import { randomUUID } from 'node:crypto';
import { definePlugin, type PluginDefinition } from '@pet/plugin-sdk';
import { KernelFault } from '@pet/host-kernel';
import {
  SPEECH_ATTACH_TIMEOUT_MS,
  SPEECH_CANCEL_FENCE_TTL_MS,
  SPEECH_FORMAT,
  SPEECH_MAX_ACTIVE,
  SPEECH_MAX_RETAINED,
  SPEECH_NEXT_SEGMENT_GRACE_MS,
  SPEECH_PLAN_TIMEOUT_MS,
  SPEECH_SEGMENT_MAX_BYTES,
  SPEECH_SPLIT_VERSION,
  SPEECH_TERMINAL_TTL_MS,
  isSpeechBegin,
  isSpeechSegmentKey,
  isSpeechUtteranceKey,
  makeError,
  type KernelError,
  type SpeechAudioHeader,
  type SpeechBegin,
  type SpeechSegmentKey,
  type SpeechSegmentReceipt,
  type SpeechSegmentReserve,
  type SpeechSegmentStatus,
  type SpeechUtteranceKey,
  type SpeechUtteranceReceipt,
  type SpeechUtteranceStatus,
} from '@pet/contracts';
import type {
  SharedSpeechPorts,
  SharedSpeechPortsFor,
  SpeechAudioConsumer,
  SpeechOutputNative,
  SpeechProviderBinding,
  SpeechSynthesisOperation,
  SpeechTextSegment,
} from '@pet/companion-runtime';
import { SpeechGenerationFault } from '@pet/companion-runtime';
import { speechSegments } from './segments.js';
export { speechSegments } from './segments.js';

const keyOf = (v: SpeechUtteranceKey): SpeechUtteranceKey => ({
  utteranceId: v.utteranceId,
  clientId: v.clientId,
  agentId: v.agentId,
  serviceEpoch: v.serviceEpoch,
});
const sameKey = (a: SpeechUtteranceKey, b: SpeechUtteranceKey): boolean =>
  a.utteranceId === b.utteranceId &&
  a.clientId === b.clientId &&
  a.agentId === b.agentId &&
  a.serviceEpoch === b.serviceEpoch;
const errorOf = (error: unknown): KernelError =>
  error instanceof KernelFault ? error.error : makeError('unavailable', false);
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
interface Segment {
  key: SpeechSegmentKey;
  view: Mutable<SpeechSegmentStatus>;
  claimed: boolean;
  operation: SpeechSynthesisOperation | undefined;
  setup: Promise<SpeechAudioConsumer> | undefined;
  finish: Promise<void> | undefined;
  failure: unknown;
  settled: Promise<void>;
  resolve: () => void;
}
interface Utterance {
  input: SpeechBegin | null;
  fingerprint: string | null;
  view: Mutable<SpeechUtteranceStatus>;
  binding: SpeechProviderBinding | null;
  text: string;
  segments: readonly SpeechTextSegment[];
  abort: AbortController;
  timer: ReturnType<typeof setTimeout> | undefined;
  admission: Promise<SpeechUtteranceReceipt> | undefined;
  current: Segment | undefined;
  cancellation: Promise<SpeechUtteranceStatus> | undefined;
}

/** Only bounded canonical intent/stream state. It never creates another conversation or queue. */
export class SharedSpeechOutput implements SpeechOutputNative {
  private readonly utterances = new Map<string, Utterance>();
  private closed = false;
  private closing: Promise<void> | undefined;
  constructor(
    private readonly ports: SharedSpeechPorts,
    private readonly sourceSignal: AbortSignal,
  ) {}
  private current(): void {
    if (this.closed || this.sourceSignal.aborted) throw new KernelFault('stale-owner');
  }
  private owned(key: SpeechUtteranceKey): Utterance {
    if (!isSpeechUtteranceKey(key)) throw new KernelFault('invalid-input');
    const u = this.utterances.get(key.utteranceId);
    if (!u || !sameKey(u.view, key)) throw new KernelFault('unavailable');
    return u;
  }
  private prune(): void {
    const now = Date.now();
    for (const [id, u] of this.utterances)
      if (
        u.view.phase === 'terminal' &&
        u.view.cleanup === 'settled' &&
        u.view.completedAt !== null &&
        now - u.view.completedAt >= SPEECH_TERMINAL_TTL_MS
      )
        this.utterances.delete(id);
  }
  private room(): void {
    this.prune();
    // Reserving a metadata slot at admission prevents terminal/fence eviction races.
    if (this.utterances.size >= SPEECH_MAX_RETAINED) throw new KernelFault('quota-exceeded');
  }
  private arm(u: Utterance, timeout: number): void {
    if (u.timer) clearTimeout(u.timer);
    u.timer = setTimeout(() => {
      void this.cancel(keyOf(u.view));
    }, timeout);
    u.timer.unref();
  }
  private terminal(
    u: Utterance,
    outcome: 'completed' | 'failed' | 'cancelled',
    error: KernelError | null,
  ): void {
    if (u.timer) clearTimeout(u.timer);
    u.timer = undefined;
    u.text = '';
    u.segments = [];
    u.binding = null;
    u.view = {
      ...u.view,
      phase: 'terminal',
      outcome,
      cleanup: u.current?.view.transportCleanup === 'failed' ? 'failed' : 'settled',
      currentSegment: u.current ? { ...u.current.view } : null,
      error,
      reason:
        outcome === 'failed'
          ? u.current?.view.drainedFrames
            ? 'partial-output'
            : 'invalid-stream'
          : null,
      completedAt: Date.now(),
    };
    if (u.view.cleanup === 'settled' && u.view.receipt)
      this.ports.settled(structuredClone(u.view.receipt));
  }
  private snapshot(u: Utterance): SpeechUtteranceStatus {
    const segment = u.current;
    return structuredClone({
      ...u.view,
      currentSegment: segment
        ? {
            ...segment.view,
            producedFrames: segment.operation?.producedFrames ?? segment.view.producedFrames,
          }
        : null,
    });
  }
  async begin(input: SpeechBegin): Promise<SpeechUtteranceReceipt> {
    this.current();
    if (!isSpeechBegin(input)) throw new KernelFault('invalid-input');
    const fingerprint = JSON.stringify([
      input.utteranceId,
      input.clientId,
      input.agentId,
      input.serviceEpoch,
      input.messageId,
      input.eventSequence,
      input.providerRef,
      input.bindingId,
      input.expectedFeatureRevision,
      input.volume,
    ]);
    const known = this.utterances.get(input.utteranceId);
    if (known) {
      if (!sameKey(known.view, input)) throw new KernelFault('conflict');
      if (known.input === null) throw new KernelFault('cancelled');
      if (known.fingerprint !== fingerprint) throw new KernelFault('conflict');
      if (known.admission) return known.admission;
      if (known.view.receipt) return structuredClone(known.view.receipt);
      throw new KernelFault(known.view.error?.code ?? 'cancelled');
    }
    this.room();
    const active = [...this.utterances.values()].filter((u) => u.view.outcome === 'pending');
    if (
      active.length >= SPEECH_MAX_ACTIVE ||
      active.some((u) => u.view.clientId === input.clientId)
    )
      throw new KernelFault('quota-exceeded');
    const u: Utterance = {
      input: { ...input },
      fingerprint,
      binding: null,
      text: '',
      segments: [],
      abort: new AbortController(),
      timer: undefined,
      admission: undefined,
      current: undefined,
      cancellation: undefined,
      view: {
        ...keyOf(input),
        receipt: null,
        phase: 'planned',
        outcome: 'pending',
        cleanup: 'pending',
        attemptedThrough: -1,
        deliveredThrough: -1,
        currentSegment: null,
        error: null,
        reason: null,
        completedAt: null,
      },
    };
    this.utterances.set(input.utteranceId, u);
    this.arm(u, SPEECH_PLAN_TIMEOUT_MS);
    const work = (async (): Promise<SpeechUtteranceReceipt> => {
      const binding = await this.ports.captureBinding(input);
      const message = await this.ports.canonicalMessage({
        id: input.messageId,
        eventSequence: input.eventSequence,
      });
      this.current();
      u.abort.signal.throwIfAborted();
      if (message.role !== 'assistant') throw new KernelFault('invalid-input');
      const segments = speechSegments(message.text);
      const receipt: SpeechUtteranceReceipt = {
        ...keyOf(input),
        providerRef: input.providerRef,
        bindingId: input.bindingId,
        messageId: input.messageId,
        eventSequence: input.eventSequence,
        utteranceBindingId: randomUUID(),
        segmentCount: segments.length,
        splitVersion: SPEECH_SPLIT_VERSION,
      };
      u.binding = binding;
      u.text = message.text;
      u.segments = segments;
      u.view.receipt = receipt;
      this.arm(u, SPEECH_PLAN_TIMEOUT_MS);
      return structuredClone(receipt);
    })();
    u.admission = work;
    try {
      return await work;
    } catch (error) {
      this.terminal(
        u,
        u.abort.signal.aborted || this.sourceSignal.aborted ? 'cancelled' : 'failed',
        u.abort.signal.aborted || this.sourceSignal.aborted ? null : errorOf(error),
      );
      throw u.abort.signal.aborted ? new KernelFault('cancelled') : error;
    } finally {
      u.admission = undefined;
    }
  }
  async reserve(input: SpeechSegmentReserve): Promise<SpeechSegmentReceipt> {
    this.current();
    if (!isSpeechSegmentKey(input)) throw new KernelFault('invalid-input');
    const u = this.owned(keyOf(input));
    const receipt = u.view.receipt;
    if (!receipt || input.utteranceBindingId !== receipt.utteranceBindingId)
      throw new KernelFault('conflict');
    const s = u.current;
    if (s && s.key.segmentIndex === input.segmentIndex) {
      if (s.key.requestId !== input.requestId) throw new KernelFault('conflict');
      return { ...s.key, phase: 'awaiting-consumer' };
    }
    if (
      u.abort.signal.aborted ||
      u.view.outcome !== 'pending' ||
      input.segmentIndex !== u.view.deliveredThrough + 1 ||
      input.segmentIndex >= receipt.segmentCount ||
      (s && s.view.terminal?.outcome !== 'completed')
    )
      throw new KernelFault('conflict');
    let resolve = () => {};
    const settled = new Promise<void>((done) => {
      resolve = done;
    });
    u.current = {
      key: { ...input },
      claimed: false,
      operation: undefined,
      setup: undefined,
      finish: undefined,
      failure: undefined,
      settled,
      resolve,
      view: {
        ...input,
        phase: 'awaiting-consumer',
        producedFrames: 0,
        drainedFrames: 0,
        nativeSettled: false,
        transportCleanup: 'pending',
        terminal: null,
      },
    };
    this.arm(u, SPEECH_ATTACH_TIMEOUT_MS);
    return { ...input, phase: 'awaiting-consumer' };
  }
  async attach(input: SpeechSegmentKey, signal: AbortSignal): Promise<SpeechAudioConsumer> {
    this.current();
    if (!isSpeechSegmentKey(input)) throw new KernelFault('invalid-input');
    const u = this.owned(keyOf(input));
    const s = u.current;
    const receipt = u.view.receipt;
    const binding = u.binding;
    const range = u.segments[input.segmentIndex];
    if (
      !receipt ||
      !s ||
      !binding ||
      !range ||
      u.view.outcome !== 'pending' ||
      u.abort.signal.aborted ||
      s.key.requestId !== input.requestId ||
      s.key.segmentIndex !== input.segmentIndex ||
      input.utteranceBindingId !== receipt.utteranceBindingId ||
      s.claimed
    )
      throw new KernelFault('conflict');
    s.claimed = true;
    if (u.timer) clearTimeout(u.timer);
    u.timer = undefined;
    u.view.phase = 'streaming';
    u.view.attemptedThrough = input.segmentIndex;
    s.view.phase = 'streaming';
    const combined = AbortSignal.any([signal, u.abort.signal, this.sourceSignal]);
    const setup = (async (): Promise<SpeechAudioConsumer> => {
      try {
        const operation = await this.ports.synthesize(
          { key: input, binding, text: u.text.slice(range.start, range.end) },
          combined,
        );
        s.operation = operation;
        if (combined.aborted) {
          operation.cancel();
          operation.audio.cancel();
          await this.finishSegment(u, s, new KernelFault('cancelled'));
          throw new KernelFault('cancelled');
        }
        const iterator = operation.audio[Symbol.asyncIterator]();
        let used = false;
        const cancel = (): void => {
          u.abort.abort();
          s.operation?.cancel();
          s.operation?.audio.cancel();
          void this.finishSegment(u, s, new KernelFault('cancelled'));
        };
        combined.addEventListener('abort', cancel, { once: true });
        void s.settled.then(() => combined.removeEventListener('abort', cancel));
        const header: SpeechAudioHeader = {
          ...input,
          version: 1,
          providerRef: receipt.providerRef,
          bindingId: receipt.bindingId,
          format: { ...SPEECH_FORMAT },
        };
        return {
          header,
          settled: s.settled,
          cancel,
          audio: {
            reference: operation.audio.reference,
            cancel,
            [Symbol.asyncIterator]: () => {
              if (used) throw new KernelFault('conflict');
              used = true;
              return {
                next: async () => {
                  try {
                    combined.throwIfAborted();
                    const next = await iterator.next();
                    if (next.done) {
                      await this.finishSegment(u, s);
                      if (s.view.terminal?.outcome !== 'completed')
                        throw new KernelFault(s.view.terminal?.error?.code ?? 'cancelled');
                      return { done: true as const, value: undefined };
                    }
                    if (
                      !(next.value instanceof Uint8Array) ||
                      !next.value.byteLength ||
                      next.value.byteLength % 2 ||
                      s.view.drainedFrames * 2 + next.value.byteLength > SPEECH_SEGMENT_MAX_BYTES
                    )
                      throw new KernelFault('audio-format');
                    s.view.drainedFrames += next.value.byteLength / 2;
                    return { done: false as const, value: next.value };
                  } catch (error) {
                    // Fence the HTTP stream immediately; physical cleanup continues in s.settled.
                    void this.finishSegment(u, s, error);
                    throw new KernelFault(s.view.terminal?.error?.code ?? errorOf(error).code);
                  }
                },
                return: async () => {
                  cancel();
                  await s.settled;
                  return { done: true as const, value: undefined };
                },
              };
            },
          },
        };
      } catch (error) {
        if (combined.aborted && !s.failure) u.abort.abort();
        await this.finishSegment(u, s, error);
        throw error;
      }
    })();
    s.setup = setup;
    return setup;
  }
  private finishSegment(u: Utterance, s: Segment, failure?: unknown): Promise<void> {
    if (s.finish) return s.finish;
    if (failure && !u.abort.signal.aborted && !this.sourceSignal.aborted) s.failure = failure;
    if (failure) {
      u.view.phase = 'stopping';
      u.view.cleanup = 'pending';
    }
    s.finish = Promise.resolve().then(async () => {
      let error = failure;
      let producedFrames = s.view.producedFrames;
      let nativeError: unknown;
      let cleanupFailed = false;
      const operation = s.operation;
      if (failure || u.abort.signal.aborted || this.sourceSignal.aborted) {
        operation?.cancel();
        operation?.audio.cancel();
        s.view.phase = 'stopping';
      }
      if (operation) {
        try {
          const result = await operation.result;
          producedFrames = result.producedFrames;
          if (
            result.finishReason !== 'stop' ||
            result.producedBytes !== producedFrames * 2 ||
            result.producedBytes !== s.view.drainedFrames * 2 ||
            !producedFrames
          )
            error ??= new KernelFault('audio-format');
        } catch (caught) {
          nativeError = caught;
        }
        try {
          await operation.settled;
        } catch (caught) {
          cleanupFailed = true;
          error ??= caught;
        }
        producedFrames = operation.producedFrames;
        s.operation = undefined;
      }
      error = nativeError ?? error;
      const cancelled = !s.failure && (u.abort.signal.aborted || this.sourceSignal.aborted);
      const outcome = cancelled ? 'cancelled' : error ? 'failed' : 'completed';
      const kernelError = outcome === 'failed' ? errorOf(error) : null;
      s.view = {
        ...s.view,
        phase: 'terminal',
        producedFrames,
        nativeSettled: true,
        transportCleanup: cleanupFailed ? 'failed' : 'settled',
        terminal: {
          outcome,
          finishReason:
            outcome === 'completed'
              ? 'stop'
              : error instanceof SpeechGenerationFault
                ? error.finishReason
                : 'error',
          producedFrames,
          producedBytes: producedFrames * 2,
          drainedFrames: s.view.drainedFrames,
          drainedBytes: s.view.drainedFrames * 2,
          nativeSettled: true,
          transportCleanup: cleanupFailed ? 'failed' : 'settled',
          error: kernelError,
        },
      };
      if (outcome === 'completed') {
        u.view.deliveredThrough = s.key.segmentIndex;
        if (s.key.segmentIndex + 1 === u.view.receipt?.segmentCount)
          this.terminal(u, 'completed', null);
        else {
          u.view.phase = 'planned';
          this.arm(
            u,
            Math.ceil((producedFrames / SPEECH_FORMAT.sampleRate) * 1000) +
              SPEECH_NEXT_SEGMENT_GRACE_MS,
          );
        }
      } else {
        u.abort.abort();
        this.terminal(u, outcome, kernelError);
      }
      s.resolve();
    });
    return s.finish;
  }
  async status(key: SpeechUtteranceKey): Promise<SpeechUtteranceStatus> {
    this.current();
    this.prune();
    return this.snapshot(this.owned(key));
  }
  async cancel(key: SpeechUtteranceKey): Promise<SpeechUtteranceStatus> {
    if (!isSpeechUtteranceKey(key)) throw new KernelFault('invalid-input');
    let u = this.utterances.get(key.utteranceId);
    if (!u) {
      this.current();
      this.room();
      u = {
        input: null,
        fingerprint: null,
        text: '',
        segments: [],
        binding: null,
        abort: new AbortController(),
        timer: undefined,
        admission: undefined,
        current: undefined,
        cancellation: undefined,
        view: {
          ...key,
          receipt: null,
          phase: 'terminal',
          outcome: 'cancelled',
          cleanup: 'settled',
          attemptedThrough: -1,
          deliveredThrough: -1,
          currentSegment: null,
          error: null,
          reason: null,
          completedAt:
            Date.now() + Math.max(0, SPEECH_CANCEL_FENCE_TTL_MS - SPEECH_TERMINAL_TTL_MS),
        },
      };
      this.utterances.set(key.utteranceId, u);
    }
    if (!sameKey(u.view, key)) throw new KernelFault('conflict');
    if (u.cancellation) return u.cancellation;
    if (u.view.phase === 'terminal' && u.view.cleanup === 'settled') return this.snapshot(u);
    const current = u;
    current.abort.abort();
    current.view.phase = 'stopping';
    current.view.cleanup = 'pending';
    current.current?.operation?.cancel();
    current.current?.operation?.audio.cancel();
    current.cancellation = (async () => {
      await Promise.allSettled([current.admission, current.current?.setup]);
      if (current.current)
        await this.finishSegment(current, current.current, new KernelFault('cancelled'));
      if (current.view.outcome === 'pending') this.terminal(current, 'cancelled', null);
      return this.snapshot(current);
    })();
    return current.cancellation;
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.closing = (async () => {
      await Promise.all([...this.utterances.values()].map((u) => this.cancel(keyOf(u.view))));
      for (const u of this.utterances.values()) if (u.timer) clearTimeout(u.timer);
      if ([...this.utterances.values()].some((u) => u.view.cleanup === 'failed'))
        throw new KernelFault('unavailable');
      this.utterances.clear();
    })();
    return this.closing;
  }
}

export function createSharedSpeechPlugin(portsFor: SharedSpeechPortsFor): PluginDefinition {
  return definePlugin({
    activate(context) {
      const ports = portsFor(context);
      const feature = new SharedSpeechOutput(ports, context.signal);
      context.provide('output', {
        describe: async () => ({ canonicalAssistant: true, streamingPcm: true }),
      });
      context.effect(() => () => feature.close());
      context.effect(() => ports.bind(feature));
    },
  });
}
export default definePlugin({
  activate() {
    throw new KernelFault('not-ready');
  },
});
