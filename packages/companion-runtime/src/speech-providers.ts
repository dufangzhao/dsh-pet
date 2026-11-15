import { randomUUID } from 'node:crypto';
import {
  SPEECH_CATALOG_MAX_BYTES,
  SPEECH_CATALOG_MAX_CANDIDATES,
  SPEECH_CATALOG_TIMEOUT_MS,
  SPEECH_FORMAT,
  SPEECH_OUTPUT_STREAM_CAPABILITY,
  SPEECH_SEGMENT_TIMEOUT_MS,
  SPEECH_SEGMENT_MAX_BYTES,
  makeError,
  type OwnerRef,
  type SpeechCatalog,
  type SpeechSegmentKey,
  type StreamCreditMessage,
  type StreamEndMessage,
} from '@pet/contracts';
import { KernelFault, TaskMediaPeer } from '@pet/host-kernel';
import type { PluginContext } from '@pet/plugin-sdk';
import type { CompanionPluginHost } from './plugin-host.js';
import { withSourceAuthority } from './source-authority.js';
import { SpeechCleanupFault } from './speech-output-errors.js';
import type {
  AuthorizedMagpieSpeechTransport,
  NativeSpeechBinding,
  NativeSpeechResult,
  SpeechProviderBinding,
  SpeechSynthesisOperation,
  SpeechTtsPorts,
  SpeechTtsRegistration,
} from './speech-output-types.js';

const identity = (pluginId: string) => ({ pluginId, instanceId: 'default' });
const same = (a: OwnerRef, b: OwnerRef): boolean =>
  a.pluginId === b.pluginId && a.instanceId === b.instanceId && a.generation === b.generation;
interface Bound {
  ref: string;
  id: string;
  owner: OwnerRef;
  revision: number;
  epoch: number;
  fingerprint: string;
  native: NativeSpeechBinding;
  abort: AbortController;
  pending: Set<Promise<unknown>>;
  retired: boolean;
}

/** Native bindings for the existing source/task kernel, not a second provider registry. */
export class SpeechProviders {
  private readonly registrations = new Map<string, SpeechTtsRegistration>();
  private readonly prepared = new Map<string, { revision: number; abort: AbortController }>();
  private readonly bindings = new Map<string, Bound>();
  private readonly pending = new Set<Promise<unknown>>();
  private selected = '';
  private readonly offCommit: () => void;
  constructor(
    private readonly host: CompanionPluginHost,
    registrations: readonly SpeechTtsRegistration[],
    private readonly transport: (
      owner: OwnerRef,
      baseUrl: string,
    ) => AuthorizedMagpieSpeechTransport,
    private readonly invalidated: (ref: string) => void,
  ) {
    if (registrations.length > 4) throw new KernelFault('quota-exceeded');
    for (const r of registrations) {
      const ref = `${r.manifest.id}/${r.tts.providerId}`;
      if (
        this.registrations.has(ref) ||
        !r.manifest.provides?.some(
          (p) =>
            p.id === r.tts.providerId &&
            p.capability === SPEECH_OUTPUT_STREAM_CAPABILITY &&
            p.features?.['nativeSpeech'] === 1,
        )
      )
        throw new KernelFault('invalid-input');
      this.registrations.set(ref, r);
    }
    this.offCommit = host.onConfigurationCommit((commit) => {
      for (const [ref, r] of this.registrations)
        if (
          r.manifest.id === commit.pluginId &&
          commit.instanceId === 'default' &&
          this.prepared.get(ref)?.revision !== commit.revision
        )
          this.invalidate(ref);
    });
  }
  list(): readonly [string, SpeechTtsRegistration][] {
    return [...this.registrations];
  }
  registration(ref: string): SpeechTtsRegistration {
    const r = this.registrations.get(ref);
    if (!r) throw new KernelFault('invalid-input');
    return r;
  }
  select(ref: string): void {
    this.registration(ref);
    if (this.selected && this.selected !== ref) this.invalidated(this.selected);
    this.selected = ref;
  }
  invalidate(ref: string): void {
    this.registration(ref);
    this.prepared.get(ref)?.abort.abort();
    const b = this.bindings.get(ref);
    if (b) this.fence(b);
  }
  private fence(b: Bound): void {
    if (b.retired) return;
    b.retired = true;
    b.abort.abort();
    if (this.bindings.get(b.ref) === b) this.bindings.delete(b.ref);
    this.invalidated(b.ref);
  }
  private current(b: Bound): boolean {
    const policy = this.host.permissionControl.inspect(identity(b.owner.pluginId));
    return (
      !b.retired &&
      !b.abort.signal.aborted &&
      this.bindings.get(b.ref) === b &&
      this.host.manager.isActive(b.owner) &&
      this.host.verifySource(b.owner.pluginId) &&
      !!policy &&
      !policy.blocked &&
      policy.preset !== 'deny' &&
      policy.epoch === b.epoch
    );
  }
  binding(ref: string): { bindingId: string; revision: number; owner: OwnerRef } | null {
    const b = this.bindings.get(ref);
    if (!b) return null;
    if (!this.current(b)) {
      this.fence(b);
      return null;
    }
    return { bindingId: b.id, revision: b.revision, owner: b.owner };
  }
  async capture(
    ref: string,
    bindingId: string,
    credentialVersion: string,
  ): Promise<SpeechProviderBinding> {
    const b = this.bindings.get(ref);
    if (!b || b.id !== bindingId || !this.current(b) || this.selected !== ref)
      throw new KernelFault('conflict');
    const r = this.registration(ref);
    const config = await this.host.configs.get(identity(b.owner.pluginId));
    if (!config.ok || config.value.revision !== b.revision || !this.current(b))
      throw new KernelFault('conflict');
    return {
      providerRef: ref,
      bindingId: b.id,
      sourcePluginId: b.owner.pluginId,
      instanceId: b.owner.instanceId,
      providerId: r.tts.providerId,
      sourceGeneration: b.owner.generation,
      configRevision: b.revision,
      credentialVersion,
      policyEpoch: b.epoch,
      sourceFingerprint: b.fingerprint,
      settings: r.tts.parseConfig(config.value.data),
      format: { ...SPEECH_FORMAT },
    };
  }
  async enable(ref: string): Promise<void> {
    const r = this.registration(ref);
    const config = await this.host.configs.get(identity(r.manifest.id));
    if (!config.ok) throw new KernelFault(config.error.code);
    if (this.host.isEnabled(r.manifest.id)) {
      if (this.binding(ref)?.revision === config.value.revision) return;
      throw new KernelFault('conflict');
    }
    this.prepared.set(ref, { revision: config.value.revision, abort: new AbortController() });
    await this.host.setEnabled(r.manifest.id, true);
  }
  async disable(ref: string): Promise<void> {
    this.invalidate(ref);
    await this.host.setEnabled(this.registration(ref).manifest.id, false);
  }
  async prepare(context: PluginContext): Promise<void> {
    const entry = this.list().find(([, r]) => r.manifest.id === context.owner.pluginId);
    if (!entry) throw new KernelFault('not-ready');
    const config = await this.host.configs.get(identity(context.owner.pluginId));
    if (!config.ok) throw new KernelFault(config.error.code);
    if (context.signal.aborted) throw new KernelFault('stale-owner');
    this.prepared.set(entry[0], { revision: config.value.revision, abort: new AbortController() });
  }
  portsFor(context: PluginContext): SpeechTtsPorts {
    const entry = this.list().find(([, r]) => r.manifest.id === context.owner.pluginId);
    if (!entry) throw new KernelFault('not-ready');
    const [ref] = entry;
    const prepared = this.prepared.get(ref);
    if (!prepared) throw new KernelFault('not-ready');
    const valid = (): void => {
      const owner = this.host.manager.get(identity(context.owner.pluginId));
      if (
        context.signal.aborted ||
        prepared.abort.signal.aborted ||
        !owner ||
        !same(owner.owner, context.owner) ||
        !['activating', 'active'].includes(owner.state)
      )
        throw new KernelFault('stale-owner');
    };
    return {
      authorizedMagpie: (baseUrl) => {
        valid();
        const native = this.transport(context.owner, baseUrl);
        const signalFor = (signal: AbortSignal) =>
          AbortSignal.any([signal, context.signal, prepared.abort.signal]);
        return {
          catalog: async (signal) => {
            valid();
            const value = await native.catalog(signalFor(signal));
            valid();
            return value;
          },
          mimoSpeech: async (input, signal) => {
            valid();
            const stream = await native.mimoSpeech(input, signalFor(signal));
            try {
              valid();
            } catch (error) {
              stream.cancel();
              await stream.settled;
              throw error;
            }
            return stream;
          },
          close: () => native.close(),
        };
      },
      bind: (native) => {
        valid();
        if (this.bindings.has(ref)) throw new KernelFault('conflict');
        const policy = this.host.permissionControl.inspect(identity(context.owner.pluginId));
        if (!policy) throw new KernelFault('permission-denied');
        const b: Bound = {
          ref,
          id: randomUUID(),
          owner: { ...context.owner },
          revision: prepared.revision,
          epoch: policy.epoch,
          fingerprint: this.host.sourceFingerprint(context.owner.pluginId),
          native,
          abort: prepared.abort,
          pending: new Set(),
          retired: false,
        };
        const abort = () => this.fence(b);
        context.signal.addEventListener('abort', abort, { once: true });
        this.bindings.set(ref, b);
        return async () => {
          this.fence(b);
          context.signal.removeEventListener('abort', abort);
          await Promise.allSettled([...b.pending]);
        };
      },
    };
  }
  private async guard(b: Bound, consumer: string): Promise<void> {
    if (
      this.selected !== b.ref ||
      !this.current(b) ||
      !this.host.isEnabled(consumer) ||
      !this.host.verifySource(consumer)
    )
      throw new KernelFault('stale-owner');
    const config = await this.host.configs.get(identity(b.owner.pluginId));
    if (!config.ok || config.value.revision !== b.revision || !this.current(b))
      throw new KernelFault('conflict');
  }
  async catalog(
    consumer: string,
    ref: string,
    bindingId: string,
    signal: AbortSignal,
  ): Promise<SpeechCatalog> {
    const b = this.bindings.get(ref);
    if (!b || b.id !== bindingId) throw new KernelFault('conflict');
    const work = (async () => {
      await this.guard(b, consumer);
      return withSourceAuthority(
        this.host,
        consumer,
        [{ kind: 'capability-use', capability: SPEECH_OUTPUT_STREAM_CAPABILITY }],
        (consumerSignal) =>
          withSourceAuthority(
            this.host,
            b.owner.pluginId,
            [{ kind: 'files', scope: 'plugin-data', access: 'read' }],
            async (sourceSignal) => {
              const candidates = await b.native.catalog(sourceSignal);
              await this.guard(b, consumer);
              const result = { providerRef: ref, bindingId, candidates };
              if (
                candidates.length > SPEECH_CATALOG_MAX_CANDIDATES ||
                Buffer.byteLength(JSON.stringify({ ok: true, value: result })) >
                  SPEECH_CATALOG_MAX_BYTES
              )
                throw new KernelFault('quota-exceeded');
              return result;
            },
            { signal: consumerSignal, timeoutMs: SPEECH_CATALOG_TIMEOUT_MS },
          ),
        { signal: AbortSignal.any([signal, b.abort.signal]), timeoutMs: SPEECH_CATALOG_TIMEOUT_MS },
      );
    })();
    return this.track(b, work);
  }
  async synthesize(
    consumer: string,
    input: { key: SpeechSegmentKey; binding: SpeechProviderBinding; text: string },
    signal: AbortSignal,
  ): Promise<SpeechSynthesisOperation> {
    const captured = input.binding;
    const b = this.bindings.get(captured.providerRef);
    if (
      !b ||
      b.id !== captured.bindingId ||
      b.revision !== captured.configRevision ||
      b.owner.generation !== captured.sourceGeneration ||
      b.epoch !== captured.policyEpoch ||
      b.fingerprint !== captured.sourceFingerprint
    )
      throw new KernelFault('conflict');
    const abort = new AbortController();
    let producedFrames = 0;
    let submittedBytes = 0;
    let reporting = true;
    const onProduced = (frames: number): void => {
      if (!reporting) return;
      if (
        !Number.isSafeInteger(frames) ||
        frames < producedFrames ||
        frames * 2 > SPEECH_SEGMENT_MAX_BYTES
      )
        throw new KernelFault('audio-format');
      producedFrames = frames;
    };
    let readyResolve: (operation: SpeechSynthesisOperation) => void = () => {};
    let readyReject: (error: unknown) => void = () => {};
    const ready = new Promise<SpeechSynthesisOperation>((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    const work: Promise<NativeSpeechResult> = (async () => {
      await this.guard(b, consumer);
      return withSourceAuthority(
        this.host,
        consumer,
        [{ kind: 'capability-use', capability: SPEECH_OUTPUT_STREAM_CAPABILITY }],
        (consumerSignal) =>
          withSourceAuthority(
            this.host,
            b.owner.pluginId,
            [{ kind: 'files', scope: 'plugin-data', access: 'read' }],
            async (sourceSignal, context) => {
              await this.guard(b, consumer);
              const reference = {
                streamId: randomUUID(),
                taskId: context.taskId,
                owner: context.owner,
              };
              const envelope = (
                message: Parameters<ConstructorParameters<typeof TaskMediaPeer>[0]['control']>[0],
              ): StreamCreditMessage | StreamEndMessage => ({
                protocol: 1,
                id: randomUUID(),
                sessionId: reference.streamId,
                owner: context.owner,
                ...message,
              });
              const signalFor = (owner: OwnerRef, taskId: string) =>
                same(owner, context.owner) &&
                taskId === context.taskId &&
                !sourceSignal.aborted &&
                this.current(b)
                  ? sourceSignal
                  : null;
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
              const reader = readerPeer.createReader(reference);
              const writer = writerPeer.createWriter(reference);
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
              let readFinished = () => {};
              const readDone = new Promise<void>((resolve) => {
                readFinished = resolve;
              });
              const iterator = reader.value[Symbol.asyncIterator]();
              let consumed = false;
              const cancelRead = (): void => {
                reader.value.cancel();
                readFinished();
              };
              sourceSignal.addEventListener('abort', cancelRead, { once: true });
              const audio = {
                reference,
                cancel: cancelRead,
                [Symbol.asyncIterator]() {
                  if (consumed) throw new KernelFault('conflict');
                  consumed = true;
                  return {
                    async next() {
                      try {
                        const next = await iterator.next();
                        if (next.done) readFinished();
                        return next;
                      } catch (error) {
                        readFinished();
                        throw error;
                      }
                    },
                    async return() {
                      abort.abort();
                      try {
                        await iterator.return?.();
                      } finally {
                        readFinished();
                      }
                      return { done: true as const, value: undefined };
                    },
                  };
                },
              };
              readyResolve({
                start: {
                  ...input.key,
                  providerRef: b.ref,
                  bindingId: b.id,
                  version: 1,
                  format: { ...SPEECH_FORMAT },
                  media: reference,
                },
                audio,
                get producedFrames() {
                  return producedFrames;
                },
                result: work,
                settled: work.then(
                  () => {},
                  (error: unknown) => {
                    if (error instanceof SpeechCleanupFault) throw error;
                  },
                ),
                cancel: () => abort.abort(),
              });
              try {
                const result = await b.native.synthesize(
                  {
                    key: input.key,
                    modelRef: captured.settings.modelRef,
                    voice: captured.settings.voice,
                    text: input.text,
                    format: { ...SPEECH_FORMAT },
                    onProduced,
                    audio: {
                      reference: writer.value.reference,
                      write: async (bytes) => {
                        if (
                          !reporting ||
                          !(bytes instanceof Uint8Array) ||
                          bytes.byteLength % 2 ||
                          submittedBytes + bytes.byteLength > producedFrames * 2
                        )
                          throw new KernelFault('audio-format');
                        submittedBytes += bytes.byteLength;
                        return writer.value.write(bytes);
                      },
                      end: () => writer.value.end(),
                      cancel: () => writer.value.cancel(),
                    },
                  },
                  sourceSignal,
                );
                reporting = false;
                if (
                  !result ||
                  result.finishReason !== 'stop' ||
                  !Number.isSafeInteger(result.producedFrames) ||
                  result.producedFrames < 1 ||
                  result.producedFrames !== producedFrames ||
                  result.producedBytes !== submittedBytes ||
                  result.producedBytes !== result.producedFrames * 2 ||
                  result.producedBytes > SPEECH_SEGMENT_MAX_BYTES
                )
                  throw new KernelFault('audio-format');
                await readDone;
                await this.guard(b, consumer);
                return result;
              } finally {
                reporting = false;
                sourceSignal.removeEventListener('abort', cancelRead);
                readerPeer.close();
                writerPeer.close();
                readFinished();
              }
            },
            { signal: consumerSignal, timeoutMs: SPEECH_SEGMENT_TIMEOUT_MS },
          ),
        {
          signal: AbortSignal.any([signal, b.abort.signal, abort.signal]),
          timeoutMs: SPEECH_SEGMENT_TIMEOUT_MS,
        },
      );
    })();
    void this.track(b, work).catch(readyReject);
    return ready;
  }
  private async track<T>(b: Bound, work: Promise<T>): Promise<T> {
    b.pending.add(work);
    this.pending.add(work);
    try {
      return await work;
    } finally {
      b.pending.delete(work);
      this.pending.delete(work);
    }
  }
  async close(): Promise<void> {
    this.offCommit();
    for (const ref of this.registrations.keys()) this.invalidate(ref);
    await Promise.allSettled([...this.pending]);
  }
}
