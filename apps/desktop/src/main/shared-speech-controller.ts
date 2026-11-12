import { randomUUID } from 'node:crypto';
import {
  DESKTOP_SPEECH_MAX_QUEUE,
  DESKTOP_SPEECH_IPC_MAX_CHUNK_BYTES,
  DESKTOP_SPEECH_MAX_STATE_BYTES,
  SPEECH_CONSUMER_STALL_TIMEOUT_MS,
  SPEECH_FORMAT,
  SPEECH_SEGMENT_MAX_FRAMES,
  SPEECH_SEGMENT_TIMEOUT_MS,
  SPEECH_STATUS_TIMEOUT_MS,
  SPEECH_TAIL_GRACE_MS,
  isSpeechVerifiedTerminal,
  matchesDesktopSpeechAudioHeader,
  makeError,
  type DesktopCompanionTarget,
  type DesktopSpeechState,
  type DesktopSpeechAudioEvent,
  type DesktopSpeechPlaybackIdentity,
  type DesktopSpeechReady,
  type DesktopSpeechConsume,
  type DesktopSpeechPlayback,
  type DesktopSpeechReleased,
  type KernelError,
  type OwnerRef,
  type Result,
  type SpeechBegin,
  type SpeechView,
  type SpeechUtteranceReceipt,
  type SpeechSegmentKey,
  type SpeechRemoteBinding,
} from '@pet/contracts';
import { KernelFault } from '@pet/host-kernel';
import type {
  CompanionSpeechService,
  CompanionSpeechSession,
  SpeechBaseline,
  SpeechConnectionEvent,
} from './companion-speech-service.js';
import type {
  SpeechPlaybackHost,
  SpeechPlaybackLease,
  SpeechPlaybackSource,
} from './shared-speech-host.js';

const errorOf = (error: unknown): KernelError =>
  error instanceof KernelFault ? error.error : makeError('unavailable', false);
const fail = (code: KernelError['code']): Result<never> => ({
  ok: false,
  error: makeError(code, false),
});
const unwrap = <T>(result: Result<T>): T => {
  if (!result.ok) throw new KernelFault(result.error.code);
  return result.value;
};
function gate() {
  let resolve = () => {},
    reject = (_error: unknown) => {};
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  void promise.catch(() => {});
  return { promise, resolve, reject };
}
const sameOwner = (a: OwnerRef, b: OwnerRef): boolean =>
  a.pluginId === b.pluginId && a.instanceId === b.instanceId && a.generation === b.generation;
const selection = (view: SpeechView): string => {
  const provider = view.providers.find((item) => item.providerRef === view.feature.providerRef);
  return JSON.stringify([
    view.feature,
    provider && [
      provider.providerRef,
      provider.bindingId,
      provider.configRevision,
      provider.credential.version,
      provider.source,
      provider.readiness,
    ],
  ]);
};
interface BindingRefresh {
  readonly connectionId: string;
  readonly generation: number;
  work: Promise<void>;
}
interface Intent {
  readonly session: CompanionSpeechSession;
  readonly begin: Omit<SpeechBegin, 'volume'>;
  readonly binding: SpeechRemoteBinding;
}
interface Segment {
  readonly identity: DesktopSpeechPlaybackIdentity;
  readonly frame: object;
  readonly lease: SpeechPlaybackLease;
  readonly completion: ReturnType<typeof gate>;
  readonly ready: ReturnType<typeof gate>;
  readonly released: ReturnType<typeof gate>;
  consumed: ReturnType<typeof gate> | null;
  chunkSequence: number;
  chunkBytes: number;
  sequence: number;
  endSequence: number | null;
  sentFrames: number;
  endedFrames: number;
  receivedFrames: number;
  releaseSequences: Set<number>;
  issued: boolean;
  stopped: boolean;
  ended: boolean;
  cleanup: 'pending' | 'settled' | 'failed';
  timer: ReturnType<typeof setTimeout> | null;
  timeout: () => void;
}
interface Whole {
  readonly intent: Intent;
  readonly abort: AbortController;
  segment: Segment | null;
  receipt: SpeechUtteranceReceipt | null;
  issued: boolean;
  done: Promise<void>;
  cancel: Promise<void> | null;
  error: KernelError | null;
  outcome: DesktopSpeechState['outcome'];
  remoteCleanup: DesktopSpeechState['remoteCleanup'];
}
export function initialDesktopSpeechState(): DesktopSpeechState {
  return {
    version: 1,
    revision: 0,
    connectionId: null,
    appliedBinding: null,
    source: 'disabled',
    phase: 'idle',
    generating: false,
    playing: false,
    queued: 0,
    current: null,
    messageId: null,
    segmentCount: 0,
    completedSegments: 0,
    receivedFrames: 0,
    endedFrames: 0,
    outcome: 'pending',
    localCleanup: 'settled',
    remoteCleanup: 'settled',
    error: null,
    reason: null,
  };
}
/** One logical FIFO; each head owns one stream and one exact Pet frame at a time. */
export class SharedSpeechController {
  #state = initialDesktopSpeechState();
  #source: SpeechPlaybackSource | null = null;
  #sourceOff = () => {};
  #baseline: SpeechBaseline | null = null;
  #session: CompanionSpeechSession | null = null;
  #view: SpeechView | null = null;
  #queue: Intent[] = [];
  #whole: Whole | null = null;
  #arming = 0;
  #armingConnection: string | null = null;
  #armingObserved = 0;
  #refreshing: BindingRefresh | null = null;
  #pendingRefresh: { readonly connectionId: string; readonly generation: number } | null = null;
  #recovering: Promise<void> | null = null;
  #observationAbort = new AbortController();
  readonly #observations = new Set<Promise<void>>();
  #closed = false;
  #cleanupFailed = false;
  readonly #offEvent: () => void;
  readonly #offRetire: () => void;
  constructor(
    private readonly service: CompanionSpeechService,
    private readonly host: SpeechPlaybackHost,
    private readonly frame: () => object | null,
    private readonly changed: () => void,
    private readonly audio: (
      frame: object,
      event: DesktopSpeechAudioEvent,
      payload?: Uint8Array,
    ) => void,
    private readonly volume: () => Promise<number>,
  ) {
    this.#offEvent = service.onSpeechEvent((event) => this.#event(event));
    this.#offRetire = service.onSpeechRetiring(async (id) => {
      if (
        this.#baseline?.connectionId === id ||
        this.#whole?.intent.session.connectionId === id ||
        this.#armingConnection === id
      ) {
        this.#fence(makeError('stale-owner', false));
        await this.#join();
      }
    });
  }
  #appliedBinding(): SpeechRemoteBinding | null {
    if (
      !this.#source ||
      this.#closed ||
      this.#source.signal.aborted ||
      this.#armingConnection ||
      !this.#baseline ||
      !this.#session ||
      this.#session.signal.aborted ||
      this.#baseline.connectionId !== this.#session.connectionId ||
      this.#view?.feature.source !== 'ready'
    )
      return null;
    const provider = this.#view.providers.find(
      (item) => item.providerRef === this.#view?.feature.providerRef,
    );
    return provider?.source === 'ready' && provider.readiness === 'configured' && provider.bindingId
      ? { providerRef: provider.providerRef, bindingId: provider.bindingId }
      : null;
  }
  getState(): Promise<Result<DesktopSpeechState>> {
    return Promise.resolve({
      ok: true,
      value: structuredClone({ ...this.#state, appliedBinding: this.#appliedBinding() }),
    });
  }
  #publish(patch: Partial<DesktopSpeechState>): void {
    const state = {
      ...this.#state,
      ...patch,
      appliedBinding: this.#appliedBinding(),
      revision: this.#state.revision + 1,
    };
    if (
      Buffer.byteLength(JSON.stringify({ ok: true, value: state })) > DESKTOP_SPEECH_MAX_STATE_BYTES
    )
      throw new KernelFault('quota-exceeded');
    this.#state = state;
    this.changed();
  }
  async refreshSource(): Promise<void> {
    if (this.#closed) return;
    const source = await this.host.readSource();
    if (this.#closed) return;
    if (!source.ok) {
      this.#sourceOff();
      this.#source = null;
      this.#fence(source.error);
      this.#publish({
        source: source.error.code === 'not-ready' ? 'disabled' : 'unavailable',
        reason: 'feature-disabled',
      });
      await this.#join();
      return;
    }
    if (this.#source && sameOwner(this.#source.owner, source.value.owner)) return;
    this.#fence(makeError('stale-owner', false));
    await this.#join();
    if (this.#closed || source.value.signal.aborted || this.#cleanupFailed) return;
    this.#sourceOff();
    this.#source = source.value;
    const revoked = () => {
      this.#source = null;
      this.#fence(makeError('stale-owner', false));
      this.#publish({ source: 'disabled' });
    };
    source.value.signal.addEventListener('abort', revoked, { once: true });
    this.#sourceOff = () => source.value.signal.removeEventListener('abort', revoked);
    this.#publish({ source: 'ready' });
    const state = await this.service.getState();
    if (state.ok && state.value.connectionId && state.value.phase === 'live')
      await this.#arm(state.value.connectionId);
  }
  #event(event: SpeechConnectionEvent): void {
    if (this.#closed) return;
    if (event.kind === 'fence') {
      if (
        event.connectionId === this.#baseline?.connectionId ||
        event.connectionId === this.#whole?.intent.session.connectionId ||
        event.connectionId === this.#armingConnection
      )
        this.#fence(event.error);
      return;
    }
    if (event.kind === 'invalid') {
      const connectionId =
        this.#baseline?.connectionId ??
        this.#whole?.intent.session.connectionId ??
        this.#armingConnection;
      if (this.#source && connectionId === event.connectionId) this.#recover(event.connectionId);
      return;
    }
    if (event.kind === 'live') {
      if (this.#source) void this.#arm(event.connectionId);
      return;
    }
    if (event.kind === 'refresh') {
      if (this.#source) void this.#refreshBinding(event.connectionId);
      return;
    }
    if (event.baseline.connectionId === this.#armingConnection)
      this.#armingObserved = Math.max(this.#armingObserved, event.event.sequence);
    const baseline = this.#baseline;
    if (
      !this.#source ||
      !baseline ||
      !this.#session ||
      !this.#view ||
      baseline.connectionId !== event.baseline.connectionId ||
      baseline.serviceEpoch !== event.event.epoch ||
      baseline.agentId !== event.baseline.agentId ||
      event.event.sequence <= baseline.cursor
    )
      return;
    if (event.event.sequence !== baseline.cursor + 1) {
      this.#recover(baseline.connectionId);
      return;
    }
    this.#baseline = { ...baseline, cursor: event.event.sequence };
    const data = event.event.data;
    if (
      event.event.kind !== 'message' ||
      data['role'] !== 'assistant' ||
      typeof data['messageId'] !== 'string'
    )
      return;
    const provider = this.#view.providers.find(
      (p) => p.providerRef === this.#view?.feature.providerRef,
    );
    if (
      this.#view.feature.source !== 'ready' ||
      !provider ||
      provider.source !== 'ready' ||
      provider.readiness !== 'configured' ||
      !provider.bindingId
    ) {
      this.#publish({
        messageId: data['messageId'],
        error: makeError('not-ready', false),
        reason: 'source-unavailable',
      });
      return;
    }
    if (this.#queue.length + (this.#whole ? 1 : 0) >= DESKTOP_SPEECH_MAX_QUEUE) {
      this.#publish({
        messageId: data['messageId'],
        error: makeError('quota-exceeded', false),
        reason: 'quota-exceeded',
      });
      return;
    }
    const binding = { providerRef: provider.providerRef, bindingId: provider.bindingId };
    this.#queue.push({
      session: this.#session,
      binding,
      begin: {
        utteranceId: randomUUID(),
        clientId: baseline.clientId,
        agentId: baseline.agentId,
        serviceEpoch: baseline.serviceEpoch,
        messageId: data['messageId'],
        eventSequence: event.event.sequence,
        expectedFeatureRevision: this.#view.feature.configRevision,
        ...binding,
      },
    });
    this.#publish({ queued: this.#queue.length });
    this.#pump();
  }
  #recover(connectionId: string): void {
    if (this.#recovering) return;
    this.#fence(makeError('unavailable', false), 'failed');
    const work = (async () => {
      await this.#join();
      if (this.#source && !this.#closed) await this.#arm(connectionId);
    })();
    this.#recovering = work;
    void work
      .finally(() => {
        if (this.#recovering === work) this.#recovering = null;
      })
      .catch(() => {});
  }
  #arm(connectionId: string): Promise<void> {
    const work = this.#armConnection(connectionId);
    this.#observations.add(work);
    void work.finally(() => this.#observations.delete(work)).catch(() => {});
    return work;
  }
  async #armConnection(connectionId: string): Promise<void> {
    if (!this.#source || this.#closed || this.#cleanupFailed) return;
    if (this.#whole) {
      const previous = this.#whole;
      this.#fence(makeError('stale-owner', false));
      await previous.done;
      if (this.#source && !this.#closed) await this.#arm(connectionId);
      return;
    }
    const issued = ++this.#arming;
    this.#pendingRefresh = null;
    this.#observationAbort.abort();
    this.#observationAbort = new AbortController();
    const signal = AbortSignal.any([this.#observationAbort.signal, this.#source.signal]);
    this.#baseline = null;
    this.#session = null;
    this.#armingConnection = connectionId;
    this.#armingObserved = 0;
    this.#publish({
      ...(this.#state.connectionId !== connectionId
        ? { ...initialDesktopSpeechState(), source: this.#state.source }
        : {}),
      connectionId,
      phase: 'baselining',
    });
    try {
      if (issued !== this.#arming || !this.#source || this.#closed) return;
      const session = this.service.speechSession({ connectionId });
      this.#session = session;
      const [baseline, view] = await Promise.all([
        session.baseline(signal),
        session.readSpeech(signal),
      ]);
      if (issued !== this.#arming || !this.#source || this.#closed || !(await session.isCurrent()))
        return;
      if (issued !== this.#arming || signal.aborted || !this.#source || this.#closed) return;
      this.#session = session;
      this.#view = unwrap(view);
      this.#baseline = {
        ...unwrap(baseline),
        cursor: Math.max(unwrap(baseline).cursor, this.#armingObserved),
      };
      this.#armingConnection = null;
      this.#publish(
        this.#state.outcome === 'pending'
          ? { connectionId, phase: 'idle', error: null, reason: null }
          : { connectionId, phase: 'terminal' },
      );
    } catch (error) {
      if (issued === this.#arming) {
        this.#armingConnection = null;
        this.#baseline = null;
        this.#publish({ error: errorOf(error), reason: 'source-unavailable' });
      }
    } finally {
      if (issued === this.#arming) this.#flushRefresh();
    }
  }
  #flushRefresh(): void {
    const pending = this.#pendingRefresh;
    if (!pending) return;
    if (!this.#source || this.#closed || pending.generation !== this.#arming) {
      this.#pendingRefresh = null;
      return;
    }
    if (this.#armingConnection) return;
    this.#pendingRefresh = null;
    void this.#refreshBinding(pending.connectionId);
  }
  #refreshBinding(connectionId: string): Promise<void> {
    const target =
      this.#armingConnection ??
      this.#baseline?.connectionId ??
      this.#session?.connectionId ??
      this.#whole?.intent.session.connectionId;
    if (!this.#source || this.#closed) return Promise.resolve();
    if (!target) {
      // Bootstrap may fail before capturing a session; confirm the live service target before arming.
      try {
        const current = this.service.speechSession({ connectionId });
        if (current.connectionId !== connectionId || current.signal.aborted)
          return Promise.resolve();
      } catch {
        return Promise.resolve();
      }
      return this.#arm(connectionId);
    }
    if (target !== connectionId) return Promise.resolve();
    const generation = this.#arming;
    const active = this.#refreshing;
    if (this.#armingConnection) {
      this.#pendingRefresh = { connectionId, generation };
      return Promise.resolve();
    }
    if (active?.connectionId === connectionId && active.generation === generation) {
      this.#pendingRefresh = { connectionId, generation };
      return active.work;
    }
    if (!this.#baseline || !this.#session) return this.#arm(connectionId);
    this.#pendingRefresh = null;
    const session = this.#session;
    const signal = this.#observationAbort.signal;
    const refresh: BindingRefresh = { connectionId, generation, work: Promise.resolve() };
    this.#refreshing = refresh;
    const work = (async () => {
      const result = await session.readSpeech(signal);
      if (
        signal.aborted ||
        generation !== this.#arming ||
        this.#session !== session ||
        !this.#source
      )
        return;
      if (!result.ok || !this.#view || selection(result.value) !== selection(this.#view)) {
        this.#fence(result.ok ? makeError('stale-owner', false) : result.error);
        await this.#whole?.done;
        await this.#arm(connectionId);
      }
    })();
    refresh.work = work;
    this.#observations.add(work);
    void work
      .finally(() => {
        this.#observations.delete(work);
        if (this.#refreshing === refresh) {
          this.#refreshing = null;
          this.#flushRefresh();
        }
      })
      .catch(() => {});
    return work;
  }
  #pump(): void {
    if (this.#whole || !this.#source || this.#closed || this.#cleanupFailed) return;
    const intent = this.#queue.shift();
    if (!intent) return;
    const whole: Whole = {
      intent,
      abort: new AbortController(),
      segment: null,
      receipt: null,
      issued: false,
      done: Promise.resolve(),
      cancel: null,
      error: null,
      outcome: 'pending',
      remoteCleanup: 'settled',
    };
    this.#whole = whole;
    this.#publish({
      connectionId: intent.session.connectionId,
      queued: this.#queue.length,
      phase: 'preparing',
      messageId: intent.begin.messageId,
      segmentCount: 0,
      completedSegments: 0,
      receivedFrames: 0,
      endedFrames: 0,
      outcome: 'pending',
      error: null,
      reason: null,
    });
    whole.done = this.#run(whole);
    void whole.done
      .finally(() => {
        if (this.#whole === whole) this.#whole = null;
        this.#pump();
      })
      .catch(() => {});
  }
  #active(whole: Whole): boolean {
    return this.#whole === whole && !whole.abort.signal.aborted && !!this.#source && !this.#closed;
  }
  async #run(whole: Whole): Promise<void> {
    try {
      // Master sound and actual profile volume are checked before service admission.
      const volume = await this.volume();
      if (!Number.isInteger(volume) || volume < 0 || volume > 100)
        throw new KernelFault('invalid-input');
      if (!this.#active(whole)) throw new KernelFault('stale-owner');
      if (!(await whole.intent.session.isCurrent())) {
        this.#fence(makeError('stale-owner', false));
        throw new KernelFault('stale-owner');
      }
      whole.issued = true;
      whole.remoteCleanup = 'pending';
      whole.receipt = unwrap(
        await whole.intent.session.begin({ ...whole.intent.begin, volume }, whole.abort.signal),
      );
      const receipt = whole.receipt;
      if (!this.#active(whole)) throw new KernelFault('stale-owner');
      this.#publish({ segmentCount: receipt.segmentCount, remoteCleanup: 'pending' });
      for (let index = 0; index < receipt.segmentCount; index++) {
        if (!this.#active(whole)) throw new KernelFault('cancelled');
        const key: SpeechSegmentKey = {
          utteranceId: receipt.utteranceId,
          clientId: receipt.clientId,
          agentId: receipt.agentId,
          serviceEpoch: receipt.serviceEpoch,
          utteranceBindingId: receipt.utteranceBindingId,
          segmentIndex: index,
          requestId: `${receipt.utteranceId}.${index}`,
        };
        unwrap(await whole.intent.session.reserve(key, whole.abort.signal));
        await this.#segment(whole, key, volume);
        if (!this.#active(whole)) throw new KernelFault('cancelled');
        this.#publish({ completedSegments: index + 1 });
      }
      whole.outcome = 'completed';
    } catch (error) {
      if (!whole.error) whole.error = errorOf(error);
      if (whole.outcome === 'pending')
        whole.outcome =
          whole.error.code === 'cancelled' || whole.error.code === 'stale-owner'
            ? 'cancelled'
            : 'failed';
      this.#failWhole(whole, whole.error, whole.outcome);
      await this.#cancel(whole);
    } finally {
      if (this.#whole === whole)
        this.#publish({
          phase: 'terminal',
          generating: false,
          playing: false,
          current: null,
          queued: this.#queue.length,
          outcome: whole.outcome,
          remoteCleanup: whole.remoteCleanup,
          error: whole.error,
          reason:
            whole.remoteCleanup === 'unknown'
              ? 'remote-unknown'
              : whole.outcome === 'completed'
                ? null
                : this.#state.endedFrames || this.#state.completedSegments
                  ? 'partial-output'
                  : null,
        });
    }
  }
  async #segment(whole: Whole, key: SpeechSegmentKey, volume: number): Promise<void> {
    const frame = this.frame();
    if (!frame) throw new KernelFault('not-ready');
    const completion = gate();
    const lease = await this.host.acquire(whole.abort.signal, completion.promise);
    const segment: Segment = {
      identity: {
        ...key,
        connectionId: whole.intent.session.connectionId,
        playbackId: randomUUID(),
        localOwner: lease.owner,
        localTaskId: lease.taskId,
        localStreamId: lease.streamId,
        remoteBinding: whole.intent.binding,
      },
      frame,
      lease,
      completion,
      ready: gate(),
      released: gate(),
      consumed: null,
      chunkSequence: 0,
      chunkBytes: 0,
      sequence: 0,
      endSequence: null,
      sentFrames: 0,
      endedFrames: 0,
      receivedFrames: 0,
      releaseSequences: new Set(),
      issued: false,
      stopped: false,
      ended: false,
      cleanup: 'pending',
      timer: null,
      timeout: () => {},
    };
    whole.segment = segment;
    const revoke = () => {
      if (!whole.abort.signal.aborted) this.#fence(makeError('stale-owner', false));
    };
    lease.signal.addEventListener('abort', revoke, { once: true });
    whole.intent.session.signal.addEventListener('abort', revoke, { once: true });
    const absolute = setTimeout(
      () => this.#failWhole(whole, makeError('timeout', false), 'failed'),
      SPEECH_SEGMENT_TIMEOUT_MS,
    );
    try {
      if (!this.#active(whole) || frame !== this.frame() || !(await lease.isCurrent())) {
        if (this.#active(whole)) this.#fence(makeError('stale-owner', false));
        throw new KernelFault('stale-owner');
      }
      segment.issued = true;
      this.#publish({
        phase: 'preparing',
        current: segment.identity,
        localCleanup: 'pending',
        receivedFrames: 0,
        endedFrames: 0,
      });
      this.audio(frame, {
        ...segment.identity,
        sequence: 0,
        kind: 'start',
        format: SPEECH_FORMAT,
        volume,
      });
      await this.#wait(whole, segment, segment.ready, SPEECH_CONSUMER_STALL_TIMEOUT_MS);
      if (
        !this.#active(whole) ||
        !(await lease.isCurrent()) ||
        !(await whole.intent.session.isCurrent())
      ) {
        if (this.#active(whole)) this.#fence(makeError('stale-owner', false));
        throw new KernelFault('cancelled');
      }
      this.#publish({ phase: 'streaming', generating: true });
      const delivery = (async () => {
        for await (const bytes of lease.reader) {
          for (
            let offset = 0;
            offset < bytes.byteLength;
            offset += DESKTOP_SPEECH_IPC_MAX_CHUNK_BYTES
          ) {
            if (
              !this.#active(whole) ||
              frame !== this.frame() ||
              lease.signal.aborted ||
              !(await lease.isCurrent())
            ) {
              if (this.#active(whole)) this.#fence(makeError('stale-owner', false));
              throw new KernelFault('cancelled');
            }
            if (!this.#active(whole) || frame !== this.frame() || lease.signal.aborted)
              throw new KernelFault('stale-owner');
            const chunk = bytes.slice(offset, offset + DESKTOP_SPEECH_IPC_MAX_CHUNK_BYTES);
            segment.sequence++;
            segment.chunkSequence = segment.sequence;
            segment.chunkBytes = chunk.byteLength;
            segment.sentFrames += chunk.byteLength / 2;
            segment.consumed = gate();
            this.audio(
              frame,
              {
                ...segment.identity,
                sequence: segment.sequence,
                kind: 'chunk',
                byteLength: chunk.byteLength,
              },
              chunk,
            );
            await this.#wait(whole, segment, segment.consumed, SPEECH_CONSUMER_STALL_TIMEOUT_MS);
            segment.consumed = null;
          }
        }
      })();
      const transport = whole.intent.session.consumeAudio(
        key,
        whole.intent.binding,
        whole.abort.signal,
        async (header, pcm, signal) => {
          try {
            if (!matchesDesktopSpeechAudioHeader(segment.identity, header))
              throw new KernelFault('invalid-input');
            for await (const bytes of pcm) {
              if (
                signal.aborted ||
                !this.#active(whole) ||
                bytes.byteLength === 0 ||
                bytes.byteLength % 2
              )
                throw new KernelFault('invalid-input');
              segment.receivedFrames += bytes.byteLength / 2;
              if (segment.receivedFrames > SPEECH_SEGMENT_MAX_FRAMES)
                throw new KernelFault('quota-exceeded');
              this.#publish({ receivedFrames: segment.receivedFrames });
              // Media kernel bounds resident bytes independently of cumulative stream length.
              for (
                let offset = 0;
                offset < bytes.byteLength;
                offset += DESKTOP_SPEECH_IPC_MAX_CHUNK_BYTES
              )
                unwrap(
                  await lease.writer.write(
                    bytes.slice(offset, offset + DESKTOP_SPEECH_IPC_MAX_CHUNK_BYTES),
                  ),
                );
            }
            unwrap(await lease.writer.end());
          } catch (error) {
            this.#failWhole(whole, errorOf(error), 'failed');
            throw error;
          }
        },
      );
      // A failed side synchronously aborts the other, then both actual operations are joined.
      const guardedDelivery = delivery.catch((error: unknown) => {
        this.#failWhole(whole, errorOf(error), 'failed');
        throw error;
      });
      const guardedTransport = transport
        .then((result) => {
          if (!result.ok) {
            this.#failWhole(whole, result.error, 'failed');
            throw new KernelFault(result.error.code);
          }
        })
        .catch((error: unknown) => {
          this.#failWhole(whole, errorOf(error), 'failed');
          throw error;
        });
      const joined = await Promise.allSettled([guardedDelivery, guardedTransport]);
      const rejected = joined.find((result) => result.status === 'rejected');
      if (rejected?.status === 'rejected') throw rejected.reason;
      if (!this.#active(whole)) throw new KernelFault('cancelled');
      const statusSignal = AbortSignal.any([
        whole.abort.signal,
        AbortSignal.timeout(SPEECH_STATUS_TIMEOUT_MS),
      ]);
      const status = unwrap(await whole.intent.session.status(whole.intent.begin, statusSignal));
      whole.remoteCleanup = status.cleanup;
      const terminal = status.currentSegment?.terminal;
      if (
        !terminal ||
        !isSpeechVerifiedTerminal(terminal) ||
        terminal.producedFrames !== segment.receivedFrames ||
        terminal.producedFrames !== segment.sentFrames ||
        status.currentSegment?.requestId !== key.requestId
      )
        throw new KernelFault('unavailable');
      segment.endSequence = ++segment.sequence;
      segment.releaseSequences.add(segment.sequence);
      this.#publish({ generating: false });
      this.audio(frame, { ...segment.identity, sequence: segment.sequence, kind: 'end', terminal });
      const tail =
        ((segment.sentFrames - segment.endedFrames) / SPEECH_FORMAT.sampleRate) * 1000 +
        SPEECH_TAIL_GRACE_MS;
      await this.#wait(whole, segment, segment.released, tail);
      if (!segment.ended || segment.cleanup !== 'settled') throw new KernelFault('unavailable');
    } catch (error) {
      this.#failWhole(
        whole,
        errorOf(error),
        whole.outcome === 'pending' ? 'failed' : whole.outcome,
      );
      throw error;
    } finally {
      clearTimeout(absolute);
      lease.signal.removeEventListener('abort', revoke);
      whole.intent.session.signal.removeEventListener('abort', revoke);
      if (segment.timer) clearTimeout(segment.timer);
      if (!segment.issued) {
        segment.cleanup = 'settled';
        segment.released.resolve();
      } else if (segment.cleanup === 'pending') this.#stopSegment(segment);
      await segment.released.promise;
      lease.cancelMedia();
      completion.resolve();
      await lease.settled;
      if (segment.cleanup !== 'settled') this.#cleanupFailed = true;
      if (whole.segment === segment) whole.segment = null;
      this.#publish({ current: null, localCleanup: segment.cleanup, playing: false });
    }
  }
  #wait(
    whole: Whole,
    segment: Segment,
    pending: ReturnType<typeof gate>,
    ms: number,
  ): Promise<void> {
    if (segment.timer) clearTimeout(segment.timer);
    const timedOut = gate();
    segment.timeout = () => {
      this.#failWhole(whole, makeError('timeout', false), 'failed');
      timedOut.reject(new KernelFault('timeout'));
    };
    segment.timer = setTimeout(segment.timeout, ms);
    return Promise.race([pending.promise, timedOut.promise]).finally(() => {
      if (segment.timer) clearTimeout(segment.timer);
      segment.timer = null;
    });
  }
  #stopSegment(segment: Segment): void {
    if (segment.stopped) return;
    segment.stopped = true;
    segment.ready.reject(new KernelFault('cancelled'));
    segment.consumed?.reject(new KernelFault('cancelled'));
    segment.lease.cancelMedia();
    if (!segment.issued) {
      segment.cleanup = 'settled';
      segment.released.resolve();
      return;
    }
    segment.releaseSequences.add(segment.sequence);
    const sequence = ++segment.sequence;
    segment.releaseSequences.add(sequence);
    this.audio(segment.frame, { ...segment.identity, sequence, kind: 'stop' });
  }
  #fence(error: KernelError, outcome: DesktopSpeechState['outcome'] = 'cancelled'): void {
    this.#arming++;
    this.#pendingRefresh = null;
    this.#observationAbort.abort();
    this.#armingConnection = null;
    this.#baseline = null;
    this.#session = null;
    this.#queue = [];
    const whole = this.#whole;
    if (!whole) {
      this.#publish({ queued: 0 });
      return;
    }
    this.#failWhole(whole, error, outcome);
  }
  /** A failed reply does not invalidate an otherwise healthy event feed or later FIFO items. */
  #failWhole(
    whole: Whole | null,
    error: KernelError,
    outcome: DesktopSpeechState['outcome'],
  ): void {
    if (!whole || this.#whole !== whole) return;
    whole.error ??= error;
    if (whole.outcome === 'pending') whole.outcome = outcome;
    whole.abort.abort();
    if (whole.segment) this.#stopSegment(whole.segment);
    this.#publish({
      phase: 'stopping',
      queued: this.#queue.length,
      generating: false,
      playing: false,
      error: whole.error,
    });
    void this.#cancel(whole);
  }
  #cancel(whole: Whole): Promise<void> {
    if (whole.cancel) return whole.cancel;
    const work = (async () => {
      if (!whole.issued) {
        whole.remoteCleanup = 'settled';
        return;
      }
      try {
        if (!(await whole.intent.session.isCurrent())) {
          whole.remoteCleanup = 'unknown';
          return;
        }
        const result = await whole.intent.session.cancel(whole.intent.begin);
        whole.remoteCleanup = result.ok ? result.value.cleanup : 'unknown';
      } catch {
        whole.remoteCleanup = 'unknown';
      }
    })();
    whole.cancel = work;
    return work;
  }
  #record(identity: DesktopSpeechPlaybackIdentity, frame: object): Segment {
    const segment = this.#whole?.segment;
    const a = segment?.identity;
    if (
      !segment ||
      segment.frame !== frame ||
      !a ||
      !sameOwner(a.localOwner, identity.localOwner) ||
      a.connectionId !== identity.connectionId ||
      a.playbackId !== identity.playbackId ||
      a.localTaskId !== identity.localTaskId ||
      a.localStreamId !== identity.localStreamId ||
      a.utteranceId !== identity.utteranceId ||
      a.clientId !== identity.clientId ||
      a.agentId !== identity.agentId ||
      a.serviceEpoch !== identity.serviceEpoch ||
      a.utteranceBindingId !== identity.utteranceBindingId ||
      a.segmentIndex !== identity.segmentIndex ||
      a.requestId !== identity.requestId ||
      a.remoteBinding.providerRef !== identity.remoteBinding.providerRef ||
      a.remoteBinding.bindingId !== identity.remoteBinding.bindingId
    )
      throw new KernelFault('stale-owner');
    return segment;
  }
  async playerReady(input: DesktopSpeechReady, frame: object): Promise<Result<null>> {
    try {
      const segment = this.#record(input, frame);
      if (segment.stopped || frame !== this.frame() || input.sequence !== 0)
        return fail('stale-owner');
      segment.ready.resolve();
      return { ok: true, value: null };
    } catch (error) {
      return { ok: false, error: errorOf(error) };
    }
  }
  async consume(input: DesktopSpeechConsume, frame: object): Promise<Result<null>> {
    try {
      const segment = this.#record(input, frame);
      if (
        segment.stopped ||
        frame !== this.frame() ||
        !segment.consumed ||
        input.sequence !== segment.chunkSequence ||
        input.byteLength !== segment.chunkBytes
      )
        return fail('stale-owner');
      segment.consumed.resolve();
      return { ok: true, value: null };
    } catch (error) {
      return { ok: false, error: errorOf(error) };
    }
  }
  async reportPlayback(input: DesktopSpeechPlayback, frame: object): Promise<Result<null>> {
    try {
      const segment = this.#record(input, frame);
      if (
        segment.stopped ||
        frame !== this.frame() ||
        input.endedFrames < segment.endedFrames ||
        input.endedFrames > segment.sentFrames ||
        input.sequence < 0 ||
        input.sequence > segment.sequence
      )
        return fail('stale-owner');
      if (input.status === 'failed') {
        segment.releaseSequences.add(input.sequence);
        this.#failWhole(this.#whole, makeError('unavailable', false), 'failed');
        return { ok: true, value: null };
      }
      if (input.status === 'ended') {
        if (segment.endSequence !== input.sequence || input.endedFrames !== segment.sentFrames)
          return fail('invalid-input');
        segment.ended = true;
      } else if (input.sequence < 1 || input.sequence > segment.chunkSequence)
        return fail('invalid-input');
      const advanced = input.endedFrames > segment.endedFrames;
      segment.endedFrames = input.endedFrames;
      this.#publish({
        endedFrames: input.endedFrames,
        playing: input.status !== 'ended' && input.endedFrames < segment.sentFrames,
      });
      if (advanced && segment.consumed && segment.timer) {
        clearTimeout(segment.timer);
        segment.timer = setTimeout(segment.timeout, SPEECH_CONSUMER_STALL_TIMEOUT_MS);
      }
      return { ok: true, value: null };
    } catch (error) {
      return { ok: false, error: errorOf(error) };
    }
  }
  async reportReleased(input: DesktopSpeechReleased, frame: object): Promise<Result<null>> {
    try {
      const segment = this.#record(input, frame);
      if (
        !segment.releaseSequences.has(input.sequence) &&
        !(input.sequence === 0 && segment.sequence === 0)
      )
        return fail('invalid-input');
      segment.cleanup = input.cleanup;
      segment.released.resolve();
      if (input.cleanup === 'failed') this.#cleanupFailed = true;
      if (input.cleanup === 'failed' || (!segment.stopped && !segment.ended))
        this.#failWhole(this.#whole, makeError('unavailable', false), 'failed');
      return { ok: true, value: null };
    } catch (error) {
      return { ok: false, error: errorOf(error) };
    }
  }
  async stop(input: DesktopCompanionTarget): Promise<Result<DesktopSpeechState>> {
    const target =
      this.#whole?.intent.session.connectionId ??
      this.#baseline?.connectionId ??
      this.#armingConnection;
    if (!target || input.connectionId !== target) return fail('stale-owner');
    const id = input.connectionId;
    this.#fence(makeError('cancelled', false));
    void (async () => {
      await this.#whole?.done;
      if (this.#source && !this.#closed) await this.#arm(id);
    })();
    return this.getState();
  }
  async #join(): Promise<void> {
    const results = await Promise.allSettled([
      ...(this.#whole ? [this.#whole.done] : []),
      ...this.#observations,
    ]);
    if (results.some((result) => result.status === 'rejected'))
      throw new KernelFault('unavailable');
  }
  async stopFor(owner: OwnerRef): Promise<void> {
    if (this.#source && !sameOwner(this.#source.owner, owner)) return;
    this.#sourceOff();
    this.#source = null;
    this.#fence(makeError('stale-owner', false));
    await this.#join();
    this.#publish({ source: 'disabled' });
    if (this.#cleanupFailed) throw new KernelFault('unavailable');
  }
  ownerGone(frame: object): void {
    const segment = this.#whole?.segment;
    if (!segment || segment.frame !== frame) return;
    this.#fence(makeError('unavailable', false), 'failed');
    segment.cleanup = 'failed';
    segment.released.resolve();
    this.#cleanupFailed = true;
  }
  async close(): Promise<void> {
    this.#closed = true;
    this.#offEvent();
    this.#offRetire();
    this.#sourceOff();
    this.#source = null;
    this.#fence(makeError('cancelled', false));
    await this.#join();
    if (this.#cleanupFailed) throw new KernelFault('unavailable');
  }
}
