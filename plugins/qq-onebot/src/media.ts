import { createHash, randomUUID } from 'node:crypto';
import {
  COMPANION_MATERIAL_FILE_MAX_BYTES,
  MEDIA_MAX_CHUNK_BYTES,
  makeError,
  type KernelError,
  type Result,
} from '@pet/contracts';
import { KernelFault } from '@pet/host-kernel';
import type { QQMediaConsumer, QQMediaRead } from '@pet/companion-runtime';
import type { OneBotAction } from './wire.js';
import type {
  SnowDownloadedMedia,
  SnowMediaDownloadInput,
  SnowMediaExchange,
  SnowMediaIo,
  SnowMediaLookup,
  SnowMediaOutcome,
  SnowMediaUploadInput,
  SnowStagedMedia,
} from './media-types.js';
import {
  decodeSnowDownloadReply,
  decodeSnowUploadReply,
  encodeSnowMediaRequest,
  SNOW_DOWNLOAD_REQUEST_CHUNK_BYTES,
  SNOW_MEDIA_MAX_CHUNKS,
  SNOW_STAGING_RETENTION_MS,
  SNOW_UPLOAD_CHUNK_BYTES,
  type SnowMediaRequest,
  type SnowUploadReply,
} from './media-wire.js';

export const SNOW_MEDIA_TIMEOUT_MS = 300_000;
function fault(error: unknown, signal: AbortSignal): KernelError {
  return error instanceof KernelFault
    ? error.error
    : makeError(signal.aborted ? 'cancelled' : 'internal', false);
}
function name(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 240 &&
    ![...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  );
}
function reference(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 8192 &&
    ![...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  );
}
function route(value: { scene: string; targetId: string }): boolean {
  return ['private', 'group'].includes(value.scene) && /^[1-9]\d{0,19}$/u.test(value.targetId);
}
async function join(work: readonly Promise<unknown>[]): Promise<void> {
  const results = await Promise.allSettled(work);
  const failure = results.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
}
async function closeRead(reader: QQMediaRead, iterator: AsyncIterator<Uint8Array>): Promise<void> {
  let error: unknown;
  try {
    reader.cancel();
  } catch (cause) {
    error = cause;
  }
  await join([
    reader.settled,
    Promise.resolve().then(() => iterator.return?.()),
    error === undefined ? Promise.resolve() : Promise.reject(error),
  ]);
}
/** Finite facts for one transfer; never a persistent effect ledger or retry manager. */
class Attempt {
  dispatched = false;
  confirmedBytes = 0;
  confirmedChunks = 0;
  retcode: number | null = null;
  constructor(
    readonly io: SnowMediaIo,
    readonly connectionId: string,
    readonly signal: AbortSignal,
  ) {}
  reject(code: number): never {
    this.retcode = code;
    throw new KernelFault(code === 1401 || code === 1403 ? 'auth-failed' : 'unavailable');
  }
  async exchange<T>(
    request: SnowMediaRequest,
    consume: (iterator: AsyncIterator<string>) => Promise<T>,
  ): Promise<T> {
    this.signal.throwIfAborted();
    const encoded = encodeSnowMediaRequest(request);
    if (!encoded.ok) throw new KernelFault(encoded.error.code);
    let exchange: SnowMediaExchange;
    try {
      exchange = this.io.openMedia(request, this.signal);
    } catch (error) {
      // Native synchronous KernelFault validation guarantees no write was started.
      if (!(error instanceof KernelFault)) this.dispatched = true;
      throw error;
    }
    const iterator = exchange.frames[Symbol.asyncIterator]();
    const parsed: { result?: { value: T } } = {};
    const reading = consume(iterator).then((value) => {
      parsed.result = { value };
      return value;
    });
    void reading.catch(() => {});
    const close = (): Promise<void> => Promise.resolve().then(() => exchange.close());
    const stop = (): void => {
      void close().catch(() => {});
    };
    this.signal.addEventListener('abort', stop, { once: true });
    if (this.signal.aborted) stop();
    try {
      let sent;
      try {
        sent = await exchange.sent;
      } catch (error) {
        this.dispatched = true;
        if (parsed.result) return parsed.result.value;
        throw error;
      }
      if (!sent.ok) {
        this.dispatched ||= sent.dispatched;
        if (!sent.dispatched) {
          this.retcode = null;
          throw new KernelFault(sent.error.code);
        }
        if (parsed.result) return parsed.result.value;
        throw new KernelFault(sent.error.code);
      }
      this.dispatched = true;
      return await reading;
    } finally {
      this.signal.removeEventListener('abort', stop);
      await join([
        close(),
        exchange.settled,
        reading.then(
          () => {},
          () => {},
        ),
        Promise.resolve().then(() => iterator.return?.()),
      ]);
    }
  }
  failure<T>(error: unknown): Result<SnowMediaOutcome<T>> {
    const safe = fault(error, this.signal);
    return this.dispatched
      ? {
          ok: true,
          value: {
            kind: this.retcode === null ? 'unknown' : 'rejected',
            connectionId: this.connectionId,
            confirmedBytes: this.confirmedBytes,
            confirmedChunks: this.confirmedChunks,
            error: safe,
            retcode: this.retcode,
          },
        }
      : { ok: false, error: safe };
  }
}
function lifetime(parent: AbortSignal, timeoutMs: number): { signal: AbortSignal; clear(): void } {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > SNOW_MEDIA_TIMEOUT_MS)
    throw new KernelFault('invalid-input');
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(new KernelFault('timeout')), timeoutMs);
  return { signal: AbortSignal.any([parent, abort.signal]), clear: () => clearTimeout(timer) };
}
async function uploadReply(attempt: Attempt, request: SnowMediaRequest): Promise<SnowUploadReply> {
  return attempt.exchange(request, async (iterator) => {
    const next = await iterator.next();
    attempt.signal.throwIfAborted();
    if (next.done) throw new KernelFault('network');
    const parsed = decodeSnowUploadReply(next.value, request.echo);
    if (!parsed.ok) throw new KernelFault(parsed.error.code);
    if (parsed.value.kind === 'rejected') attempt.reject(parsed.value.retcode);
    return parsed.value;
  });
}

/** Stages bytes on the selected authenticated gateway. Never sends a QQ message itself. */
export async function uploadSnowMedia(
  io: SnowMediaIo,
  input: SnowMediaUploadInput,
  connectionId: string,
  nextEcho: () => string,
  parentSignal: AbortSignal,
  timeoutMs = SNOW_MEDIA_TIMEOUT_MS,
): Promise<Result<SnowMediaOutcome<SnowStagedMedia>>> {
  const source = input.source;
  if (
    !route(input) ||
    !['image', 'voice', 'file', 'text'].includes(input.kind) ||
    !name(source?.name) ||
    typeof source?.open !== 'function' ||
    !Number.isSafeInteger(source.sizeBytes) ||
    source.sizeBytes < 0 ||
    source.sizeBytes > COMPANION_MATERIAL_FILE_MAX_BYTES ||
    !/^[a-f0-9]{64}$/u.test(source.sha256)
  )
    return { ok: false, error: makeError('invalid-input', false) };
  const life = lifetime(parentSignal, timeoutMs);
  const attempt = new Attempt(io, connectionId, life.signal);
  const size = source.sizeBytes;
  const sha256 = source.sha256;
  const fileName = source.name;
  const total = Math.max(1, Math.ceil(size / SNOW_UPLOAD_CHUNK_BYTES));
  const params = {
    stream_id: `qqm_${randomUUID()}`,
    filename: fileName,
    total_chunks: total,
    file_size: size,
    expected_sha256: sha256,
    file_retention: SNOW_STAGING_RETENTION_MS,
  };
  try {
    life.signal.throwIfAborted();
    const reader = await source.open(0, size, life.signal);
    const iterator = reader.body[Symbol.asyncIterator]();
    const hash = createHash('sha256');
    let bytesRead = 0;
    let sourceChunks = 0;
    let filled = 0;
    let block = Buffer.alloc(SNOW_UPLOAD_CHUNK_BYTES);
    const push = async (bytes: Uint8Array): Promise<void> => {
      const index = attempt.confirmedChunks;
      const reply = await uploadReply(attempt, {
        action: 'upload_file_stream',
        echo: nextEcho(),
        params,
        chunk: { index, bytes },
      });
      if (
        reply.kind !== 'upload-progress' ||
        reply.status !== 'chunk_received' ||
        reply.stream_id !== params.stream_id ||
        reply.total_chunks !== total ||
        reply.received_chunks !== index + 1
      )
        throw new KernelFault('invalid-input');
      attempt.confirmedChunks++;
      attempt.confirmedBytes += bytes.byteLength;
    };
    try {
      while (true) {
        life.signal.throwIfAborted();
        const next = await iterator.next();
        life.signal.throwIfAborted();
        if (next.done) break;
        if (
          !(next.value instanceof Uint8Array) ||
          next.value.byteLength < 1 ||
          next.value.byteLength > MEDIA_MAX_CHUNK_BYTES ||
          bytesRead + next.value.byteLength > size ||
          ++sourceChunks > SNOW_MEDIA_MAX_CHUNKS
        )
          throw new KernelFault('quota-exceeded');
        const owned = Buffer.from(next.value);
        hash.update(owned);
        bytesRead += owned.byteLength;
        for (let at = 0; at < owned.byteLength;) {
          const length = Math.min(block.byteLength - filled, owned.byteLength - at);
          owned.copy(block, filled, at, at + length);
          at += length;
          filled += length;
          if (filled === block.byteLength) {
            await push(block);
            block = Buffer.alloc(SNOW_UPLOAD_CHUNK_BYTES);
            filled = 0;
          }
        }
      }
      if (bytesRead !== size || hash.digest('hex') !== sha256)
        throw new KernelFault('invalid-input');
      if (filled > 0 || size === 0) await push(block.subarray(0, filled));
    } finally {
      await closeRead(reader, iterator);
    }
    if (attempt.confirmedChunks !== total || attempt.confirmedBytes !== size)
      throw new KernelFault('invalid-input');
    const complete = await uploadReply(attempt, {
      action: 'upload_file_stream',
      echo: nextEcho(),
      params: { ...params, is_complete: true },
    });
    if (
      complete.kind !== 'upload-complete' ||
      complete.stream_id !== params.stream_id ||
      complete.file_size !== size ||
      complete.sha256 !== sha256 ||
      complete.received_chunks !== total ||
      complete.total_chunks !== total
    )
      throw new KernelFault('invalid-input');
    return {
      ok: true,
      value: {
        kind: 'complete',
        value: {
          connectionId,
          scene: input.scene,
          targetId: input.targetId,
          kind: input.kind,
          name: complete.file_name,
          sizeBytes: size,
          sha256,
          transferId: complete.stream_id,
          remotePath: complete.file_path,
        },
      },
    };
  } catch (error) {
    return attempt.failure(error);
  } finally {
    life.clear();
  }
}

/** Downloads into a task-owned private consumer; terminal has no provider transfer identifier. */
export async function downloadSnowMedia(
  io: SnowMediaIo,
  lookup: SnowMediaLookup,
  input: SnowMediaDownloadInput,
  consumer: QQMediaConsumer,
  connectionId: string,
  nextEcho: () => string,
  parentSignal: AbortSignal,
  timeoutMs = SNOW_MEDIA_TIMEOUT_MS,
): Promise<Result<SnowMediaOutcome<SnowDownloadedMedia>>> {
  if (
    !input.source ||
    !reference(input.source.fileId) ||
    typeof consumer !== 'function' ||
    (input.expectedSizeBytes !== null &&
      (!Number.isSafeInteger(input.expectedSizeBytes) ||
        input.expectedSizeBytes < 0 ||
        input.expectedSizeBytes > COMPANION_MATERIAL_FILE_MAX_BYTES)) ||
    (input.expectedSha256 !== null && !/^[a-f0-9]{64}$/u.test(input.expectedSha256))
  )
    return { ok: false, error: makeError('invalid-input', false) };
  const life = lifetime(parentSignal, timeoutMs);
  const attempt = new Attempt(io, connectionId, life.signal);
  try {
    life.signal.throwIfAborted();
    let request: SnowMediaRequest;
    if (input.source.kind === 'image' || input.source.kind === 'voice') {
      request = {
        action:
          input.source.kind === 'image'
            ? 'download_file_image_stream'
            : 'download_file_record_stream',
        echo: nextEcho(),
        params: { file_id: input.source.fileId, chunk_size: SNOW_DOWNLOAD_REQUEST_CHUNK_BYTES },
      };
    } else if (input.source.kind === 'file' && route(input.source)) {
      const source = input.source;
      const params =
        source.scene === 'group'
          ? {
              group_id: source.targetId,
              file_id: source.fileId,
              ...(source.busid === null ? {} : { busid: source.busid }),
            }
          : {
              user_id: source.targetId,
              file_id: source.fileId,
              ...(source.fileHash === null ? {} : { file_hash: source.fileHash }),
            };
      let result;
      try {
        result = await lookup(
          source.scene === 'group' ? 'get_group_file_url' : 'get_private_file_url',
          params,
          life.signal,
        );
      } catch (error) {
        attempt.dispatched = true;
        throw error;
      }
      if (!result.ok) {
        attempt.dispatched ||= result.dispatched;
        throw new KernelFault(result.error.code);
      }
      attempt.dispatched = true;
      if (result.value.status === 'failed') attempt.reject(result.value.retcode);
      const data = result.value.data;
      if (
        result.value.status !== 'ok' ||
        !data ||
        typeof data !== 'object' ||
        !('url' in data) ||
        !reference(data.url)
      )
        throw new KernelFault('invalid-input');
      const url = new URL(data.url);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
        throw new KernelFault('invalid-input');
      request = {
        action: 'download_file_stream',
        echo: nextEcho(),
        params: { file: data.url, chunk_size: SNOW_DOWNLOAD_REQUEST_CHUNK_BYTES },
      };
    } else throw new KernelFault('invalid-input');
    const result = await attempt.exchange(request, async (iterator) => {
      let fileName: string | null = null;
      let declared = 0;
      const hash = createHash('sha256');
      while (true) {
        life.signal.throwIfAborted();
        const next = await iterator.next();
        life.signal.throwIfAborted();
        if (next.done) throw new KernelFault('network');
        const parsed = decodeSnowDownloadReply(next.value, request.echo);
        if (!parsed.ok) throw new KernelFault(parsed.error.code);
        const reply = parsed.value;
        if (reply.kind === 'rejected') attempt.reject(reply.retcode);
        if (reply.kind === 'download-info') {
          if (fileName !== null) throw new KernelFault('invalid-input');
          fileName = reply.file_name;
          declared = reply.file_size;
          if (
            declared > 0 &&
            input.expectedSizeBytes !== null &&
            declared !== input.expectedSizeBytes
          )
            throw new KernelFault('invalid-input');
        } else if (reply.kind === 'download-chunk') {
          if (
            fileName === null ||
            reply.index !== attempt.confirmedChunks ||
            attempt.confirmedBytes + reply.bytes.byteLength > COMPANION_MATERIAL_FILE_MAX_BYTES ||
            (declared > 0 && attempt.confirmedBytes + reply.bytes.byteLength > declared)
          )
            throw new KernelFault('invalid-input');
          const owned = Buffer.from(reply.bytes);
          hash.update(owned);
          await consumer(owned, attempt.confirmedBytes, life.signal);
          attempt.confirmedBytes += owned.byteLength;
          attempt.confirmedChunks++;
        } else if (reply.kind === 'download-complete') {
          if (
            fileName === null ||
            reply.file_name !== fileName ||
            reply.total_chunks !== attempt.confirmedChunks ||
            reply.total_bytes !== attempt.confirmedBytes ||
            (declared > 0 && declared !== attempt.confirmedBytes) ||
            (input.expectedSizeBytes !== null && input.expectedSizeBytes !== attempt.confirmedBytes)
          )
            throw new KernelFault('invalid-input');
          const sha256 = hash.digest('hex');
          if (input.expectedSha256 !== null && sha256 !== input.expectedSha256)
            throw new KernelFault('invalid-input');
          return {
            connectionId,
            name: fileName,
            sizeBytes: attempt.confirmedBytes,
            sha256,
            chunks: attempt.confirmedChunks,
          };
        }
      }
    });
    return { ok: true, value: { kind: 'complete', value: result } };
  } catch (error) {
    return attempt.failure(error);
  } finally {
    life.clear();
  }
}

/** A separate single publish operation. Staging never calls this automatically. */
export function snowStagedSend(
  staged: SnowStagedMedia,
): Result<{ action: OneBotAction; params: Record<string, unknown> }> {
  if (!route(staged) || !reference(staged.remotePath) || !name(staged.name))
    return { ok: false, error: makeError('invalid-input', false) };
  const group = staged.scene === 'group';
  if (staged.kind === 'file' || staged.kind === 'text')
    return {
      ok: true,
      value: {
        action: group ? 'upload_group_file' : 'upload_private_file',
        params: {
          [group ? 'group_id' : 'user_id']: staged.targetId,
          file: staged.remotePath,
          name: staged.name,
          upload_file: true,
        },
      },
    };
  if (staged.kind !== 'image' && staged.kind !== 'voice')
    return { ok: false, error: makeError('invalid-input', false) };
  return {
    ok: true,
    value: {
      action: group ? 'send_group_msg' : 'send_private_msg',
      params: {
        [group ? 'group_id' : 'user_id']: staged.targetId,
        message: [
          { type: staged.kind === 'image' ? 'image' : 'record', data: { file: staged.remotePath } },
        ],
      },
    },
  };
}
