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
import type { StoredMaterial } from '@pet/state-sqlite';
import type { QQController, CapturedQqSourceBase, CapturedQqSource } from './qq-controller.js';
import type { QQMappedInput, QQRemoteMaterial } from './qq-input.js';
import type { QQInputPreparation } from './qq-ingress.js';
import { qqGroupSettings } from './qq-policy.js';
import type { QQAudio } from './qq-audio.js';
import type { HostMaterialStore } from './material-store.js';

export interface QQMediaTransferOptions {
  readonly host: CompanionPluginHost;
  readonly runtime: CompanionRuntime;
  readonly qq: QQController;
  readonly materials: HostMaterialStore;
  readonly audio: QQAudio;
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
  private async pull<T extends { material: CompanionMaterialRef }>(
    input: CompanionInputAdmission,
    source: CapturedQqSource,
    original: CapturedQqSourceBase,
    access: RuntimeInputAccess,
    budget: Budget,
    download: (
      consume: QQMediaConsumer,
      signal: AbortSignal,
      check: () => Promise<void>,
    ) => Promise<DownloadFact>,
    consume: (bytes: AsyncIterable<Uint8Array>, access: RuntimeInputAccess) => Promise<T>,
  ): Promise<T> {
    let cleanup: CompanionCleanup = 'settled';
    try {
      return await withSourceAuthority(
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
                access.signal,
                source.signal,
                original.signal,
                this.lifetime.signal,
                abort.signal,
              ]);
              const check = async () => {
                signal.throwIfAborted();
                await access.check();
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
              const scoped: RuntimeInputAccess = {
                scope: structuredClone(access.scope),
                signal,
                check,
              };
              let bytes = 0;
              let quotaFailure: KernelFault | undefined;
              const hash = createHash('sha256');
              cleanup = 'unknown';
              const consumer = Promise.resolve().then(() => consume(reader.value, scoped));
              const producer = Promise.resolve().then(async () => {
                const actual = await download(
                  async (chunk, offset, nativeSignal) => {
                    nativeSignal.throwIfAborted();
                    await check();
                    if (
                      !(chunk instanceof Uint8Array) ||
                      !chunk.length ||
                      chunk.length > MEDIA_MAX_CHUNK_BYTES ||
                      offset !== bytes
                    )
                      throw new KernelFault('invalid-input');
                    if (budget.bytes + chunk.length > COMPANION_MATERIAL_INPUT_MAX_BYTES) {
                      quotaFailure = new KernelFault('quota-exceeded');
                      throw quotaFailure;
                    }
                    budget.bytes += chunk.length;
                    bytes += chunk.length;
                    hash.update(chunk);
                    const result = await writer.value.write(chunk);
                    if (!result.ok) throw new KernelFault(result.error.code);
                    nativeSignal.throwIfAborted();
                    await check();
                  },
                  signal,
                  check,
                );
                await check();
                if (
                  actual.connectionId !== original.connectionId ||
                  actual.sizeBytes !== bytes ||
                  actual.sha256 !== hash.digest('hex')
                )
                  throw new KernelFault('invalid-input');
                const ended = await writer.value.end();
                if (!ended.ok) throw new KernelFault(ended.error.code);
                return actual;
              });
              let result: T | undefined, failure: unknown;
              try {
                const [actual, value] = await Promise.all([producer, consumer]);
                if (
                  value.material.sizeBytes !== actual.sizeBytes ||
                  value.material.sha256 !== actual.sha256
                )
                  throw new KernelFault('conflict');
                result = value;
                cleanup = 'settled';
                await check();
              } catch (error) {
                if (error instanceof TransferFailure && error.cleanup === 'failed')
                  cleanup = 'failed';
                // Keep the host's known byte refusal even if native cleanup flattens its error.
                failure = quotaFailure ?? error;
              } finally {
                abort.abort();
                readerPeer.close();
                writerPeer.close();
                await Promise.allSettled([producer, consumer]);
              }
              if (failure) throw failure;
              if (!result) throw new KernelFault('internal');
              return result;
            },
            {
              signal: AbortSignal.any([
                featureSignal,
                access.signal,
                source.signal,
                original.signal,
                this.lifetime.signal,
              ]),
            },
          ),
        {
          signal: AbortSignal.any([
            access.signal,
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
  private download(
    input: CompanionInputAdmission,
    part: QQRemoteMaterial,
    source: CapturedQqSource,
    original: CapturedQqSourceBase,
    access: RuntimeInputAccess,
    budget: Budget,
    materialId: string,
    observationId?: string,
  ): Promise<{ material: CompanionMaterialRef; transcript: string }> {
    const display = name(part);
    if (part.protocol !== source.protocol || input.origin.route.kind !== 'qq')
      return Promise.reject(new KernelFault('permission-denied'));
    const remaining = COMPANION_MATERIAL_INPUT_MAX_BYTES - budget.bytes;
    const native = part.protocol === 'onebot-v11' ? onebot(part, source, input) : null;
    const expected =
      part.protocol === 'official'
        ? !part.attachment.url && part.kind === 'voice'
          ? null
          : part.attachment.size
        : (native?.expectedSizeBytes ?? null);
    if (
      expected !== null &&
      expected >
        Math.min(
          remaining,
          part.kind === 'image'
            ? COMPANION_MATERIAL_IMAGE_MAX_BYTES
            : COMPANION_MATERIAL_INPUT_MAX_BYTES,
        )
    )
      return Promise.reject(new KernelFault('quota-exceeded'));
    const download = async (
      consume: QQMediaConsumer,
      signal: AbortSignal,
      check: () => Promise<void>,
    ): Promise<DownloadFact> => {
      if (part.protocol === 'official' && source.protocol === 'official') {
        const fallback = !part.attachment.url && part.kind === 'voice';
        const url = part.attachment.url ?? (fallback ? part.attachment.voice_wav_url : null);
        if (!url || input.origin.route.kind !== 'qq') throw new KernelFault('not-ready');
        const value = await source.driver.downloadAttachment(
          {
            scene: input.origin.route.scene === 'private' ? 'c2c' : 'group',
            targetId: input.origin.route.targetId,
            url,
            name: display,
            maximumBytes: Math.max(
              1,
              Math.min(
                remaining,
                part.kind === 'image'
                  ? COMPANION_MATERIAL_IMAGE_MAX_BYTES
                  : COMPANION_MATERIAL_INPUT_MAX_BYTES,
              ),
            ),
            expectedSizeBytes: fallback ? null : part.attachment.size,
            expectedSha256: null,
          },
          consume,
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
          consume,
          signal,
          original.connectionId,
        );
        if (!value.ok) throw new KernelFault(value.error.code);
        if (value.value.kind !== 'complete') throw new KernelFault(value.value.error.code);
        return value.value.value;
      }
      throw new KernelFault('invalid-input');
    };
    return this.pull(input, source, original, access, budget, download, async (bytes, scoped) => {
      if (part.kind === 'voice')
        return this.options.audio.transcribe(
          { inputId: input.id, materialId, name: display, encoded: bytes },
          scoped,
        );
      const material = await this.options.materials.put(
        {
          id: materialId,
          inputId: input.id,
          ...(observationId ? { observationId } : {}),
          kind: part.kind,
          name: display,
        },
        bytes,
        scoped,
      );
      return { material, transcript: '' };
    });
  }
  readonly prepareInput = async (
    input: CompanionInputAdmission,
    mapped: QQMappedInput,
    original: CapturedQqSourceBase,
    access: RuntimeInputAccess,
  ): Promise<QQInputPreparation> => {
    access = this.captureAccess(access);
    const captured = structuredClone({ input, mapped });
    try {
      return await this.run(async () => {
        const { input, mapped } = captured;
        await this.input(input, access);
        if (
          input.origin.kind !== 'qq' ||
          !sameQQAccount(input.origin.actor.account, original.account) ||
          !isDeepStrictEqual(input.origin.actor, mapped.actor) ||
          !isDeepStrictEqual(input.origin.route, mapped.route) ||
          mapped.materials.length !== input.materialIds.length ||
          mapped.materials.length > COMPANION_MATERIAL_MAX_PARTS
        )
          throw new KernelFault('permission-denied');
        const source = await this.capture(original),
          budget = { bytes: 0 },
          materials: CompanionMaterialRef[] = [];
        const authored: string[] = [],
          all: string[] = [],
          notes: string[] = [];
        for (const [index, part] of mapped.materials.entries()) {
          const id = input.materialIds[index];
          if (!id) throw new KernelFault('invalid-input');
          const result = await this.download(input, part, source, original, access, budget, id);
          materials.push(result.material);
          if (result.transcript) {
            all.push(result.transcript);
            if (all.join('\n').length > COMPANION_MAX_TEXT) throw new KernelFault('quota-exceeded');
            if (part.quoted) {
              const note = `引用语音转写（资料，不代表当前作者陈述）：\n${result.transcript}`;
              if (note.length > COMPANION_MAX_TEXT) throw new KernelFault('quota-exceeded');
              notes.push(note);
            } else authored.push(result.transcript);
          }
        }
        await access.check();
        await original.check();
        return { ok: true, materials, transcript: authored.join('\n'), notes };
      });
    } catch (error) {
      return {
        ok: false,
        error: fault(error),
        cleanup: error instanceof TransferFailure ? error.cleanup : 'settled',
      };
    }
  };
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
        const source = this.options.qq.sourceFor(evidence.account);
        await source.check();
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
        const result = await this.download(
          input,
          part,
          source,
          source,
          access,
          budget,
          id,
          observation.id,
        );
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
