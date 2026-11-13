/** Authenticated, bounded reads by canonical material ID; tokens never enter the URL. */
import {
  COMPANION_FULL_TEXT_MAX_BYTES as MATERIAL_TEXT_MAX_BYTES,
  COMPANION_MATERIAL_FILE_MAX_BYTES as MATERIAL_DOWNLOAD_MAX_BYTES,
  makeError,
  type Result,
} from '@pet/contracts';

import type { ClientTransport } from './protocol.js';

export { MATERIAL_TEXT_MAX_BYTES, MATERIAL_DOWNLOAD_MAX_BYTES };

const FULL_TEXT_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

export interface MaterialBlob {
  readonly blob: Blob;
  readonly filename: string | null;
}

/** 从 Content-Disposition 里取文件名；没有就返回 null，不编一个。 */
function filenameOf(response: Response): string | null {
  const header = response.headers.get('Content-Disposition');
  if (header === null) return null;
  const extended = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (extended?.[1] !== undefined) {
    try {
      return decodeURIComponent(extended[1]);
    } catch {
      return null;
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1] ?? null;
}

async function requestMaterial(
  transport: ClientTransport,
  materialId: string,
  limitBytes: number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Result<MaterialBlob>> {
  const deadline = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${transport.baseUrl}/api/materials/${encodeURIComponent(materialId)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${transport.token}` },
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    });
  } catch {
    return { ok: false, error: deadline.aborted ? makeError('timeout') : makeError('network') };
  }
  if (!response.ok) {
    // 失败响应也可能带 body：不读，但要显式取消，别把连接挂着。
    await response.body?.cancel().catch(() => {});
    if (response.status === 401 || response.status === 403)
      return { ok: false, error: makeError('auth-failed', false) };
    if (response.status === 404) return { ok: false, error: makeError('unavailable', false) };
    if (response.status === 409) return { ok: false, error: makeError('conflict', false) };
    return {
      ok: false,
      error: makeError(response.status >= 500 ? 'unavailable' : 'invalid-input', false),
    };
  }
  // 服务端说了长度就先比一次，别把超限的东西整个读进来。
  const declared = Number(response.headers.get('Content-Length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > limitBytes) {
    // 声明就超限：body 也不读，直接取消。
    await response.body?.cancel().catch(() => {});
    return { ok: false, error: makeError('quota-exceeded', false) };
  }

  // Count before retaining each chunk: Content-Length can be absent or untrusted.
  if (response.body === null) {
    return {
      ok: true,
      value: {
        blob: new Blob([], {
          type: response.headers.get('Content-Type') ?? 'application/octet-stream',
        }),
        filename: filenameOf(response),
      },
    };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > limitBytes) {
        // 越界：取消剩余传输，一个字节都不再收。
        await reader.cancel().catch(() => {});
        return { ok: false, error: makeError('quota-exceeded', false) };
      }
      chunks.push(next.value);
    }
  } catch {
    await reader.cancel().catch(() => {});
    return { ok: false, error: deadline.aborted ? makeError('timeout') : makeError('network') };
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    ok: true,
    value: {
      blob: new Blob([bytes], {
        type: response.headers.get('Content-Type') ?? 'application/octet-stream',
      }),
      filename: filenameOf(response),
    },
  };
}

/**
 * 读全文。只用于 `text-document` 的材料；读不下就如实失败，
 * 界面据此显示「无法在页面内查看」，而不是把错误当正文。
 */
export async function readMaterialText(
  transport: ClientTransport,
  materialId: string,
  signal?: AbortSignal,
): Promise<Result<string>> {
  const result = await requestMaterial(
    transport,
    materialId,
    MATERIAL_TEXT_MAX_BYTES,
    FULL_TEXT_TIMEOUT_MS,
    signal,
  );
  if (!result.ok) return result;
  try {
    return { ok: true, value: await result.value.blob.text() };
  } catch {
    return { ok: false, error: makeError('unavailable', false) };
  }
}

/** 取原始字节用于下载；不在页面里解释内容。 */
export function readMaterialBlob(
  transport: ClientTransport,
  materialId: string,
  signal?: AbortSignal,
): Promise<Result<MaterialBlob>> {
  return requestMaterial(
    transport,
    materialId,
    MATERIAL_DOWNLOAD_MAX_BYTES,
    DOWNLOAD_TIMEOUT_MS,
    signal,
  );
}

/** 交给浏览器保存；token 不进链接，所以这里用 Blob URL。 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.click();
  // 交给浏览器之后再撤销：立即撤销会让部分浏览器拿不到内容。
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
