import type { OwnerRef } from '@pet/contracts';
import {
  CredentialBroker,
  CredentialError,
  credentialPermissionAuthorizer,
  KernelFault,
  MemoryCiphertextStore,
} from '@pet/host-kernel';
import { withSourceAuthority } from '@pet/companion-runtime/source-authority';
import type { CompanionPluginHost } from '@pet/companion-runtime/plugin-host';

/** Host-only capture. Neither the secret nor this object is a plugin capability payload. */
export interface CapturedQqBinding<S> {
  readonly owner: OwnerRef;
  readonly signal: AbortSignal;
  readonly configRevision: number;
  readonly credentialVersion: string;
  readonly settings: S;
  readonly credential: string;
  /** Distributed sources require a fresh scoped server check before every business dispatch. */
  readonly requireOperationCheck?: boolean;
  check(): void | Promise<void>;
}

/** A completed egress response survives only a subsequent authority/cancellation failure. */
export function isQqEgressPostflightFailure(error: unknown): boolean {
  return (
    error instanceof KernelFault &&
    [
      'permission-denied',
      'stale-owner',
      'package-changed',
      'cancelled',
      'timeout',
      'conflict',
      'not-ready',
    ].includes(error.error.code)
  );
}

/** One source's native operations; logical cancellation never substitutes for actual settlement. */
export function createQqAuthority<S>(
  host: CompanionPluginHost,
  binding: CapturedQqBinding<S>,
  credentialId: string,
): {
  readonly signal: AbortSignal;
  check(): Promise<void>;
  /** Fence this captured native authority synchronously; close() still joins all owned work. */
  fence(): void;
  run<T>(
    signal: AbortSignal,
    operation: (secret: string, signal: AbortSignal) => Promise<T>,
  ): Promise<T>;
  close(): Promise<void>;
} {
  const lifetime = new AbortController();
  const signal = AbortSignal.any([binding.signal, lifetime.signal]);
  const pending = new Set<Promise<unknown>>();
  const broker = new CredentialBroker({
    store: new MemoryCiphertextStore(),
    cipher: {
      encrypt: async () => {
        throw new CredentialError('unavailable');
      },
      decrypt: async () => {
        throw new CredentialError('unavailable');
      },
    },
    authorize: credentialPermissionAuthorizer(host.permissions),
  });
  if (binding.credential) broker.redactor.add(binding.credential);
  let closed = false;
  const check = async (): Promise<void> => {
    if (closed || signal.aborted) throw new KernelFault('stale-owner');
    const current = host.manager.get({
      pluginId: binding.owner.pluginId,
      instanceId: binding.owner.instanceId,
    });
    if (
      !current ||
      current.owner.generation !== binding.owner.generation ||
      !host.manager.isActive(binding.owner)
    )
      throw new KernelFault('stale-owner');
    if (!host.verifySource(binding.owner.pluginId)) throw new KernelFault('package-changed');
    try {
      await binding.check();
    } catch (error) {
      throw error instanceof KernelFault ? error : new KernelFault('stale-owner');
    }
    if (closed || signal.aborted) throw new KernelFault('stale-owner');
  };
  const fence = (): void => {
    if (closed) return;
    closed = true;
    lifetime.abort();
    broker.dispose();
  };
  return {
    signal,
    check,
    fence,
    run<T>(
      caller: AbortSignal,
      operation: (secret: string, signal: AbortSignal) => Promise<T>,
    ): Promise<T> {
      const work = (async (): Promise<T> => {
        await check();
        if (!binding.credential) throw new KernelFault('not-ready');
        let value: { result: T } | undefined;
        let failure: unknown;
        let actual: Promise<void> | undefined;
        await withSourceAuthority(
          host,
          binding.owner.pluginId,
          [{ kind: 'files', scope: 'plugin-data', access: 'read' }],
          async (sourceSignal, context) => {
            if (
              context.owner.generation !== binding.owner.generation ||
              context.owner.instanceId !== binding.owner.instanceId
            )
              throw new KernelFault('stale-owner');
            try {
              await broker.withSecretForHost(
                context.owner,
                [credentialId],
                credentialId,
                { taskId: context.taskId, signal: sourceSignal },
                async (secret, credentialSignal) => {
                  actual = (async () => {
                    try {
                      await check();
                      const result = await operation(secret, credentialSignal);
                      await check();
                      value = { result };
                    } catch (error) {
                      failure =
                        error instanceof KernelFault
                          ? error
                          : new KernelFault(credentialSignal.aborted ? 'cancelled' : 'network');
                    }
                  })();
                  await actual;
                  return null;
                },
                binding.credential,
              );
            } catch (error) {
              if (failure === undefined)
                failure = error instanceof CredentialError ? new KernelFault(error.code) : error;
            } finally {
              await actual;
            }
            if (failure !== undefined) throw failure;
            return null;
          },
          { signal: AbortSignal.any([caller, signal]) },
        );
        if (!value) throw new KernelFault('unavailable');
        return value.result;
      })();
      pending.add(work);
      void work.then(
        () => pending.delete(work),
        () => pending.delete(work),
      );
      return work;
    },
    async close() {
      fence();
      await Promise.allSettled([...pending]);
      await broker.drainUses();
      await broker.drainWrites();
    },
  };
}
