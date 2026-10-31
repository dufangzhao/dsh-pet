import type { ModelServiceEndpoint } from '@pet/contracts';
import { KernelFault } from '@pet/host-kernel';

const MAX_PAGES = 20;
const MAX_MODELS = 2000;
const MAX_ID_LENGTH = 128;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_PAGE_TOKEN_LENGTH = 4096;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new KernelFault('network');
  return value as Record<string, unknown>;
}

function modelId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_ID_LENGTH)
    throw new KernelFault('network');
  return value;
}

function abortFault(signal: AbortSignal): KernelFault {
  const reason: unknown = signal.reason;
  return new KernelFault(
    (reason instanceof Error && reason.name === 'TimeoutError') ||
      (reason instanceof KernelFault && reason.error.code === 'timeout')
      ? 'timeout'
      : 'cancelled',
  );
}

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body) throw new KernelFault('network');
  const reader = response.body.getReader();
  const cancel = () => {
    // Cleanup must not replace the fixed request fault with a transport exception.
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  try {
    signal.throwIfAborted();
    while (true) {
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new KernelFault('network');
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
    reader.releaseLock();
  }
}

/** Lists models only; the caller owns endpoint selection, credentials and the task deadline. */
export async function fetchModelCatalog(
  endpoint: ModelServiceEndpoint,
  key: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<readonly string[]> {
  try {
    signal.throwIfAborted();
    const protocol = endpoint.protocol;
    const base = endpoint.baseUrl.trim().replace(/\/+$/, '');
    const root = base + (protocol === 'anthropic' ? '/v1/models' : '/models');
    const headers: Record<string, string> = { accept: 'application/json' };
    if (protocol === 'anthropic') {
      headers['x-api-key'] = key;
      headers['anthropic-version'] = '2023-06-01';
    } else if (protocol === 'gemini') {
      headers['x-goog-api-key'] = key;
    } else {
      headers['authorization'] = 'Bearer ' + key;
    }
    const models = new Set<string>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    let count = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      signal.throwIfAborted();
      const url = new URL(root);
      if (protocol === 'gemini') {
        url.searchParams.set('pageSize', '1000');
        if (cursor !== undefined) url.searchParams.set('pageToken', cursor);
      } else if (protocol === 'anthropic' && cursor !== undefined) {
        url.searchParams.set('after_id', cursor);
      }
      const response = await fetchImpl(url.href, {
        method: 'GET',
        headers,
        redirect: 'error',
        signal,
      });
      if (signal.aborted || !response.ok) {
        void response.body?.cancel().catch(() => {});
        if (signal.aborted) throw abortFault(signal);
        throw new KernelFault(
          response.status === 401 || response.status === 403
            ? 'auth-failed'
            : response.status === 429
              ? 'rate-limited'
              : response.status === 408 || response.status === 504
                ? 'timeout'
                : 'network',
        );
      }
      const data = object(await readJson(response, signal));
      const rows = data[protocol === 'gemini' || protocol === 'browser' ? 'models' : 'data'];
      if (!Array.isArray(rows) || count + rows.length > MAX_MODELS)
        throw new KernelFault('network');
      count += rows.length;
      for (const value of rows) {
        const row = object(value);
        if (protocol === 'browser') {
          if (typeof row['visibility'] !== 'string') throw new KernelFault('network');
          if (row['visibility'] !== 'list') continue;
        }
        const field = row[protocol === 'gemini' ? 'name' : protocol === 'browser' ? 'slug' : 'id'];
        const id =
          protocol === 'gemini' && typeof field === 'string'
            ? field.replace(/^models\//, '')
            : field;
        models.add(modelId(id));
      }
      cursor = undefined;
      if (protocol === 'anthropic') {
        if (data['has_more'] !== undefined && typeof data['has_more'] !== 'boolean')
          throw new KernelFault('network');
        if (data['has_more'] === true) {
          if (rows.length === 0) throw new KernelFault('network');
          cursor = modelId(data['last_id']);
        }
      } else if (protocol === 'gemini' && data['nextPageToken'] !== undefined) {
        const token = data['nextPageToken'];
        if (typeof token !== 'string' || token.length > MAX_PAGE_TOKEN_LENGTH)
          throw new KernelFault('network');
        if (token) cursor = token;
      }
      signal.throwIfAborted();
      if (cursor === undefined) return [...models];
      if (cursors.has(cursor)) throw new KernelFault('network');
      cursors.add(cursor);
    }
    throw new KernelFault('network');
  } catch (error) {
    if (signal.aborted) throw abortFault(signal);
    if (error instanceof KernelFault) throw error;
    throw new KernelFault(
      error instanceof Error && error.name === 'TimeoutError'
        ? 'timeout'
        : error instanceof Error && error.name === 'AbortError'
          ? 'cancelled'
          : 'network',
    );
  }
}
