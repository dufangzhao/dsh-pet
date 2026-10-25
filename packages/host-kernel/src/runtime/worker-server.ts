import path from 'node:path';
import { types } from 'node:util';
import {
  makeError,
  type JsonObject,
  type JsonValue,
  type OwnerRef,
  type Result,
} from '@pet/contracts';
import { jsonPreflight } from '@pet/contracts/validation';
import type { RpcContext, RpcHandler } from '../ipc/control-endpoint.js';
import { CordisRuntimeDriver } from './cordis-driver.js';
import { createVerifiedPluginLoader, discoverPlugins, type DiscoveredPlugin } from './discovery.js';
import { instanceKey, sameOwner } from './identity.js';
import {
  exactKeys,
  manifestDigest,
  ownerFrom,
  record,
  type WorkerBootstrap,
} from './worker-protocol.js';
import type { CapabilityMethod, CapabilityMethods, RuntimeSession } from './types.js';
interface WorkerRecord {
  owner: OwnerRef;
  controller: AbortController;
  session: RuntimeSession;
  ready: boolean;
  methods: Map<string, CapabilityMethods>;
  contributions: Map<string, CapabilityMethod | undefined>;
  stopping: Promise<void> | undefined;
}
const bad = (code: Parameters<typeof makeError>[0]): Result<JsonValue> => ({
  ok: false,
  error: makeError(code, false),
});
export class RuntimeWorkerServer {
  readonly #instances = new Map<string, WorkerRecord>();
  readonly #generations = new Map<string, number>();
  readonly #driver: CordisRuntimeDriver;
  readonly #loader: ReturnType<typeof createVerifiedPluginLoader>;
  readonly #migrating = new Set<string>();
  #closing = false;
  private constructor(
    private readonly packages: readonly DiscoveredPlugin[],
    readonly issueCount: number,
  ) {
    this.#loader = createVerifiedPluginLoader(packages);
    this.#driver = new CordisRuntimeDriver(this.#loader);
  }
  static async create(bootstrap: WorkerBootstrap): Promise<RuntimeWorkerServer> {
    const discovered = await discoverPlugins(bootstrap.roots);
    return new RuntimeWorkerServer(discovered.plugins, discovered.issues.length);
  }
  handlers(): Readonly<Record<string, RpcHandler>> {
    const handlers: Record<string, RpcHandler> = {
      'runtime.info': async () => ({
        ok: true,
        value: {
          version: 1,
          packages: this.packages.length,
          issues: this.issueCount,
          instances: this.#instances.size,
        },
      }),
      'runtime.activate': (ctx, payload) => this.activate(ctx, payload),
      'runtime.stop': (_ctx, payload) => this.stop(payload),
      'runtime.invoke': (ctx, payload) => this.invoke(ctx, payload, false),
      'runtime.command': (ctx, payload) => this.invoke(ctx, payload, true),
      'runtime.migrate': (ctx, payload) => this.migrate(ctx, payload),
    };
    return Object.freeze(handlers);
  }
  private async activate(context: RpcContext, payload: JsonValue): Promise<Result<JsonValue>> {
    const body = record(payload);
    if (
      this.#closing ||
      !body ||
      !exactKeys(body, ['owner', 'entryPath', 'manifestDigest', 'config'])
    )
      return bad('invalid-input');
    const owner = ownerFrom(body['owner']);
    const config = record(body['config']!);
    if (
      !owner ||
      !config ||
      typeof body['entryPath'] !== 'string' ||
      typeof body['manifestDigest'] !== 'string'
    )
      return bad('invalid-input');
    const candidate = this.packages.find(
      (item) =>
        item.manifest.id === owner.pluginId &&
        path.resolve(item.directory, item.manifest.entries.runtime) === body['entryPath'] &&
        manifestDigest(item.manifest) === body['manifestDigest'],
    );
    if (!candidate) return bad('not-ready');
    const key = instanceKey(owner);
    if (this.#migrating.has(key)) return bad('not-ready');
    if (this.#instances.size >= 128) return bad('quota-exceeded');
    if (this.#instances.has(key) || owner.generation <= (this.#generations.get(key) ?? 0))
      return bad('stale-owner');
    if (context.signal.aborted) return bad('cancelled');
    const controller = new AbortController();
    const abort = () => controller.abort();
    context.signal.addEventListener('abort', abort, { once: true });
    const methods = new Map<string, CapabilityMethods>(),
      contributions = new Map<string, CapabilityMethod | undefined>();
    let item: WorkerRecord | undefined;
    try {
      const session = this.#driver.start(
        {
          owner,
          manifest: candidate.manifest,
          entryPath: body['entryPath'],
          config: config as JsonObject,
          signal: controller.signal,
        },
        {
          provide: (id, implementation) => {
            if (
              controller.signal.aborted ||
              item?.ready ||
              !candidate.manifest.provides?.some((p) => p.id === id) ||
              methods.has(id)
            )
              throw new Error('Invalid registration');
            if (
              !implementation ||
              typeof implementation !== 'object' ||
              types.isProxy(implementation)
            )
              throw new Error('Invalid methods');
            const descriptors = Object.getOwnPropertyDescriptors(implementation);
            const names = Object.keys(descriptors);
            if (!names.length || names.length > 64) throw new Error('Invalid methods');
            const copy: Record<string, CapabilityMethod> = Object.create(null) as Record<
              string,
              CapabilityMethod
            >;
            for (const name of names) {
              const descriptor = descriptors[name]!;
              if (
                !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name) ||
                ['constructor', 'prototype', '__proto__'].includes(name) ||
                !('value' in descriptor) ||
                typeof descriptor.value !== 'function'
              )
                throw new Error('Invalid methods');
              copy[name] = descriptor.value as CapabilityMethod;
            }
            methods.set(id, Object.freeze(copy));
          },
          contribute: (id, handler) => {
            const declaration = candidate.manifest.contributes?.find((c) => c.id === id);
            if (
              controller.signal.aborted ||
              item?.ready ||
              !declaration ||
              contributions.has(id) ||
              (declaration.kind === 'command' && typeof handler !== 'function') ||
              (declaration.kind !== 'command' && handler !== undefined)
            )
              throw new Error('Invalid contribution');
            contributions.set(id, handler);
          },
        },
      );
      item = {
        owner: Object.freeze({ ...owner }),
        controller,
        session,
        ready: false,
        methods,
        contributions,
        stopping: undefined,
      };
      this.#instances.set(key, item);
      this.#generations.set(key, owner.generation);
      await session.ready;
      if (controller.signal.aborted || context.signal.aborted)
        throw new Error('Cancelled activation');
      if (
        (candidate.manifest.provides ?? []).some((p) => !methods.has(p.id)) ||
        (candidate.manifest.contributes ?? []).some((c) => !contributions.has(c.id))
      )
        throw new Error('Incomplete registration');
      const description = {
        providers: [...methods].map(([id, value]) => ({ id, methods: Object.keys(value) })),
        contributions: [...contributions].map(([id, handler]) => ({
          id,
          command: handler !== undefined,
        })),
      };
      const safe = jsonPreflight(description);
      if (!safe.ok || JSON.stringify(description).length > 16384)
        throw new Error('Registration budget');
      item.ready = true;
      return { ok: true, value: safe.value };
    } catch {
      controller.abort();
      if (item) {
        try {
          await this.stopItem(item);
        } catch {
          /* retain failed cleanup record */
        }
      }
      return bad(context.signal.aborted ? 'cancelled' : 'internal');
    } finally {
      context.signal.removeEventListener('abort', abort);
    }
  }
  private async stop(payload: JsonValue): Promise<Result<JsonValue>> {
    const body = record(payload);
    if (!body || !exactKeys(body, ['owner'])) return bad('invalid-input');
    const owner = ownerFrom(body['owner']);
    if (!owner) return bad('invalid-input');
    const item = this.#instances.get(instanceKey(owner));
    if (!item)
      return this.#generations.get(instanceKey(owner)) === owner.generation
        ? { ok: true, value: null }
        : bad('stale-owner');
    if (!sameOwner(item.owner, owner)) return bad('stale-owner');
    try {
      await this.stopItem(item);
      return { ok: true, value: null };
    } catch {
      return bad('internal');
    }
  }
  private stopItem(item: WorkerRecord): Promise<void> {
    item.controller.abort();
    item.ready = false;
    return (item.stopping ??= item.session.stop().then(() => {
      if (this.#instances.get(instanceKey(item.owner)) === item)
        this.#instances.delete(instanceKey(item.owner));
    }));
  }
  private async invoke(
    context: RpcContext,
    payload: JsonValue,
    command: boolean,
  ): Promise<Result<JsonValue>> {
    const body = record(payload);
    const fields = command
      ? ['owner', 'contributionId', 'input']
      : ['owner', 'providerId', 'method', 'input'];
    if (!body || !exactKeys(body, fields) || !context.taskId) return bad('invalid-input');
    const owner = ownerFrom(body['owner']);
    if (!owner) return bad('invalid-input');
    const item = this.#instances.get(instanceKey(owner));
    if (!item || !item.ready || item.controller.signal.aborted || !sameOwner(owner, item.owner))
      return bad('stale-owner');
    const method = command
      ? typeof body['contributionId'] === 'string'
        ? item.contributions.get(body['contributionId'])
        : undefined
      : typeof body['providerId'] === 'string' && typeof body['method'] === 'string'
        ? item.methods.get(body['providerId'])?.[body['method']]
        : undefined;
    if (!method) return bad('invalid-input');
    const signal = AbortSignal.any([context.signal, item.controller.signal]);
    if (signal.aborted) return bad('cancelled');
    try {
      const output = await method(
        { taskId: context.taskId, signal, deadline: performance.now() + context.budgetMs },
        body['input']!,
      );
      if (signal.aborted || !item.ready || this.#instances.get(instanceKey(owner)) !== item)
        return bad('cancelled');
      const safe = jsonPreflight(output);
      return safe.ok ? { ok: true, value: safe.value } : bad('invalid-input');
    } catch {
      return bad(signal.aborted ? 'cancelled' : 'internal');
    }
  }
  private async migrate(context: RpcContext, payload: JsonValue): Promise<Result<JsonValue>> {
    const body = record(payload);
    if (
      this.#closing ||
      !body ||
      !exactKeys(body, ['owner', 'entryPath', 'manifestDigest', 'fromVersion', 'toVersion', 'data'])
    )
      return bad('invalid-input');
    const owner = ownerFrom(body['owner']);
    const data = record(body['data']!);
    if (
      !owner ||
      !data ||
      typeof body['entryPath'] !== 'string' ||
      typeof body['manifestDigest'] !== 'string' ||
      !Number.isSafeInteger(body['fromVersion']) ||
      !Number.isSafeInteger(body['toVersion']) ||
      (body['fromVersion'] as number) < 1 ||
      (body['fromVersion'] as number) >= (body['toVersion'] as number)
    )
      return bad('invalid-input');
    const key = instanceKey(owner);
    if (this.#instances.has(key) || this.#migrating.has(key) || this.#migrating.size >= 4)
      return bad('not-ready');
    const candidate = this.packages.find(
      (item) =>
        item.manifest.id === owner.pluginId &&
        item.manifest.config?.version === body['toVersion'] &&
        path.resolve(item.directory, item.manifest.entries.runtime) === body['entryPath'] &&
        manifestDigest(item.manifest) === body['manifestDigest'],
    );
    if (!candidate) return bad('not-ready');
    if (context.signal.aborted) return bad('cancelled');
    this.#migrating.add(key);
    try {
      const module = await this.#loader({
        owner,
        manifest: candidate.manifest,
        entryPath: body['entryPath'],
        config: {},
        signal: context.signal,
      });
      if (context.signal.aborted) return bad('cancelled');
      if (typeof module.migrateConfig !== 'function') return bad('not-ready');
      const migrated = await module.migrateConfig(
        Object.freeze({
          fromVersion: body['fromVersion'] as number,
          toVersion: body['toVersion'] as number,
          data: Object.freeze(structuredClone(data)),
          signal: context.signal,
        }),
      );
      if (context.signal.aborted) return bad('cancelled');
      const safe = jsonPreflight(migrated);
      return safe.ok && record(safe.value) ? { ok: true, value: safe.value } : bad('invalid-input');
    } catch {
      return bad(context.signal.aborted ? 'cancelled' : 'internal');
    } finally {
      this.#migrating.delete(key);
    }
  }
  async shutdown(): Promise<void> {
    this.#closing = true;
    const outcomes = await Promise.allSettled(
      [...this.#instances.values()].map((item) => this.stopItem(item)),
    );
    await this.#driver.dispose();
    if (outcomes.some((o) => o.status === 'rejected'))
      throw new Error('Runtime cleanup incomplete');
  }
}
