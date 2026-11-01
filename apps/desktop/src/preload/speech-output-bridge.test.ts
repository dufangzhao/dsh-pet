import { expect, it, vi } from 'vitest';
import { SPEECH_OUTPUT_IPC, type SpeechOutputAudioEvent } from '@pet/contracts';
import { createSpeechOutputBridge } from './speech-output-bridge.js';
it('exposes fixed frozen calls, enforces arity and disposes owned subscriptions', async () => {
  const invoke = vi.fn(async () => ({ ok: true, value: null })),
    detach = vi.fn();
  const bridge = createSpeechOutputBridge(
    invoke,
    () => detach,
    () => detach,
  );
  expect(Object.isFrozen(bridge)).toBe(true);
  await bridge.speak({ text: '你好', utteranceId: 'reply-1' });
  expect(invoke).toHaveBeenCalledWith(SPEECH_OUTPUT_IPC.speak, {
    text: '你好',
    utteranceId: 'reply-1',
  });
  expect(await Reflect.apply(bridge.stop, bridge, [1])).toMatchObject({
    ok: false,
    error: { code: 'invalid-input' },
  });
  expect(invoke).toHaveBeenCalledOnce();
  bridge.onChanged(() => {})();
  expect(detach).toHaveBeenCalledOnce();
});
it('delivers owned binary audio separately and rejects oversized or mismatched chunks', () => {
  let send: ((event: SpeechOutputAudioEvent, payload?: Uint8Array) => void) | undefined;
  const bridge = createSpeechOutputBridge(
    async () => null,
    () => () => {},
    (callback) => {
      send = callback;
      return () => {};
    },
  );
  const received = vi.fn();
  bridge.onAudio(received);
  const owner = { pluginId: 'pet.profile', instanceId: 'default', generation: 1 };
  const event: SpeechOutputAudioEvent = {
    kind: 'chunk',
    playbackId: 'play-1',
    utteranceId: 'reply-1',
    taskId: 'task-1',
    owner,
    provider: owner,
    sequence: 1,
    byteLength: 2,
  };
  const bytes = new Uint8Array([1, 2]);
  send?.(event, bytes);
  bytes.fill(0);
  expect(received.mock.calls[0]?.[1]).toEqual(new Uint8Array([1, 2]));
  send?.(event, new Uint8Array(3));
  send?.({ ...event, byteLength: 262145 }, new Uint8Array(262145));
  expect(received).toHaveBeenCalledOnce();
});
