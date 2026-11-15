import {
  SPEECH_CATALOG_TIMEOUT_MS,
  SPEECH_CREDENTIAL_ID,
  SPEECH_GATEWAY_CATALOG_MAX_BYTES,
  SPEECH_NATIVE_REQUEST_MAX_BYTES,
  SPEECH_SEGMENT_TIMEOUT_MS,
  type SpeechTtsSettings,
} from '@pet/contracts';
import {
  CredentialBroker,
  CredentialError,
  credentialPermissionAuthorizer,
  KernelFault,
  MemoryCiphertextStore,
} from '@pet/host-kernel';
import {
  SpeechCleanupFault,
  withSourceAuthority,
  type AuthorizedMagpieSpeechTransport,
  type AuthorizedSpeechStream,
  type CompanionPluginHost,
} from '@pet/companion-runtime';
import { parseMagpieSpeechSettings, resolveMiMoSpeech } from '@pet/tts-magpie';

export const SPEECH_TTS_USER_AGENT = 'dsh-pet-speech/1';
const fault = (error: unknown, signal: AbortSignal): KernelFault =>
  error instanceof KernelFault ? error : new KernelFault(signal.aborted ? 'cancelled' : 'network');

/** A source-owned Magpie route, not an arbitrary HTTP/URL SDK port. */
export function createAuthorizedSpeechTransport(
  host: CompanionPluginHost,
  sourcePluginId: string,
  input: SpeechTtsSettings,
  apiKey: string | undefined,
): AuthorizedMagpieSpeechTransport {
  const settings = parseMagpieSpeechSettings(input);
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
  const lifetime = new AbortController();
  const pending = new Set<Promise<unknown>>();
  const streams = new Set<() => void>();
  let closed = false;
  let cleanupFailure: SpeechCleanupFault | undefined;
  const current = (): void => {
    if (closed) throw new KernelFault('stale-owner');
    if (!host.verifySource(sourcePluginId)) throw new KernelFault('package-changed');
  };
  function tracked<T>(work: Promise<T>): Promise<T> {
    pending.add(work);
    void work.then(
      () => pending.delete(work),
      () => pending.delete(work),
    );
    return work;
  }
  async function authorized<T>(
    signal: AbortSignal,
    timeoutMs: number,
    operation: (secret: string, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    current();
    if (!apiKey) throw new KernelFault('not-ready');
    let value: { result: T } | undefined;
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
            [SPEECH_CREDENTIAL_ID],
            SPEECH_CREDENTIAL_ID,
            { taskId: context.taskId, signal: sourceSignal },
            async (secret, credentialSignal) => {
              actual = (async () => {
                try {
                  current();
                  value = { result: await operation(secret, credentialSignal) };
                  current();
                } catch (caught) {
                  error = fault(caught, credentialSignal);
                }
              })();
              await actual;
              return null;
            },
            apiKey,
          );
        } catch (caught) {
          if (error === undefined)
            error = caught instanceof CredentialError ? new KernelFault(caught.code) : caught;
        } finally {
          await actual;
        }
        if (error !== undefined) throw error;
        return null;
      },
      { signal: AbortSignal.any([signal, lifetime.signal]), timeoutMs },
    );
    if (!value) throw new KernelFault('unavailable');
    return value.result;
  }
  const headers = (secret: string, accept: string): Record<string, string> => ({
    Authorization: `Bearer ${secret}`,
    'User-Agent': SPEECH_TTS_USER_AGENT,
    Accept: accept,
  });
  const responseOk = async (response: Response): Promise<void> => {
    if (response.ok) return;
    await response.body?.cancel();
    throw new KernelFault(
      response.status === 401 || response.status === 403
        ? 'auth-failed'
        : response.status === 429
          ? 'rate-limited'
          : 'unavailable',
    );
  };
  return {
    catalog: (signal) =>
      tracked(
        authorized(signal, SPEECH_CATALOG_TIMEOUT_MS, async (secret, auth) => {
          const response = await fetch(`${settings.baseUrl}/models?kind=all`, {
            method: 'GET',
            signal: auth,
            redirect: 'error',
            credentials: 'omit',
            cache: 'no-store',
            headers: headers(secret, 'application/json'),
          });
          await responseOk(response);
          if (
            !response.body ||
            !/^application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/i.test(
              response.headers.get('content-type') ?? '',
            )
          ) {
            await response.body?.cancel();
            throw new KernelFault('unavailable');
          }
          const reader = response.body.getReader();
          const chunks: Uint8Array[] = [];
          let size = 0;
          try {
            for (;;) {
              const next = await reader.read();
              if (next.done) break;
              size += next.value.byteLength;
              if (size > SPEECH_GATEWAY_CATALOG_MAX_BYTES) throw new KernelFault('quota-exceeded');
              chunks.push(next.value);
            }
          } finally {
            await reader.cancel();
            reader.releaseLock();
          }
          const bytes = new Uint8Array(size);
          let at = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, at);
            at += chunk.byteLength;
          }
          let value: unknown;
          try {
            value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
          } catch {
            throw new KernelFault('unavailable');
          }
          if (broker.redactor.containsValue(value)) throw new KernelFault('permission-denied');
          return value;
        }),
      ),
    mimoSpeech: async (selection, signal) => {
      current();
      if (
        !settings.modelRef ||
        selection.modelRef !== settings.modelRef ||
        selection.voice !== settings.voice
      )
        throw new KernelFault('permission-denied');
      const { vendor, wireModel } = resolveMiMoSpeech(settings.modelRef);
      const body = JSON.stringify({
        model: wireModel,
        stream: true,
        messages: [{ role: 'assistant', content: selection.text }],
        audio: { format: 'pcm16', voice: selection.voice },
      });
      if (Buffer.byteLength(body) > SPEECH_NATIVE_REQUEST_MAX_BYTES)
        throw new KernelFault('quota-exceeded');
      let readyResolve: (value: AuthorizedSpeechStream) => void = () => {};
      let readyReject: (error: unknown) => void = () => {};
      const ready = new Promise<AuthorizedSpeechStream>((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
      });
      let cleanupError: unknown;
      const work: Promise<void> = authorized(
        signal,
        SPEECH_SEGMENT_TIMEOUT_MS,
        async (secret, auth) => {
          const abort = new AbortController();
          const requestSignal = AbortSignal.any([auth, abort.signal]);
          const response = await fetch(
            `${settings.baseUrl}/magpie/native/${encodeURIComponent(vendor)}/v1/chat/completions`,
            {
              method: 'POST',
              body,
              signal: requestSignal,
              redirect: 'error',
              credentials: 'omit',
              cache: 'no-store',
              headers: {
                ...headers(secret, 'text/event-stream'),
                'Content-Type': 'application/json',
              },
            },
          );
          await responseOk(response);
          if (
            !response.body ||
            !/^text\/event-stream(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')
          ) {
            await response.body?.cancel();
            throw new KernelFault('unavailable');
          }
          const reader = response.body.getReader();
          let reading: ReturnType<typeof reader.read> | undefined;
          let release: Promise<void> | undefined;
          let finished = () => {};
          const done = new Promise<void>((resolve) => {
            finished = resolve;
          });
          let nativeError: unknown;
          let readError: unknown;
          let used = false;
          const close = (): Promise<void> => {
            if (release) return release;
            release = Promise.resolve().then(async () => {
              try {
                try {
                  await reader.cancel();
                } catch (error) {
                  const aborted = error instanceof Error && error.name === 'AbortError';
                  // An already errored Fetch stream repeats its stored read/abort error on cancel.
                  if (error !== readError && !(requestSignal.aborted && aborted)) throw error;
                }
                if (reading) await reading.catch(() => {});
                reader.releaseLock();
              } catch {
                cleanupFailure = new SpeechCleanupFault();
                cleanupError = cleanupFailure;
              } finally {
                abort.abort();
                finished();
              }
            });
            return release;
          };
          const cancel = (): void => {
            void close();
          };
          streams.add(cancel);
          requestSignal.addEventListener('abort', cancel, { once: true });
          readyResolve({
            body: {
              [Symbol.asyncIterator]() {
                if (used) throw new KernelFault('conflict');
                used = true;
                return {
                  async next() {
                    try {
                      requestSignal.throwIfAborted();
                      current();
                      reading = reader.read();
                      const next = await reading;
                      reading = undefined;
                      current();
                      if (next.done) {
                        await close();
                        return { done: true as const, value: undefined };
                      }
                      return { done: false as const, value: next.value };
                    } catch (error) {
                      readError = error;
                      nativeError = fault(error, requestSignal);
                      await close();
                      throw nativeError;
                    }
                  },
                  async return() {
                    await close();
                    return { done: true as const, value: undefined };
                  },
                };
              },
            },
            settled: work.then(
              () => {},
              () => {
                if (cleanupError) throw cleanupError;
              },
            ),
            cancel,
          });
          if (requestSignal.aborted) cancel();
          try {
            await done;
            if (cleanupError) throw cleanupError;
            if (nativeError) throw nativeError;
          } finally {
            await close();
            requestSignal.removeEventListener('abort', cancel);
            streams.delete(cancel);
          }
        },
      );
      void tracked(work).catch(readyReject);
      return ready;
    },
    async close() {
      if (!closed) {
        closed = true;
        lifetime.abort();
        for (const cancel of streams) cancel();
        broker.dispose();
      }
      await Promise.allSettled([...pending]);
      await broker.drainUses();
      await broker.drainWrites();
      if (cleanupFailure) throw cleanupFailure;
    },
  };
}
