import { expect, it, vi } from 'vitest';
import type { DemoController } from './demo-controller.js';
import { handleDemoRequest, type DemoRequestSource } from './demo-request.js';
const source: DemoRequestSource = {
  senderId: 1,
  expectedId: 1,
  mainFrame: true,
  frameUrl: 'file:///console/index.html',
  expectedUrl: 'file:///console/index.html',
  role: 'console',
};
it('does not grant capture or key administration to pet views or untrusted frames', async () => {
  const snapshot = vi.fn(async () => ({})),
    beginRecording = vi.fn(),
    saveKey = vi.fn();
  const demo = { snapshot, beginRecording, saveKey } as unknown as DemoController;
  for (const changed of [
    { senderId: 2 },
    { mainFrame: false },
    { frameUrl: source.frameUrl + '#wrong' },
  ])
    expect(await handleDemoRequest({ ...source, ...changed }, 'snapshot', [], demo)).toMatchObject({
      ok: false,
      error: { code: 'permission-denied' },
    });
  for (const action of ['record', 'key', 'clear'] as const)
    expect(await handleDemoRequest({ ...source, role: 'pet' }, action, [], demo)).toMatchObject({
      ok: false,
      error: { code: 'permission-denied' },
    });
  expect(snapshot).not.toHaveBeenCalled();
  expect(beginRecording).not.toHaveBeenCalled();
  expect(saveKey).not.toHaveBeenCalled();
});
it('keeps PCM out of JSON and validates arity before dispatch', async () => {
  const pushAudio = vi.fn(() => ({ ok: true, value: null }));
  const demo = { pushAudio } as unknown as DemoController;
  const bytes = new Uint8Array(4),
    header = { token: 'ticket', sequence: 0 };
  expect(await handleDemoRequest(source, 'pcm', [header, bytes], demo)).toEqual({
    ok: true,
    value: null,
  });
  expect(pushAudio).toHaveBeenCalledWith('ticket', 1, 0, bytes);
  expect(
    await handleDemoRequest(source, 'pcm', [{ ...header, payload: [0, 0, 0, 0] }], demo),
  ).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
  expect(
    await handleDemoRequest(
      source,
      'ready',
      [{ token: 'ticket', sampleRate: 16000, path: 'forbidden' }],
      demo,
    ),
  ).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
  expect(pushAudio).toHaveBeenCalledOnce();
});
