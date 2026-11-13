import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  COMPANION_MATERIAL_FILE_MAX_BYTES,
  MEDIA_MAX_CHUNK_BYTES,
  isCompanionMaterialRef,
  isCompanionRecordId,
  isQQDeliveryPart,
  isQQExternalId,
  isQQReplyRoute,
  sameQQAccount,
  makeError,
  type CompanionMaterialRef,
  type KernelError,
  type QQRemoteReceipt,
  type Result,
} from '@pet/contracts';
import { KernelFault } from '@pet/host-kernel';
import type { QQMediaRead, QQMediaSource } from '@pet/companion-runtime';
import type {
  OfficialQqDriver,
  OfficialDriverHttpResult,
} from '../../../plugins/qq-official/src/driver.js';
import type { OfficialMediaResult } from '../../../plugins/qq-official/src/media-types.js';
import { OFFICIAL_MEDIA_MAX_PARTS } from '../../../plugins/qq-official/src/media-wire.js';
import type { OfficialHttpReceipt } from '../../../plugins/qq-official/src/wire.js';
import type { OneBotQqDriver, OneBotCallOutcome } from '../../../plugins/qq-onebot/src/driver.js';
import type { SnowStagedMedia } from '../../../plugins/qq-onebot/src/media-types.js';
import { decodeOneBotActionReceipt } from '../../../plugins/qq-onebot/src/wire.js';
import type { CapturedQqSourceBase } from './qq-controller.js';
import type { QQDeliveryOutcome, QQDeliveryRequest, QQDeliverySource } from './qq-delivery.js';

export type QQDeliveryNativeSource = CapturedQqSourceBase &
  (
    | {
        readonly protocol: 'official';
        readonly driver: Pick<OfficialQqDriver, 'send' | 'uploadMedia'>;
      }
    | {
        readonly protocol: 'onebot-v11';
        readonly driver: Pick<OneBotQqDriver, 'call' | 'uploadMedia' | 'sendStaged'>;
      }
  );
const errorOf = (error: unknown, signal: AbortSignal): KernelError =>
  error instanceof KernelFault
    ? error.error
    : makeError(signal.aborted ? 'cancelled' : 'unavailable', false);
const publicReceipt = (fields: Partial<QQRemoteReceipt>): QQRemoteReceipt => ({
  messageId: null,
  fileId: null,
  transferId: null,
  sequence: null,
  sequenceAuthoritative: null,
  ...fields,
});
function publicId(value: unknown): string {
  if (!isQQExternalId(value) || /^(?:https?:|file:|[/\\])/i.test(value))
    throw new KernelFault('invalid-input');
  return value;
}
const digest = (bytes: string | Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');
type HeldRange = { readonly read: QQMediaRead; ended: boolean; close(): Promise<void> };

/** A verified private stream becomes repeatable bounded views only for this execute call. */
class ScopedMedia {
  private closed = false;
  private readonly readers = new Set<HeldRange>();
  readonly source: QQMediaSource;
  private constructor(
    private readonly chunks: Uint8Array[],
    material: CompanionMaterialRef,
    private readonly check: () => Promise<void>,
    private readonly signal: AbortSignal,
  ) {
    this.source = Object.freeze({
      name: material.name,
      sizeBytes: material.sizeBytes,
      sha256: material.sha256,
      open: (offset: number, length: number, signal: AbortSignal) =>
        this.open(offset, length, signal),
    });
  }
  static async collect(
    request: QQDeliveryRequest,
    check: () => Promise<void>,
    signal: AbortSignal,
  ): Promise<ScopedMedia> {
    const material = request.material;
    if (
      !material ||
      !isCompanionMaterialRef(material) ||
      !request.bytes ||
      material.sizeBytes > COMPANION_MATERIAL_FILE_MAX_BYTES
    )
      throw new KernelFault('invalid-input');
    const chunks: Uint8Array[] = [];
    const hash = createHash('sha256');
    let size = 0;
    const iterator = request.bytes[Symbol.asyncIterator]();
    let ended = false;
    try {
      for (;;) {
        await check();
        const next = await iterator.next();
        await check();
        if (next.done) {
          ended = true;
          break;
        }
        const chunk = next.value;
        if (
          !(chunk instanceof Uint8Array) ||
          !chunk.byteLength ||
          chunk.byteLength > MEDIA_MAX_CHUNK_BYTES
        )
          throw new KernelFault('invalid-input');
        size += chunk.byteLength;
        if (size > material.sizeBytes || chunks.length >= 32768)
          throw new KernelFault('quota-exceeded');
        // Sender/store owns immutable chunks throughout this awaited attempt; retain views, not copies.
        chunks.push(chunk);
        hash.update(chunk);
      }
      if (size !== material.sizeBytes || hash.digest('hex') !== material.sha256)
        throw new KernelFault('invalid-input');
      if (material.kind === 'voice') {
        const header = Buffer.alloc(10);
        let copied = 0;
        for (const chunk of chunks) {
          const count = Math.min(10 - copied, chunk.byteLength);
          header.set(chunk.subarray(0, count), copied);
          copied += count;
          if (copied === 10) break;
        }
        // QQAudio owns full codec verification. Only its Tencent SILK result is eligible here.
        if (material.mediaType !== 'audio/silk' || !header.equals(Buffer.from('\x02#!SILK_V3')))
          throw new KernelFault('invalid-input');
      }
      return new ScopedMedia(chunks, material, check, signal);
    } finally {
      if (!ended) await iterator.return?.();
    }
  }
  private async open(offset: number, length: number, caller: AbortSignal): Promise<QQMediaRead> {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      offset > this.source.sizeBytes ||
      length > this.source.sizeBytes - offset
    )
      throw new KernelFault('invalid-input');
    if (this.closed || this.readers.size >= OFFICIAL_MEDIA_MAX_PARTS + 1)
      throw new KernelFault('not-ready');
    await this.check();
    if (this.closed) throw new KernelFault('not-ready');
    const abort = new AbortController();
    const signal = AbortSignal.any([this.signal, caller, abort.signal]);
    let used = false,
      stopped = false,
      position = offset;
    let pending: Promise<IteratorResult<Uint8Array>> | undefined;
    let finish: () => void = () => {};
    const settled = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let closing: Promise<void> | undefined;
    const close = (): Promise<void> =>
      (closing ??= (async () => {
        stopped = true;
        abort.abort();
        await pending?.catch(() => {});
        signal.removeEventListener('abort', onAbort);
        finish();
      })());
    const onAbort = (): void => {
      void close();
    };
    const held: HeldRange = {
      ended: false,
      close,
      read: {
        settled,
        cancel: onAbort,
        body: {
          [Symbol.asyncIterator]: () => {
            if (used) throw new KernelFault('conflict');
            used = true;
            return {
              next: () => {
                if (pending) return Promise.reject(new KernelFault('conflict'));
                const work = (async (): Promise<IteratorResult<Uint8Array>> => {
                  if (stopped || signal.aborted || this.closed) throw new KernelFault('cancelled');
                  await this.check();
                  if (stopped || signal.aborted || this.closed) throw new KernelFault('cancelled');
                  if (position === offset + length) {
                    held.ended = true;
                    stopped = true;
                    finish();
                    signal.removeEventListener('abort', onAbort);
                    return { done: true, value: undefined };
                  }
                  let base = 0;
                  for (const chunk of this.chunks) {
                    if (position < base + chunk.byteLength) {
                      const at = position - base;
                      const count = Math.min(
                        chunk.byteLength - at,
                        offset + length - position,
                        MEDIA_MAX_CHUNK_BYTES,
                      );
                      position += count;
                      return { done: false, value: chunk.subarray(at, at + count) };
                    }
                    base += chunk.byteLength;
                  }
                  throw new KernelFault('invalid-input');
                })();
                pending = work;
                void work.then(
                  () => {
                    pending = undefined;
                  },
                  () => {
                    pending = undefined;
                    void close();
                  },
                );
                return work;
              },
              return: async () => {
                await close();
                return { done: true as const, value: undefined };
              },
            };
          },
        },
      },
    };
    this.readers.add(held);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    return held.read;
  }
  complete(): boolean {
    return [...this.readers].every((reader) => reader.ended);
  }
  async close(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.readers].map((reader) => reader.close()));
    this.chunks.length = 0;
  }
}

function validate(request: QQDeliveryRequest, captured: QQDeliveryNativeSource): void {
  const { delivery, part, operation } = request;
  if (
    typeof request.check !== 'function' ||
    request.expectedConnectionId !== captured.connectionId ||
    !isQQReplyRoute(delivery.route) ||
    !sameQQAccount(delivery.route.account, captured.account) ||
    captured.account.protocol !== captured.protocol ||
    !isQQDeliveryPart(part) ||
    part.preparation !== 'ready' ||
    !isDeepStrictEqual(
      delivery.parts.find((item) => item.id === part.id),
      part,
    ) ||
    !['prepared', 'sending'].includes(delivery.phase)
  )
    throw new KernelFault('conflict');
  const claim = operation === 'send' ? part.send : part.upload;
  if (
    !claim ||
    claim.id !== request.attemptId ||
    claim.operation !== operation ||
    claim.phase !== 'claimed'
  )
    throw new KernelFault('conflict');
  if (captured.protocol === 'official') {
    if (
      !['official-passive', 'official-proactive'].includes(delivery.mode) ||
      operation === 'upload-and-send'
    )
      throw new KernelFault('invalid-input');
    if (operation === 'send' && (!Number.isSafeInteger(part.msgSeq) || (part.msgSeq ?? 0) < 1))
      throw new KernelFault('invalid-input');
    if (
      delivery.mode === 'official-passive' &&
      (!delivery.route.reference ||
        !(delivery.route.reference.messageId || delivery.route.reference.eventId))
    )
      throw new KernelFault('invalid-input');
  } else if (delivery.mode !== 'onebot' || part.msgSeq !== null)
    throw new KernelFault('invalid-input');
  if (part.content.kind === 'inline-text') {
    if (
      operation !== 'send' ||
      request.bytes !== undefined ||
      request.material !== undefined ||
      request.uploaded !== undefined ||
      digest(part.content.text) !== part.content.sha256
    )
      throw new KernelFault('invalid-input');
  } else {
    const material = part.content.material;
    if (!material || !isCompanionMaterialRef(material)) throw new KernelFault('invalid-input');
    if (
      part.content.kind === 'voice' &&
      (material.kind !== 'voice' || material.mediaType !== 'audio/silk')
    )
      throw new KernelFault('invalid-input');
    const compound = captured.protocol === 'onebot-v11' && ['file', 'text'].includes(material.kind);
    if (compound ? operation !== 'upload-and-send' : !['upload', 'send'].includes(operation))
      throw new KernelFault('invalid-input');
    if (
      operation !== 'send' &&
      (!isDeepStrictEqual(request.material, material) ||
        !request.bytes ||
        request.uploaded !== undefined)
    )
      throw new KernelFault('invalid-input');
    if (
      operation === 'send' &&
      (request.bytes !== undefined ||
        request.material !== undefined ||
        request.uploaded === undefined)
    )
      throw new KernelFault('invalid-input');
  }
}
function binding(request: QQDeliveryRequest): unknown {
  return {
    delivery: request.delivery.id,
    mode: request.delivery.mode,
    route: request.delivery.route,
    part: request.part.id,
    content: request.part.content,
  };
}
type Issued = { readonly binding: unknown } & (
  | {
      readonly protocol: 'official';
      readonly handle: Extract<OfficialHttpReceipt, { kind: 'media-upload-accepted' }>;
    }
  | { readonly protocol: 'onebot-v11'; readonly handle: SnowStagedMedia }
);

/** Adapt one captured source, never fetch a replacement connection or retry an effect. */
export function createQQDeliverySource(source: QQDeliveryNativeSource): QQDeliverySource {
  const captured = {
    ...source,
    account: Object.freeze(structuredClone(source.account)),
    check: source.check.bind(source),
  };
  const fenced = new AbortController();
  const sourceSignal = AbortSignal.any([source.signal, fenced.signal]);
  const checkSource = async (): Promise<void> => {
    try {
      sourceSignal.throwIfAborted();
      await captured.check();
      sourceSignal.throwIfAborted();
    } catch (error) {
      fenced.abort();
      throw error;
    }
  };
  const issued = new WeakMap<object, Issued>();
  return {
    account: captured.account,
    connectionId: captured.connectionId,
    signal: sourceSignal,
    check: checkSource,
    transport: {
      async execute(raw, caller, progress): Promise<QQDeliveryOutcome> {
        const lifetime = new AbortController();
        const signal = AbortSignal.any([sourceSignal, caller, lifetime.signal]);
        let dispatched = false,
          uncertain = false;
        let cleanup: QQDeliveryOutcome['cleanup'] = 'settled';
        let receipt: QQRemoteReceipt | null = null,
          correlationId: string | null = null;
        let outcome: QQDeliveryOutcome | undefined, media: ScopedMedia | undefined;
        const failed = (error: KernelError): QQDeliveryOutcome => ({
          dispatched,
          outcome: uncertain
            ? 'unknown'
            : !dispatched && (signal.aborted || error.code === 'cancelled')
              ? 'cancelled-before-dispatch'
              : 'failed',
          receipt,
          correlationId,
          cleanup,
          error,
        });
        const accepted = (
          error: KernelError | null = null,
          uploaded?: unknown,
        ): QQDeliveryOutcome => ({
          dispatched: true,
          outcome: 'accepted',
          receipt,
          correlationId,
          cleanup,
          error,
          ...(uploaded !== undefined ? { uploaded } : {}),
        });
        try {
          validate(raw, captured);
          const request: QQDeliveryRequest = {
            ...raw,
            delivery: structuredClone(raw.delivery),
            part: structuredClone(raw.part),
            ...(raw.material ? { material: structuredClone(raw.material) } : {}),
            check: raw.check.bind(raw),
          };
          const check = async (): Promise<void> => {
            signal.throwIfAborted();
            await checkSource();
            signal.throwIfAborted();
            try {
              await request.check();
            } catch (error) {
              fenced.abort();
              throw error;
            }
            signal.throwIfAborted();
            if (
              request.delivery.mode === 'official-passive' &&
              request.delivery.eligibilityExpiresAt !== null &&
              Date.now() >= request.delivery.eligibilityExpiresAt
            )
              throw new KernelFault('not-ready');
          };
          const io = async <T extends Result<unknown>>(run: () => Promise<T>): Promise<T> => {
            await check();
            uncertain = true;
            try {
              const result = await run();
              if (result.ok) dispatched = true;
              return result;
            } catch (error) {
              dispatched = true;
              throw error;
            }
          };
          const publish = async (): Promise<void> => {
            await progress({ dispatched, receipt, correlationId });
          };
          const official = (
            value: OfficialDriverHttpResult | OfficialMediaResult,
            operation: 'upload' | 'send',
          ): QQDeliveryOutcome => {
            if ('cleanup' in value) cleanup = value.cleanup;
            if (value.connectionId !== captured.connectionId) throw new KernelFault('stale-owner');
            const native = value.receipt;
            dispatched = true;
            if (native.kind === 'rejected') {
              uncertain = false;
              return {
                ...failed(
                  value.error ??
                    makeError(
                      native.httpStatus === 401 || native.httpStatus === 403
                        ? 'auth-failed'
                        : 'unavailable',
                      false,
                    ),
                ),
                outcome: 'rejected',
              };
            }
            if (operation === 'send' && native.kind === 'message-accepted') {
              receipt = publicReceipt({ messageId: publicId(native.id) });
              uncertain = false;
              return accepted(value.error);
            }
            if (operation === 'upload' && native.kind === 'media-upload-accepted') {
              receipt = publicReceipt({ fileId: publicId(native.file_uuid) });
              uncertain = false;
              Object.freeze(native);
              issued.set(native, {
                protocol: 'official',
                binding: structuredClone(binding(request)),
                handle: native,
              });
              return accepted(value.error, native);
            }
            return {
              ...failed(value.error ?? makeError('unavailable', false)),
              outcome: 'unknown',
            };
          };
          const onebot = (value: OneBotCallOutcome, file: boolean): QQDeliveryOutcome => {
            if (value.connectionId !== captured.connectionId) throw new KernelFault('stale-owner');
            dispatched = true;
            correlationId = publicId(value.echo);
            if (value.kind === 'unknown') return { ...failed(value.error), outcome: 'unknown' };
            const decoded = decodeOneBotActionReceipt(
              value.response,
              value.echo,
              file ? 'file-action' : 'send',
            );
            if (!decoded.ok) return { ...failed(decoded.error), outcome: 'unknown' };
            const native = decoded.value;
            if (native.kind === 'rejected') {
              uncertain = false;
              return { ...failed(makeError('unavailable', false)), outcome: 'rejected' };
            }
            if (native.kind === 'send-response') {
              receipt = publicReceipt({
                ...receipt,
                messageId: publicId(String(native.message_id)),
              });
              uncertain = false;
              return accepted();
            }
            if (native.kind === 'file-action-response' && native.file_id !== null) {
              receipt = publicReceipt({ ...receipt, fileId: publicId(native.file_id) });
              uncertain = false;
              return accepted();
            }
            return { ...failed(makeError('unavailable', false)), outcome: 'unknown' };
          };
          await check();
          if (request.operation !== 'send')
            media = await ScopedMedia.collect(request, check, signal);
          if (captured.protocol === 'official') {
            const scene = request.delivery.route.scene === 'private' ? 'c2c' : 'group';
            const target = request.delivery.route.targetId;
            if (request.operation === 'upload') {
              if (!media || !request.material) throw new KernelFault('invalid-input');
              const input = media.source;
              const result = await io(() =>
                captured.driver.uploadMedia(
                  {
                    scene,
                    targetId: target,
                    fileType:
                      request.material?.kind === 'image'
                        ? 1
                        : request.material?.kind === 'voice'
                          ? 3
                          : 4,
                    source: input,
                  },
                  signal,
                  captured.connectionId,
                ),
              );
              if (result.ok) outcome = official(result.value, 'upload');
              else {
                if ('cleanup' in result && result.cleanup === 'failed') cleanup = 'failed';
                uncertain = false;
                outcome = failed(result.error);
              }
            } else {
              const payload: Record<string, unknown> = { msg_seq: request.part.msgSeq };
              if (request.delivery.mode === 'official-passive') {
                const reference = request.delivery.route.reference;
                if (reference?.messageId) payload['msg_id'] = reference.messageId;
                else payload['event_id'] = reference?.eventId;
              }
              const display = request.delivery.route.reference?.displayReference;
              if (display) payload['message_reference'] = { message_id: display };
              if (request.part.content.kind === 'inline-text') {
                payload['msg_type'] = 0;
                payload['content'] = request.part.content.text;
              } else {
                const token =
                  request.uploaded && typeof request.uploaded === 'object'
                    ? issued.get(request.uploaded)
                    : undefined;
                if (
                  !token ||
                  token.protocol !== 'official' ||
                  !isDeepStrictEqual(token.binding, binding(request))
                )
                  throw new KernelFault('permission-denied');
                payload['msg_type'] = 7;
                payload['media'] = { file_info: token.handle.file_info };
              }
              const result = await io(() =>
                captured.driver.send(scene, target, payload, signal, captured.connectionId),
              );
              if (result.ok) outcome = official(result.value, 'send');
              else {
                uncertain = false;
                outcome = failed(result.error);
              }
            }
          } else {
            const route = request.delivery.route;
            if (request.operation !== 'send') {
              if (!media || !request.material) throw new KernelFault('invalid-input');
              const material = request.material;
              const input = media.source;
              const result = await io(() =>
                captured.driver.uploadMedia(
                  {
                    scene: route.scene,
                    targetId: route.targetId,
                    kind: material.kind,
                    source: input,
                  },
                  signal,
                  captured.connectionId,
                ),
              );
              if (!result.ok) {
                uncertain = false;
                outcome = failed(result.error);
              } else if (result.value.kind !== 'complete') {
                dispatched = true;
                if (result.value.connectionId !== captured.connectionId)
                  throw new KernelFault('stale-owner');
                uncertain = result.value.kind === 'unknown';
                outcome = { ...failed(result.value.error), outcome: result.value.kind };
              } else {
                dispatched = true;
                const staged = result.value.value;
                if (
                  staged.connectionId !== captured.connectionId ||
                  staged.scene !== route.scene ||
                  staged.targetId !== route.targetId ||
                  staged.kind !== material.kind ||
                  staged.name !== material.name ||
                  staged.sizeBytes !== material.sizeBytes ||
                  staged.sha256 !== material.sha256 ||
                  !isCompanionRecordId(staged.transferId)
                )
                  throw new KernelFault('conflict');
                uncertain = false;
                receipt = publicReceipt({ transferId: staged.transferId });
                Object.freeze(staged);
                issued.set(staged, {
                  protocol: 'onebot-v11',
                  binding: structuredClone(binding(request)),
                  handle: staged,
                });
                if (request.operation === 'upload') outcome = accepted(null, staged);
                if (request.operation === 'upload-and-send') {
                  await publish();
                  if (!media.complete()) {
                    fenced.abort();
                    throw new KernelFault('invalid-input');
                  }
                  await check();
                  const sent = await io(() =>
                    captured.driver.sendStaged(staged, signal, captured.connectionId),
                  );
                  if (sent.ok) outcome = onebot(sent.value, true);
                  else {
                    uncertain = false;
                    outcome = failed(sent.error);
                  }
                }
              }
            } else if (request.part.content.kind === 'inline-text') {
              const message = [
                ...(route.reference?.messageId
                  ? [{ type: 'reply', data: { id: route.reference.messageId } }]
                  : []),
                { type: 'text', data: { text: request.part.content.text } },
              ];
              const result = await io(() =>
                captured.driver.call(
                  route.scene === 'private' ? 'send_private_msg' : 'send_group_msg',
                  {
                    [route.scene === 'private' ? 'user_id' : 'group_id']: route.targetId,
                    message,
                    auto_escape: false,
                  },
                  signal,
                  captured.connectionId,
                ),
              );
              if (result.ok) outcome = onebot(result.value, false);
              else {
                uncertain = false;
                outcome = failed(result.error);
              }
            } else {
              const token =
                request.uploaded && typeof request.uploaded === 'object'
                  ? issued.get(request.uploaded)
                  : undefined;
              if (
                !token ||
                token.protocol !== 'onebot-v11' ||
                !isDeepStrictEqual(token.binding, binding(request))
              )
                throw new KernelFault('permission-denied');
              const result = await io(() =>
                captured.driver.sendStaged(token.handle, signal, captured.connectionId),
              );
              if (result.ok) outcome = onebot(result.value, false);
              else {
                uncertain = false;
                outcome = failed(result.error);
              }
            }
          }
          if (cleanup !== 'settled' && outcome)
            outcome = { ...outcome, error: outcome.error ?? makeError('unavailable', false) };
          if ((outcome?.outcome === 'accepted' && outcome.error) || cleanup !== 'settled')
            fenced.abort();
          if (dispatched) await publish();
          if (media && !media.complete()) {
            fenced.abort();
            throw new KernelFault('invalid-input');
          }
          await check();
        } catch (error) {
          const failure = errorOf(error, signal);
          // A post-effect check/progress failure must not erase its receipt or admit another part.
          if (dispatched) fenced.abort();
          outcome = outcome ? { ...outcome, error: outcome.error ?? failure } : failed(failure);
        } finally {
          lifetime.abort();
          try {
            await media?.close();
          } catch {
            fenced.abort();
            outcome = {
              ...(outcome ?? failed(makeError('unavailable'))),
              cleanup: 'failed',
              error: makeError('unavailable', false),
            };
          }
        }
        return outcome ?? failed(makeError('unavailable', false));
      },
    },
  };
}
