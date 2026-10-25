import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Duplex, type Readable, type Writable } from 'node:stream';
import {
  makeError,
  type JsonObject,
  type JsonValue,
  type OwnerRef,
  type Result,
} from '@pet/contracts';
import { ControlEndpoint } from '../ipc/control-endpoint.js';
import { childProcessControl } from '../ipc/node-control-transport.js';
import { FramedMediaPort } from '../ipc/media-port.js';
import { KernelFault } from '../kernel-fault.js';
import { manifestDigest, parseBootstrap, record, ownerFrom, exactKeys } from './worker-protocol.js';
import { sameOwner } from './identity.js';
import { TaskMediaPeer, mediaReference } from '../tasks/media-peer.js';
import { SensitivePeer } from '../credentials/sensitive-peer.js';
import type { RuntimeHostPort } from './host-services.js';
import type { RpcContext } from '../ipc/control-endpoint.js';
import type { DiscoveryRoot } from './discovery.js';
import type {
  ActivationRegistrar,
  CapabilityMethod,
  RuntimeActivation,
  RuntimeDriver,
  RuntimeSession,
} from './types.js';
export type RuntimeProcessState = 'starting' | 'ready' | 'failed' | 'stopped';
export interface RemoteRuntimeOptions {
  executable: string;
  workerEntry: string;
  roots: readonly DiscoveryRoot[];
  host?: RuntimeHostPort;
  startupTimeoutMs?: number;
  stopTimeoutMs?: number;
  onFault?: (owner: OwnerRef) => void;
}
interface RemoteSession {
  owner: OwnerRef;
  stop: () => Promise<void>;
}
const unwrap = <T>(result: Result<T>): T => {
  if (!result.ok) throw new KernelFault(result.error.code);
  return result.value;
};
const bounded = <T>(promise: Promise<T>, ms: number): Promise<T | undefined> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      },
    );
  });
export class RemoteRuntimeDriver implements RuntimeDriver {
  readonly #child: ChildProcess;
  readonly #endpoint: ControlEndpoint;
  readonly #media: FramedMediaPort;
  readonly #streams: TaskMediaPeer;
  readonly #sensitive: SensitivePeer;
  readonly #sensitivePort: FramedMediaPort;
  readonly #exit: Promise<number | null>;
  readonly #ready: Promise<void>;
  readonly #sessions = new Set<RemoteSession>();
  #exited = false;
  #exitCode: number | null = null;
  #closing = false;
  #forced = false;
  #state: RuntimeProcessState = 'starting';
  #disposing: Promise<{ exitConfirmed: boolean; forced: boolean }> | undefined;
  constructor(private readonly options: RemoteRuntimeOptions) {
    if (!path.isAbsolute(options.executable) || !path.isAbsolute(options.workerEntry))
      throw new Error('Runtime paths must be absolute');
    for (const value of [options.startupTimeoutMs ?? 5000, options.stopTimeoutMs ?? 2000])
      if (!Number.isSafeInteger(value) || value < 1 || value > 30000)
        throw new Error('Invalid runtime timeout');
    const startupDeadline = performance.now() + (options.startupTimeoutMs ?? 5000);
    const startupBudget = () => Math.max(1, Math.floor(startupDeadline - performance.now()));
    const bootstrap = parseBootstrap({
      version: 1,
      sessionId: randomUUID(),
      owner: { pluginId: 'core.runtime', instanceId: randomUUID(), generation: 1 },
      roots: options.roots,
    });
    if (!bootstrap) throw new Error('Invalid runtime bootstrap');
    const env: NodeJS.ProcessEnv = { ELECTRON_RUN_AS_NODE: '1' };
    for (const name of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH'])
      if (process.env[name]) env[name] = process.env[name];
    this.#child = spawn(options.executable, [options.workerEntry, JSON.stringify(bootstrap)], {
      cwd: path.dirname(options.workerEntry),
      env,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc', 'pipe', 'pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let exited!: (value: number | null) => void;
    this.#exit = new Promise((resolve) => {
      exited = resolve;
    });
    this.#child.once('exit', (code) => {
      this.#exited = true;
      this.#streams.close();
      this.#media.close();
      this.#sensitive.close();
      this.#sensitivePort.close();
      this.#exitCode = code;
      this.#state = this.#closing ? 'stopped' : 'failed';
      exited(code);
      if (!this.#closing) this.notifyFaults();
    });
    this.#child.on('error', () => {
      this.#state = 'failed';
      if (this.#child.pid === undefined) {
        this.#exited = true;
        exited(null);
      }
      if (!this.#closing) this.notifyFaults();
    });
    this.#streams = new TaskMediaPeer({
      signalFor: (owner, taskId) => this.options.host?.signalFor(owner, taskId) ?? null,
      write: (frame) =>
        this.options.host?.allowFrame?.(frame) === false
          ? Promise.resolve({ ok: false, error: makeError('invalid-input', false) })
          : this.#media.write(frame),
      closed: (reference) => this.options.host?.forget?.(reference.streamId),
      control: (message) => this.#endpoint.streamControl(message),
    });
    this.#sensitive = new SensitivePeer({ write: (frame) => this.#sensitivePort.write(frame) });
    this.#endpoint = new ControlEndpoint(childProcessControl(this.#child), {
      sessionId: bootstrap.sessionId,
      owner: bootstrap.owner,
      live: () => !this.#exited,
      allowJson: (value) => this.options.host?.allowJson?.(value) !== false,
      handlers: { 'host.api': (context, payload) => this.fromWorker(context, payload) },
      onStreamControl: (message) => {
        const result = this.#streams.control(message);
        if (!result.ok) throw new Error('Invalid stream control');
      },
      onClosed: () => {
        if (!this.#closing && !this.#exited) {
          this.#state = 'failed';
          void bounded(this.#exit, 100).then(() => {
            if (!this.#closing && !this.#exited) {
              this.#forced = true;
              this.#child.kill();
              void bounded(this.#exit, 1000).then(() => {
                if (!this.#exited) this.notifyFaults();
              });
            }
          });
        }
      },
    });
    const stdio = this.#child.stdio as readonly (Readable | Writable | null | undefined)[];
    const outgoing = stdio[4],
      incoming = stdio[5];
    if (!outgoing || !incoming) throw new Error('Missing runtime media pipes');
    const pipe = Duplex.from({ readable: incoming, writable: outgoing });
    this.#media = new FramedMediaPort(
      pipe as Duplex,
      (frame) => this.#streams.receive(frame),
      (error) => this.#streams.close(error),
    );
    if (!stdio[6] || !stdio[7]) throw new Error('Missing sensitive pipes');
    this.#sensitivePort = new FramedMediaPort(
      Duplex.from({ readable: stdio[7], writable: stdio[6] }),
      (frame) => this.#sensitive.receive(frame),
      () => this.#sensitive.close(),
    );
    this.#ready = this.#endpoint
      .request('runtime.info', null, { budgetMs: startupBudget() })
      .then(async (result) => {
        const value = record(unwrap(result));
        if (!value || value['version'] !== 1 || value['completion'] !== 'work-v1' || this.#exited)
          throw new KernelFault('unavailable');
        const sent = await bounded(
          this.#media.write({
            header: {
              streamId: bootstrap.sessionId,
              taskId: 'core-media-ready',
              owner: bootstrap.owner,
              sequence: 0,
              byteLength: 0,
            },
            payload: new Uint8Array(0),
          }),
          startupBudget(),
        );
        if (!sent) throw new KernelFault('timeout');
        unwrap(sent);
        const ready = record(
          unwrap(
            await this.#endpoint.request('runtime.media-ready', null, {
              budgetMs: startupBudget(),
            }),
          ),
        );
        if (!ready || ready['version'] !== 1 || performance.now() >= startupDeadline)
          throw new KernelFault('timeout');
        this.#state = 'ready';
      })
      .catch(async () => {
        this.#state = 'failed';
        if (!this.#exited) {
          this.#forced = true;
          this.#child.kill();
          await bounded(this.#exit, 1000);
        }
        throw new KernelFault('unavailable');
      });
    void this.#ready.catch(() => {});
  }
  private async fromWorker(context: RpcContext, payload: JsonValue): Promise<Result<JsonValue>> {
    const bad = (code: Parameters<typeof makeError>[0]): Result<JsonValue> => ({
      ok: false,
      error: makeError(code, false),
    });
    const body = record(payload);
    if (
      !body ||
      !exactKeys(body, ['owner', 'action', 'payload']) ||
      typeof body['action'] !== 'string'
    )
      return bad('invalid-input');
    const owner = ownerFrom(body['owner']);
    if (
      !owner ||
      !this.#sessions.size ||
      ![...this.#sessions].some((session) => sameOwner(session.owner, owner)) ||
      !this.options.host
    )
      return bad('permission-denied');
    if (body['action'] === 'credentials.use') {
      const value = record(body['payload']!);
      const reference = value && mediaReference(value['reference']);
      if (
        !value ||
        !exactKeys(value, ['keyId', 'reference']) ||
        typeof value['keyId'] !== 'string' ||
        !reference ||
        reference.streamId !== context.taskId ||
        !sameOwner(reference.owner, owner) ||
        !this.options.host.signalFor(owner, reference.taskId)
      )
        return bad('permission-denied');
      if (!this.options.host.useCredential) return bad('not-ready');
      return this.options.host.useCredential(
        owner,
        reference.taskId,
        value['keyId'],
        context.signal,
        (secret, signal) => this.#sensitive.send(reference, secret, signal),
      );
    }
    if (body['action'] === 'media.input' || body['action'] === 'media.output') {
      const reference = mediaReference(body['payload']);
      if (
        !reference ||
        reference.taskId !== context.taskId ||
        !sameOwner(reference.owner, owner) ||
        !this.options.host.signalFor(owner, reference.taskId)
      )
        return bad('permission-denied');
      if (body['action'] === 'media.input') {
        if (!this.options.host.input) return bad('not-ready');
        const writer = this.#streams.createWriter(reference);
        if (!writer.ok) return writer;
        try {
          this.options.host.input(reference, writer.value);
        } catch {
          writer.value.cancel();
          return bad('internal');
        }
      } else {
        if (!this.options.host.output) return bad('not-ready');
        const reader = this.#streams.createReader(reference);
        if (!reader.ok) return reader;
        try {
          this.options.host.output(reference, reader.value);
          const credit = this.#streams.grantInitial(reference);
          if (!credit.ok) {
            reader.value.cancel();
            return credit;
          }
        } catch {
          reader.value.cancel();
          return bad('internal');
        }
      }
      return { ok: true, value: reference as unknown as JsonValue };
    }
    return this.options.host.request(owner, body['action'], body['payload']!, context);
  }
  private notifyFaults(): void {
    for (const session of this.#sessions)
      try {
        this.options.onFault?.(session.owner);
      } catch {
        /* metadata only */
      }
  }
  status(): {
    state: RuntimeProcessState;
    pid: number | null;
    exitCode: number | null;
    exitConfirmed: boolean;
    forced: boolean;
  } {
    return {
      state: this.#state,
      pid: this.#child.pid ?? null,
      exitCode: this.#exitCode,
      exitConfirmed: this.#exited,
      forced: this.#forced,
    };
  }
  inspectRuntime(): Promise<Result<JsonValue>> {
    return this.#endpoint.request('runtime.info', null, { budgetMs: 1000 });
  }
  mediaStats() {
    return { ...this.#streams.snapshot(), port: this.#media.snapshot() };
  }
  ready(): Promise<void> {
    return this.#ready;
  }
  waitForExit(): Promise<number | null> {
    return this.#exit;
  }
  start(activation: RuntimeActivation, registrar: ActivationRegistrar): RuntimeSession {
    if (this.#closing || this.#exited) throw new KernelFault('unavailable');
    const owner = Object.freeze({ ...activation.owner });
    let stopping: Promise<void> | undefined;
    const remote: RemoteSession = {
      owner,
      stop: () => {
        return (stopping ??= Promise.resolve().then(async () => {
          if (this.#state === 'failed' && !this.#exited) await bounded(this.#exit, 1200);
          if (this.#exited) {
            this.#sessions.delete(remote);
            return;
          }
          await this.#ready;
          unwrap(
            await this.#endpoint.request('runtime.stop', { owner } as unknown as JsonValue, {
              budgetMs: this.options.stopTimeoutMs ?? 2000,
            }),
          );
          this.#sessions.delete(remote);
        }));
      },
    };
    this.#sessions.add(remote);
    const ready = this.#ready.then(async () => {
      if (activation.signal.aborted) throw new KernelFault('cancelled');
      const description = record(
        unwrap(
          await this.#endpoint.request(
            'runtime.activate',
            {
              owner,
              entryPath: activation.entryPath,
              manifestDigest: manifestDigest(activation.manifest),
              config: activation.config,
            } as unknown as JsonValue,
            { signal: activation.signal, budgetMs: this.options.startupTimeoutMs ?? 5000 },
          ),
        ),
      );
      if (
        !description ||
        !Array.isArray(description['providers']) ||
        !Array.isArray(description['contributions']) ||
        activation.signal.aborted
      )
        throw new KernelFault('invalid-input');
      for (const row of description['providers']) {
        const provider = record(row);
        if (
          !provider ||
          typeof provider['id'] !== 'string' ||
          !Array.isArray(provider['methods']) ||
          provider['methods'].length > 64 ||
          !activation.manifest.provides?.some((p) => p.id === provider['id'])
        )
          throw new KernelFault('invalid-input');
        const methods: Record<string, CapabilityMethod> = Object.create(null) as Record<
          string,
          CapabilityMethod
        >;
        for (const method of provider['methods']) {
          if (
            typeof method !== 'string' ||
            !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(method) ||
            ['constructor', 'prototype', '__proto__'].includes(method) ||
            Object.hasOwn(methods, method)
          )
            throw new KernelFault('invalid-input');
          methods[method] = (context, input) =>
            this.call(
              'runtime.invoke',
              { owner, providerId: provider['id'], method, input } as unknown as JsonValue,
              context.taskId,
              context.signal,
              context.deadline,
            );
        }
        registrar.provide(provider['id'], Object.freeze(methods));
      }
      for (const row of description['contributions']) {
        const item = record(row);
        if (
          !item ||
          typeof item['id'] !== 'string' ||
          typeof item['command'] !== 'boolean' ||
          !activation.manifest.contributes?.some(
            (c) => c.id === item['id'] && (c.kind === 'command') === item['command'],
          )
        )
          throw new KernelFault('invalid-input');
        const id = item['id'];
        registrar.contribute(
          id,
          item['command']
            ? (context, input) =>
                this.call(
                  'runtime.command',
                  { owner, contributionId: id, input } as unknown as JsonValue,
                  context.taskId,
                  context.signal,
                  context.deadline,
                )
            : undefined,
        );
      }
    });
    void ready.catch(() => {});
    return Object.freeze({ ready, stop: remote.stop });
  }
  async migrateConfig(
    activation: Pick<RuntimeActivation, 'owner' | 'manifest' | 'entryPath'>,
    source: {
      fromVersion: number;
      toVersion: number;
      data: JsonObject;
      signal: AbortSignal;
    },
  ): Promise<JsonObject> {
    await this.#ready;
    if (this.#closing || this.#exited || source.signal.aborted) throw new KernelFault('cancelled');
    const value = record(
      unwrap(
        await this.#endpoint.request(
          'runtime.migrate',
          {
            owner: activation.owner,
            entryPath: activation.entryPath,
            manifestDigest: manifestDigest(activation.manifest),
            fromVersion: source.fromVersion,
            toVersion: source.toVersion,
            data: source.data,
          } as unknown as JsonValue,
          { signal: source.signal, budgetMs: 30000 },
        ),
      ),
    );
    if (!value) throw new KernelFault('invalid-input');
    return value;
  }
  private async call(
    method: string,
    payload: JsonValue,
    taskId: string,
    signal: AbortSignal,
    deadline?: number,
  ): Promise<JsonValue> {
    const budget = deadline === undefined ? 30000 : Math.floor(deadline - performance.now());
    if (budget < 1) throw new KernelFault('timeout');
    const result = await this.#endpoint.request(method, payload, {
      taskId,
      signal,
      budgetMs: Math.min(budget, 86400000),
      waitForWork: true,
    });
    if (!this.#exited && this.#endpoint.diagnostics().closed) await this.#exit;
    return unwrap(result);
  }
  dispose(): Promise<{ exitConfirmed: boolean; forced: boolean }> {
    return (this.#disposing ??= this.shutdown());
  }
  private async shutdown(): Promise<{ exitConfirmed: boolean; forced: boolean }> {
    this.#closing = true;
    await bounded(
      Promise.allSettled([...this.#sessions].map((session) => session.stop())),
      this.options.stopTimeoutMs ?? 2000,
    );
    this.#streams.close();
    this.#sensitive.close();
    this.#sensitivePort.close();
    this.#endpoint.close();
    this.#media.close();
    if (!this.#exited) await bounded(this.#exit, this.options.stopTimeoutMs ?? 2000);
    if (!this.#exited) {
      this.#forced = true;
      this.#child.kill();
      await bounded(this.#exit, 1000);
    }
    this.#state = this.#exited ? 'stopped' : 'failed';
    return { exitConfirmed: this.#exited, forced: this.#forced };
  }
}
