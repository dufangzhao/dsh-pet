import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DemoBridge, DemoCaptureTicket, DemoRecordingReceipt, Result } from '@pet/contracts';
import type { DemoCaptureEvents, DemoCaptureHandle } from './demo/capture.js';
const harness = vi.hoisted(() => ({
  effects: [] as (() => (() => void) | void)[],
  capture: vi.fn(),
}));
vi.mock('react', () => ({
  useRef: <T>(value: T) => ({ current: value }),
  useState: <T>(initial: T | (() => T)) => [
    typeof initial === 'function' ? (initial as () => T)() : initial,
    vi.fn(),
  ],
  useCallback: <T>(value: T) => value,
  useMemo: <T>(factory: () => T) => factory(),
  useEffect: (effect: () => (() => void) | void) => {
    harness.effects.push(effect);
  },
}));
vi.mock('./demo/capture.js', () => ({ microphoneCapture: harness.capture }));
import { useDemo } from './use-demo.js';
const ticket: DemoCaptureTicket = {
  token: 'capture-one',
  sampleRate: 16000,
  maxSamples: 320000,
  chunkSamples: 1600,
};
const cleanups: (() => void)[] = [];
let event: (request: DemoRecordingReceipt) => void = () => {};
let api: DemoBridge;
function mount(): ReturnType<typeof useDemo> {
  const state = useDemo({ notify: vi.fn() });
  for (const effect of harness.effects.splice(0)) {
    const cleanup = effect();
    if (cleanup) cleanups.push(cleanup);
  }
  return state;
}
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  harness.effects.length = 0;
  harness.capture.mockReset();
  api = {
    version: 1,
    getSnapshot: vi.fn(async () => ({
      ok: false,
      error: { code: 'not-ready', messageKey: 'errors.not-ready', retryable: false },
    })),
    onChanged: () => () => {},
    onRecordingRequested: (listener: (request: DemoRecordingReceipt) => void) => {
      event = listener;
      return () => {
        event = () => {};
      };
    },
    beginRecording: vi.fn(async () => ({ ok: true, value: ticket })),
    captureReady: vi.fn(async () => ({ ok: true, value: null })),
    pushAudio: vi.fn(async () => ({ ok: true, value: null })),
    finishRecording: vi.fn(async () => ({ ok: true, value: null })),
    cancel: vi.fn(async () => ({
      ok: false,
      error: { code: 'not-ready', messageKey: 'errors.not-ready', retryable: false },
    })),
  } as unknown as DemoBridge;
  vi.stubGlobal('window', { petDemo: api });
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.unstubAllGlobals();
});
it('routes short-press next-down and held-release finish to the same arming capture', async () => {
  const opened = deferred<DemoCaptureHandle>(),
    stop = vi.fn(async () => {}),
    dispose = vi.fn();
  harness.capture.mockReturnValue(opened.promise);
  mount();
  event({ id: 'down-1', action: 'toggle' });
  await vi.waitFor(() => expect(harness.capture).toHaveBeenCalledOnce());
  event({ id: 'down-2', action: 'toggle' });
  event({ id: 'up-2', action: 'finish' });
  opened.resolve({ stop, dispose });
  await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
  expect(api.beginRecording).toHaveBeenCalledOnce();
  expect(harness.capture).toHaveBeenCalledOnce();
});
it('cancels before a late ticket without opening hardware or resurrecting a session', async () => {
  const ticketReady = deferred<Result<DemoCaptureTicket>>();
  vi.mocked(api.beginRecording).mockReturnValue(ticketReady.promise);
  mount();
  event({ id: 'down-1', action: 'toggle' });
  event({ id: 'cancel-1', action: 'cancel' });
  ticketReady.resolve({ ok: true, value: ticket });
  await vi.waitFor(() => expect(api.cancel).toHaveBeenCalledOnce());
  await Promise.resolve();
  expect(harness.capture).not.toHaveBeenCalled();
});
it('a late completion from an older capture cannot clear the newer microphone owner', async () => {
  const firstFinish = deferred<Result<null>>(),
    events: DemoCaptureEvents[] = [],
    secondDispose = vi.fn();
  harness.capture.mockImplementation(
    async (_ticket: DemoCaptureTicket, callbacks: DemoCaptureEvents) => {
      events.push(callbacks);
      return { stop: async () => {}, dispose: events.length === 2 ? secondDispose : vi.fn() };
    },
  );
  vi.mocked(api.finishRecording).mockReturnValue(firstFinish.promise);
  vi.mocked(api.beginRecording)
    .mockResolvedValueOnce({ ok: true, value: ticket })
    .mockResolvedValueOnce({ ok: true, value: { ...ticket, token: 'capture-two' } });
  const state = mount();
  await state.startRecording();
  const ending = events[0]?.ended();
  await vi.waitFor(() => expect(api.finishRecording).toHaveBeenCalledOnce());
  await state.cancelRecording();
  await state.startRecording();
  firstFinish.resolve({ ok: true, value: null });
  await ending;
  // A third start must see capture two still owned instead of opening another recorder.
  await state.startRecording();
  expect(harness.capture).toHaveBeenCalledTimes(2);
  expect(secondDispose).not.toHaveBeenCalled();
});
