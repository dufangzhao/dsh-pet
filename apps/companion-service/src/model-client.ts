import {
  CredentialBroker,
  CredentialError,
  credentialPermissionAuthorizer,
  KernelFault,
  MemoryCiphertextStore,
} from '@pet/host-kernel';
import { withSourceAuthority, type CompanionPluginHost } from '@pet/companion-runtime';
import type { ResponseClient } from '@pet/harness-cortico';
import { createNativeProvider } from './native-provider.mjs';

type Generation = Awaited<ReturnType<ResponseClient['respond']>>;

export function createAuthorizedModelClient(
  host: CompanionPluginHost,
  sourcePluginId: string,
  options: {
    baseUrl: string;
    apiKey: string;
  },
): { client: ResponseClient; close(): Promise<void> } {
  const endpoint = new URL(options.baseUrl);
  if (
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    !(
      endpoint.protocol === 'https:' ||
      (endpoint.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname))
    )
  )
    throw new KernelFault('invalid-input');
  // Provisioned secrets are borrowed, never persisted. This is not a plaintext-file cipher fallback.
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
  broker.redactor.add(options.apiKey);
  const safe = (value: unknown): boolean => {
    try {
      const text =
        value instanceof Error
          ? JSON.stringify({ ...value, message: value.message })
          : JSON.stringify(value);
      return !text || !broker.redactor.contains(text);
    } catch {
      return false;
    }
  };
  return {
    client: {
      async respond(request, generateOptions = {}) {
        let generation: Generation | undefined;
        let originalError: unknown;
        let actualWork: Promise<void> | undefined;
        return withSourceAuthority(
          host,
          sourcePluginId,
          [],
          async (sourceSignal, context) => {
            try {
              // The broker acquires the source's credential lease; no SDK secret client is exposed.
              await broker.withSecretForHost(
                context.owner,
                ['model-api-key'],
                'model-api-key',
                { taskId: context.taskId, signal: sourceSignal },
                async (secret, signal) => {
                  const native = createNativeProvider(options.baseUrl, secret);
                  actualWork = (async () => {
                    try {
                      generation = await native.respond(request, {
                        ...generateOptions,
                        signal,
                        ...(generateOptions.onEvent
                          ? {
                              onEvent: (event) => {
                                if (!safe(event)) throw new KernelFault('permission-denied');
                                generateOptions.onEvent?.(event);
                              },
                            }
                          : {}),
                      });
                      if (!safe(generation)) {
                        generation = undefined;
                        originalError = new KernelFault('permission-denied');
                      }
                    } catch (error) {
                      originalError = safe(error) ? error : new KernelFault('permission-denied');
                    }
                  })();
                  await actualWork;
                  return null;
                },
                options.apiKey,
              );
            } catch (error) {
              if (originalError === undefined) originalError = error;
            } finally {
              // Credential cancellation can settle logically before native fetch cleanup.
              await actualWork;
            }
            if (originalError !== undefined) throw originalError;
            if (!generation) throw new KernelFault('unavailable');
            return generation;
          },
          {
            ...(generateOptions.signal ? { signal: generateOptions.signal } : {}),
            timeoutMs: 180000,
          },
        );
      },
    },
    async close() {
      broker.dispose();
      await broker.drainUses();
      await broker.drainWrites();
    },
  };
}
