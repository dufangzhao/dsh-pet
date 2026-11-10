import {
  VOICE_CHUNK_SAMPLES,
  VOICE_MAX_SAMPLES,
  VOICE_SAMPLE_RATE,
  makeError,
  type CaptureErrorReason,
  type DesktopCompanionTarget,
  type DesktopVoiceState,
  type KernelError,
  type OwnerRef,
  type Result,
  type VoiceTicket,
  type VoiceCaptureResult,
  type VoiceBeginSelection,
  type VoiceResultKey,
} from '@pet/contracts';
import { KernelFault } from '@pet/host-kernel';
import type { CompanionVoiceService, CompanionVoiceSession } from './companion-voice-service.js';
import type { VoiceCaptureHost, VoiceMicrophoneLease } from './shared-voice-capture-host.js';

type CaptureKey = DesktopCompanionTarget & { captureId: string };
const fail = <T>(code: KernelError['code']): Result<T> => ({
  ok: false,
  error: makeError(code, false),
});
const errorOf = (error: unknown) =>
  error instanceof KernelFault ? error.error : makeError('unavailable', false);
const deferred = () => {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
interface Capture {
  readonly key: CaptureKey;
  readonly selection: VoiceBeginSelection;
  readonly frame: object;
  readonly session: CompanionVoiceSession;
  readonly abort: AbortController;
  readonly released: ReturnType<typeof deferred>;
  readonly work: Set<Promise<unknown>>;
  microphone: VoiceMicrophoneLease | null;
  ticket: VoiceTicket | null;
  issued: boolean;
  deviceReleased: boolean;
  ready: boolean;
  tail: boolean;
  sequence: number;
  samples: number;
  audio: Uint8Array[];
  timer: ReturnType<typeof setTimeout> | null;
  off: () => void;
  begin: Promise<Result<VoiceTicket>> | null;
  finish: Promise<Result<VoiceCaptureResult>> | null;
  retiring: Promise<void> | null;
}

/** One console frame, one physical microphone and one captured service intent. */
export class SharedVoiceController {
  #capture: Capture | null = null;
  #state: DesktopVoiceState = {
    version: 1,
    revision: 0,
    connectionId: null,
    phase: 'idle',
    captureId: null,
    samples: 0,
    cleanup: 'settled',
    error: null,
  };
  readonly #offRetire: () => void;
  constructor(
    private readonly service: CompanionVoiceService,
    private readonly host: VoiceCaptureHost,
    private readonly frame: () => object | null,
    private readonly changed: () => void,
  ) {
    this.#offRetire = service.onVoiceRetiring((id) => {
      const capture = this.#capture;
      return capture?.key.connectionId === id ? this.#retire(capture) : Promise.resolve();
    });
  }
  getState(): Promise<Result<DesktopVoiceState>> {
    return Promise.resolve({ ok: true, value: { ...this.#state } });
  }
  #publish(patch: Partial<DesktopVoiceState>): void {
    this.#state = { ...this.#state, ...patch, revision: this.#state.revision + 1 };
    this.changed();
  }
  #record(key: CaptureKey, frame: object): Capture {
    const capture = this.#capture;
    if (
      !capture ||
      capture.frame !== frame ||
      this.frame() !== frame ||
      capture.key.connectionId !== key.connectionId ||
      capture.key.captureId !== key.captureId
    )
      throw new KernelFault('stale-owner');
    return capture;
  }
  async #current(capture: Capture): Promise<boolean> {
    if (
      this.#capture !== capture ||
      capture.abort.signal.aborted ||
      this.frame() !== capture.frame ||
      !capture.microphone ||
      !(await capture.microphone.isCurrent())
    )
      return false;
    const current = await capture.session.isCurrent();
    return (
      current &&
      capture.microphone.sourceValid() &&
      this.#capture === capture &&
      !capture.abort.signal.aborted &&
      this.frame() === capture.frame
    );
  }
  #track<T>(capture: Capture, work: Promise<T>): Promise<T> {
    capture.work.add(work);
    void work.finally(() => capture.work.delete(work)).catch(() => {});
    return work;
  }
  begin(
    input: DesktopCompanionTarget & VoiceBeginSelection,
    frame: object,
  ): Promise<Result<VoiceTicket>> {
    if (this.frame() !== frame) return Promise.resolve(fail('permission-denied'));
    const { connectionId, ...selection } = input;
    const key = { connectionId, captureId: selection.captureId };
    if (this.#capture) {
      const active = this.#capture;
      if (
        active.frame === frame &&
        active.key.connectionId === key.connectionId &&
        active.key.captureId === key.captureId &&
        !active.abort.signal.aborted &&
        active.begin &&
        active.selection.expectedFeatureRevision === selection.expectedFeatureRevision &&
        active.selection.providerRef === selection.providerRef &&
        active.selection.bindingId === selection.bindingId &&
        active.selection.finishMode === selection.finishMode
      )
        return active.begin;
      return Promise.resolve(fail('conflict'));
    }
    let session: CompanionVoiceSession;
    try {
      session = this.service.voiceSession(key);
    } catch (error) {
      return Promise.resolve({ ok: false, error: errorOf(error) });
    }
    const capture: Capture = {
      key,
      selection,
      frame,
      session,
      abort: new AbortController(),
      released: deferred(),
      work: new Set(),
      microphone: null,
      ticket: null,
      issued: false,
      deviceReleased: false,
      ready: false,
      tail: false,
      sequence: 0,
      samples: 0,
      audio: [],
      timer: null,
      off: () => {},
      begin: null,
      finish: null,
      retiring: null,
    };
    this.#capture = capture;
    this.#publish({
      connectionId: key.connectionId,
      captureId: key.captureId,
      phase: 'arming',
      samples: 0,
      cleanup: 'pending',
      error: null,
    });
    const begin = (async (): Promise<Result<VoiceTicket>> => {
      try {
        // Service CAS checks the exact selection shown by the renderer before any microphone task.
        const result = await capture.session.begin(selection, capture.abort.signal);
        if (!result.ok) throw new KernelFault(result.error.code);
        capture.ticket = result.value;
        if (capture.abort.signal.aborted || this.frame() !== frame || !(await session.isCurrent()))
          throw new KernelFault('stale-owner');
        capture.microphone = await this.host.acquire(
          capture.abort.signal,
          capture.released.promise,
        );
        const revoke = () => {
          if (!capture.deviceReleased) void this.#retire(capture);
        };
        const disconnected = () => {
          void this.#retire(capture);
        };
        capture.microphone.signal.addEventListener('abort', revoke, { once: true });
        capture.session.signal.addEventListener('abort', disconnected, { once: true });
        capture.off = () => {
          capture.microphone?.signal.removeEventListener('abort', revoke);
          capture.session.signal.removeEventListener('abort', disconnected);
        };
        if (!(await this.#current(capture)) || !capture.microphone.valid())
          throw new KernelFault('stale-owner');
        capture.issued = true;
        capture.timer = setTimeout(() => {
          void this.#retire(capture, makeError('timeout', false));
        }, 30_000);
        return result;
      } catch (error) {
        // No ticket reached the renderer, so no device request could have started.
        this.#deviceReleased(capture);
        void this.#retire(capture, errorOf(error));
        return { ok: false, error: errorOf(error) };
      }
    })();
    capture.begin = this.#track(capture, begin);
    return capture.begin;
  }
  microphoneAllowed(frame: object): boolean {
    const capture = this.#capture;
    return (
      !!capture &&
      capture.issued &&
      capture.frame === frame &&
      this.frame() === frame &&
      !capture.abort.signal.aborted &&
      !capture.session.signal.aborted &&
      !capture.deviceReleased &&
      capture.microphone?.valid() === true &&
      !capture.finish
    );
  }
  async captureReady(key: CaptureKey, frame: object, sampleRate: number): Promise<Result<null>> {
    try {
      const capture = this.#record(key, frame);
      if (!(await this.#current(capture)) || !this.microphoneAllowed(frame))
        return fail('stale-owner');
      if (sampleRate !== VOICE_SAMPLE_RATE || capture.ready) return fail('audio-format');
      capture.ready = true;
      if (capture.timer) clearTimeout(capture.timer);
      capture.timer = setTimeout(() => {
        void this.#retire(capture, makeError('timeout', false));
      }, 22_000);
      this.#publish({ phase: 'recording' });
      return { ok: true, value: null };
    } catch (error) {
      return { ok: false, error: errorOf(error) };
    }
  }
  async pushAudio(
    key: CaptureKey,
    frame: object,
    sequence: number,
    bytes: Uint8Array,
  ): Promise<Result<null>> {
    try {
      const capture = this.#record(key, frame);
      if (!(await this.#current(capture)) || !this.microphoneAllowed(frame) || !capture.ready)
        return fail('stale-owner');
      if (
        !Number.isSafeInteger(sequence) ||
        sequence !== capture.sequence ||
        capture.tail ||
        !(bytes instanceof Uint8Array) ||
        !(bytes.buffer instanceof ArrayBuffer) ||
        bytes.byteLength < 4 ||
        bytes.byteLength > VOICE_CHUNK_SAMPLES * 4 ||
        bytes.byteLength % 4 ||
        capture.samples + bytes.byteLength / 4 >
          Math.min(capture.ticket?.maxSamples ?? 0, VOICE_MAX_SAMPLES)
      )
        return fail('invalid-input');
      const owned = Uint8Array.from(bytes);
      const view = new DataView(owned.buffer);
      for (let i = 0; i < owned.byteLength; i += 4) {
        const value = view.getFloat32(i, true);
        if (!Number.isFinite(value) || Math.abs(value) > 1) return fail('audio-format');
      }
      capture.audio.push(owned);
      capture.samples += owned.byteLength / 4;
      capture.sequence++;
      capture.tail = owned.byteLength < VOICE_CHUNK_SAMPLES * 4;
      this.#publish({ samples: capture.samples });
      return { ok: true, value: null };
    } catch (error) {
      return { ok: false, error: errorOf(error) };
    }
  }
  #deviceReleased(capture: Capture): void {
    capture.deviceReleased = true;
    if (capture.timer) clearTimeout(capture.timer);
    capture.timer = null;
    capture.released.resolve();
  }
  async reportCaptureReleased(key: CaptureKey, frame: object): Promise<Result<null>> {
    try {
      // The exact old record/frame is sufficient for cleanup. No source/token/service lookup here.
      const capture = this.#record(key, frame);
      this.#deviceReleased(capture);
      await capture.microphone?.settled;
      if (this.#capture === capture && !capture.abort.signal.aborted)
        this.#publish({ phase: 'finishing', cleanup: 'settled' });
      return { ok: true, value: null };
    } catch (error) {
      return { ok: false, error: errorOf(error) };
    }
  }
  finishCapture(
    key: CaptureKey,
    frame: object,
    frames: number,
  ): Promise<Result<VoiceCaptureResult>> {
    let capture: Capture;
    try {
      capture = this.#record(key, frame);
    } catch (error) {
      return Promise.resolve({ ok: false, error: errorOf(error) });
    }
    if (capture.finish) return capture.finish;
    if (
      !capture.ready ||
      !capture.deviceReleased ||
      !Number.isSafeInteger(frames) ||
      frames !== capture.sequence
    )
      return Promise.resolve(fail('invalid-input'));
    const finish = (async (): Promise<Result<VoiceCaptureResult>> => {
      try {
        await capture.microphone?.settled;
        if (!(await this.#current(capture)) || !capture.ticket) return fail('stale-owner');
        const clip = new Uint8Array(capture.samples * 4);
        let offset = 0;
        for (const chunk of capture.audio) {
          clip.set(chunk, offset);
          offset += chunk.byteLength;
        }
        capture.audio = [];
        this.#publish({ phase: 'transcribing', cleanup: 'settled' });
        const result = await capture.session.upload(
          capture.ticket,
          capture.samples,
          clip,
          capture.abort.signal,
        );
        if (!(await this.#current(capture))) return fail('stale-owner');
        if (!result.ok) {
          this.#publish({ phase: 'error', error: result.error });
          return result;
        }
        if (
          result.value.cleanup === 'settled' &&
          !['awaiting-audio', 'transcribing', 'retiring'].includes(result.value.phase)
        )
          this.#clear(capture);
        return result;
      } catch (error) {
        return { ok: false, error: errorOf(error) };
      } finally {
        capture.audio = [];
      }
    })();
    capture.finish = this.#track(capture, finish);
    return capture.finish;
  }
  async readCaptureResult(
    input: DesktopCompanionTarget & VoiceResultKey,
    frame: object,
  ): Promise<Result<VoiceCaptureResult>> {
    try {
      const session = this.service.voiceSession(input);
      const capture = this.#capture;
      if (
        capture &&
        (capture.key.connectionId !== input.connectionId ||
          capture.key.captureId !== input.captureId ||
          capture.frame !== frame ||
          this.frame() !== frame ||
          capture.abort.signal.aborted)
      )
        return fail('stale-owner');
      const result = await (capture
        ? this.#track(capture, session.result(input, capture.abort.signal))
        : session.result(input));
      if (capture && !(await this.#current(capture))) return fail('stale-owner');
      if (
        result.ok &&
        capture &&
        capture.frame === frame &&
        this.frame() === frame &&
        capture.key.connectionId === input.connectionId &&
        capture.key.captureId === input.captureId &&
        !capture.abort.signal.aborted &&
        capture.deviceReleased &&
        result.value.cleanup === 'settled' &&
        !['awaiting-audio', 'transcribing', 'retiring'].includes(result.value.phase) &&
        (await this.#current(capture))
      )
        this.#clear(capture);
      return result;
    } catch (error) {
      return { ok: false, error: errorOf(error) };
    }
  }
  async cancelCapture(
    key: CaptureKey,
    frame: object,
    reason?: CaptureErrorReason,
  ): Promise<Result<DesktopVoiceState>> {
    try {
      const capture = this.#record(key, frame);
      const error = reason
        ? makeError(
            reason === 'denied'
              ? 'permission-denied'
              : reason === 'format'
                ? 'audio-format'
                : 'unavailable',
            false,
          )
        : undefined;
      // Return the honest pending projection; awaiting physical release here would deadlock its caller.
      void this.#retire(capture, error);
      return this.getState();
    } catch (error) {
      return { ok: false, error: errorOf(error) };
    }
  }
  #clear(capture: Capture, error: KernelError | null = null): void {
    capture.off();
    capture.audio = [];
    if (capture.timer) clearTimeout(capture.timer);
    if (this.#capture !== capture) return;
    this.#capture = null;
    this.#publish({
      phase: error ? 'error' : 'idle',
      captureId: null,
      connectionId: null,
      samples: 0,
      cleanup: 'settled',
      error,
    });
  }
  #retire(capture: Capture, error: KernelError | null = null): Promise<void> {
    if (capture.retiring) return capture.retiring;
    capture.off();
    capture.abort.abort();
    capture.audio = [];
    if (capture.timer) clearTimeout(capture.timer);
    if (!capture.issued) this.#deviceReleased(capture);
    if (this.#capture === capture) this.#publish({ phase: 'retiring', cleanup: 'pending', error });
    const retiring = (async () => {
      // A fenced connection never borrows a token merely to cancel its old ticket.
      const cancel =
        capture.ticket && !capture.session.signal.aborted
          ? capture.session.cancel(capture.ticket)
          : Promise.resolve();
      await Promise.all([capture.released.promise, cancel, ...capture.work]);
      await capture.microphone?.settled;
      this.#clear(capture, error);
    })();
    capture.retiring = retiring;
    return retiring;
  }
  ownerHidden(): void {
    if (this.#capture) void this.#retire(this.#capture);
  }
  ownerGone(frame: object): void {
    const capture = this.#capture;
    if (capture?.frame !== frame) return;
    this.#deviceReleased(capture);
    void this.#retire(capture);
  }
  async retireSource(owner: OwnerRef): Promise<void> {
    const capture = this.#capture;
    const source = capture?.microphone?.owner;
    if (
      capture &&
      (!source ||
        (source.pluginId === owner.pluginId &&
          source.instanceId === owner.instanceId &&
          source.generation === owner.generation))
    )
      await this.#retire(capture);
  }
  async close(): Promise<void> {
    this.#offRetire();
    if (this.#capture) await this.#retire(this.#capture);
  }
}
