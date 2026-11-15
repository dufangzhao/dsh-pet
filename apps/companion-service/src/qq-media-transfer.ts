import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  COMPANION_MATERIAL_MAX_PARTS,
  COMPANION_MATERIAL_INPUT_MAX_BYTES,
  COMPANION_MATERIAL_IMAGE_MAX_BYTES,
  COMPANION_MATERIAL_PREPARATION_MAX_ACTIVE,
  COMPANION_MAX_TEXT,
  COMPANION_TASK_MATERIAL_MAX,
  MEDIA_MAX_CHUNK_BYTES,
  QQ_FEATURE_PLUGIN_ID,
  QQ_PROTOCOL_CAPABILITY,
  sameQQAccount,
  companionAudienceKey,
  isCompanionRecordId,
  makeError,
  type CompanionInputAdmission,
  type CompanionMaterialRef,
  type CompanionCleanup,
  type KernelError,
  type OwnerRef,
  type QQAccountRef,
  type QQFileEvidence,
  type StreamCreditMessage,
  type StreamEndMessage,
} from '@pet/contracts';
import { KernelFault, TaskMediaPeer } from '@pet/host-kernel';
import {
  withSourceAuthority,
  type CompanionPluginHost,
  type CompanionRuntime,
  type RuntimeInputAccess,
  type RuntimeInputPorts,
  type QQMediaConsumer,
} from '@pet/companion-runtime';
import type { OfficialDownloadedMedia } from '@pet/qq-official';
import type { SnowMediaDownloadInput } from '@pet/qq-onebot';
import type { StoredMaterial, StateObservation } from '@pet/state-sqlite';
import type { QQController, CapturedQqSourceBase, CapturedQqSource } from './qq-controller.js';
import type { QQMappedInput, QQRemoteMaterial } from '@pet/local-host/qq-input';
import type { QQInputPreparation } from './qq-ingress.js';
import { qqGroupSettings } from './qq-policy.js';
import type { QQAudio } from './qq-audio.js';
import type { HostMaterialStore, RawInputSource, RawInputCustody } from './material-store.js';
import { qqMediaAccess, type QQProactiveMediaAuthority } from './qq-media-authority.js';
export type { QQProactiveMediaAuthority } from './qq-media-authority.js';

/** Safe metadata only; private native/remote locators remain inside the producer closure. */
export interface QQInputMaterialDescriptor {
  readonly kind: 'image' | 'voice' | 'file';
  readonly name: string;
  readonly quoted: boolean;
  readonly expectedSizeBytes: number | null;
  readonly expectedSha256: string | null;
}
export interface QQInputMaterialProducer {
  readonly account: QQAccountRef;
  readonly parts: readonly QQInputMaterialDescriptor[];
  readPart(
    index: number,
    actor: RuntimeInputAccess,
    consume: (source: RawInputSource) => Promise<void>,
  ): Promise<void>;
}

export type QQObservedFileResource = StateObservation & { readonly fileEvidence: QQFileEvidence };
/** Invoked only for a scoped, fresh, not-yet-canonical resource under the original server actor. */
export type QQObservedFileProducerFor = (
  input: CompanionInputAdmission,
  observation: QQObservedFileResource,
  materialId: string,
  access: RuntimeInputAccess,
) => Promise<QQInputMaterialProducer>;

export interface QQMediaTransferOptions {
  readonly host: CompanionPluginHost;
  readonly runtime: CompanionRuntime;
  readonly qq: QQController;
  readonly materials: HostMaterialStore;
  readonly audio: QQAudio;
  /** Missing remote support is unavailable; legacy native IO requires this explicit local selection. */
  readonly producerForObservedFile?: QQObservedFileProducerFor | 'service-local';
}
type DownloadFact = Pick<OfficialDownloadedMedia, 'connectionId' | 'sizeBytes' | 'sha256'>;
type Budget = { bytes: number };
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fault = (error: unknown): KernelError =>
  error instanceof KernelFault
    ? error.error
    : makeError(
        error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'internal',
        false,
      );
class TransferFailure extends KernelFault {
  constructor(
    error: KernelError,
    readonly cleanup: CompanionCleanup,
  ) {
    super(error.code);
  }
}
function text(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > 8192 ||
    [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    throw new KernelFault('invalid-input');
  return value;
}
function size(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const parsed = typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < 0)
    throw new KernelFault('invalid-input');
  return parsed;
}
function name(part: QQRemoteMaterial): string {
  const value =
    part.protocol === 'official'
      ? part.attachment.filename
      : text(part.segment.data['name'] ?? part.segment.data['file_name']);
  const original = value ?? 'attachment';
  const result =
    part.protocol === 'official' &&
    !part.attachment.url &&
    part.kind === 'voice' &&
    part.attachment.voice_wav_url
      ? `${original.replace(/\.[^.]*$/u, '')}.wav`
      : original;
  if (
    !result.length ||
    result.length > 240 ||
    [...result].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    throw new KernelFault('invalid-input');
  return result;
}
function onebot(
  part: Extract<QQRemoteMaterial, { protocol: 'onebot-v11' }>,
  source: CapturedQqSource,
  input: CompanionInputAdmission,
): SnowMediaDownloadInput {
  const data = part.segment.data;
  const fileId = text(data['file_id'] ?? (part.kind === 'file' ? undefined : data['file']));
  if (!fileId || input.origin.route.kind !== 'qq' || source.protocol !== 'onebot-v11')
    throw new KernelFault('invalid-input');
  const expectedSha256 = text(data['sha256']);
  if (expectedSha256 !== null && !/^[a-f0-9]{64}$/u.test(expectedSha256))
    throw new KernelFault('invalid-input');
  return {
    source:
      part.kind === 'file'
        ? {
            kind: 'file',
            fileId,
            scene: input.origin.route.scene,
            targetId: input.origin.route.targetId,
            fileHash: text(data['file_hash']),
            busid: size(data['busid']),
          }
        : { kind: part.kind, fileId },
    expectedSizeBytes: size(data['file_size'] ?? data['size']),
    expectedSha256,
  };
}

/** Fixed native references enter the owned byte plane; no URL or gateway path becomes a host path. */
export class QQMediaTransfer {
  private readonly lifetime = new AbortController();
  private readonly pending = new Set<Promise<unknown>>();
  private closed = false;
  constructor(private readonly options: QQMediaTransferOptions) {}
  private run<T>(work: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new KernelFault('not-ready'));
    if (this.pending.size >= COMPANION_MATERIAL_PREPARATION_MAX_ACTIVE)
      return Promise.reject(new KernelFault('quota-exceeded'));
    const result = Promise.resolve().then(work);
    this.pending.add(result);
    void result.then(
      () => this.pending.delete(result),
      () => this.pending.delete(result),
    );
    return result;
  }
  private captureAccess(access: RuntimeInputAccess): RuntimeInputAccess {
    const signal = AbortSignal.any([access.signal, this.lifetime.signal]);
    const check = access.check.bind(access);
    return {
      scope: structuredClone(access.scope),
      signal,
      check: async () => {
        signal.throwIfAborted();
        await check();
        signal.throwIfAborted();
      },
    };
  }
  private async input(input: CompanionInputAdmission, access: RuntimeInputAccess): Promise<void> {
    access.signal.throwIfAborted();
    await access.check();
    const stored = await this.options.runtime.state(
      'getInput',
      { id: input.id, scope: access.scope },
      access.signal,
    );
    await access.check();
    access.signal.throwIfAborted();
    if (
      !isDeepStrictEqual(stored.origin, input.origin) ||
      !isDeepStrictEqual(stored.materialIds, input.materialIds)
    )
      throw new KernelFault('permission-denied');
  }
  private async capture(source: CapturedQqSourceBase): Promise<CapturedQqSource> {
    await source.check();
    source.signal.throwIfAborted();
    const captured = this.options.qq.sourceFor(source.account);
    if (
      captured.connectionId !== source.connectionId ||
      !sameQQAccount(captured.account, source.account)
    )
      throw new KernelFault('stale-owner');
    await captured.check();
    await source.check();
    return captured;
  }
  private async pull(
    source: CapturedQqSource,
    original: CapturedQqSourceBase,
    actor: RuntimeInputAccess,
    download: (
      consume: QQMediaConsumer,
      signal: AbortSignal,
      check: () => Promise<void>,
    ) => Promise<DownloadFact>,
    consume: (source: RawInputSource) => Promise<void>,
  ): Promise<void> {
    let cleanup: CompanionCleanup = 'settled';
    try {
      await withSourceAuthority(
        this.options.host,
        QQ_FEATURE_PLUGIN_ID,
        [{ kind: 'capability-use', capability: QQ_PROTOCOL_CAPABILITY }],
        (featureSignal) =>
          withSourceAuthority(
            this.options.host,
            source.account.sourcePluginId,
            [{ kind: 'files', scope: 'plugin-data', access: 'read' }],
            async (sourceSignal, context) => {
              const abort = new AbortController();
              const signal = AbortSignal.any([
                sourceSignal,
                featureSignal,
                actor.signal,
                source.signal,
                original.signal,
                this.lifetime.signal,
                abort.signal,
              ]);
              const check = async () => {
                signal.throwIfAborted();
                await actor.check();
                await source.check();
                await original.check();
                signal.throwIfAborted();
              };
              await check();
              const reference = {
                streamId: randomUUID(),
                taskId: context.taskId,
                owner: context.owner,
              };
              const same = (owner: OwnerRef, taskId: string) =>
                owner.pluginId === context.owner.pluginId &&
                owner.instanceId === context.owner.instanceId &&
                owner.generation === context.owner.generation &&
                taskId === context.taskId;
              const envelope = (
                message: Parameters<
                  NonNullable<ConstructorParameters<typeof TaskMediaPeer>[0]['control']>
                >[0],
              ): StreamCreditMessage | StreamEndMessage => ({
                protocol: 1,
                id: randomUUID(),
                sessionId: reference.streamId,
                owner: context.owner,
                ...message,
              });
              const signalFor = (owner: OwnerRef, taskId: string) =>
                same(owner, taskId) && !signal.aborted ? signal : null;
              const readerPeer: TaskMediaPeer = new TaskMediaPeer({
                signalFor,
                write: async () => ({ ok: false, error: makeError('permission-denied', false) }),
                control: (message) => writerPeer.control(envelope(message)),
              });
              const writerPeer: TaskMediaPeer = new TaskMediaPeer({
                signalFor,
                write: async (frame) => readerPeer.receive(frame),
                control: (message) => readerPeer.control(envelope(message)),
              });
              const reader = readerPeer.createReader(reference),
                writer = writerPeer.createWriter(reference);
              if (!reader.ok || !writer.ok) {
                readerPeer.close();
                writerPeer.close();
                throw new KernelFault('not-ready');
              }
              const credit = readerPeer.grantInitial(reference);
              if (!credit.ok) {
                readerPeer.close();
                writerPeer.close();
                throw new KernelFault(credit.error.code);
              }
              const cancel = () => {
                abort.abort();
                readerPeer.close();
                writerPeer.close();
              };
              let count = 0;
              const hash = createHash('sha256');
              cleanup = 'unknown';
              const producer = Promise.resolve().then(async () => {
                try {
                  const fact = await download(
                    async (chunk, offset, nativeSignal) => {
                      nativeSignal.throwIfAborted();
                      await check();
                      if (
                        !(chunk instanceof Uint8Array) ||
                        !chunk.length ||
                        chunk.length > MEDIA_MAX_CHUNK_BYTES ||
                        offset !== count
                      )
                        throw new KernelFault('invalid-input');
                      count += chunk.length;
                      hash.update(chunk);
                      const result = await writer.value.write(chunk);
                      if (!result.ok) throw new KernelFault(result.error.code);
                      nativeSignal.throwIfAborted();
                      await check();
                    },
                    signal,
                    check,
                  );
                  if (
                    fact.connectionId !== original.connectionId ||
                    fact.sizeBytes !== count ||
                    fact.sha256 !== hash.digest('hex')
                  )
                    throw new KernelFault('invalid-input');
                  const ended = await writer.value.end();
                  if (!ended.ok) throw new KernelFault(ended.error.code);
                } catch (error) {
                  cancel();
                  throw error;
                }
              });
              const consumer = Promise.resolve().then(() =>
                consume({ body: reader.value, settled: producer, signal, check, cancel }),
              );
              let failure: unknown;
              try {
                await Promise.all([producer, consumer]);
                cleanup = 'settled';
              } catch (error) {
                failure = error;
              } finally {
                cancel();
                const results = await Promise.allSettled([producer, consumer]);
                const native = results[0];
                if (
                  native?.status === 'rejected' &&
                  native.reason instanceof TransferFailure &&
                  native.reason.cleanup === 'failed'
                ) {
                  cleanup = 'failed';
                  failure = native.reason;
                }
              }
              if (failure) throw failure;
            },
            {
              signal: AbortSignal.any([
                featureSignal,
                actor.signal,
                source.signal,
                original.signal,
                this.lifetime.signal,
              ]),
            },
          ),
        {
          signal: AbortSignal.any([
            actor.signal,
            source.signal,
            original.signal,
            this.lifetime.signal,
          ]),
        },
      );
    } catch (error) {
      throw new TransferFailure(fault(error), cleanup);
    }
  }
  private descriptor(part: QQRemoteMaterial): QQInputMaterialDescriptor {
    return {
      kind: part.kind,
      name: name(part),
      quoted: part.quoted,
      expectedSizeBytes:
        part.protocol === 'official'
          ? !part.attachment.url && part.kind === 'voice'
            ? null
            : part.attachment.size
          : size(part.segment.data['file_size'] ?? part.segment.data['size']),
      expectedSha256: part.protocol === 'official' ? null : text(part.segment.data['sha256']),
    };
  }
  private legacyProducer(
    input: CompanionInputAdmission,
    parts: readonly QQRemoteMaterial[],
    source: CapturedQqSource,
    original: CapturedQqSourceBase,
  ): QQInputMaterialProducer {
    return {
      account: source.account,
      parts: parts.map((part) => this.descriptor(part)),
      readPart: async (index, actor, consume) => {
        const part = parts[index];
        if (!part || part.protocol !== source.protocol || input.origin.route.kind !== 'qq')
          throw new KernelFault('permission-denied');
        const display = name(part),
          native = part.protocol === 'onebot-v11' ? onebot(part, source, input) : null;
        await this.pull(
          source,
          original,
          actor,
          async (write, signal, check) => {
            if (
              part.protocol === 'official' &&
              source.protocol === 'official' &&
              input.origin.route.kind === 'qq'
            ) {
              const fallback = !part.attachment.url && part.kind === 'voice';
              const url = part.attachment.url ?? (fallback ? part.attachment.voice_wav_url : null);
              if (!url) throw new KernelFault('not-ready');
              const value = await source.driver.downloadAttachment(
                {
                  scene: input.origin.route.scene === 'private' ? 'c2c' : 'group',
                  targetId: input.origin.route.targetId,
                  url,
                  name: display,
                  maximumBytes:
                    part.kind === 'image'
                      ? COMPANION_MATERIAL_IMAGE_MAX_BYTES
                      : COMPANION_MATERIAL_INPUT_MAX_BYTES,
                  expectedSizeBytes: fallback ? null : part.attachment.size,
                  expectedSha256: null,
                },
                write,
                signal,
                original.connectionId,
                check,
              );
              if (!value.ok) throw new TransferFailure(value.error, value.cleanup ?? 'unknown');
              return value.value;
            }
            if (native && source.protocol === 'onebot-v11') {
              const value = await source.driver.downloadMedia(
                native,
                write,
                signal,
                original.connectionId,
              );
              if (!value.ok) throw new KernelFault(value.error.code);
              if (value.value.kind !== 'complete') throw new KernelFault(value.value.error.code);
              return value.value.value;
            }
            throw new KernelFault('invalid-input');
          },
          consume,
        );
      },
    };
  }
  private async stagePart(
    producer: QQInputMaterialProducer,
    index: number,
    descriptor: QQInputMaterialDescriptor,
    actor: RuntimeInputAccess,
    budget: Budget,
  ): Promise<RawInputCustody> {
    let custody: RawInputCustody | undefined, stageFailure: unknown;
    try {
      await producer.readPart(index, actor, async (source) => {
        const body: AsyncIterable<Uint8Array> = {
          async *[Symbol.asyncIterator]() {
            let bytes = 0;
            for await (const chunk of source.body) {
              await actor.check();
              actor.signal.throwIfAborted();
              if (!(chunk instanceof Uint8Array) || chunk.length > MEDIA_MAX_CHUNK_BYTES)
                throw new KernelFault('invalid-input');
              bytes += chunk.length;
              budget.bytes += chunk.length;
              if (
                budget.bytes > COMPANION_MATERIAL_INPUT_MAX_BYTES ||
                (descriptor.kind === 'image' && bytes > COMPANION_MATERIAL_IMAGE_MAX_BYTES)
              )
                throw new KernelFault('quota-exceeded');
              yield chunk;
            }
          },
        };
        try {
          custody = await this.options.materials.stageRawInput(
            descriptor,
            {
              body,
              settled: source.settled,
              signal: source.signal,
              check: source.check.bind(source),
              cancel: source.cancel.bind(source),
            },
            actor,
          );
        } catch (error) {
          stageFailure = error;
          throw error;
        }
      });
    } catch (error) {
      if (!custody) {
        const cleanup = error instanceof TransferFailure ? error.cleanup : 'unknown';
        const primary =
          stageFailure instanceof KernelFault && stageFailure.error.code === 'quota-exceeded'
            ? stageFailure
            : error;
        throw new TransferFailure(fault(primary), cleanup);
      }
      // Native EOF/join and the owned file are already positive; source-only postflight cannot retract them.
      await actor.check();
      actor.signal.throwIfAborted();
    }
    if (!custody) throw new TransferFailure(makeError('unavailable', false), 'unknown');
    return custody;
  }
  private async processRaw(
    input: CompanionInputAdmission,
    id: string,
    descriptor: QQInputMaterialDescriptor,
    custody: RawInputCustody,
    actor: RuntimeInputAccess,
    candidate?: QQProactiveMediaAuthority,
    observationId?: string,
  ): Promise<{ material: CompanionMaterialRef; transcript: string }> {
    if (descriptor.kind === 'voice')
      return this.options.audio.transcribeRaw(
        { inputId: input.id, materialId: id, name: descriptor.name, custody },
        actor,
        candidate,
      );
    return this.options.materials.withRawInput(custody, async (_info, bytes, signal) => {
      const access: RuntimeInputAccess = {
        scope: actor.scope,
        signal: AbortSignal.any([signal, actor.signal]),
        check: actor.check.bind(actor),
      };
      const material = await this.options.materials.put(
        {
          id,
          inputId: input.id,
          ...(observationId ? { observationId } : {}),
          kind: descriptor.kind,
          name: descriptor.name,
        },
        bytes,
        access,
      );
      return { material, transcript: '' };
    });
  }
  private validateDescriptor(part: QQInputMaterialDescriptor): void {
    if (
      Object.keys(part).sort().join(',') !== 'expectedSha256,expectedSizeBytes,kind,name,quoted' ||
      !['voice', 'image', 'file'].includes(part.kind) ||
      !part.name.length ||
      part.name.length > 240 ||
      [...part.name].some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) ||
      typeof part.quoted !== 'boolean' ||
      (part.expectedSizeBytes !== null &&
        (!Number.isSafeInteger(part.expectedSizeBytes) ||
          part.expectedSizeBytes < 0 ||
          part.expectedSizeBytes > COMPANION_MATERIAL_INPUT_MAX_BYTES)) ||
      (part.expectedSha256 !== null && !/^[a-f0-9]{64}$/u.test(part.expectedSha256))
    )
      throw new KernelFault('invalid-input');
  }
  private async produced(
    input: CompanionInputAdmission,
    producer: QQInputMaterialProducer,
    access: RuntimeInputAccess,
    candidate?: QQProactiveMediaAuthority,
  ): Promise<QQInputPreparation> {
    const custody: RawInputCustody[] = [];
    let outcome: QQInputPreparation | undefined;
    try {
      await this.input(input, access);
      const actor = await qqMediaAccess(input, access, candidate);
      const account =
        input.origin.kind === 'qq'
          ? input.origin.actor.account
          : input.origin.kind === 'qq-proactive'
            ? input.origin.account
            : null;
      if (
        !account ||
        !sameQQAccount(account, producer.account) ||
        producer.parts.length !== input.materialIds.length ||
        producer.parts.length > COMPANION_MATERIAL_MAX_PARTS
      )
        throw new KernelFault('permission-denied');
      const parts = structuredClone(producer.parts),
        budget = { bytes: 0 };
      for (const part of parts) this.validateDescriptor(part);
      for (const [index, part] of parts.entries()) {
        await actor.check();
        actor.signal.throwIfAborted();
        if (
          part.expectedSizeBytes !== null &&
          part.expectedSizeBytes + budget.bytes > COMPANION_MATERIAL_INPUT_MAX_BYTES
        )
          throw new KernelFault('quota-exceeded');
        custody.push(await this.stagePart(producer, index, part, actor, budget));
      }
      // The complete required set is server-owned before any decode, ASR, or ready material write.
      const materials: CompanionMaterialRef[] = [],
        authored: string[] = [],
        all: string[] = [],
        notes: string[] = [];
      for (const [index, part] of parts.entries()) {
        const handle = custody[index],
          id = input.materialIds[index];
        if (!handle || !id) throw new KernelFault('invalid-input');
        let result: { material: CompanionMaterialRef; transcript: string };
        try {
          result = await this.processRaw(input, id, part, handle, actor, candidate);
        } catch (error) {
          throw new TransferFailure(fault(error), 'unknown');
        }
        materials.push(result.material);
        if (result.transcript) {
          all.push(result.transcript);
          if (all.join('\n').length > COMPANION_MAX_TEXT) throw new KernelFault('quota-exceeded');
          if (part.quoted || input.origin.kind === 'qq-proactive') {
            const prefix = part.quoted
              ? '引用语音转写（资料，不代表当前作者陈述）'
              : '群聊语音转写（观察资料，不代表该成员委托任务）';
            const note = `${prefix}：\n${result.transcript}`;
            if (note.length > COMPANION_MAX_TEXT) throw new KernelFault('quota-exceeded');
            notes.push(note);
          } else authored.push(result.transcript);
        }
      }
      await actor.check();
      actor.signal.throwIfAborted();
      outcome = { ok: true, materials, transcript: authored.join('\n'), notes };
    } catch (error) {
      outcome = {
        ok: false,
        error: fault(error),
        cleanup: error instanceof TransferFailure ? error.cleanup : 'settled',
      };
    } finally {
      const cleanup = await Promise.allSettled(
        custody.map((handle) => this.options.materials.releaseRawInput(handle)),
      );
      if (cleanup.some((result) => result.status === 'rejected'))
        outcome = { ok: false, error: makeError('unavailable', false), cleanup: 'failed' };
    }
    return outcome ?? { ok: false, error: makeError('internal', false), cleanup: 'unknown' };
  }
  readonly prepareProducedInput = (
    input: CompanionInputAdmission,
    producer: QQInputMaterialProducer,
    access: RuntimeInputAccess,
    candidate?: QQProactiveMediaAuthority,
  ): Promise<QQInputPreparation> => {
    access = this.captureAccess(access);
    const captured = structuredClone(input);
    const capturedProducer: QQInputMaterialProducer = {
      account: structuredClone(producer.account),
      parts: structuredClone(producer.parts),
      readPart: producer.readPart.bind(producer),
    };
    return this.run(() => this.produced(captured, capturedProducer, access, candidate)).catch(
      (error) => ({ ok: false, error: fault(error), cleanup: 'settled' }),
    );
  };
  readonly prepareInput = (
    input: CompanionInputAdmission,
    mapped: QQMappedInput,
    original: CapturedQqSourceBase,
    access: RuntimeInputAccess,
    candidate?: QQProactiveMediaAuthority,
  ): Promise<QQInputPreparation> => {
    access = this.captureAccess(access);
    const captured = structuredClone({ input, mapped });
    return this.run(async () => {
      const { input, mapped } = captured;
      await this.input(input, access);
      const actor = await qqMediaAccess(input, access, candidate, mapped);
      if (
        !isDeepStrictEqual(input.origin.route, mapped.route) ||
        !sameQQAccount(mapped.actor.account, original.account)
      )
        throw new KernelFault('permission-denied');
      const source = await this.capture(original);
      return this.produced(
        input,
        this.legacyProducer(input, mapped.materials, source, original),
        actor,
        candidate,
      );
    }).catch((error) => ({
      ok: false,
      error: fault(error),
      cleanup: error instanceof TransferFailure ? error.cleanup : 'settled',
    }));
  };
  /** Host-private adapter only; prepareWork owns the preceding scoped observation/TTL/grant checks. */
  readonly producerFromNativeObservation: QQObservedFileProducerFor = async (
    input,
    observation,
    _materialId,
    access,
  ) => {
    await access.check();
    access.signal.throwIfAborted();
    const evidence = observation.fileEvidence,
      source = this.options.qq.sourceFor(evidence.account);
    await source.check();
    await access.check();
    access.signal.throwIfAborted();
    const part: QQRemoteMaterial = {
      protocol: 'onebot-v11',
      kind: 'file',
      quoted: false,
      segment: {
        type: 'file',
        data: {
          file_id: evidence.fileId,
          name: evidence.name,
          file_size: evidence.reportedSize,
          busid: evidence.busId,
        },
      },
    };
    return this.legacyProducer(input, [part], source, source);
  };
  private async observedProducer(
    input: CompanionInputAdmission,
    observation: QQObservedFileResource,
    materialId: string,
    access: RuntimeInputAccess,
  ): Promise<QQInputMaterialProducer> {
    const open = this.options.producerForObservedFile;
    if (!open) throw new KernelFault('not-ready');
    await access.check();
    access.signal.throwIfAborted();
    let producer: QQInputMaterialProducer;
    if (typeof open === 'function') {
      producer = await open(
        Object.freeze(structuredClone(input)),
        Object.freeze(structuredClone(observation)),
        materialId,
        access,
      );
    } else if (open === 'service-local') {
      producer = await this.producerFromNativeObservation(input, observation, materialId, access);
    } else throw new KernelFault('not-ready');
    await access.check();
    access.signal.throwIfAborted();
    const descriptor = producer.parts[0],
      evidence = observation.fileEvidence;
    if (
      !sameQQAccount(producer.account, evidence.account) ||
      producer.parts.length !== 1 ||
      !descriptor ||
      descriptor.kind !== 'file' ||
      descriptor.quoted ||
      descriptor.name !== evidence.name ||
      (evidence.reportedSize !== null && descriptor.expectedSizeBytes !== evidence.reportedSize)
    )
      throw new KernelFault('permission-denied');
    this.validateDescriptor(descriptor);
    return {
      account: structuredClone(producer.account),
      parts: structuredClone(producer.parts),
      readPart: producer.readPart.bind(producer),
    };
  }
  private async verified(
    stored: StoredMaterial,
    access: RuntimeInputAccess,
    budget: Budget,
  ): Promise<CompanionMaterialRef> {
    if (stored.phase !== 'ready' || !stored.reference) throw new KernelFault('not-ready');
    budget.bytes += stored.reference.sizeBytes;
    if (budget.bytes > COMPANION_MATERIAL_INPUT_MAX_BYTES) throw new KernelFault('quota-exceeded');
    return this.options.materials.withMaterial(stored.id, access, async (reference, bytes) => {
      for await (const chunk of bytes) {
        access.signal.throwIfAborted();
        await access.check();
        if (!(chunk instanceof Uint8Array)) throw new KernelFault('invalid-input');
      }
      return reference;
    });
  }
  readonly prepareWork: NonNullable<RuntimeInputPorts['prepareWork']> = (
    input,
    request,
    access,
  ) => {
    access = this.captureAccess(access);
    const captured = structuredClone({ input, request });
    return this.run(async () => {
      const { input, request } = captured;
      await this.input(input, access);
      if (!request.materials?.length) return request;
      if (request.materials.length > COMPANION_TASK_MATERIAL_MAX)
        throw new KernelFault('quota-exceeded');
      const budget = {
        bytes: (request.files ?? []).reduce(
          (total, file) => total + Buffer.byteLength(file.content),
          0,
        ),
      };
      const selected = [],
        seen = new Set<string>();
      for (const selection of request.materials) {
        await access.check();
        access.signal.throwIfAborted();
        if (!isCompanionRecordId(selection.materialId) || seen.has(selection.materialId))
          throw new KernelFault('invalid-input');
        seen.add(selection.materialId);
        const stored = await this.options.runtime.state(
          'findMaterial',
          { id: selection.materialId, scope: access.scope },
          access.signal,
        );
        if (stored) {
          await this.verified(stored, access, budget);
          selected.push(selection);
          continue;
        }
        if (!selection.materialId.startsWith('observe-file-')) throw new KernelFault('unavailable');
        const id = `material-${digest(['qq-observation-file', input.id, selection.materialId])}`;
        const existing = await this.options.runtime.state(
          'findMaterial',
          { id, scope: access.scope },
          access.signal,
        );
        if (existing) {
          if (
            existing.inputId !== input.id ||
            existing.observationId !== selection.materialId ||
            !isDeepStrictEqual(existing.reference?.originInputIds, [input.id])
          )
            throw new KernelFault('conflict');
          await this.verified(existing, access, budget);
          selected.push({ ...selection, materialId: id });
          continue;
        }
        const observation = await this.options.runtime.state(
          'getObservation',
          { id: selection.materialId, scope: access.scope },
          access.signal,
        );
        await access.check();
        const audience = input.origin.audience,
          evidence = observation.fileEvidence;
        if (
          !evidence ||
          audience.kind !== 'qq-group' ||
          observation.audience.kind !== 'qq-group' ||
          companionAudienceKey(observation.audience) !== companionAudienceKey(audience) ||
          !sameQQAccount(evidence.account, audience.account) ||
          evidence.groupId !== audience.groupId ||
          evidence.account.protocol !== 'onebot-v11'
        )
          throw new KernelFault('permission-denied');
        const settings = qqGroupSettings(
          this.options.qq.policy().settings,
          audience.account,
          audience.groupId,
        );
        if (
          observation.observedAt > Date.now() ||
          observation.observedAt < Date.now() - settings.contextMaxAgeMs
        )
          throw new KernelFault('unavailable');
        if (
          evidence.reportedSize !== null &&
          evidence.reportedSize + budget.bytes > COMPANION_MATERIAL_INPUT_MAX_BYTES
        )
          throw new KernelFault('quota-exceeded');
        const resource: QQObservedFileResource = { ...observation, fileEvidence: evidence };
        const producer = await this.observedProducer(input, resource, id, access),
          descriptor = producer.parts[0];
        if (!descriptor) throw new KernelFault('invalid-input');
        const custody = await this.stagePart(producer, 0, descriptor, access, budget);
        let result: { material: CompanionMaterialRef; transcript: string };
        try {
          result = await this.processRaw(
            input,
            id,
            descriptor,
            custody,
            access,
            undefined,
            observation.id,
          );
        } finally {
          await this.options.materials.releaseRawInput(custody);
        }
        selected.push({ ...selection, materialId: result.material.id });
      }
      await access.check();
      access.signal.throwIfAborted();
      return { ...request, materials: selected };
    });
  };
  async close(): Promise<void> {
    this.closed = true;
    this.lifetime.abort();
    await Promise.allSettled([...this.pending]);
  }
}
export function createQQMediaTransfer(options: QQMediaTransferOptions): QQMediaTransfer {
  return new QQMediaTransfer(options);
}
