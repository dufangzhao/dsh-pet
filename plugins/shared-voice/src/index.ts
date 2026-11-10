import { randomUUID } from 'node:crypto';
import { definePlugin, type PluginDefinition } from '@pet/plugin-sdk';
import { KernelFault } from '@pet/host-kernel';
import {
  VOICE_MAX_ACTIVE,
  VOICE_MAX_RETAINED,
  VOICE_MAX_SAMPLES,
  VOICE_OPERATION_TIMEOUT_MS,
  VOICE_TICKET_TTL_MS,
  VOICE_RESULT_TTL_MS,
  VOICE_RESULT_MAX_BYTES,
  COMPANION_MAX_TEXT,
  VOICE_UPLOAD_BODY_TIMEOUT_MS,
  makeError,
  type KernelError,
  type VoiceBegin,
  type VoiceCaptureResult,
  type VoiceFinal,
  type VoiceResultKey,
  type VoiceTicket,
} from '@pet/contracts';
import type {
  SharedVoicePorts,
  SharedVoicePortsFor,
  VoiceInputNative,
} from '@pet/companion-runtime';
interface Capture {
  fingerprint: string;
  input: VoiceBegin;
  ticket: VoiceTicket;
  result: VoiceCaptureResult;
  abort: AbortController;
  timer: ReturnType<typeof setTimeout> | null;
  running: Promise<VoiceCaptureResult> | null;
}
const terminal = (phase: string) => ['final', 'empty', 'cancelled', 'failed'].includes(phase);
const fingerprint = (v: VoiceBegin) =>
  JSON.stringify([
    v.captureId,
    v.clientId,
    v.agentId,
    v.expectedFeatureRevision,
    v.providerRef,
    v.bindingId,
    v.finishMode,
  ]);
const problem = (error: unknown): KernelError =>
  error instanceof KernelFault
    ? error.error
    : makeError(
        error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'internal',
        false,
      );
/** Transient input preparation only. It never writes a canonical message or history. */
export class SharedVoiceInput implements VoiceInputNative {
  private readonly epoch = randomUUID();
  private readonly captures = new Map<string, Capture>();
  private closed = false;
  constructor(
    private readonly ports: SharedVoicePorts,
    private readonly sourceSignal: AbortSignal,
  ) {}
  private current(): void {
    if (this.closed || this.sourceSignal.aborted) throw new KernelFault('stale-owner');
  }
  private owned(key: VoiceResultKey): Capture {
    this.current();
    const c = this.captures.get(key.captureId);
    if (
      !c ||
      c.ticket.clientId !== key.clientId ||
      c.ticket.agentId !== key.agentId ||
      c.ticket.serviceEpoch !== key.serviceEpoch
    )
      throw new KernelFault('unavailable');
    return c;
  }
  private prune(): void {
    const done = [...this.captures.values()]
      .filter((c) => terminal(c.result.phase))
      .sort((a, b) => (a.result.completedAt ?? 0) - (b.result.completedAt ?? 0));
    while (done.length > VOICE_MAX_RETAINED) {
      const c = done.shift();
      if (c) {
        clearTimeout(c.timer ?? undefined);
        this.captures.delete(c.ticket.captureId);
      }
    }
  }
  private finish(
    c: Capture,
    phase: 'final' | 'empty' | 'cancelled' | 'failed',
    outcome: VoiceFinal | null,
    error: KernelError | null,
  ): VoiceCaptureResult {
    clearTimeout(c.timer ?? undefined);
    let value: VoiceCaptureResult = {
      ticket: c.ticket,
      phase,
      samples: c.result.samples,
      cleanup: 'settled',
      outcome,
      error,
      completedAt: Date.now(),
    };
    if (Buffer.byteLength(JSON.stringify({ ok: true, value })) > VOICE_RESULT_MAX_BYTES)
      value = {
        ...value,
        phase: 'failed',
        outcome: null,
        error: makeError('quota-exceeded', false),
      };
    c.result = value;
    c.timer = setTimeout(() => {
      if (this.captures.get(c.ticket.captureId) === c) this.captures.delete(c.ticket.captureId);
    }, VOICE_RESULT_TTL_MS);
    c.timer.unref?.();
    this.prune();
    return value;
  }
  async begin(input: VoiceBegin): Promise<VoiceTicket> {
    this.current();
    const retained = this.captures.get(input.captureId);
    if (retained) {
      if (retained.fingerprint !== fingerprint(input)) throw new KernelFault('conflict');
      return retained.ticket;
    }
    await this.ports.validateBegin(input);
    this.current();
    const agent = await this.ports.currentAgent();
    this.current();
    if (agent.id !== input.agentId) throw new KernelFault('conflict');
    if (!agent.acceptsInput) throw new KernelFault('not-ready');
    const existing = this.captures.get(input.captureId);
    if (existing) {
      if (existing.fingerprint !== fingerprint(input)) throw new KernelFault('conflict');
      return existing.ticket;
    }
    const active = [...this.captures.values()].filter((c) => !terminal(c.result.phase));
    if (active.some((c) => c.ticket.clientId === input.clientId)) throw new KernelFault('conflict');
    if (active.length >= VOICE_MAX_ACTIVE) throw new KernelFault('quota-exceeded');
    const ticket: VoiceTicket = {
      version: 1,
      captureId: input.captureId,
      clientId: input.clientId,
      agentId: input.agentId,
      serviceEpoch: this.epoch,
      bindingId: input.bindingId,
      finishMode: input.finishMode,
      encoding: 'f32le',
      sampleRate: 16000,
      channels: 1,
      chunkSamples: 1600,
      maxSamples: VOICE_MAX_SAMPLES,
      expiresAt: Date.now() + VOICE_TICKET_TTL_MS,
    };
    const c: Capture = {
      input: { ...input },
      fingerprint: fingerprint(input),
      ticket,
      abort: new AbortController(),
      running: null,
      result: {
        ticket,
        phase: 'awaiting-audio',
        samples: 0,
        cleanup: 'pending',
        outcome: null,
        error: null,
        completedAt: null,
      },
      timer: null,
    };
    clearTimeout(c.timer ?? undefined);
    c.timer = setTimeout(() => {
      if (c.result.phase === 'awaiting-audio') {
        c.abort.abort();
        this.finish(c, 'cancelled', null, null);
      }
    }, VOICE_TICKET_TTL_MS);
    c.timer.unref?.();
    this.captures.set(input.captureId, c);
    return ticket;
  }
  async result(key: VoiceResultKey): Promise<VoiceCaptureResult> {
    return this.owned(key).result;
  }
  async upload(
    key: VoiceResultKey,
    samples: number,
    pcm: AsyncIterable<Uint8Array>,
    callerSignal: AbortSignal,
  ): Promise<VoiceCaptureResult> {
    const c = this.owned(key);
    if (c.result.phase !== 'awaiting-audio' || c.running || Date.now() > c.ticket.expiresAt)
      throw new KernelFault('conflict');
    if (!Number.isSafeInteger(samples) || samples < 0 || samples > VOICE_MAX_SAMPLES)
      throw new KernelFault('invalid-input');
    clearTimeout(c.timer ?? undefined);
    c.result = { ...c.result, phase: 'transcribing', samples };
    const deadline = new AbortController(),
      operationTimer = setTimeout(
        () => deadline.abort(new DOMException('Voice operation deadline', 'TimeoutError')),
        VOICE_OPERATION_TIMEOUT_MS,
      );
    const signal = AbortSignal.any([
      callerSignal,
      c.abort.signal,
      this.sourceSignal,
      deadline.signal,
    ]);
    const retiring = () => {
      if (!terminal(c.result.phase))
        c.result = { ...c.result, phase: 'retiring', cleanup: 'pending' };
    };
    signal.addEventListener('abort', retiring, { once: true });
    const work = (async () => {
      try {
        signal.throwIfAborted();
        let final: VoiceFinal;
        // Validate the entire completed clip before any provider/native operation is admitted.
        const raw = new Uint8Array(samples * 4);
        let bytes = 0;
        const bodyDeadline = setTimeout(
          () => c.abort.abort(new DOMException('Upload body deadline', 'TimeoutError')),
          VOICE_UPLOAD_BODY_TIMEOUT_MS,
        );
        const iterator = pcm[Symbol.asyncIterator]();
        let release: Promise<unknown> | undefined;
        const abortBody = () => {
          c.result = { ...c.result, phase: 'retiring', cleanup: 'pending' };
          release = Promise.resolve(iterator.return?.());
        };
        signal.addEventListener('abort', abortBody, { once: true });
        try {
          for (;;) {
            signal.throwIfAborted();
            const next = await iterator.next();
            if (next.done) break;
            const chunk = next.value;
            if (!(chunk instanceof Uint8Array) || bytes + chunk.byteLength > raw.byteLength)
              throw new KernelFault('audio-format');
            raw.set(chunk, bytes);
            bytes += chunk.byteLength;
          }
        } finally {
          clearTimeout(bodyDeadline);
          signal.removeEventListener('abort', abortBody);
          await (release ?? iterator.return?.());
        }
        signal.throwIfAborted();
        if (bytes !== raw.byteLength) throw new KernelFault('audio-format');
        const floats = new DataView(raw.buffer);
        for (let at = 0; at < raw.byteLength; at += 4) {
          const sample = floats.getFloat32(at, true);
          if (!Number.isFinite(sample) || sample < -1 || sample > 1)
            throw new KernelFault('audio-format');
        }
        async function* clip(): AsyncIterable<Uint8Array> {
          for (let at = 0; at < raw.length; at += 6400) yield raw.subarray(at, at + 6400);
        }
        try {
          if (samples === 0) final = { kind: 'no-speech' };
          else
            final = await this.ports.recognize(
              c.input.providerRef,
              c.ticket.bindingId,
              samples,
              clip(),
              signal,
            );
        } finally {
          raw.fill(0);
        }
        signal.throwIfAborted();
        this.current();
        if (final.kind === 'final') {
          if (typeof final.text !== 'string' || !final.text.trim())
            throw new KernelFault('asr-failed');
          if (final.text.length > COMPANION_MAX_TEXT) throw new KernelFault('quota-exceeded');
          final = { kind: 'final', text: final.text.trim() };
        } else if (final.kind !== 'no-speech') throw new KernelFault('asr-failed');
        return this.finish(c, final.kind === 'final' ? 'final' : 'empty', final, null);
      } catch (error) {
        if (c.abort.signal.reason instanceof Error && c.abort.signal.reason.name === 'TimeoutError')
          return this.finish(c, 'failed', null, makeError('timeout', false));
        if (c.abort.signal.aborted || callerSignal.aborted || this.sourceSignal.aborted)
          return this.finish(c, 'cancelled', null, null);
        return this.finish(
          c,
          'failed',
          null,
          deadline.signal.aborted ? makeError('timeout', false) : problem(error),
        );
      }
    })();
    c.running = work;
    try {
      return await work;
    } finally {
      clearTimeout(operationTimer);
      signal.removeEventListener('abort', retiring);
      c.running = null;
    }
  }
  async cancel(key: VoiceResultKey): Promise<VoiceCaptureResult> {
    const c = this.owned(key);
    if (terminal(c.result.phase)) return c.result;
    c.abort.abort();
    c.result = { ...c.result, phase: 'retiring', cleanup: 'pending' };
    if (c.running) return c.running;
    return this.finish(c, 'cancelled', null, null);
  }
  async invalidateProvider(ref: string): Promise<void> {
    const work: Promise<unknown>[] = [];
    for (const c of this.captures.values())
      if (!terminal(c.result.phase) && c.input.providerRef === ref) {
        c.abort.abort();
        if (c.running) work.push(c.running);
        else this.finish(c, 'cancelled', null, null);
      }
    await Promise.allSettled(work);
  }
  async close(): Promise<void> {
    this.closed = true;
    const work: Promise<unknown>[] = [];
    for (const c of this.captures.values()) {
      clearTimeout(c.timer ?? undefined);
      c.abort.abort();
      if (c.running) work.push(c.running);
    }
    await Promise.allSettled(work);
    for (const c of this.captures.values()) clearTimeout(c.timer ?? undefined);
    this.captures.clear();
  }
}
export function createSharedVoicePlugin(portsFor: SharedVoicePortsFor): PluginDefinition {
  return definePlugin({
    activate(context) {
      const ports = portsFor(context),
        feature = new SharedVoiceInput(ports, context.signal);
      context.provide('input', {
        describe: async () => ({ explicitUtterance: true, finalText: true, synthetic: false }),
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
