import { makeError, type KernelError, type Result } from '@pet/contracts';
import { parseEnvelope } from './guards.js';
import type { ClientTransport } from './protocol.js';

export const networkError = (): KernelError => makeError('network');
export function statusError(status: number): KernelError {
  if (status === 401 || status === 403) return makeError('auth-failed', false);
  if (status === 409) return makeError('conflict', false);
  if (status === 429) return makeError('rate-limited');
  if (status === 404) return makeError('unavailable', false);
  if (status >= 500) return makeError('unavailable');
  return makeError('invalid-input', false);
}
/** One bounded authenticated JSON response reader; PCM is only an HTTP request body. */
export async function requestJson(
  transport: ClientTransport,
  path: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Result<unknown>> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(`${transport.baseUrl}${path}`, {
      ...init,
      signal,
      headers: {
        Authorization: `Bearer ${transport.token}`,
        Accept: 'application/json',
        ...init.headers,
      },
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
    });
  } catch {
    return { ok: false, error: timeout.aborted ? makeError('timeout') : networkError() };
  }
  let body: unknown;
  try {
    if (!response.body) throw new Error('Missing JSON body');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > 64 * 1024) throw new Error('Wire budget exceeded');
        chunks.push(next.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    return {
      ok: false,
      error: timeout.aborted
        ? makeError('timeout')
        : response.ok
          ? makeError('unavailable', false)
          : statusError(response.status),
    };
  }
  const parsed = parseEnvelope(body);
  if (!parsed.ok) return { ok: false, error: parsed.failure.error };
  return response.ok
    ? { ok: true, value: parsed.value }
    : { ok: false, error: statusError(response.status) };
}
