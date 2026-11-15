import { afterEach, expect, it, vi } from 'vitest';
import { TaskSupervisor, KernelFault } from '@pet/host-kernel';
import {
  SPEECH_FORMAT,
  SPEECH_PROTOCOL,
  SPEECH_TTS_PROVIDER,
  makeError,
  type SpeechView,
  type SpeechBegin,
  type SpeechSegmentKey,
  type SpeechUtteranceStatus,
  type DesktopSpeechAudioEvent,
  type CompanionEvent,
  type JsonObject,
} from '@pet/contracts';
import { SharedSpeechController } from './shared-speech-controller.js';
import { SharedSpeechHost } from './shared-speech-host.js';
import type {
  CompanionSpeechSession,
  CompanionSpeechService,
  SpeechConnectionEvent,
} from './companion-speech-service.js';
const close: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of close.splice(0).reverse()) await fn();
  vi.useRealTimers();
});
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const view: SpeechView = {
  version: 1,
  feature: {
    sourcePluginId: 'pet.shared-speech',
    instanceId: 'default',
    source: 'ready',
    configRevision: 1,
    providerRef: SPEECH_TTS_PROVIDER,
  },
  providers: [
    {
      providerRef: SPEECH_TTS_PROVIDER,
      sourcePluginId: 'pet.tts-magpie',
      instanceId: 'default',
      providerId: 'magpie',
      label: 'fixture',
      synthetic: true,
      source: 'ready',
      configRevision: 1,
      bindingId: 'binding',
      settings: {
        baseUrl: 'http://127.0.0.1',
        modelRef: 'mimo-v2.5-tts',
        authMode: 'local-client-id',
        protocol: SPEECH_PROTOCOL,
        voice: 'Mia',
      },
      credential: { available: true, writable: false, version: '1', source: 'local-client-id' },
      readiness: 'configured',
      reason: null,
    },
  ],
};
async function fixture(
  options: {
    readonly gatedReads?: readonly number[];
    readonly initialSessionNotReady?: boolean;
  } = {},
) {
  let sessionReady = !options.initialSessionNotReady;
  const readGates = new Map((options.gatedReads ?? []).map((number) => [number, deferred()]));
  const readSignals = new Map<number, AbortSignal | undefined>();
  let speechView = structuredClone(view),
    readCount = 0;
  const source = new AbortController(),
    remote = new AbortController();
  const owner = { pluginId: 'pet.speech-output', instanceId: 'default', generation: 1 };
  let enabled = true,
    frame: object = {},
    autoReady = true,
    autoConsume = true,
    autoRelease = true;
  let listener = (_event: SpeechConnectionEvent) => {};
  let retiring = async (_id: string) => {};
  let begin: SpeechBegin | null = null,
    reserved: SpeechSegmentKey | null = null,
    segmentCount = 1,
    sequence = 0;
  let chunks: Uint8Array[] = [new Uint8Array(65536), new Uint8Array(2)];
  let heldNative: Promise<void> | null = null;
  let volumeError = false,
    holdPart: number | null = null;
  const tasks = new TaskSupervisor({
    isActive: () => enabled && !source.signal.aborted,
    isLive: () => true,
    signal: () => source.signal,
  });
  const kernel = {
    manager: {
      get: () => (enabled ? { owner } : undefined),
      isActive: () => enabled && !source.signal.aborted,
      signal: () => source.signal,
    },
    tasks,
    describeTrust: () => ({ trusted: true, digest: 'digest' }),
    verifyTrust: async () => true,
    permissionControl: { inspect: () => ({ preset: 'allow' as const, blocked: false, epoch: 1 }) },
    permissions: {
      authorize: vi.fn(async () => ({
        ok: true as const,
        value: { signal: source.signal, isValid: () => !source.signal.aborted, close() {} },
      })),
    },
  };
  const status = (): SpeechUtteranceStatus => {
    if (!begin || !reserved) throw new Error('missing intent');
    const frames = chunks.reduce((n, b) => n + b.byteLength / 2, 0);
    const terminal = {
      outcome: 'completed' as const,
      finishReason: 'stop' as const,
      producedFrames: frames,
      producedBytes: frames * 2,
      drainedFrames: frames,
      drainedBytes: frames * 2,
      nativeSettled: true,
      transportCleanup: 'settled' as const,
      error: null,
    };
    return {
      ...begin,
      receipt: { ...begin, utteranceBindingId: 'whole', segmentCount, splitVersion: 2 },
      phase: 'streaming',
      outcome: 'pending',
      cleanup: 'pending',
      attemptedThrough: reserved.segmentIndex,
      deliveredThrough: reserved.segmentIndex,
      currentSegment: {
        ...reserved,
        phase: 'terminal',
        producedFrames: frames,
        drainedFrames: frames,
        nativeSettled: true,
        transportCleanup: 'settled',
        terminal,
      },
      error: null,
      reason: null,
      completedAt: null,
    };
  };
  const session: CompanionSpeechSession = {
    connectionId: 'connection',
    clientId: 'client',
    agentId: 'agent',
    serviceEpoch: 'epoch',
    signal: remote.signal,
    isCurrent: vi.fn(async () => !remote.signal.aborted),
    baseline: vi.fn<CompanionSpeechSession['baseline']>(async () => ({
      ok: true,
      value: {
        connectionId: 'connection',
        clientId: 'client',
        agentId: 'agent',
        serviceEpoch: 'epoch',
        cursor: sequence,
      },
    })),
    readSpeech: vi.fn<CompanionSpeechSession['readSpeech']>(async (signal) => {
      const number = ++readCount,
        captured = structuredClone(speechView);
      readSignals.set(number, signal);
      await readGates.get(number)?.promise;
      return { ok: true, value: captured };
    }),
    saveProvider: vi.fn(),
    catalog: vi.fn(),
    begin: vi.fn<CompanionSpeechSession['begin']>(async (input) => {
      begin = input;
      return {
        ok: true,
        value: { ...input, utteranceBindingId: 'whole', segmentCount, splitVersion: 2 },
      };
    }),
    reserve: vi.fn<CompanionSpeechSession['reserve']>(async (key) => {
      reserved = key;
      return { ok: true, value: { ...key, phase: 'awaiting-consumer' } };
    }),
    consumeAudio: vi.fn<CompanionSpeechSession['consumeAudio']>(
      async (key, binding, signal, consume) => {
        try {
          await consume(
            { ...key, ...binding, version: 1, format: SPEECH_FORMAT },
            {
              async *[Symbol.asyncIterator]() {
                for (const chunk of chunks) {
                  signal.throwIfAborted();
                  yield chunk;
                }
                if (heldNative) await heldNative;
              },
            },
            signal,
          );
          return { ok: true, value: null };
        } catch {
          return { ok: false, error: makeError('cancelled', false) };
        }
      },
    ),
    status: vi.fn<CompanionSpeechSession['status']>(async () => ({ ok: true, value: status() })),
    cancel: vi.fn<CompanionSpeechSession['cancel']>(async () => ({
      ok: true,
      value: { ...status(), cleanup: 'settled', outcome: 'cancelled', phase: 'terminal' },
    })),
  };
  let currentSession = session;
  const service: CompanionSpeechService = {
    getState: async () => ({
      ok: true,
      value: { connectionId: currentSession.connectionId, phase: 'live' },
    }),
    speechSession: (target) => {
      if (target.connectionId !== currentSession.connectionId) throw new KernelFault('stale-owner');
      if (!sessionReady) throw new KernelFault('not-ready');
      return currentSession;
    },
    onSpeechEvent: (next) => {
      listener = next;
      return () => {};
    },
    onSpeechRetiring: (next) => {
      retiring = next;
      return () => {};
    },
  };
  const events: DesktopSpeechAudioEvent[] = [],
    payloads: Uint8Array[] = [];
  const frames = new Map<string, number>();
  const controller = new SharedSpeechController(
    service,
    new SharedSpeechHost(kernel),
    () => frame,
    () => {},
    (target, event, payload) => {
      expect(target).toBe(frame);
      events.push(event);
      if (event.kind === 'start' && autoReady)
        void controller.playerReady({ ...event, format: SPEECH_FORMAT }, target);
      if (event.kind === 'chunk') {
        if (payload) payloads.push(payload);
        frames.set(event.playbackId, (frames.get(event.playbackId) ?? 0) + event.byteLength / 2);
        if (autoConsume) void controller.consume({ ...event }, target);
      }
      if (event.kind === 'end') {
        void controller.reportPlayback(
          { ...event, status: 'ended', endedFrames: frames.get(event.playbackId) ?? 0 },
          target,
        );
        if (autoRelease && event.segmentIndex !== holdPart)
          void controller.reportReleased({ ...event, cleanup: 'settled' }, target);
      }
      if (event.kind === 'stop' && autoRelease)
        void controller.reportReleased({ ...event, cleanup: 'settled' }, target);
    },
    async () => {
      if (volumeError) throw new KernelFault('not-ready');
      return 70;
    },
  );
  close.push(async () => {
    for (const pending of readGates.values()) pending.resolve();
    await controller.close();
  });
  const initialization = controller.refreshSource();
  if (!readGates.has(1)) await initialization;
  const emit = (
    id = `reply-${sequence + 1}`,
    role = 'assistant',
    scope: JsonObject = { audience: { kind: 'owner-private' } },
    advance = 1,
  ) => {
    sequence += advance;
    const event: CompanionEvent = {
      id: `epoch:${sequence}`,
      epoch: 'epoch',
      sequence,
      time: 1,
      kind: 'message',
      data: { messageId: id, role, inputId: null, taskId: null, ...scope },
    };
    listener({
      kind: 'event',
      baseline: {
        connectionId: 'connection',
        clientId: 'client',
        agentId: 'agent',
        serviceEpoch: 'epoch',
        cursor: 0,
      },
      event,
    });
  };
  return {
    controller,
    session,
    initialization,
    releaseRead: (number: number) => readGates.get(number)?.resolve(),
    readSignal: (number: number) => readSignals.get(number),
    setBinding: (bindingId: string) => {
      speechView = {
        ...speechView,
        providers: speechView.providers.map((provider) => ({
          ...provider,
          bindingId,
          configRevision: provider.configRevision + 1,
          credential: { ...provider.credential, version: bindingId },
        })),
      };
    },
    source,
    remote,
    events,
    payloads,
    kernel,
    tasks,
    emit,
    frame: () => frame,
    replaceFrame: () => {
      frame = {};
    },
    ready: (value: boolean) => {
      autoReady = value;
    },
    consume: (value: boolean) => {
      autoConsume = value;
    },
    release: (value: boolean) => {
      autoRelease = value;
    },
    enabled: (value: boolean) => {
      enabled = value;
    },
    chunks: (value: Uint8Array[]) => {
      chunks = value;
    },
    parts: (value: number) => {
      segmentCount = value;
    },
    holdPart: (value: number) => {
      holdPart = value;
    },
    native: (value: Promise<void>) => {
      heldNative = value;
    },
    volumeOff: () => {
      volumeError = true;
    },
    volumeOn: () => {
      volumeError = false;
    },
    refresh: (connectionId = 'connection') => listener({ kind: 'refresh', connectionId }),
    repairSession: () => {
      sessionReady = true;
    },
    retarget: (next: CompanionSpeechSession, notify = true) => {
      currentSession = next;
      if (notify) listener({ kind: 'live', connectionId: next.connectionId });
    },
    fence: () =>
      listener({ kind: 'fence', connectionId: 'connection', error: makeError('network', false) }),
    invalid: () => listener({ kind: 'invalid', connectionId: 'connection' }),
    retire: () => {
      remote.abort();
      return retiring('connection');
    },
  };
}
async function state(f: Awaited<ReturnType<typeof fixture>>) {
  return unwrap(await f.controller.getState());
}
function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error('failed result');
  return result.value;
}
it('recovers on a same-connection refresh after the initial speech session was not ready', async () => {
  const f = await fixture({ initialSessionNotReady: true });
  expect(await state(f)).toMatchObject({
    connectionId: 'connection',
    appliedBinding: null,
    error: { code: 'not-ready' },
  });
  expect(f.session.readSpeech).not.toHaveBeenCalled();
  f.repairSession();
  f.refresh();
  await vi.waitFor(async () =>
    expect((await state(f)).appliedBinding).toEqual({
      providerRef: SPEECH_TTS_PROVIDER,
      bindingId: 'binding',
    }),
  );
  expect(f.session.baseline).toHaveBeenCalledTimes(1);
  expect(f.session.readSpeech).toHaveBeenCalledTimes(1);
  expect(f.session.begin).not.toHaveBeenCalled();
});
it('rejects an old-target refresh before any projection change when initial session creation failed', async () => {
  const f = await fixture({ initialSessionNotReady: true });
  const before = await state(f);
  f.repairSession();
  f.setBinding('binding-B');
  const next: CompanionSpeechSession = {
    ...f.session,
    connectionId: 'connection-B',
    baseline: vi.fn<CompanionSpeechSession['baseline']>(async () => ({
      ok: true,
      value: {
        connectionId: 'connection-B',
        clientId: 'client',
        agentId: 'agent',
        serviceEpoch: 'epoch',
        cursor: 0,
      },
    })),
  };
  f.retarget(next, false);
  f.refresh('connection');
  expect(await state(f)).toEqual(before);
  expect(f.session.readSpeech).not.toHaveBeenCalled();
  f.refresh('connection-B');
  await vi.waitFor(async () =>
    expect(await state(f)).toMatchObject({
      connectionId: 'connection-B',
      appliedBinding: { bindingId: 'binding-B' },
    }),
  );
  expect(next.baseline).toHaveBeenCalledTimes(1);
});
it('rechecks an invalidation received during initial arm and projects B only after its baseline adopts', async () => {
  const f = await fixture({ gatedReads: [1, 2, 3] });
  await vi.waitFor(() => expect(f.session.readSpeech).toHaveBeenCalledTimes(1));
  expect((await state(f)).appliedBinding).toBeNull();
  f.setBinding('binding-B');
  f.refresh();
  f.refresh();
  f.releaseRead(1);
  await f.initialization;
  await vi.waitFor(() => expect(f.session.readSpeech).toHaveBeenCalledTimes(2));
  expect((await state(f)).appliedBinding?.bindingId).toBe('binding');
  f.releaseRead(2);
  await vi.waitFor(() => expect(f.session.readSpeech).toHaveBeenCalledTimes(3));
  expect((await state(f)).appliedBinding).toBeNull();
  f.releaseRead(3);
  await vi.waitFor(async () =>
    expect((await state(f)).appliedBinding).toEqual({
      providerRef: SPEECH_TTS_PROVIDER,
      bindingId: 'binding-B',
    }),
  );
  expect(f.session.baseline).toHaveBeenCalledTimes(2);
  expect(f.session.begin).not.toHaveBeenCalled();
  f.emit('new-after-B-adopted');
  await vi.waitFor(async () => expect((await state(f)).outcome).toBe('completed'));
  expect(vi.mocked(f.session.begin).mock.calls[0]?.[0].bindingId).toBe('binding-B');
});
it('merges notifications during an unchanged in-flight read into one additional read', async () => {
  const f = await fixture({ gatedReads: [2] });
  f.refresh();
  await vi.waitFor(() => expect(f.session.readSpeech).toHaveBeenCalledTimes(2));
  f.setBinding('binding-B');
  f.refresh();
  f.refresh();
  expect((await state(f)).appliedBinding?.bindingId).toBe('binding');
  f.releaseRead(2);
  await vi.waitFor(async () =>
    expect((await state(f)).appliedBinding?.bindingId).toBe('binding-B'),
  );
  expect(f.session.readSpeech).toHaveBeenCalledTimes(4); // One coalesced read, then the changed-binding baseline.
  expect(f.session.baseline).toHaveBeenCalledTimes(2);
});
it('retains the existing changed-view recovery when a newer notification arrives during the read', async () => {
  const f = await fixture({ gatedReads: [2, 3] });
  f.setBinding('binding-B');
  f.refresh();
  await vi.waitFor(() => expect(f.session.readSpeech).toHaveBeenCalledTimes(2));
  f.setBinding('binding-C');
  f.refresh();
  f.releaseRead(2);
  await vi.waitFor(() => expect(f.session.readSpeech).toHaveBeenCalledTimes(3));
  expect((await state(f)).appliedBinding).toBeNull();
  f.releaseRead(3);
  await vi.waitFor(async () =>
    expect((await state(f)).appliedBinding?.bindingId).toBe('binding-C'),
  );
  expect(f.session.readSpeech).toHaveBeenCalledTimes(3);
  expect(f.session.baseline).toHaveBeenCalledTimes(2);
});
it('ignores old-target refreshes and joins its aborted read even after a new target adopts', async () => {
  const f = await fixture({ gatedReads: [2, 3] });
  f.refresh();
  await vi.waitFor(() => expect(f.session.readSpeech).toHaveBeenCalledTimes(2));
  f.setBinding('binding-B');
  const next: CompanionSpeechSession = {
    ...f.session,
    connectionId: 'connection-B',
    baseline: vi.fn<CompanionSpeechSession['baseline']>(async () => ({
      ok: true,
      value: {
        connectionId: 'connection-B',
        clientId: 'client',
        agentId: 'agent',
        serviceEpoch: 'epoch',
        cursor: 0,
      },
    })),
  };
  f.retarget(next);
  await vi.waitFor(() => expect(f.session.readSpeech).toHaveBeenCalledTimes(3));
  expect(f.readSignal(2)?.aborted).toBe(true);
  expect((await state(f)).appliedBinding).toBeNull();
  f.refresh('connection');
  f.releaseRead(3);
  await vi.waitFor(async () =>
    expect(await state(f)).toMatchObject({
      connectionId: 'connection-B',
      appliedBinding: { bindingId: 'binding-B' },
    }),
  );
  expect(f.session.readSpeech).toHaveBeenCalledTimes(3);
  f.refresh('connection-B');
  await vi.waitFor(() => expect(f.session.readSpeech).toHaveBeenCalledTimes(4));
  f.refresh('connection');
  expect(f.session.readSpeech).toHaveBeenCalledTimes(4);
  let closed = false;
  const closing = f.controller.close().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  expect((await state(f)).appliedBinding).toBeNull();
  f.releaseRead(2);
  await closing;
  expect(f.session.readSpeech).toHaveBeenCalledTimes(4);
});
it('disabling fences queued invalidations and waits for the actual old read to return', async () => {
  const f = await fixture({ gatedReads: [2] });
  f.refresh();
  await vi.waitFor(() => expect(f.session.readSpeech).toHaveBeenCalledTimes(2));
  f.setBinding('binding-B');
  f.refresh();
  f.enabled(false);
  let joined = false;
  const disabling = f.controller.refreshSource().then(() => {
    joined = true;
  });
  await vi.waitFor(() => expect(f.readSignal(2)?.aborted).toBe(true));
  expect(joined).toBe(false);
  expect((await state(f)).appliedBinding).toBeNull();
  f.releaseRead(2);
  await disabling;
  expect(f.session.readSpeech).toHaveBeenCalledTimes(2);
  expect((await state(f)).source).toBe('disabled');
});
it('admits only explicit owner-private events before FIFO and accepts scope-filtered sequence gaps', async () => {
  const f = await fixture();
  f.ready(false);
  const account = {
    protocol: 'official',
    sourcePluginId: 'pet.qq-official',
    instanceId: 'default',
    accountId: 'app',
  };
  for (const scope of [
    { audience: { kind: 'qq-group', account, groupId: 'group-A' } },
    { audience: { kind: 'person-private', principalId: 'another' } },
    { audience: { kind: 'public' } },
    { audience: null },
    {},
    { audience: { kind: 'owner-private', role: 'administrator' } },
  ])
    f.emit('not-personal', 'assistant', scope);
  expect(await state(f)).toMatchObject({ phase: 'idle', messageId: null, queued: 0 });
  expect(f.session.begin).not.toHaveBeenCalled();
  f.emit('personal-after-filtered-gap', 'assistant', { audience: { kind: 'owner-private' } }, 3);
  await vi.waitFor(() => expect(f.session.begin).toHaveBeenCalledTimes(1));
  expect(f.session.begin).toHaveBeenCalledWith(
    expect.objectContaining({ messageId: 'personal-after-filtered-gap' }),
    expect.any(AbortSignal),
  );
  expect(f.session.readSpeech).toHaveBeenCalledTimes(1);
});
it('keeps a 64KiB chunk and its one-frame tail ordered, then waits for actual release', async () => {
  const f = await fixture();
  f.release(false);
  f.emit();
  await vi.waitFor(() => expect(f.events.at(-1)?.kind).toBe('end'));
  expect(f.payloads.map((b) => b.byteLength)).toEqual([65536, 2]);
  expect((await state(f)).localCleanup).toBe('pending');
  const end = f.events.at(-1);
  if (!end) throw new Error('no end');
  expect(await f.controller.reportReleased({ ...end, cleanup: 'settled' }, f.frame())).toEqual({
    ok: true,
    value: null,
  });
  await vi.waitFor(async () => expect((await state(f)).outcome).toBe('completed'));
  expect((await state(f)).localCleanup).toBe('settled');
  expect((await state(f)).remoteCleanup).toBe('pending'); // Preserve the service's separate cleanup fact.
  expect(f.session.consumeAudio).toHaveBeenCalledTimes(1);
});
it('admits all formal events in one refresh window as logical FIFO items and fences pending on stop', async () => {
  const f = await fixture();
  f.ready(false);
  f.emit('say-1');
  f.emit('say-2');
  f.emit('say-3');
  f.emit('say-4');
  f.emit('over-quota');
  await vi.waitFor(() => expect(f.events[0]?.kind).toBe('start'));
  expect(f.session.begin).toHaveBeenCalledTimes(1);
  expect((await state(f)).queued).toBe(3);
  expect((await state(f)).error?.code).toBe('quota-exceeded');
  await f.controller.stop({ connectionId: 'connection' });
  await vi.waitFor(async () => expect((await state(f)).localCleanup).toBe('settled'));
  expect(f.session.begin).toHaveBeenCalledTimes(1);
  expect(f.session.consumeAudio).not.toHaveBeenCalled();
});
it('requires exact frame/identity and accepts progress for older chunk sequences', async () => {
  const f = await fixture();
  f.consume(false);
  f.emit();
  await vi.waitFor(() => expect(f.events.some((e) => e.kind === 'chunk')).toBe(true));
  const first = f.events.find((e) => e.kind === 'chunk');
  if (!first || first.kind !== 'chunk') throw new Error('no chunk');
  expect(await f.controller.consume({ ...first }, {})).toMatchObject({ ok: false });
  expect(await f.controller.consume({ ...first, localTaskId: 'foreign' }, f.frame())).toMatchObject(
    { ok: false },
  );
  await f.controller.consume({ ...first }, f.frame());
  await vi.waitFor(() => expect(f.events.filter((e) => e.kind === 'chunk')).toHaveLength(2));
  expect(
    await f.controller.reportPlayback(
      { ...first, status: 'progress', endedFrames: 2400 },
      f.frame(),
    ),
  ).toMatchObject({ ok: true });
  expect(
    await f.controller.reportPlayback(
      { ...first, status: 'progress', endedFrames: 2399 },
      f.frame(),
    ),
  ).toMatchObject({ ok: false });
  const second = f.events.find((e) => e.kind === 'chunk' && e.sequence !== first.sequence);
  if (!second || second.kind !== 'chunk') throw new Error('no second chunk');
  await f.controller.consume({ ...second }, f.frame());
  await vi.waitFor(async () => expect((await state(f)).outcome).toBe('completed'));
});
it('fences invalid/offline events, keeps remote unknown after retirement, and joins delayed local release', async () => {
  const f = await fixture();
  f.ready(false);
  f.release(false);
  f.emit();
  await vi.waitFor(() => expect(f.events[0]?.kind).toBe('start'));
  const start = f.events[0];
  if (!start) throw new Error('no start');
  const retiring = f.retire();
  await vi.waitFor(() => expect(f.events.at(-1)?.kind).toBe('stop'));
  expect(
    await f.controller.playerReady({ ...start, format: SPEECH_FORMAT }, f.frame()),
  ).toMatchObject({ ok: false });
  expect(f.session.consumeAudio).not.toHaveBeenCalled();
  expect(f.session.cancel).not.toHaveBeenCalled();
  let joined = false;
  void retiring.then(() => {
    joined = true;
  });
  await Promise.resolve();
  expect(joined).toBe(false);
  const stop = f.events.at(-1);
  if (!stop) throw new Error('no stop');
  await f.controller.reportReleased({ ...stop, cleanup: 'settled' }, f.frame());
  await retiring;
  expect((await state(f)).remoteCleanup).toBe('unknown');
  expect((await state(f)).localCleanup).toBe('settled');
});
it('does no remote admission while disabled or master sound is off, and first PCM precedes native completion', async () => {
  const f = await fixture();
  f.enabled(false);
  await f.controller.refreshSource();
  f.emit();
  expect(f.session.begin).not.toHaveBeenCalled();
  f.enabled(true);
  await f.controller.refreshSource();
  f.volumeOff();
  f.emit();
  await vi.waitFor(async () => expect((await state(f)).outcome).toBe('failed'));
  expect(f.session.begin).not.toHaveBeenCalled();
  const g = await fixture();
  const native = deferred();
  g.native(native.promise);
  g.emit();
  await vi.waitFor(() => expect(g.payloads.length).toBeGreaterThan(0));
  expect(g.session.status).not.toHaveBeenCalled();
  native.resolve();
  await vi.waitFor(async () => expect((await state(g)).outcome).toBe('completed'));
});
it('stopping segment two prevents a third request and preserves completed segment progress', async () => {
  const f = await fixture();
  f.parts(3);
  f.holdPart(1);
  f.emit();
  await vi.waitFor(() =>
    expect(f.events.some((event) => event.kind === 'end' && event.segmentIndex === 1)).toBe(true),
  );
  expect((await state(f)).completedSegments).toBe(1);
  await f.controller.stop({ connectionId: 'connection' });
  await vi.waitFor(async () => expect((await state(f)).outcome).toBe('cancelled'));
  expect(f.session.reserve).toHaveBeenCalledTimes(2);
  expect(f.session.consumeAudio).toHaveBeenCalledTimes(2);
  expect((await state(f)).reason).toBe('partial-output');
});
it('actual node progress extends a blocked chunk budget and cumulative streams exceed two MiB', async () => {
  const f = await fixture();
  f.consume(false);
  vi.useFakeTimers();
  f.emit();
  await vi.waitFor(() => expect(f.events.some((event) => event.kind === 'chunk')).toBe(true));
  const first = f.events.find((event) => event.kind === 'chunk');
  if (!first || first.kind !== 'chunk') throw new Error('missing chunk');
  for (const endedFrames of Array.from({ length: 9 }, (_, index) => (index + 1) * 2400)) {
    await vi.advanceTimersByTimeAsync(14_000);
    expect(
      await f.controller.reportPlayback({ ...first, status: 'progress', endedFrames }, f.frame()),
    ).toMatchObject({ ok: true });
    expect(f.events.some((event) => event.kind === 'stop')).toBe(false);
  }
  await f.controller.consume(first, f.frame());
  await vi.waitFor(() =>
    expect(f.events.filter((event) => event.kind === 'chunk')).toHaveLength(2),
  );
  const tail = f.events.find(
    (event) => event.kind === 'chunk' && event.sequence !== first.sequence,
  );
  if (!tail || tail.kind !== 'chunk') throw new Error('missing tail');
  await f.controller.consume(tail, f.frame());
  await vi.waitFor(async () => expect((await state(f)).outcome).toBe('completed'));
  vi.useRealTimers();
  const g = await fixture();
  g.chunks(Array.from({ length: 40 }, () => new Uint8Array(65536)));
  g.emit();
  await vi.waitFor(async () => expect((await state(g)).outcome).toBe('completed'));
  expect(g.payloads.reduce((sum, bytes) => sum + bytes.byteLength, 0)).toBe(40 * 65536);
  expect(g.session.consumeAudio).toHaveBeenCalledTimes(1);
});
it('a malformed event fences only speech, joins resources, and baselines before accepting future replies', async () => {
  const f = await fixture();
  f.ready(false);
  f.emit('before-bad-frame');
  await vi.waitFor(() => expect(f.events[0]?.kind).toBe('start'));
  f.invalid();
  await vi.waitFor(() => expect(f.session.baseline).toHaveBeenCalledTimes(2));
  expect(f.session.consumeAudio).not.toHaveBeenCalled();
  f.ready(true);
  f.emit('future-after-baseline');
  await vi.waitFor(async () => expect((await state(f)).outcome).toBe('completed'));
  expect(vi.mocked(f.session.begin).mock.calls.map(([input]) => input.messageId)).toEqual([
    'before-bad-frame',
    'future-after-baseline',
  ]);
});
it.each(['provider', 'playback'] as const)(
  'a delayed %s failure preserves the feed and later logical replies without a refresh',
  async (failure) => {
    const f = await fixture();
    const delayed = deferred();
    if (failure === 'provider') {
      vi.mocked(f.session.consumeAudio).mockImplementationOnce(async () => {
        await delayed.promise;
        return { ok: false, error: makeError('unavailable', false) };
      });
    } else f.ready(false);
    f.emit('failed-reply');
    await vi.waitFor(() => expect(f.events[0]?.kind).toBe('start'));
    if (failure === 'provider')
      await vi.waitFor(() => expect(f.session.consumeAudio).toHaveBeenCalledTimes(1));
    // Its ordinary refresh is already consumed before the delayed failure arrives.
    f.refresh();
    await vi.waitFor(() => expect(f.session.readSpeech).toHaveBeenCalledTimes(2));
    f.emit('already-queued-reply');
    expect((await state(f)).queued).toBe(1);
    if (failure === 'provider') delayed.resolve();
    else {
      f.ready(true);
      const start = f.events[0];
      if (!start) throw new Error('missing start');
      await f.controller.reportPlayback({ ...start, status: 'failed', endedFrames: 0 }, f.frame());
    }
    await vi.waitFor(async () => expect((await state(f)).outcome).toBe('completed'));
    f.emit('new-reply-after-settlement');
    await vi.waitFor(() => expect(f.session.begin).toHaveBeenCalledTimes(3));
    await vi.waitFor(async () => expect((await state(f)).outcome).toBe('completed'));
    expect(vi.mocked(f.session.begin).mock.calls.map(([input]) => input.messageId)).toEqual([
      'failed-reply',
      'already-queued-reply',
      'new-reply-after-settlement',
    ]);
    expect(f.session.baseline).toHaveBeenCalledTimes(1);
    expect(f.session.readSpeech).toHaveBeenCalledTimes(2);
  },
);
it('a refused local volume read does not lose the next formal reply after volume recovers', async () => {
  const f = await fixture();
  f.volumeOff();
  f.emit('muted-reply');
  await vi.waitFor(async () => expect((await state(f)).outcome).toBe('failed'));
  expect(f.session.begin).not.toHaveBeenCalled();
  expect((await state(f)).appliedBinding).toEqual({
    providerRef: SPEECH_TTS_PROVIDER,
    bindingId: 'binding',
  });
  f.volumeOn();
  f.emit('future-unmuted-reply');
  await vi.waitFor(async () => expect((await state(f)).outcome).toBe('completed'));
  expect(vi.mocked(f.session.begin).mock.calls.map(([input]) => input.messageId)).toEqual([
    'future-unmuted-reply',
  ]);
  expect(f.session.baseline).toHaveBeenCalledTimes(1);
  expect(f.session.readSpeech).toHaveBeenCalledTimes(1);
});
it.each(['completed', 'failed'] as const)(
  'retarget after A %s publishes B and rejects old A stop while B is arming',
  async (outcome) => {
    const f = await fixture();
    if (outcome === 'failed') f.volumeOff();
    f.emit('A-reply');
    await vi.waitFor(async () => expect((await state(f)).outcome).toBe(outcome));
    const baselineGate = deferred();
    close.push(async () => {
      baselineGate.resolve();
    });
    let armedSignal: AbortSignal | undefined;
    const next: CompanionSpeechSession = {
      ...f.session,
      connectionId: 'connection-B',
      clientId: 'client-B',
      agentId: 'agent-B',
      serviceEpoch: 'epoch-B',
      baseline: vi.fn<CompanionSpeechSession['baseline']>(async (signal) => {
        armedSignal = signal;
        await baselineGate.promise;
        return {
          ok: true,
          value: {
            connectionId: 'connection-B',
            clientId: 'client-B',
            agentId: 'agent-B',
            serviceEpoch: 'epoch-B',
            cursor: 0,
          },
        };
      }),
    };
    f.retarget(next);
    await vi.waitFor(() => expect(next.baseline).toHaveBeenCalledTimes(1));
    const arming = await state(f);
    expect(await f.controller.stop({ connectionId: 'connection' })).toMatchObject({
      ok: false,
      error: { code: 'stale-owner' },
    });
    expect(await state(f)).toEqual(arming);
    expect(armedSignal?.aborted).toBe(false);
    expect(arming).toMatchObject({
      connectionId: 'connection-B',
      phase: 'baselining',
      outcome: 'pending',
      messageId: null,
      error: null,
      reason: null,
      completedSegments: 0,
      current: null,
    });
    baselineGate.resolve();
    await vi.waitFor(async () =>
      expect(await state(f)).toMatchObject({ connectionId: 'connection-B', phase: 'idle' }),
    );
    expect(await f.controller.stop({ connectionId: 'connection' })).toMatchObject({
      ok: false,
      error: { code: 'stale-owner' },
    });
    expect(await f.controller.stop({ connectionId: 'connection-B' })).toMatchObject({
      ok: true,
      value: { connectionId: 'connection-B' },
    });
    await vi.waitFor(() => expect(next.baseline).toHaveBeenCalledTimes(2));
  },
);
it('a terminal display connection has no stop authority after the source is disabled', async () => {
  const f = await fixture();
  f.emit();
  await vi.waitFor(async () => expect((await state(f)).outcome).toBe('completed'));
  f.enabled(false);
  await f.controller.refreshSource();
  const disabled = await state(f);
  expect(await f.controller.stop({ connectionId: 'connection' })).toMatchObject({
    ok: false,
    error: { code: 'stale-owner' },
  });
  expect(await state(f)).toEqual(disabled);
  expect(f.session.baseline).toHaveBeenCalledTimes(1);
});
it('failure during preparation still joins release and never starts native audio', async () => {
  const f = await fixture();
  f.ready(false);
  f.release(false);
  f.emit();
  await vi.waitFor(() => expect(f.events[0]?.kind).toBe('start'));
  const start = f.events[0];
  if (!start) throw new Error('no start');
  await f.controller.reportPlayback({ ...start, status: 'failed', endedFrames: 0 }, f.frame());
  expect((await state(f)).localCleanup).toBe('pending');
  await f.controller.reportReleased({ ...start, cleanup: 'settled' }, f.frame());
  await vi.waitFor(async () => expect((await state(f)).outcome).toBe('failed'));
  expect(f.session.consumeAudio).not.toHaveBeenCalled();
});
