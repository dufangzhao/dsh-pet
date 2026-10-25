import { Context } from '@deepseek-ai/cordis';
import { freezeJson } from './identity.js';
import type {
  ActivationRegistrar,
  Disposer,
  PluginLoader,
  PluginRuntimeContext,
  RuntimeActivation,
  RuntimeDriver,
  RuntimeSession,
} from './types.js';

/** Plugin-area adapter; the host, not plugins, owns this Cordis context. */
export class CordisRuntimeDriver implements RuntimeDriver {
  readonly #root = new Context();
  readonly #stops = new Set<() => Promise<void>>();
  #disposed = false;
  constructor(private readonly load: PluginLoader) {}
  start(activation: RuntimeActivation, registrar: ActivationRegistrar): RuntimeSession {
    if (this.#disposed || activation.signal.aborted) throw new Error('Runtime unavailable');
    const lifetime = new AbortController();
    const signal = AbortSignal.any([activation.signal, lifetime.signal]);
    let fiber: ReturnType<Context['plugin']> | undefined;
    let cleanupFailed = false;
    // Defer plugin code until start() has returned the session handle to the manager.
    const ready = Promise.resolve().then(async () => {
      if (signal.aborted) throw new Error('Activation cancelled');
      const module = await this.load(activation);
      if (signal.aborted) throw new Error('Activation cancelled');
      fiber = this.#root.plugin(async (context: Context) => {
        const resources: Disposer[] = [];
        let closed = false;
        context.effect(() => async () => {
          closed = true;
          let failed = false;
          while (resources.length) {
            const dispose = resources.pop()!;
            try {
              await dispose();
            } catch {
              failed = true;
              cleanupFailed = true;
            }
          }
          if (failed) throw new Error('Owned resource cleanup failed');
        });
        const live = () => {
          if (signal.aborted || closed) throw new Error('Resource scope unavailable');
        };
        const api: PluginRuntimeContext = Object.freeze({
          owner: Object.freeze({ ...activation.owner }),
          signal,
          config: freezeJson(structuredClone(activation.config)),
          provide: (id: string, methods: Parameters<ActivationRegistrar['provide']>[1]) => {
            live();
            registrar.provide(id, methods);
          },
          contribute: (id: string, handler?: Parameters<ActivationRegistrar['contribute']>[1]) => {
            live();
            registrar.contribute(id, handler);
          },
          effect: (create: Parameters<PluginRuntimeContext['effect']>[0]) => {
            live();
            if (resources.length >= 128 || typeof create !== 'function')
              throw new Error('Resource budget exceeded');
            const dispose = create();
            if (typeof dispose !== 'function') throw new Error('Invalid resource disposer');
            resources.push(dispose);
          },
        });
        try {
          const dispose = await module.activate(api);
          if (dispose !== undefined) {
            if (typeof dispose !== 'function') throw new Error('Invalid module disposer');
            resources.push(dispose);
          }
          live();
        } catch (error) {
          lifetime.abort();
          throw error;
        }
      });
      await fiber.await();
    });
    void ready.catch(() => lifetime.abort());
    let stopping: Promise<void> | undefined;
    const stop = (): Promise<void> => {
      lifetime.abort();
      return (stopping ??= Promise.resolve()
        .then(async () => {
          // An uncooperative activation must not be declared stopped while it can return late resources.
          try {
            await ready;
          } catch {
            /* activation failure still requires fiber cleanup */
          }
          if (fiber) await fiber.dispose();
          if (cleanupFailed) throw new Error('Runtime cleanup incomplete');
        })
        .then(() => {
          this.#stops.delete(stop);
        }));
    };
    this.#stops.add(stop);
    return Object.freeze({ ready, stop });
  }
  diagnostics(): { sessions: number; fibers: number } {
    return { sessions: this.#stops.size, fibers: this.#root.registry.size };
  }
  async dispose(): Promise<void> {
    this.#disposed = true;
    const results = await Promise.allSettled([...this.#stops].map((stop) => stop()));
    await this.#root.fiber.dispose();
    if (results.some((result) => result.status === 'rejected'))
      throw new Error('Runtime cleanup incomplete');
  }
}
