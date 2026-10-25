import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Duplex } from 'node:stream';
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
import { manifestDigest, parseBootstrap, record } from './worker-protocol.js';
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
      stdio: ['ignore', 'ignore', 'ignore', 'ipc', 'pipe'],
      windowsHide: true,
    });
    let exited!: (value: number | null) => void;
    this.#exit = new Promise((resolve) => {
      exited = resolve;
    });
    this.#child.once('exit', (code) => {
      this.#exited = true;
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
    this.#endpoint = new ControlEndpoint(childProcessControl(this.#child), {
      sessionId: bootstrap.sessionId,
      owner: bootstrap.owner,
      live: () => !this.#exited,
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
    const pipe = this.#child.stdio[4];
    if (!pipe) throw new Error('Missing runtime media pipe');
    this.#media = new FramedMediaPort(
      pipe as Duplex,
      () => ({ ok: false, error: makeError('not-ready', false) }),
      () => {},
    );
    this.#ready = this.#endpoint
      .request('runtime.info', null, { budgetMs: options.startupTimeoutMs ?? 5000 })
      .then((result) => {
        const value = record(unwrap(result));
        if (!value || value['version'] !== 1 || this.#exited) throw new KernelFault('unavailable');
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
    return unwrap(
      await this.#endpoint.request(method, payload, {
        taskId,
        signal,
        budgetMs: Math.min(budget, 86400000),
      }),
    );
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
