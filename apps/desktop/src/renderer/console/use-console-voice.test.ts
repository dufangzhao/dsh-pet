import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { DesktopVoiceBridge, DesktopVoiceState, Result } from '@pet/contracts';
import type {
  VoiceController,
  VoiceInputProps,
  VoiceTransport,
} from '@pet/text-client/voice-input-ui';
import { createUnavailableDesktopVoiceBridge } from '@pet/text-client/protocol';

// Hook ownership regression, not DOM or native permission evidence.
const harness = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void }[],
  effects: [] as (() => void)[],
  controller: null as VoiceController | null,
  transport: null as VoiceTransport | null,
}));
const changed = (old: readonly unknown[] | undefined, next: readonly unknown[]) =>
  old === undefined ||
  old.length !== next.length ||
  next.some((value, index) => !Object.is(value, old[index]));

vi.mock('react', () => ({
  useRef: <T>(initial: T) => {
    const slot = (harness.slots[harness.cursor++] ??= {});
    slot.value ??= { current: initial };
    return slot.value as { current: T };
  },
  useMemo: <T>(factory: () => T, deps: readonly unknown[]) => {
    const slot = (harness.slots[harness.cursor++] ??= {});
    if (changed(slot.deps, deps)) {
      slot.value = factory();
      slot.deps = [...deps];
    }
    return slot.value as T;
  },
  useEffect: (effect: () => (() => void) | void, deps: readonly unknown[]) => {
    const slot = (harness.slots[harness.cursor++] ??= {});
    if (!changed(slot.deps, deps)) return;
    slot.deps = [...deps];
    harness.effects.push(() => {
      slot.cleanup?.();
      const cleanup = effect();
      if (cleanup) slot.cleanup = cleanup;
      else delete slot.cleanup;
    });
  },
}));
vi.mock('@pet/text-client/voice-input-ui', () => ({
  createVoiceSampler: () => ({}),
  useVoiceInput: (props: VoiceInputProps) => {
    harness.transport = props.transport;
    return harness.controller;
  },
}));
vi.mock('@pet/audio-capture/capture-worklet?worker&url', () => ({ default: '/worklet.js' }));

import { useConsoleVoice } from './use-console-voice.js';

let notify: () => void;
let nativeState: DesktopVoiceState;
let bridge: DesktopVoiceBridge;
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
function render(connectionId: string, send: Parameters<typeof useConsoleVoice>[0]['send']) {
  harness.cursor = 0;
  useConsoleVoice({ state: { connectionId, phase: 'live' }, send });
  for (const effect of harness.effects.splice(0)) effect();
  return harness.transport!;
}

beforeEach(() => {
  harness.cursor = 0;
  harness.slots = [];
  harness.effects = [];
  harness.transport = null;
  harness.controller = {
    state: {
      phase: 'recording',
      intent: {
        captureId: 'capture-a',
        clientId: 'client-a',
        agentId: 'agent-a',
        serviceEpoch: 'epoch-a',
        finishMode: 'send',
        targetKey: 'connection-a',
      },
      preview: null,
      submitting: null,
      error: null,
      notice: null,
      release: 'pending',
    },
    view: null,
    mode: 'send',
    hint: '',
    rules: { ok: false, reason: null },
    level: 0,
    reload: vi.fn(),
    recover: vi.fn(),
    start: vi.fn(),
    finish: vi.fn(),
    cancel: vi.fn(),
    send: vi.fn(),
    edit: vi.fn(),
  };
  nativeState = {
    version: 1,
    revision: 1,
    connectionId: 'connection-a',
    phase: 'recording',
    captureId: 'capture-a',
    samples: 0,
    cleanup: 'pending',
    error: null,
  };
  notify = () => {};
  bridge = {
    ...createUnavailableDesktopVoiceBridge(),
    getState: async (): Promise<Result<DesktopVoiceState>> => ({ ok: true, value: nativeState }),
    onChanged: (listener) => {
      notify = listener;
      return () => {
        notify = () => {};
      };
    },
  };
  vi.stubGlobal('window', { petVoice: bridge });
});
afterEach(() => {
  for (const slot of harness.slots) slot.cleanup?.();
  vi.unstubAllGlobals();
});

test('old transport keeps its captured sender and cannot dispatch through a replacement connection', async () => {
  const sendA = vi.fn(async () => ({ outcome: 'stale' as const, error: null }));
  const sendB = vi.fn(async () => ({ outcome: 'accepted' as const, error: null }));
  const old = render('connection-a', sendA);
  const same = render('connection-a', sendB);
  expect(same).toBe(old);
  const current = render('connection-b', sendB);
  expect(current).not.toBe(old);
  expect(await old.submit('message-a', 'old transcript')).toBe('skipped');
  expect(sendA).toHaveBeenCalledWith('message-a', 'old transcript');
  expect(sendB).not.toHaveBeenCalled();
});

test('Main retirement cancels only its matching local capture, once', async () => {
  render('connection-a', async () => ({ outcome: 'accepted', error: null }));
  await flush();
  nativeState = { ...nativeState, revision: 2, phase: 'retiring', captureId: 'other-capture' };
  notify();
  await flush();
  expect(harness.controller!.cancel).not.toHaveBeenCalled();
  nativeState = { ...nativeState, revision: 3, captureId: 'capture-a' };
  harness.controller = {
    ...harness.controller!,
    state: { ...harness.controller!.state, phase: 'retiring' },
  };
  render('connection-a', async () => ({ outcome: 'accepted', error: null }));
  notify();
  await flush();
  expect(harness.controller.cancel).not.toHaveBeenCalled();
  harness.controller = {
    ...harness.controller,
    state: { ...harness.controller.state, phase: 'recording' },
  };
  render('connection-a', async () => ({ outcome: 'accepted', error: null }));
  notify();
  await flush();
  notify();
  await flush();
  expect(harness.controller!.cancel).toHaveBeenCalledTimes(1);
});

test('a retired connection read cannot cancel the replacement capture', async () => {
  let resolveOld!: (value: Result<DesktopVoiceState>) => void;
  bridge.getState = () =>
    new Promise((resolve) => {
      resolveOld = resolve;
    });
  render('connection-a', async () => ({ outcome: 'stale', error: null }));
  bridge.getState = async () => ({
    ok: true,
    value: { ...nativeState, connectionId: 'connection-b', captureId: 'capture-b' },
  });
  harness.controller = {
    ...harness.controller!,
    state: {
      ...harness.controller!.state,
      intent: {
        ...harness.controller!.state.intent!,
        captureId: 'capture-b',
        targetKey: 'connection-b',
      },
    },
  };
  render('connection-b', async () => ({ outcome: 'accepted', error: null }));
  await flush();
  resolveOld({ ok: true, value: { ...nativeState, phase: 'retiring' } });
  await flush();
  expect(harness.controller!.cancel).not.toHaveBeenCalled();
});
