import path from 'node:path';
import { KernelFault } from '../kernel-fault.js';
import { prepareConfigDefinition } from '../config/schema.js';
import {
  makeError,
  type JsonObject,
  type KernelError,
  type OwnerRef,
  type PluginLifecycleState,
  type PluginManifest,
  type PlatformTarget,
  type Result,
} from '@pet/contracts';
import { checkCompatibility, jsonPreflight, validateManifest } from '@pet/contracts/validation';
import { CapabilityRegistry, type ProviderSelector } from './capability-registry.js';
import { freezeJson, instanceKey, sameOwner, type InstanceIdentity } from './identity.js';
import type {
  CapabilityMethod,
  CapabilityMethods,
  RegisteredContribution,
  RuntimeDriver,
  RuntimeSession,
} from './types.js';

export interface Installation {
  readonly directory: string;
  readonly origin: 'builtin' | 'user';
}
export interface PluginSnapshot {
  readonly owner: OwnerRef;
  readonly state: PluginLifecycleState;
  readonly manifest: PluginManifest;
  readonly origin: 'builtin' | 'user';
  readonly protected: boolean;
  readonly reason?: KernelError;
}
export interface PluginManagerOptions {
  readonly driver: RuntimeDriver;
  readonly hostApiVersion: string;
  readonly platform: PlatformTarget;
  readonly protectedPackages?: Readonly<Record<string, string>>;
  readonly trust?: (snapshot: PluginSnapshot, signal: AbortSignal) => Promise<boolean>;
  readonly readiness?: (
    snapshot: PluginSnapshot,
    config: JsonObject,
    signal: AbortSignal,
  ) => Promise<KernelError | null>;
  readonly removeInstallation?: (
    snapshot: PluginSnapshot,
    installation: Installation,
  ) => Promise<boolean>;
  readonly activationTimeoutMs?: number;
  readonly cleanupTimeoutMs?: number;
}
interface Entry {
  owner: OwnerRef;
  manifest: PluginManifest;
  installation: Installation;
  protected: boolean;
  state: PluginLifecycleState;
  reason: KernelError | undefined;
  abort: AbortController;
  ownerAbort: AbortController;
  session: RuntimeSession | undefined;
  enablePromise: Promise<Result<PluginSnapshot>> | undefined;
  stopPromise: Promise<boolean> | undefined;
  desired: boolean;
  config: JsonObject;
  cleanupError: KernelError | undefined;
  uninstallPromise: Promise<Result<null>> | undefined;
  providers: Map<string, CapabilityMethods>;
  contributions: Map<string, CapabilityMethod | undefined>;
}
class LifecycleFault extends Error {
  constructor(readonly code: KernelError['code']) {
    super(code);
  }
}
function bounded<T>(promise: Promise<T>, milliseconds: number, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error: unknown, value?: T) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(value as T);
    };
    const abort = () => finish(new LifecycleFault('cancelled'));
    const timer = setTimeout(() => finish(new LifecycleFault('timeout')), milliseconds);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    void promise.then(
      (value) => finish(null, value),
      () => finish(new LifecycleFault('internal')),
    );
  });
}
const fail = <T>(code: KernelError['code']): Result<T> => ({
  ok: false,
  error: makeError(code, false),
});
const local = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Host authority. Ordinary plugin APIs never receive this manager. */
export class PluginManager {
  readonly #entries = new Map<string, Entry>();
  readonly #generations = new Map<string, number>();
  readonly capabilities: CapabilityRegistry;
  #closing = false;
  readonly #activationMs: number;
  readonly #cleanupMs: number;
  constructor(private readonly options: PluginManagerOptions) {
    this.#activationMs = options.activationTimeoutMs ?? 5000;
    this.#cleanupMs = options.cleanupTimeoutMs ?? 2000;
    if (
      !Number.isSafeInteger(this.#activationMs) ||
      this.#activationMs < 1 ||
      this.#activationMs > 60000 ||
      !Number.isSafeInteger(this.#cleanupMs) ||
      this.#cleanupMs < 1 ||
      this.#cleanupMs > 30000
    )
      throw new Error('Invalid lifecycle timeout');
    this.capabilities = new CapabilityRegistry(
      (owner) => this.isActive(owner),
      (owner) => this.isLive(owner),
    );
  }
  install(
    input: unknown,
    installation: Installation,
    instanceId = 'default',
  ): Result<PluginSnapshot> {
    if (
      this.#closing ||
      !local.test(instanceId) ||
      ['constructor', 'prototype', '__proto__'].includes(instanceId) ||
      !installation ||
      !path.isAbsolute(installation.directory) ||
      !['builtin', 'user'].includes(installation.origin)
    )
      return fail('invalid-input');
    const parsed = validateManifest(input);
    if (!parsed.ok) return parsed;
    const manifest = freezeJson(parsed.value);
    const key = instanceKey({ pluginId: manifest.id, instanceId });
    if (this.#entries.has(key)) return fail('invalid-input');
    const generation = (this.#generations.get(key) ?? 0) + 1;
    this.#generations.set(key, generation);
    const catalog = this.options.protectedPackages;
    const declaredRoot =
      catalog && Object.hasOwn(catalog, manifest.id) ? catalog[manifest.id] : undefined;
    if (
      declaredRoot !== undefined &&
      (typeof declaredRoot !== 'string' ||
        installation.origin !== 'builtin' ||
        path.resolve(declaredRoot) !== path.resolve(installation.directory))
    )
      return fail('permission-denied');
    const entry: Entry = {
      owner: freezeJson({ pluginId: manifest.id, instanceId, generation }),
      manifest,
      installation: Object.freeze({
        ...installation,
        directory: path.resolve(installation.directory),
      }),
      protected:
        installation.origin === 'builtin' &&
        declaredRoot !== undefined &&
        path.resolve(declaredRoot) === path.resolve(installation.directory),
      state: 'disabled',
      reason: undefined,
      abort: new AbortController(),
      ownerAbort: new AbortController(),
      session: undefined,
      enablePromise: undefined,
      stopPromise: undefined,
      desired: false,
      config: Object.freeze({}),
      cleanupError: undefined,
      uninstallPromise: undefined,
      providers: new Map(),
      contributions: new Map(),
    };
    const compatible = checkCompatibility(manifest, {
      hostApiVersion: this.options.hostApiVersion,
      platform: this.options.platform,
    });
    if (!compatible.ok) {
      entry.state = 'rejected';
      entry.reason = compatible.error;
    }
    if (manifest.config) {
      const keys =
        manifest.permissions?.filter((p) => p.kind === 'credentials').flatMap((p) => p.keys) ?? [];
      const config = prepareConfigDefinition(manifest.config, keys);
      if (!config.ok) {
        entry.state = 'rejected';
        entry.reason = config.error;
      }
    }
    this.#entries.set(key, entry);
    return { ok: true, value: this.snapshot(entry) };
  }
  get(identity: InstanceIdentity): PluginSnapshot | null {
    const entry = this.#entries.get(instanceKey(identity));
    return entry ? this.snapshot(entry) : null;
  }
  list(): readonly PluginSnapshot[] {
    return [...this.#entries.values()].map((entry) => this.snapshot(entry));
  }
  isActive(owner: OwnerRef): boolean {
    const e = this.#entries.get(instanceKey(owner));
    return !!e && sameOwner(e.owner, owner) && e.state === 'active' && !e.abort.signal.aborted;
  }
  isLive(owner: OwnerRef): boolean {
    const e = this.#entries.get(instanceKey(owner));
    return (
      !!e &&
      sameOwner(e.owner, owner) &&
      !!e.session &&
      ['active', 'unready'].includes(e.state) &&
      !e.abort.signal.aborted
    );
  }
  signal(owner: OwnerRef): AbortSignal | null {
    const e = this.#entries.get(instanceKey(owner));
    return e && sameOwner(e.owner, owner) ? e.abort.signal : null;
  }
  /** Configuration survives stop, but no request may cross an owner generation. */
  ownerSignal(owner: OwnerRef): AbortSignal | null {
    const entry = this.#entries.get(instanceKey(owner));
    return !this.#closing && entry && sameOwner(entry.owner, owner)
      ? entry.ownerAbort.signal
      : null;
  }
  select(
    consumer: InstanceIdentity,
    capability: string,
    provider: ProviderSelector | null,
  ): Result<null> {
    const e = this.#entries.get(instanceKey(consumer));
    if (!e || !e.manifest.consumes?.some((c) => c.capability === capability))
      return fail('invalid-input');
    this.capabilities.select(consumer, capability, provider);
    this.refreshDependencies();
    return { ok: true, value: null };
  }
  enable(identity: InstanceIdentity, config?: JsonObject): Promise<Result<PluginSnapshot>> {
    const entry = this.#entries.get(instanceKey(identity));
    if (!entry || this.#closing || entry.uninstallPromise)
      return Promise.resolve(fail('not-ready'));
    if (entry.enablePromise) return entry.enablePromise;
    if (entry.state === 'active') return Promise.resolve({ ok: true, value: this.snapshot(entry) });
    if (['rejected', 'deactivating', 'pending_restart'].includes(entry.state))
      return Promise.resolve(fail('not-ready'));
    if (entry.session) {
      this.refreshDependencies();
      return Promise.resolve(
        this.isActive(entry.owner) ? { ok: true, value: this.snapshot(entry) } : fail('not-ready'),
      );
    }
    const safeConfig = jsonPreflight(config ?? entry.config);
    if (
      !safeConfig.ok ||
      !safeConfig.value ||
      typeof safeConfig.value !== 'object' ||
      Array.isArray(safeConfig.value)
    )
      return Promise.resolve(fail('invalid-input'));
    entry.config = freezeJson(safeConfig.value as JsonObject);
    entry.cleanupError = undefined;
    entry.desired = true;
    entry.state = 'activating';
    entry.reason = undefined;
    entry.ownerAbort.abort();
    entry.ownerAbort = new AbortController();
    entry.abort = new AbortController();
    entry.stopPromise = undefined;
    entry.providers.clear();
    entry.contributions.clear();
    const key = instanceKey(entry.owner);
    const generation = (this.#generations.get(key) ?? 0) + 1;
    this.#generations.set(key, generation);
    entry.owner = freezeJson({ ...entry.owner, generation });
    const work = this.activate(entry, entry.config);
    entry.enablePromise = work;
    void work.finally(() => {
      if (entry.enablePromise === work) entry.enablePromise = undefined;
    });
    return work;
  }
  private async activate(entry: Entry, config: JsonObject): Promise<Result<PluginSnapshot>> {
    const owner = entry.owner;
    const deadline = performance.now() + this.#activationMs;
    const remaining = () => {
      const left = deadline - performance.now();
      if (left <= 0) throw new LifecycleFault('timeout');
      return left;
    };
    const current = () =>
      sameOwner(entry.owner, owner) && entry.state === 'activating' && !entry.abort.signal.aborted;
    try {
      const trusted = this.options.trust
        ? await bounded(
            Promise.resolve().then(() => {
              if (!current()) throw new LifecycleFault('cancelled');
              return this.options.trust!(this.snapshot(entry), entry.abort.signal);
            }),
            remaining(),
            entry.abort.signal,
          )
        : false;
      if (!current()) throw new LifecycleFault('cancelled');
      if (!trusted) {
        entry.state = 'unready';
        entry.reason = makeError('permission-denied', false);
        return fail('permission-denied');
      }
      const needsServices =
        !!entry.manifest.config ||
        !!entry.manifest.permissions?.length ||
        !!entry.manifest.resources?.length;
      const problem = this.options.readiness
        ? await bounded(
            this.options.readiness(this.snapshot(entry), config, entry.abort.signal),
            remaining(),
            entry.abort.signal,
          )
        : needsServices
          ? makeError('not-ready')
          : null;
      if (!current()) throw new LifecycleFault('cancelled');
      if (problem || !this.dependenciesReady(entry)) {
        entry.state = 'unready';
        entry.reason = problem ? makeError(problem.code, false) : makeError('not-ready');
        return { ok: true, value: this.snapshot(entry) };
      }
      const requireCurrent = () => {
        if (!current()) throw new LifecycleFault('stale-owner');
      };
      entry.session = this.options.driver.start(
        {
          owner,
          manifest: entry.manifest,
          entryPath: path.resolve(entry.installation.directory, entry.manifest.entries.runtime),
          config,
          signal: entry.abort.signal,
        },
        {
          provide: (id, methods) => {
            requireCurrent();
            if (!entry.manifest.provides?.some((p) => p.id === id) || entry.providers.has(id))
              throw new LifecycleFault('invalid-input');
            entry.providers.set(id, methods);
          },
          contribute: (id, handler) => {
            requireCurrent();
            const declared = entry.manifest.contributes?.find((c) => c.id === id);
            if (
              !declared ||
              entry.contributions.has(id) ||
              (declared.kind === 'command' && typeof handler !== 'function') ||
              (declared.kind !== 'command' && handler !== undefined)
            )
              throw new LifecycleFault('invalid-input');
            entry.contributions.set(id, handler);
          },
        },
      );
      await bounded(entry.session.ready, remaining(), entry.abort.signal);
      requireCurrent();
      if (
        (entry.manifest.provides ?? []).some((p) => !entry.providers.has(p.id)) ||
        (entry.manifest.contributes ?? []).some((c) => !entry.contributions.has(c.id))
      )
        throw new LifecycleFault('not-ready');
      for (const declaration of entry.manifest.provides ?? [])
        this.capabilities.register(owner, declaration, entry.providers.get(declaration.id)!);
      entry.state = 'active';
      this.refreshDependencies();
      return { ok: true, value: this.snapshot(entry) };
    } catch (error) {
      const code =
        error instanceof LifecycleFault
          ? error.code
          : error instanceof KernelFault
            ? error.error.code
            : 'internal';
      const stillOwned = sameOwner(entry.owner, owner);
      if (!stillOwned) return fail('stale-owner');
      const externalStop = entry.state !== 'activating';
      entry.abort.abort();
      this.capabilities.unregister(owner);
      const cleaned = await this.cleanup(entry);
      if (!externalStop) {
        entry.state = cleaned ? 'failed' : 'pending_restart';
        entry.reason = makeError(code, false);
      }
      return fail(code);
    }
  }
  /** Transport supervisor only: a stale runtime cannot fail a new generation. */
  async reportFault(owner: OwnerRef): Promise<Result<PluginSnapshot>> {
    const e = this.#entries.get(instanceKey(owner));
    if (!e || !sameOwner(e.owner, owner) || !this.isLive(owner)) return fail('stale-owner');
    e.abort.abort();
    e.state = 'failed';
    e.reason = makeError('unavailable', false);
    this.capabilities.unregister(owner);
    e.contributions.clear();
    this.refreshDependencies();
    const cleaned = await this.cleanup(e);
    if (!cleaned) {
      e.state = 'pending_restart';
      e.reason = e.cleanupError ?? makeError('internal', false);
    }
    return { ok: true, value: this.snapshot(e) };
  }

  async disable(identity: InstanceIdentity): Promise<Result<PluginSnapshot>> {
    const e = this.#entries.get(instanceKey(identity));
    if (!e) return fail('not-ready');
    if (e.protected) return fail('permission-denied');
    return this.stop(e);
  }
  private async stop(e: Entry): Promise<Result<PluginSnapshot>> {
    if (e.state === 'pending_restart') return fail('not-ready');
    e.desired = false;
    e.state = 'deactivating';
    e.abort.abort();
    this.capabilities.unregister(e.owner);
    e.contributions.clear();
    this.refreshDependencies();
    const clean = await this.cleanup(e);
    e.state = clean ? 'disabled' : 'pending_restart';
    e.reason = clean ? undefined : (e.cleanupError ?? makeError('internal', false));
    return { ok: true, value: this.snapshot(e) };
  }
  uninstall(identity: InstanceIdentity): Promise<Result<null>> {
    const e = this.#entries.get(instanceKey(identity));
    if (!e) return Promise.resolve(fail('not-ready'));
    if (e.protected) return Promise.resolve(fail('permission-denied'));
    if (!this.options.removeInstallation) return Promise.resolve(fail('not-ready'));
    if (e.uninstallPromise) return e.uninstallPromise;
    const pending = this.remove(e);
    e.uninstallPromise = pending;
    void pending.then(
      () => {
        e.uninstallPromise = undefined;
      },
      () => {
        e.uninstallPromise = undefined;
      },
    );
    return pending;
  }
  private async remove(e: Entry): Promise<Result<null>> {
    const stopped = await this.stop(e);
    if (!stopped.ok || stopped.value.state !== 'disabled') return fail('not-ready');
    e.state = 'deactivating';
    try {
      if (!(await this.options.removeInstallation!(this.snapshot(e), e.installation))) {
        e.state = 'disabled';
        return fail('unavailable');
      }
    } catch {
      e.state = 'disabled';
      return fail('unavailable');
    }
    e.ownerAbort.abort();
    this.#entries.delete(instanceKey(e.owner));
    this.capabilities.forgetConsumer(e.owner);
    return { ok: true, value: null };
  }
  resolveCommand(owner: OwnerRef, id: string): Result<CapabilityMethod> {
    const entry = this.#entries.get(instanceKey(owner));
    if (!entry || !this.isActive(owner))
      return { ok: false, error: makeError('stale-owner', false) };
    const declared = entry.manifest.contributes?.find((c) => c.id === id && c.kind === 'command');
    const method = entry.contributions.get(id);
    return declared && method
      ? { ok: true, value: method }
      : { ok: false, error: makeError('not-ready', false) };
  }
  contributions(): readonly RegisteredContribution[] {
    return freezeJson(
      [...this.#entries.values()]
        .filter((e) => e.state === 'active')
        .flatMap((e) =>
          [...e.contributions.keys()].map((id) => ({
            owner: { ...e.owner },
            id,
            declaration: e.manifest.contributes!.find((item) => item.id === id)!,
          })),
        ),
    );
  }
  async shutdown(): Promise<void> {
    this.#closing = true;
    for (const entry of this.#entries.values()) entry.ownerAbort.abort();
    await Promise.all([...this.#entries.values()].map((e) => this.stop(e)));
  }
  async reconcile(): Promise<void> {
    this.refreshDependencies();
    for (const e of this.#entries.values())
      if (e.desired && e.state === 'unready' && !e.session && this.dependenciesReady(e))
        await this.enable(e.owner);
  }
  private dependenciesReady(e: Entry): boolean {
    return (e.manifest.consumes ?? []).every(
      (c) => c.optional || this.capabilities.resolveSelection(e.owner, c.capability, c.features).ok,
    );
  }
  private refreshDependencies(): void {
    // Iterative degradation handles dependent providers without switching selections.
    for (let pass = 0; pass < this.#entries.size; pass++) {
      let changed = false;
      for (const e of this.#entries.values()) {
        if (!e.session || e.abort.signal.aborted || !['active', 'unready'].includes(e.state))
          continue;
        const ready = this.dependenciesReady(e);
        const state = ready ? 'active' : 'unready';
        if (e.state !== state) {
          e.state = state;
          e.reason = ready ? undefined : makeError('not-ready');
          changed = true;
        }
      }
      if (!changed) break;
    }
  }
  private cleanup(e: Entry): Promise<boolean> {
    if (e.stopPromise) return e.stopPromise;
    e.stopPromise = (async () => {
      try {
        if (e.session)
          await bounded(
            Promise.resolve().then(() => e.session!.stop()),
            this.#cleanupMs,
          );
        e.session = undefined;
        e.providers.clear();
        e.contributions.clear();
        return true;
      } catch (error) {
        e.cleanupError = makeError(
          error instanceof LifecycleFault ? error.code : 'internal',
          false,
        );
        return false;
      }
    })();
    return e.stopPromise;
  }
  private snapshot(e: Entry): PluginSnapshot {
    return freezeJson(
      structuredClone({
        owner: e.owner,
        state: e.state,
        manifest: e.manifest,
        origin: e.installation.origin,
        protected: e.protected,
        ...(e.reason ? { reason: e.reason } : {}),
      }),
    );
  }
}
