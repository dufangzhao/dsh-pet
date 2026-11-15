import {
  VOICE_ASR_TIMEOUT_MS,
  VOICE_CATALOG_TIMEOUT_MS,
  VOICE_GATEWAY_CATALOG_MAX_BYTES,
  VOICE_MIMO_MAX_REQUEST_BYTES,
  type VoiceAsrSettings,
} from '@pet/contracts';
import {
  CredentialBroker,
  CredentialError,
  credentialPermissionAuthorizer,
  KernelFault,
  MemoryCiphertextStore,
} from '@pet/host-kernel';
import {
  withSourceAuthority,
  type AuthorizedMagpieAsrTransport,
  type CompanionPluginHost,
} from '@pet/companion-runtime';
import { parseMagpieAsrSettings, resolveMiMoAsr } from '@pet/asr-magpie';

/** Fixed-purpose native HTTP, bound to this ordinary provider's own target/key. */
export function createAuthorizedAsrTransport(
  host: CompanionPluginHost,
  sourcePluginId: string,
  input: VoiceAsrSettings,
  apiKey: string | undefined,
): AuthorizedMagpieAsrTransport {
  const settings = parseMagpieAsrSettings(input);
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
  if (apiKey) broker.redactor.add(apiKey);
  let closed = false;
  const lifetime = new AbortController();
  const pending = new Set<Promise<unknown>>();
  async function request(
    path: string,
    method: 'GET' | 'POST',
    body: string | undefined,
    signal: AbortSignal,
    timeoutMs: number,
    maxBytes: number,
  ): Promise<unknown> {
    if (closed) throw new KernelFault('stale-owner');
    if (!apiKey) throw new KernelFault('not-ready');
    const timeout = AbortSignal.timeout(timeoutMs);
    if (!host.verifySource(sourcePluginId)) throw new KernelFault('package-changed');
    let value: unknown;
    let error: unknown;
    let actual: Promise<void> | undefined;
    await withSourceAuthority(
      host,
      sourcePluginId,
      [{ kind: 'files', scope: 'plugin-data', access: 'read' }],
      async (sourceSignal, context) => {
        try {
          await broker.withSecretForHost(
            context.owner,
            ['asr-api-key'],
            'asr-api-key',
            { taskId: context.taskId, signal: sourceSignal },
            async (secret, credentialSignal) => {
              actual = (async () => {
                const requestSignal = AbortSignal.any([credentialSignal, timeout, lifetime.signal]);
                let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
                try {
                  if (closed || !host.verifySource(sourcePluginId))
                    throw new KernelFault('stale-owner');
                  const response = await fetch(`${settings.baseUrl}${path}`, {
                    method,
                    signal: requestSignal,
                    redirect: 'error',
                    credentials: 'omit',
                    cache: 'no-store',
                    headers: {
                      Authorization: `Bearer ${secret}`,
                      'User-Agent': 'dsh-pet-voice/1',
                      Accept: 'application/json',
                      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
                    },
                    ...(body === undefined ? {} : { body }),
                  });
                  if (!response.ok) {
                    await response.body?.cancel();
                    throw new KernelFault(
                      response.status === 401 || response.status === 403
                        ? 'auth-failed'
                        : response.status === 429
                          ? 'rate-limited'
                          : 'unavailable',
                    );
                  }
                  if (
                    !response.body ||
                    !/^application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/i.test(
                      response.headers.get('content-type') ?? '',
                    )
                  ) {
                    await response.body?.cancel();
                    throw new KernelFault('unavailable');
                  }
                  reader = response.body.getReader();
                  const chunks: Uint8Array[] = [];
                  let length = 0;
                  for (;;) {
                    const next = await reader.read();
                    if (next.done) break;
                    length += next.value.byteLength;
                    if (length > maxBytes) throw new KernelFault('quota-exceeded');
                    chunks.push(next.value);
                  }
                  const bytes = new Uint8Array(length);
                  let at = 0;
                  for (const chunk of chunks) {
                    bytes.set(chunk, at);
                    at += chunk.byteLength;
                  }
                  try {
                    value = JSON.parse(
                      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
                    ) as unknown;
                  } catch {
                    throw new KernelFault('unavailable');
                  }
                  if (
                    !broker.redactor.containsValue(value) &&
                    !closed &&
                    host.verifySource(sourcePluginId)
                  )
                    return;
                  value = undefined;
                  throw new KernelFault('permission-denied');
                } catch (caught) {
                  error =
                    caught instanceof KernelFault
                      ? caught
                      : new KernelFault(
                          timeout.aborted
                            ? 'timeout'
                            : requestSignal.aborted
                              ? 'cancelled'
                              : 'network',
                        );
                } finally {
                  if (reader) {
                    await reader.cancel().catch(() => {});
                    reader.releaseLock();
                  }
                }
              })();
              await actual;
              return null;
            },
            apiKey,
          );
        } catch (caught) {
          if (error === undefined)
            error = timeout.aborted
              ? new KernelFault('timeout')
              : caught instanceof CredentialError
                ? new KernelFault(caught.code)
                : caught;
        } finally {
          await actual;
        }
        if (error !== undefined) throw error;
        if (value === undefined) throw new KernelFault('unavailable');
        return null;
      },
      { signal: AbortSignal.any([signal, timeout]), timeoutMs: timeoutMs + 1000 },
    );
    return value;
  }
  function tracked<T>(operation: () => Promise<T>): Promise<T> {
    const work = operation();
    pending.add(work);
    void work.then(
      () => pending.delete(work),
      () => pending.delete(work),
    );
    return work;
  }
  return {
    catalog: (signal) =>
      tracked(() =>
        request(
          '/models?kind=all',
          'GET',
          undefined,
          signal,
          VOICE_CATALOG_TIMEOUT_MS,
          VOICE_GATEWAY_CATALOG_MAX_BYTES,
        ),
      ),
    mimoAsr: async (selection, signal) => {
      if (!settings.modelRef) throw new KernelFault('not-ready');
      if (selection.modelRef !== settings.modelRef) throw new KernelFault('permission-denied');
      const { vendor, wireModel } = resolveMiMoAsr(settings.modelRef);
      if (!(selection.wav instanceof Uint8Array) || selection.wav.byteLength > 640044)
        throw new KernelFault('quota-exceeded');
      const body = JSON.stringify({
        model: wireModel,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'input_audio',
                input_audio: {
                  data: `data:audio/wav;base64,${Buffer.from(selection.wav).toString('base64')}`,
                },
              },
            ],
          },
        ],
        max_completion_tokens: 1024,
      });
      if (Buffer.byteLength(body) > VOICE_MIMO_MAX_REQUEST_BYTES)
        throw new KernelFault('quota-exceeded');
      return tracked(() =>
        request(
          `/magpie/native/${encodeURIComponent(vendor)}/v1/chat/completions`,
          'POST',
          body,
          signal,
          VOICE_ASR_TIMEOUT_MS,
          64 * 1024,
        ),
      );
    },
    async close() {
      closed = true;
      lifetime.abort();
      broker.dispose();
      await Promise.allSettled([...pending]);
      await broker.drainUses();
      await broker.drainWrites();
    },
  };
}
