import type { OwnerRef } from '@pet/contracts';
import { KernelFault } from '@pet/host-kernel';
import type { PluginContext } from '@pet/plugin-sdk';
import { withSourceAuthority } from './source-authority.js';
import type { CompanionPluginHost } from './plugin-host.js';
import {
  MODEL_CONNECTION_CAPABILITY,
  type AuthorizedResponseTransport,
  type ModelConnectionPorts,
  type ModelConnectionRegistration,
  type ResponseClient,
  type TextModelBinding,
} from './model-connection-types.js';

const identity = (pluginId: string) => ({ pluginId, instanceId: 'default' });
const sameOwner = (a: OwnerRef, b: OwnerRef): boolean =>
  a.pluginId === b.pluginId && a.instanceId === b.instanceId && a.generation === b.generation;
interface BoundConnection extends TextModelBinding {
  readonly owner: OwnerRef;
  readonly key: string;
  readonly revision: number;
  readonly policyEpoch: number;
  readonly controller: AbortController;
  readonly pending: Set<Promise<unknown>>;
  retired: boolean;
}

/** Owns native references only; installation, authority and work stay in the existing kernel. */
export class ModelConnections {
  private readonly registrations = new Map<string, ModelConnectionRegistration>();
  private readonly prepared = new Map<string, { revision: number; controller: AbortController }>();
  private readonly bindings = new Map<string, BoundConnection>();
  private selected = '';

  constructor(
    private readonly host: CompanionPluginHost,
    registrations: readonly ModelConnectionRegistration[],
    private readonly transport: (owner: OwnerRef, baseUrl: string) => AuthorizedResponseTransport,
  ) {
    if (registrations.length > 8) throw new KernelFault('quota-exceeded');
    for (const registration of registrations) {
      const key = `${registration.manifest.id}/${registration.connection.providerId}`;
      if (
        this.registrations.has(key) ||
        !registration.manifest.provides?.some(
          (provider) =>
            provider.id === registration.connection.providerId &&
            provider.capability === MODEL_CONNECTION_CAPABILITY &&
            provider.features?.['nativeResponses'] === 1,
        )
      )
        throw new KernelFault('invalid-input');
      this.registrations.set(key, registration);
    }
    host.onConfigurationCommit((commit) => {
      for (const [key, activation] of this.prepared) {
        if (
          this.registration(key).manifest.id === commit.pluginId &&
          commit.instanceId === 'default' &&
          activation.revision !== commit.revision
        )
          activation.controller.abort();
      }
      for (const binding of [...this.bindings.values()]) {
        if (
          binding.owner.pluginId === commit.pluginId &&
          binding.owner.instanceId === commit.instanceId &&
          binding.revision !== commit.revision
        )
          this.fence(binding);
      }
    });
  }

  private fence(record: BoundConnection): void {
    record.retired = true;
    if (this.bindings.get(record.key) === record) this.bindings.delete(record.key);
    record.controller.abort();
  }

  invalidate(key: string): void {
    this.registration(key);
    const record = this.bindings.get(key);
    if (record) this.fence(record);
    this.prepared.get(key)?.controller.abort();
  }

  private sourceCurrent(record: BoundConnection): boolean {
    const policy = this.host.permissionControl.inspect(identity(record.owner.pluginId));
    return (
      !record.retired &&
      !record.controller.signal.aborted &&
      this.selected === record.key &&
      this.bindings.get(record.key) === record &&
      this.host.manager.isActive(record.owner) &&
      this.host.verifySource(record.owner.pluginId) &&
      Boolean(
        policy &&
        !policy.blocked &&
        policy.preset !== 'deny' &&
        policy.epoch === record.policyEpoch,
      )
    );
  }

  list(): readonly [string, ModelConnectionRegistration][] {
    return [...this.registrations];
  }

  registration(key: string): ModelConnectionRegistration {
    const registration = this.registrations.get(key);
    if (!registration) throw new KernelFault('invalid-input');
    return registration;
  }

  select(key: string): void {
    this.registration(key);
    this.selected = key;
  }

  async enable(key: string): Promise<void> {
    const registration = this.registration(key);
    const config = await this.host.configs.get(identity(registration.manifest.id));
    if (!config.ok) throw new KernelFault(config.error.code);
    if (this.host.isEnabled(registration.manifest.id)) {
      if (this.binding(key)?.revision === config.value.revision) return;
      throw new KernelFault('conflict');
    }
    this.prepared.set(key, { revision: config.value.revision, controller: new AbortController() });
    await this.host.setEnabled(registration.manifest.id, true);
  }

  async disable(key: string): Promise<void> {
    await this.host.setEnabled(this.registration(key).manifest.id, false);
  }

  portsFor(context: PluginContext): ModelConnectionPorts {
    const matched = this.list().filter(
      ([, registration]) => registration.manifest.id === context.owner.pluginId,
    );
    if (matched.length !== 1) throw new KernelFault('invalid-input');
    const match = matched[0];
    if (!match) throw new KernelFault('not-ready');
    const [key] = match;
    const activation = this.prepared.get(key);
    if (!activation) throw new KernelFault('not-ready');
    const owner = { ...context.owner };
    const valid = (): void => {
      const entry = this.host.manager.get(identity(owner.pluginId));
      if (
        context.signal.aborted ||
        activation.controller.signal.aborted ||
        !entry ||
        !sameOwner(entry.owner, owner) ||
        !['activating', 'active'].includes(entry.state)
      )
        throw new KernelFault('stale-owner');
    };
    return {
      authorizedResponses: (baseUrl) => {
        valid();
        const transport = this.transport(owner, baseUrl);
        return {
          client: {
            respond: async (request, options = {}) => {
              valid();
              const signals = [context.signal, activation.controller.signal];
              if (options.signal) signals.push(options.signal);
              const result = await transport.client.respond(request, {
                ...options,
                signal: AbortSignal.any(signals),
              });
              valid();
              return result;
            },
          },
          close: () => transport.close(),
        };
      },
      bind: (binding) => {
        valid();
        if (
          !binding.model ||
          binding.model.length > 128 ||
          typeof binding.client.respond !== 'function' ||
          this.bindings.has(key)
        )
          throw new KernelFault('invalid-input');
        const policy = this.host.permissionControl.inspect(identity(owner.pluginId));
        if (!policy) throw new KernelFault('permission-denied');
        const record: BoundConnection = {
          ...binding,
          owner,
          key,
          revision: activation.revision,
          policyEpoch: policy.epoch,
          controller: activation.controller,
          pending: new Set(),
          retired: false,
        };
        const fence = (): void => {
          this.fence(record);
        };
        context.signal.addEventListener('abort', fence, { once: true });
        this.bindings.set(key, record);
        return async () => {
          fence();
          context.signal.removeEventListener('abort', fence);
          await Promise.allSettled([...record.pending]);
        };
      },
    };
  }

  binding(key = this.selected): { model: string; revision: number; owner: OwnerRef } | null {
    const record = this.bindings.get(key);
    if (!record) return null;
    if (!this.sourceCurrent(record)) {
      this.fence(record);
      return null;
    }
    return { model: record.model, revision: record.revision, owner: record.owner };
  }

  clientFor(consumer: OwnerRef): ResponseClient {
    const captured = this.bindings.get(this.selected);
    if (!captured) throw new KernelFault('not-ready');
    const consumerCurrent = (): boolean => {
      const current = this.host.manager.get(identity(consumer.pluginId));
      return Boolean(
        current &&
        sameOwner(current.owner, consumer) &&
        this.host.manager.isActive(consumer) &&
        this.host.verifySource(consumer.pluginId),
      );
    };
    const guard = async (): Promise<void> => {
      if (!consumerCurrent()) throw new KernelFault('stale-owner');
      if (!this.sourceCurrent(captured)) {
        this.fence(captured);
        throw new KernelFault('stale-owner');
      }
      const config = await this.host.configs.get(identity(captured.owner.pluginId));
      if (!config.ok || config.value.revision !== captured.revision)
        throw new KernelFault('conflict');
    };
    return {
      respond: (request, options = {}) => {
        const requestAbort = new AbortController();
        const running = (async () => {
          await guard();
          if (request.model !== captured.model) throw new KernelFault('invalid-input');
          const signals = [requestAbort.signal, captured.controller.signal];
          if (options.signal) signals.push(options.signal);
          return withSourceAuthority(
            this.host,
            consumer.pluginId,
            [{ kind: 'capability-use', capability: MODEL_CONNECTION_CAPABILITY }],
            (consumerSignal) =>
              withSourceAuthority(
                this.host,
                captured.owner.pluginId,
                [{ kind: 'files', scope: 'plugin-data', access: 'read' }],
                async (sourceSignal) => {
                  await guard();
                  let active = true;
                  let generation: Awaited<ReturnType<ResponseClient['respond']>>;
                  try {
                    generation = await captured.client.respond(request, {
                      ...options,
                      signal: sourceSignal,
                      ...(options.onEvent
                        ? {
                            onEvent: (event) => {
                              if (!active) return;
                              // A caller's cancellation must not retire a shared provider.
                              if (!this.sourceCurrent(captured)) {
                                this.fence(captured);
                                return;
                              }
                              if (sourceSignal.aborted) return;
                              if (!consumerCurrent()) {
                                requestAbort.abort();
                                return;
                              }
                              options.onEvent?.(event);
                            },
                          }
                        : {}),
                    });
                  } finally {
                    active = false;
                  }
                  await guard();
                  return generation;
                },
                { signal: consumerSignal, timeoutMs: 180000 },
              ),
            { signal: AbortSignal.any(signals), timeoutMs: 180000 },
          );
        })();
        captured.pending.add(running);
        const settled = (): void => {
          captured.pending.delete(running);
        };
        void running.then(settled, settled);
        return running;
      },
    };
  }
}
