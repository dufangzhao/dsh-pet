import { createHash } from 'node:crypto';
import {
  COMPANION_MATERIAL_FILE_MAX_BYTES,
  MEDIA_MAX_CHUNK_BYTES,
  makeError,
  type KernelError,
} from '@pet/contracts';
import { KernelFault } from '@pet/host-kernel';
import type {
  QQIoOutcome,
  QQMediaSource,
  QQMediaConsumer,
  QQMediaRead,
} from '@pet/companion-runtime';
import type { OfficialHttpResponse } from './ports.js';
import type {
  OfficialAttachmentInput,
  OfficialDownloadedMedia,
  OfficialMediaInput,
  OfficialMediaIo,
  OfficialMediaResult,
  OfficialMediaOperationResult,
} from './media-types.js';
import { decodeOfficialHttpReceipt, type OfficialHttpReceipt } from './wire.js';
import {
  isOfficialPreparedPlan,
  isOfficialPartFinished,
  validOfficialMediaMetadata,
  OFFICIAL_INLINE_MEDIA_MAX_BYTES,
  OFFICIAL_PREFIX_HASH_BYTES,
  type OfficialMediaHashes,
  type OfficialMediaMetadata,
} from './media-wire.js';

const MAX_SOURCE_CHUNKS = 32_768;

function errorOf(error: unknown, signal: AbortSignal): KernelError {
  return error instanceof KernelFault
    ? error.error
    : makeError(signal.aborted ? 'cancelled' : 'internal', false);
}
interface ReadCleanup {
  readonly state: 'settled' | 'failed';
  readonly error: KernelError | null;
}
/** A body/authority error is not proof that the reader's physical resource failed to return. */
async function closeReader(
  reader: QQMediaRead,
  endings: readonly (() => Promise<unknown> | undefined)[],
  signal: AbortSignal,
): Promise<ReadCleanup> {
  let cancellation: KernelError | null = null;
  try {
    reader.cancel();
  } catch (error) {
    cancellation = errorOf(error, signal);
  }
  const [physical, ...logical] = await Promise.allSettled([
    reader.settled,
    ...endings.map((end) => Promise.resolve().then(end)),
  ]);
  if (physical?.status !== 'fulfilled')
    return {
      state: 'failed',
      error:
        physical?.status === 'rejected' && physical.reason instanceof KernelFault
          ? physical.reason.error
          : makeError('internal', false),
    };
  const failure = logical.find((result) => result.status === 'rejected');
  return {
    state: 'settled',
    error:
      cancellation ?? (failure?.status === 'rejected' ? errorOf(failure.reason, signal) : null),
  };
}
interface Range {
  readonly body: AsyncGenerator<Uint8Array>;
  readonly state: { bytes: number; ended: boolean };
  close(): Promise<ReadCleanup>;
}
/** Bounded copies detach provider-owned buffers. Offset/length select only this material's range. */
async function range(
  source: QQMediaSource,
  offset: number,
  length: number,
  signal: AbortSignal,
  onBytes: (bytes: Uint8Array) => void,
): Promise<Range> {
  signal.throwIfAborted();
  const reader = await source.open(offset, length, signal);
  const iterator = reader.body[Symbol.asyncIterator]();
  const state = { bytes: 0, ended: false };
  const body = (async function* (): AsyncGenerator<Uint8Array> {
    let chunks = 0;
    while (true) {
      signal.throwIfAborted();
      const next = await iterator.next();
      if (next.done) {
        if (state.bytes !== length) throw new KernelFault('invalid-input');
        state.ended = true;
        return;
      }
      signal.throwIfAborted();
      if (
        !(next.value instanceof Uint8Array) ||
        next.value.byteLength < 1 ||
        next.value.byteLength > MEDIA_MAX_CHUNK_BYTES ||
        state.bytes + next.value.byteLength > length ||
        ++chunks > MAX_SOURCE_CHUNKS
      )
        throw new KernelFault('quota-exceeded');
      const owned = Buffer.from(next.value);
      state.bytes += owned.byteLength;
      onBytes(owned);
      yield owned;
    }
  })();
  let closing: Promise<ReadCleanup> | null = null;
  return {
    body,
    state,
    close() {
      closing ??= closeReader(
        reader,
        [() => iterator.return?.(), () => body.return(undefined)],
        signal,
      );
      return closing;
    },
  };
}
async function hashesOf(
  source: QQMediaSource,
  signal: AbortSignal,
  recordCleanup: (result: ReadCleanup) => void,
): Promise<OfficialMediaHashes> {
  const md5 = createHash('md5');
  const sha1 = createHash('sha1');
  const sha256 = createHash('sha256');
  const prefix = createHash('md5');
  let prefixBytes = 0;
  const read = await range(source, 0, source.sizeBytes, signal, (bytes) => {
    md5.update(bytes);
    sha1.update(bytes);
    sha256.update(bytes);
    const count = Math.min(bytes.byteLength, OFFICIAL_PREFIX_HASH_BYTES - prefixBytes);
    if (count > 0) {
      prefix.update(bytes.subarray(0, count));
      prefixBytes += count;
    }
  });
  let cleanup: ReadCleanup;
  try {
    while (!(await read.body.next()).done) {
      // Advancing the bounded range feeds all four hash states without retaining file bytes.
    }
  } finally {
    cleanup = await read.close();
    recordCleanup(cleanup);
  }
  if (cleanup.error) throw new KernelFault(cleanup.error.code);
  const result = {
    md5: md5.digest('hex'),
    sha1: sha1.digest('hex'),
    sha256: sha256.digest('hex'),
    md5_10m: prefix.digest('hex'),
  };
  if (result.sha256 !== source.sha256) throw new KernelFault('invalid-input');
  return result;
}

/** Captured provider attachment only; the host enforces provider-domain/DNS/redirect policy. */
export async function readOfficialAttachment(
  io: OfficialMediaIo,
  input: OfficialAttachmentInput,
  consumer: QQMediaConsumer,
  connectionId: string,
  signal: AbortSignal,
  check: () => Promise<void>,
): Promise<OfficialMediaOperationResult<OfficialDownloadedMedia>> {
  if (
    !Number.isSafeInteger(input.maximumBytes) ||
    input.maximumBytes < 1 ||
    input.maximumBytes > COMPANION_MATERIAL_FILE_MAX_BYTES ||
    !input.name ||
    input.name.length > 240 ||
    typeof consumer !== 'function' ||
    (input.expectedSizeBytes !== null &&
      (!Number.isSafeInteger(input.expectedSizeBytes) ||
        input.expectedSizeBytes < 0 ||
        input.expectedSizeBytes > input.maximumBytes)) ||
    (input.expectedSha256 !== null && !/^[a-f0-9]{64}$/u.test(input.expectedSha256))
  )
    return { ok: false, error: makeError('invalid-input', false) };
  let cleanup: ReadCleanup = { state: 'settled', error: null };
  try {
    signal.throwIfAborted();
    await check();
    signal.throwIfAborted();
    const reader = await io.readAttachment(
      {
        scene: input.scene,
        targetId: input.targetId,
        url: input.url,
        maximumBytes: input.maximumBytes,
      },
      signal,
      check,
    );
    const iterator = reader.body[Symbol.asyncIterator]();
    const hash = createHash('sha256');
    let bytes = 0;
    let chunks = 0;
    let downloaded: OfficialDownloadedMedia;
    try {
      while (true) {
        signal.throwIfAborted();
        const next = await iterator.next();
        signal.throwIfAborted();
        if (next.done) break;
        if (
          !(next.value instanceof Uint8Array) ||
          next.value.byteLength < 1 ||
          next.value.byteLength > MEDIA_MAX_CHUNK_BYTES ||
          bytes + next.value.byteLength > input.maximumBytes ||
          ++chunks > MAX_SOURCE_CHUNKS
        )
          throw new KernelFault('quota-exceeded');
        const owned = Buffer.from(next.value);
        hash.update(owned);
        await consumer(owned, bytes, signal);
        bytes += owned.byteLength;
      }
      const sha256 = hash.digest('hex');
      if (
        (input.expectedSizeBytes !== null && bytes !== input.expectedSizeBytes) ||
        (input.expectedSha256 !== null && sha256 !== input.expectedSha256)
      )
        throw new KernelFault('invalid-input');
      downloaded = { connectionId, name: input.name, sizeBytes: bytes, sha256 };
    } finally {
      cleanup = await closeReader(reader, [() => iterator.return?.()], signal);
    }
    if (cleanup.error) return { ok: false, error: cleanup.error, cleanup: cleanup.state };
    signal.throwIfAborted();
    await check();
    signal.throwIfAborted();
    return { ok: true, value: downloaded };
  } catch (error) {
    return { ok: false, error: cleanup.error ?? errorOf(error, signal), cleanup: cleanup.state };
  }
}

/** One upload attempt, no retry and no message publication. Returned file_info stays host-private. */
export async function uploadOfficialMedia(
  io: OfficialMediaIo,
  input: OfficialMediaInput,
  connectionId: string,
  signal: AbortSignal,
): Promise<OfficialMediaOperationResult<OfficialMediaResult>> {
  const source = input.source;
  const metadata: OfficialMediaMetadata = {
    scene: input.scene,
    targetId: input.targetId,
    file_type: input.fileType,
    file_name: source?.name,
    sizeBytes: source?.sizeBytes,
  };
  if (
    !validOfficialMediaMetadata(metadata) ||
    typeof source?.open !== 'function' ||
    !/^[a-f0-9]{64}$/u.test(source.sha256)
  )
    return { ok: false, error: makeError('invalid-input', false) };
  const expectedSha256 = source.sha256;
  let stage: OfficialMediaResult['stage'] = 'hash';
  let completedParts = 0;
  let confirmedBytes = 0;
  let dispatched = false;
  let cleanup: ReadCleanup = { state: 'settled', error: null };
  let completedReceipt: OfficialHttpReceipt | null = null;
  const recordCleanup = (result: ReadCleanup): void => {
    cleanup = {
      state: result.state === 'failed' ? 'failed' : cleanup.state,
      error: cleanup.error ?? result.error,
    };
  };
  const result = (
    receipt: OfficialHttpReceipt,
    error: KernelError | null,
  ): OfficialMediaOperationResult<OfficialMediaResult> => ({
    ok: true,
    value: {
      connectionId,
      stage,
      completedParts,
      confirmedBytes,
      cleanup: cleanup.state,
      receipt,
      error: cleanup.error ?? error ?? (signal.aborted ? errorOf(signal.reason, signal) : null),
    },
  });
  const unknown = (error: KernelError): OfficialMediaOperationResult<OfficialMediaResult> =>
    result(
      completedReceipt ?? { kind: 'unknown', httpStatus: 0, reason: 'invalid-response' },
      error,
    );
  const reply = (
    response: OfficialHttpResponse,
  ): OfficialMediaOperationResult<OfficialMediaResult> => {
    const receipt = decodeOfficialHttpReceipt(response.status, response.body, 'media-upload');
    if (receipt.kind !== 'unknown') completedReceipt = receipt;
    return result(receipt, null);
  };
  const request = async <T>(call: () => Promise<QQIoOutcome<T>>): Promise<T> => {
    signal.throwIfAborted();
    let result: QQIoOutcome<T>;
    try {
      result = await call();
    } catch (error) {
      dispatched = true;
      throw error;
    }
    if (!result.ok) {
      dispatched ||= result.dispatched;
      throw new KernelFault(result.error.code);
    }
    dispatched = true;
    return result.value;
  };
  try {
    const hashes = await hashesOf(source, signal, recordCleanup);
    if (source.sizeBytes !== metadata.sizeBytes || source.sha256 !== expectedSha256)
      throw new KernelFault('conflict');
    if (metadata.sizeBytes <= OFFICIAL_INLINE_MEDIA_MAX_BYTES) {
      stage = 'inline';
      const hash = createHash('sha256');
      const read = await range(source, 0, metadata.sizeBytes, signal, (bytes) =>
        hash.update(bytes),
      );
      let receipt: OfficialHttpReceipt;
      try {
        const response = await request(() =>
          io.inline({ ...metadata, srv_send_msg: false }, read.body, signal),
        );
        receipt = decodeOfficialHttpReceipt(response.status, response.body, 'media-upload');
        if (receipt.kind === 'media-upload-accepted') {
          if (!read.state.ended || hash.digest('hex') !== expectedSha256)
            throw new KernelFault('invalid-input');
          confirmedBytes = metadata.sizeBytes;
        }
        if (receipt.kind !== 'unknown') completedReceipt = receipt;
      } finally {
        recordCleanup(await read.close());
      }
      return result(receipt, null);
    }
    stage = 'prepare';
    const prepared = await request(() => io.prepare(metadata, hashes, signal));
    if (prepared.kind !== 'prepared') return result(prepared, null);
    if (!isOfficialPreparedPlan(prepared.plan, metadata.sizeBytes))
      return unknown(makeError('invalid-input', false));
    const plan = { ...prepared.plan, parts: prepared.plan.parts.map((part) => ({ ...part })) };
    const route = { scene: metadata.scene, targetId: metadata.targetId, upload_id: plan.upload_id };
    const uploadedHash = createHash('sha256');
    for (const part of plan.parts) {
      signal.throwIfAborted();
      stage = 'part';
      const partHash = createHash('md5');
      const read = await range(source, part.offset, part.byteLength, signal, (bytes) => {
        partHash.update(bytes);
        uploadedHash.update(bytes);
      });
      let digest: string | null = null;
      let put: OfficialHttpResponse;
      try {
        put = await request(() =>
          io.putPart(
            { ...route, part_index: part.index, byteLength: part.byteLength },
            read.body,
            signal,
          ),
        );
        if ([200, 201, 204].includes(put.status)) {
          if (!read.state.ended) throw new KernelFault('invalid-input');
          digest = partHash.digest('hex');
          confirmedBytes += part.byteLength;
        }
      } finally {
        recordCleanup(await read.close());
      }
      if (digest === null) return reply(put);
      if (cleanup.error) throw new KernelFault(cleanup.error.code);
      stage = 'finish';
      const finished = await request(() =>
        io.finishPart(
          { ...route, part_index: part.index, block_size: String(part.byteLength), md5: digest },
          signal,
        ),
      );
      if (!isOfficialPartFinished(finished)) {
        const receipt = decodeOfficialHttpReceipt(finished.status, finished.body, 'media-upload');
        return receipt.kind === 'rejected'
          ? reply(finished)
          : unknown(makeError('invalid-input', false));
      }
      completedParts++;
    }
    if (confirmedBytes !== metadata.sizeBytes || uploadedHash.digest('hex') !== expectedSha256)
      throw new KernelFault('invalid-input');
    stage = 'commit';
    return reply(
      await request(() =>
        io.commit({ ...metadata, upload_id: plan.upload_id, srv_send_msg: false }, signal),
      ),
    );
  } catch (error) {
    const failure = cleanup.error ?? errorOf(error, signal);
    return dispatched ? unknown(failure) : { ok: false, error: failure, cleanup: cleanup.state };
  }
}
