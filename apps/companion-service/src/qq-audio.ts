import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  QQ_FEATURE_PLUGIN_ID,
  QQ_CODEC_PLUGIN_ID,
  COMPANION_MAX_TEXT,
  COMPANION_MATERIAL_INPUT_MAX_BYTES,
  COMPANION_MATERIAL_PREPARATION_MAX_ACTIVE,
  COMPANION_VOICE_ATTACHMENT_MAX_MS,
  COMPANION_VOICE_ATTACHMENT_MAX_SPANS,
  VOICE_SAMPLE_RATE,
  VOICE_MAX_SAMPLES,
  SPEECH_FORMAT,
  isCompanionMessageContent,
  companionAudienceKey,
  isCompanionRecordId,
  makeError,
  isQQDeliveryPartAccepted,
  QQ_REPLY_TEXT_SEPARATOR,
  type QQView,
  type CompanionMaterialRef,
  type CompanionMessage,
  type CompanionInputAdmission,
} from '@pet/contracts';
import { KernelFault } from '@pet/host-kernel';
import {
  withSourceAuthority,
  type CompanionPluginHost,
  type CompanionRuntime,
  type RuntimeInputAccess,
} from '@pet/companion-runtime';
import type { PluginContext } from '@pet/plugin-sdk';
import type { QqCodecNative, QqCodecPortsFor } from '@pet/qq-media-codec';
import { speechSegments } from '@pet/shared-speech';
import type { VoiceController } from './voice-controller.js';
import type { SpeechController } from './speech-controller.js';
import type { HostMaterialStore } from './material-store.js';

const CODEC_CAPABILITY = 'companion.qq.codec@1';
const identity = (id: string) => ({ pluginId: id, instanceId: 'default' });
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
type BoundCodec = {
  readonly context: PluginContext;
  readonly native: QqCodecNative;
  readonly config: ReturnType<CompanionPluginHost['configs']['get']>;
  readonly epoch: number;
  readonly abort: AbortController;
  readonly pending: Set<Promise<unknown>>;
};
export interface QQAudioOptions {
  readonly host: CompanionPluginHost;
  readonly runtime: CompanionRuntime;
  readonly voice: VoiceController;
  readonly speech: SpeechController;
  readonly materials: HostMaterialStore;
}
export interface QQEncodedVoice {
  readonly inputId: string;
  readonly materialId: string;
  readonly name: string;
  readonly encoded: AsyncIterable<Uint8Array>;
}
export interface QQAcceptedVoiceOutput {
  readonly inputId: string;
  readonly deliveryId: string;
  readonly messages: readonly CompanionMessage[];
}
async function collect(
  source: AsyncIterable<Uint8Array>,
  maxBytes: number,
  check: () => Promise<void>,
): Promise<Buffer> {
  const result = Buffer.alloc(maxBytes);
  let at = 0;
  for await (const bytes of source) {
    await check();
    if (!(bytes instanceof Uint8Array) || at + bytes.byteLength > maxBytes)
      throw new KernelFault('quota-exceeded');
    result.set(bytes, at);
    at += bytes.byteLength;
  }
  await check();
  return result.subarray(0, at);
}
async function* chunks(bytes: Uint8Array, check: () => Promise<void>): AsyncIterable<Uint8Array> {
  for (let at = 0; at < bytes.length; at += 64 * 1024) {
    await check();
    yield bytes.subarray(at, at + 64 * 1024);
  }
}
function encodedMime(bytes: Buffer): string {
  if (bytes.subarray(0, 10).equals(Buffer.from('\x02#!SILK_V3'))) return 'audio/silk';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE')
    return 'audio/wav';
  if (bytes.toString('ascii', 0, 4) === 'fLaC') return 'audio/flac';
  if (bytes.toString('ascii', 0, 4) === 'OggS') return 'audio/ogg';
  if (bytes.toString('ascii', 4, 8) === 'ftyp') return 'audio/mp4';
  if (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xf6) === 0xf0) return 'audio/aac';
  if (
    bytes.toString('ascii', 0, 3) === 'ID3' ||
    (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)
  )
    return 'audio/mpeg';
  throw new KernelFault('audio-format');
}

/** Only private authorized byte/text consumers. Protocol download/upload and delivery attempts stay outside. */
export class QQAudio {
  private binding: BoundCodec | undefined;
  private readonly pending = new Set<Promise<unknown>>();
  private readonly operations = new Set<Promise<unknown>>();
  private track<T>(work: Promise<T>): Promise<T> {
    this.operations.add(work);
    void work.then(
      () => this.operations.delete(work),
      () => this.operations.delete(work),
    );
    return work;
  }
  private readonly lifetime = new AbortController();
  private closed = false;
  private status: QQView['codec'] = {
    source: 'unavailable',
    imageId: null,
    manifestSha256: null,
    cleanup: 'settled',
    error: makeError('not-ready', false),
  };
  private readonly offCommit: () => void;
  constructor(private readonly options: QQAudioOptions) {
    this.offCommit = options.host.onConfigurationCommit((commit) => {
      if (commit.pluginId === QQ_CODEC_PLUGIN_ID && this.binding) this.fence(this.binding);
    });
  }
  readonly codecPorts: QqCodecPortsFor = (context) => {
    if (context.owner.pluginId !== QQ_CODEC_PLUGIN_ID) throw new KernelFault('permission-denied');
    return {
      bind: (native) => {
        if (this.binding) throw new KernelFault('conflict');
        const policy = this.options.host.permissionControl.inspect(identity(QQ_CODEC_PLUGIN_ID));
        if (!policy) throw new KernelFault('permission-denied');
        const bound: BoundCodec = {
          context,
          native,
          config: this.options.host.configs.get(identity(QQ_CODEC_PLUGIN_ID)),
          epoch: policy.epoch,
          abort: new AbortController(),
          pending: new Set(),
        };
        this.binding = bound;
        const abort = () => this.fence(bound);
        context.signal.addEventListener('abort', abort, { once: true });
        return async () => {
          abort();
          await Promise.allSettled([...bound.pending]);
          context.signal.removeEventListener('abort', abort);
        };
      },
    };
  };
  private fence(bound: BoundCodec): void {
    bound.abort.abort();
    if (this.binding === bound) {
      this.binding = undefined;
      this.status = {
        source: 'unavailable',
        imageId: null,
        manifestSha256: null,
        cleanup: 'pending',
        error: makeError('stale-owner', false),
      };
    }
  }
  private async guard(bound: BoundCodec): Promise<void> {
    const { host } = this.options;
    const expected = await bound.config,
      current = await host.configs.get(identity(QQ_CODEC_PLUGIN_ID));
    const policy = host.permissionControl.inspect(identity(QQ_CODEC_PLUGIN_ID));
    if (
      this.closed ||
      this.binding !== bound ||
      bound.abort.signal.aborted ||
      bound.context.signal.aborted ||
      !host.manager.isActive(bound.context.owner) ||
      !host.verifySource(QQ_CODEC_PLUGIN_ID) ||
      !policy ||
      policy.blocked ||
      policy.preset === 'deny' ||
      policy.epoch !== bound.epoch
    )
      throw new KernelFault('stale-owner');
    if (
      !expected.ok ||
      !current.ok ||
      expected.value.revision !== current.value.revision ||
      !isDeepStrictEqual(expected.value.data, bound.context.config)
    )
      throw new KernelFault('conflict');
  }
  private codec<T>(
    access: RuntimeInputAccess | undefined,
    operation: (
      native: QqCodecNative,
      signal: AbortSignal,
      check: () => Promise<void>,
    ) => Promise<T>,
    signal = access?.signal ?? this.lifetime.signal,
  ): Promise<T> {
    const bound = this.binding;
    if (!bound || this.closed) return Promise.reject(new KernelFault('not-ready'));
    const work = withSourceAuthority(
      this.options.host,
      QQ_FEATURE_PLUGIN_ID,
      [{ kind: 'capability-use', capability: CODEC_CAPABILITY }],
      (consumerSignal) =>
        withSourceAuthority(
          this.options.host,
          QQ_CODEC_PLUGIN_ID,
          [
            { kind: 'files', scope: 'plugin-data', access: 'read-write' },
            { kind: 'process', workers: ['codec'] },
          ],
          async (sourceSignal) => {
            const combined = AbortSignal.any([
              sourceSignal,
              bound.abort.signal,
              this.lifetime.signal,
              signal,
            ]);
            const check = async (): Promise<void> => {
              combined.throwIfAborted();
              if (access) await access.check();
              await this.guard(bound);
              combined.throwIfAborted();
            };
            await check();
            const available = await bound.native.describe();
            await check();
            if (!available.available) {
              this.status = {
                source: 'unavailable',
                imageId: available.imageId,
                manifestSha256: available.manifestSha256,
                cleanup: 'unknown',
                error: makeError('not-ready', false),
              };
              throw new KernelFault('not-ready');
            }
            if (
              available.imageId !== bound.context.config['imageId'] ||
              available.manifestSha256 !== bound.context.config['manifestSha256']
            )
              throw new KernelFault('not-ready');
            this.status = {
              source: 'ready',
              imageId: available.imageId,
              manifestSha256: available.manifestSha256,
              cleanup: 'settled',
              error: null,
            };
            const value = await operation(bound.native, combined, check);
            await check();
            return value;
          },
          { signal: consumerSignal },
        ),
      { signal: AbortSignal.any([signal, bound.abort.signal, this.lifetime.signal]) },
    );
    bound.pending.add(work);
    this.pending.add(work);
    void work.then(
      () => {
        bound.pending.delete(work);
        this.pending.delete(work);
      },
      () => {
        bound.pending.delete(work);
        this.pending.delete(work);
      },
    );
    return work;
  }
  codecStatus(): QQView['codec'] {
    const bound = this.binding,
      state = this.options.host.manager.get(identity(QQ_CODEC_PLUGIN_ID));
    const policy = this.options.host.permissionControl.inspect(identity(QQ_CODEC_PLUGIN_ID));
    if (
      !bound ||
      !state ||
      state.state !== 'active' ||
      bound.abort.signal.aborted ||
      !policy ||
      policy.blocked ||
      policy.preset === 'deny' ||
      policy.epoch !== bound.epoch ||
      !this.options.host.verifySource(QQ_CODEC_PLUGIN_ID)
    )
      return {
        ...this.status,
        source: state?.state === 'disabled' ? 'disabled' : 'unavailable',
        cleanup:
          state?.state === 'disabled'
            ? 'settled'
            : state?.state === 'pending_restart'
              ? 'failed'
              : this.status.cleanup,
      };
    return { ...this.status };
  }
  async preflightCodec(): Promise<QQView['codec']> {
    const target = this.binding;
    try {
      const value = await this.codec(undefined, async (native) => native.describe());
      if (!value.available) throw new KernelFault('not-ready');
    } catch (error) {
      if (this.binding === target)
        this.status = {
          source: 'unavailable',
          imageId: null,
          manifestSha256: null,
          cleanup: this.status.cleanup === 'unknown' ? 'unknown' : 'settled',
          error: error instanceof KernelFault ? error.error : makeError('unavailable', false),
        };
    }
    return this.codecStatus();
  }
  private async admission(
    id: string,
    access: RuntimeInputAccess,
  ): Promise<CompanionInputAdmission> {
    if (!isCompanionRecordId(id)) throw new KernelFault('invalid-input');
    await access.check();
    access.signal.throwIfAborted();
    const value = await this.options.runtime.state(
      'getInput',
      { id, scope: access.scope },
      access.signal,
    );
    await access.check();
    access.signal.throwIfAborted();
    return value;
  }
  transcribe(
    input: QQEncodedVoice,
    access: RuntimeInputAccess,
  ): Promise<{ material: CompanionMaterialRef; transcript: string }> {
    const captured = {
      inputId: input.inputId,
      materialId: input.materialId,
      name: input.name,
      encoded: input.encoded,
    };
    if (this.closed) return Promise.reject(new KernelFault('not-ready'));
    if (this.operations.size >= COMPANION_MATERIAL_PREPARATION_MAX_ACTIVE)
      return Promise.reject(new KernelFault('quota-exceeded'));
    return this.track(
      this.options.voice.withAsrConsumer(
        QQ_FEATURE_PLUGIN_ID,
        AbortSignal.any([access.signal, this.lifetime.signal]),
        (asr, asrSignal) =>
          this.codec(
            access,
            async (codec, signal, check) => {
              const admission = await this.admission(captured.inputId, access);
              if (
                admission.origin.kind !== 'qq' ||
                !admission.materialIds.includes(captured.materialId)
              )
                throw new KernelFault('permission-denied');
              const verify = async () => {
                signal.throwIfAborted();
                await check();
                await asr.check();
              };
              const encoded = await collect(
                captured.encoded,
                COMPANION_MATERIAL_INPUT_MAX_BYTES,
                verify,
              );
              return codec.decode(
                chunks(encoded, verify),
                async (output, pcm) => {
                  await verify();
                  if (
                    output.encoding !== 'pcm-f32le' ||
                    output.sampleRate !== VOICE_SAMPLE_RATE ||
                    output.frames < 1 ||
                    output.frames >
                      (VOICE_SAMPLE_RATE * COMPANION_VOICE_ATTACHMENT_MAX_MS) / 1000 ||
                    output.spans.length > COMPANION_VOICE_ATTACHMENT_MAX_SPANS
                  )
                    throw new KernelFault('audio-format');
                  const material = await this.options.materials.put(
                    {
                      id: captured.materialId,
                      inputId: captured.inputId,
                      kind: 'voice',
                      name: captured.name,
                      mediaType: encodedMime(encoded),
                      durationMs: output.durationMs,
                    },
                    chunks(encoded, verify),
                    access,
                  );
                  const bytes = await collect(pcm, output.frames * 4, verify);
                  if (bytes.length !== output.frames * 4) throw new KernelFault('audio-format');
                  const texts: string[] = [];
                  let through = 0;
                  for (const span of output.spans) {
                    await verify();
                    if (
                      span.startFrame !== through ||
                      span.frames < 1 ||
                      span.frames > VOICE_MAX_SAMPLES
                    )
                      throw new KernelFault('audio-format');
                    const result = await asr.recognize(
                      span.frames,
                      chunks(bytes.subarray(through * 4, (through + span.frames) * 4), verify),
                      signal,
                    );
                    through += span.frames;
                    texts.push(result.kind === 'final' ? result.text : '');
                    if (texts.join('\n').length > COMPANION_MAX_TEXT)
                      throw new KernelFault('quota-exceeded');
                  }
                  if (through !== output.frames) throw new KernelFault('audio-format');
                  const transcript = texts.join('\n');
                  if (!texts.some((text) => text.trim())) throw new KernelFault('no-speech');
                  await verify();
                  return { material, transcript };
                },
                signal,
              );
            },
            asrSignal,
          ),
      ),
    );
  }
  exportVoice(
    input: QQAcceptedVoiceOutput,
    access: RuntimeInputAccess,
  ): Promise<CompanionMaterialRef> {
    const captured = structuredClone(input);
    if (
      !captured.messages.length ||
      captured.messages.some((message) => message.role !== 'assistant')
    )
      return Promise.reject(new KernelFault('permission-denied'));
    if (this.closed) return Promise.reject(new KernelFault('not-ready'));
    if (this.operations.size >= COMPANION_MATERIAL_PREPARATION_MAX_ACTIVE)
      return Promise.reject(new KernelFault('quota-exceeded'));
    return this.track(
      this.codec(access, async (codec, signal, check) => {
        const admission = await this.admission(captured.inputId, access);
        await check();
        const delivery = await this.options.runtime.state(
          'getDelivery',
          { id: captured.deliveryId, scope: access.scope },
          signal,
        );
        await check();
        if (
          delivery.phase !== 'sending' ||
          delivery.outcome !== 'pending' ||
          !isDeepStrictEqual(
            delivery.messageIds,
            captured.messages.map((message) => message.id),
          ) ||
          companionAudienceKey(delivery.audience) !==
            companionAudienceKey(admission.origin.audience) ||
          captured.messages.some(
            (message) =>
              !message.audience ||
              companionAudienceKey(message.audience) !== companionAudienceKey(delivery.audience) ||
              !message.origins?.some((origin) => origin.inputId === admission.id),
          )
        )
          throw new KernelFault('permission-denied');
        const mandatory = delivery.parts.filter((part) => part.requirement === 'mandatory-text');
        if (
          !mandatory.length ||
          mandatory.some(
            (part) =>
              !isQQDeliveryPartAccepted(part) ||
              [part.upload, part.send].some(
                (attempt) =>
                  attempt &&
                  (attempt.phase !== 'settled' ||
                    attempt.cleanup !== 'settled' ||
                    ['pending', 'unknown'].includes(attempt.outcome)),
              ),
          )
        )
          throw new KernelFault('permission-denied');
        const voice = delivery.parts.find((part) => part.requirement === 'optional-voice');
        if (
          !voice ||
          voice.content.kind !== 'voice' ||
          !isDeepStrictEqual(voice.content.messageIds, delivery.messageIds) ||
          voice.content.material ||
          voice.upload ||
          voice.send ||
          voice.preparation !== 'pending'
        )
          throw new KernelFault('conflict');
        const policy = async () => {
          await check();
          const value = await this.options.host.configs.get(identity(QQ_FEATURE_PLUGIN_ID));
          if (!value.ok || value.value.data['voiceOutputEnabled'] !== true)
            throw new KernelFault('permission-denied');
        };
        await policy();
        const bodies: string[] = [];
        for (const message of captured.messages) {
          let body = message.text;
          if (message.content) {
            if (!isCompanionMessageContent(message.content)) throw new KernelFault('invalid-input');
            if (message.content.kind === 'text-document') {
              const expected = message.content.material;
              body = await this.options.materials.withMaterial(
                expected.id,
                access,
                async (reference, source) => {
                  if (!isDeepStrictEqual(reference, expected) || reference.kind !== 'text')
                    throw new KernelFault('conflict');
                  return new TextDecoder('utf-8', { fatal: true }).decode(
                    await collect(source, reference.sizeBytes, policy),
                  );
                },
              );
            }
          }
          bodies.push(body);
        }
        const text = bodies.join(QQ_REPLY_TEXT_SEPARATOR);
        if (
          !text.length ||
          text.length > COMPANION_MAX_TEXT ||
          Buffer.from(text).toString('utf8') !== text
        )
          throw new KernelFault('quota-exceeded');
        if (delivery.textRepresentation === 'inline') {
          if (
            mandatory.some(
              (part) =>
                part.content.kind !== 'inline-text' ||
                hash(part.content.text) !== part.content.sha256,
            ) ||
            mandatory
              .map((part) => (part.content.kind === 'inline-text' ? part.content.text : ''))
              .join('') !== text
          )
            throw new KernelFault('conflict');
        } else {
          const documents = mandatory.filter(
            (part) => part.content.kind === 'material' && part.content.material.kind === 'text',
          );
          const document = documents[0];
          if (
            documents.length !== 1 ||
            !document ||
            document.content.kind !== 'material' ||
            document.content.material.sha256 !== hash(text) ||
            document.content.material.sizeBytes !== Buffer.byteLength(text)
          )
            throw new KernelFault('conflict');
          await this.options.materials.withMaterial(
            document.content.material.id,
            access,
            async (reference, bytes) => {
              if (
                !isDeepStrictEqual(
                  reference,
                  document.content.kind === 'material' ? document.content.material : null,
                ) ||
                new TextDecoder('utf-8', { fatal: true }).decode(
                  await collect(bytes, reference.sizeBytes, policy),
                ) !== text
              )
                throw new KernelFault('conflict');
            },
          );
        }
        const parts = speechSegments(text),
          snapshot = await this.options.runtime.snapshot();
        const key = {
          utteranceId: randomUUID(),
          clientId: 'qq-export',
          agentId: snapshot.agent.id,
          serviceEpoch: snapshot.epoch,
          utteranceBindingId: randomUUID(),
        };
        // Allocate the real bounded export sink before the first native synthesis request.
        const maximum = ((SPEECH_FORMAT.sampleRate * COMPANION_VOICE_ATTACHMENT_MAX_MS) / 1000) * 2;
        const sink = Buffer.alloc(maximum);
        let at = 0;
        return this.options.speech.withTtsConsumer(
          QQ_FEATURE_PLUGIN_ID,
          signal,
          async (tts, ttsSignal) => {
            for (let index = 0; index < parts.length; index++) {
              if (at >= maximum) throw new KernelFault('quota-exceeded');
              const part = parts[index];
              if (!part) throw new KernelFault('invalid-input');
              await policy();
              await tts.check();
              await tts.consume(
                { ...key, segmentIndex: index, requestId: randomUUID() },
                text.slice(part.start, part.end),
                async (pcm) => {
                  for await (const bytes of pcm) {
                    ttsSignal.throwIfAborted();
                    await policy();
                    if (at + bytes.length > maximum) throw new KernelFault('quota-exceeded');
                    sink.set(bytes, at);
                    at += bytes.length;
                  }
                },
              );
            }
            if (!at || at % 2) throw new KernelFault('audio-format');
            const verified = async () => {
              ttsSignal.throwIfAborted();
              await policy();
              await tts.check();
            };
            await verified();
            return codec.encode(
              chunks(sink.subarray(0, at), verified),
              async (output, bytes) => {
                await verified();
                if (
                  output.encoding !== 'tencent-silk-v3' ||
                  output.durationMs > COMPANION_VOICE_ATTACHMENT_MAX_MS
                )
                  throw new KernelFault('audio-format');
                const scoped: RuntimeInputAccess = {
                  scope: access.scope,
                  signal: ttsSignal,
                  check: verified,
                };
                return this.options.materials.put(
                  {
                    id: `voice-${hash(JSON.stringify([delivery.id, captured.inputId]))}`,
                    inputId: captured.inputId,
                    kind: 'voice',
                    name: 'reply.silk',
                    mediaType: 'audio/silk',
                    durationMs: output.durationMs,
                  },
                  bytes,
                  scoped,
                );
              },
              ttsSignal,
            );
          },
        );
      }),
    );
  }
  async close(): Promise<void> {
    this.closed = true;
    this.offCommit();
    this.lifetime.abort();
    if (this.binding) this.fence(this.binding);
    await Promise.allSettled([...this.operations, ...this.pending]);
  }
}
