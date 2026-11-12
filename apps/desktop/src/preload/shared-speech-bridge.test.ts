import { expect, it, vi } from 'vitest';
import { DESKTOP_SPEECH_IPC, SPEECH_FORMAT, type DesktopSpeechAudioEvent } from '@pet/contracts';
import { createDesktopSpeechBridge } from './shared-speech-bridge.js';
it('freezes fixed operations with exact arity and keeps binary PCM off control invokes', async () => {
  const invoke = vi.fn(async () => ({ ok: true, value: null })),
    off = vi.fn();
  let receive = (_event: unknown, _payload?: Uint8Array) => {};
  const bridge = createDesktopSpeechBridge(
    invoke,
    () => off,
    (listener) => {
      receive = listener;
      return off;
    },
  );
  expect(Object.isFrozen(bridge)).toBe(true);
  expect(Object.keys(bridge).sort()).toEqual(
    [
      'version',
      'onChanged',
      'onAudio',
      ...Object.keys(DESKTOP_SPEECH_IPC).filter((name) => name !== 'changed' && name !== 'audio'),
    ].sort(),
  );
  expect(
    await Reflect.apply(bridge.stop, null, [{ connectionId: 'connection' }, 'extra']),
  ).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
  expect(invoke).not.toHaveBeenCalled();
  await bridge.stop({ connectionId: 'connection' });
  expect(invoke).toHaveBeenCalledWith(DESKTOP_SPEECH_IPC.stop, { connectionId: 'connection' });
  const identity = {
    connectionId: 'connection',
    utteranceId: 'utterance',
    clientId: 'client',
    agentId: 'agent',
    serviceEpoch: 'epoch',
    utteranceBindingId: 'whole',
    segmentIndex: 0,
    requestId: 'request',
    playbackId: 'playback',
    localOwner: { pluginId: 'pet.speech-output', instanceId: 'default', generation: 1 },
    localTaskId: 'task',
    localStreamId: 'stream',
    remoteBinding: { providerRef: 'pet.tts-magpie/magpie', bindingId: 'binding' },
  };
  const listener = vi.fn();
  expect(bridge.onAudio(listener)).toBe(off);
  const start: DesktopSpeechAudioEvent = {
    ...identity,
    sequence: 0,
    kind: 'start',
    format: SPEECH_FORMAT,
    volume: 80,
  };
  receive(start);
  expect(listener).toHaveBeenCalledWith(start);
  const bytes = new Uint8Array([1, 2]);
  receive({ ...identity, sequence: 1, kind: 'chunk', byteLength: 2 }, bytes);
  bytes.fill(9);
  expect(listener.mock.calls[1]?.[1]).toEqual(new Uint8Array([1, 2]));
  expect(() =>
    receive({ ...identity, sequence: 2, kind: 'chunk', byteLength: 4 }, bytes),
  ).toThrow();
  expect(() => receive(start, bytes)).toThrow();
  expect(() => bridge.onAudio(null as unknown as () => void)).toThrow();
});
