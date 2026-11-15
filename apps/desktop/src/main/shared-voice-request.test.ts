import { expect, it, vi } from 'vitest';
import { DESKTOP_VOICE_IPC, type Result } from '@pet/contracts';
import { handleDesktopVoiceRequest, type DesktopVoiceAction } from './shared-voice-request.js';
import type { SharedVoiceController } from './shared-voice-controller.js';
import type { CompanionVoiceService } from './companion-voice-service.js';
const source = {
  senderId: 1,
  expectedId: 1,
  mainFrame: true,
  frameUrl: 'file:///console.html',
  expectedUrl: 'file:///console.html',
  role: 'console' as const,
};
const success: Result<null> = { ok: true, value: null };
function fixture() {
  const controller = {
    begin: vi.fn(async () => success),
    captureReady: vi.fn(async () => success),
    pushAudio: vi.fn(async () => success),
    reportCaptureReleased: vi.fn(async () => success),
    getState: vi.fn(async () => success),
  };
  const session = {
    readVoice: vi.fn(async () => success),
    saveSettings: vi.fn(async () => success),
    saveProvider: vi.fn(async () => success),
  };
  const service = { voiceSession: vi.fn(() => session) };
  const frame = {};
  const call = (
    action: DesktopVoiceAction,
    args: unknown[],
    caller = source,
    sender: object | null = frame,
  ) =>
    handleDesktopVoiceRequest(
      caller,
      sender,
      action,
      args,
      controller as unknown as SharedVoiceController,
      service as unknown as CompanionVoiceService,
    );
  return { call, controller, service, frame, session };
}
it('every voice action refuses Pet, foreign/subframes and missing exact frame before any authority lookup', async () => {
  const f = fixture();
  for (const action of Object.keys(DESKTOP_VOICE_IPC).filter(
    (item) => item !== 'changed',
  ) as DesktopVoiceAction[]) {
    const args =
      action === 'getState' ? [] : [{ connectionId: 'connection', captureId: 'capture' }];
    for (const caller of [
      { ...source, mainFrame: false },
      { ...source, frameUrl: 'file:///pet.html' },
      { ...source, role: 'pet' as const },
    ])
      expect(
        await handleDesktopVoiceRequest(
          caller,
          f.frame,
          action,
          args,
          f.controller as unknown as SharedVoiceController,
          f.service as unknown as CompanionVoiceService,
        ),
      ).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    expect(await f.call(action, args, source, null)).toMatchObject({
      ok: false,
      error: { code: 'permission-denied' },
    });
  }
  expect(f.service.voiceSession).not.toHaveBeenCalled();
  for (const method of Object.values(f.controller)) expect(method).not.toHaveBeenCalled();
});
it('validates exact keys and arity, keeps binary outside JSON, and release never looks up current service binding', async () => {
  const f = fixture();
  const key = { connectionId: 'connection', captureId: 'capture' };
  expect((await f.call('begin', [{ ...key, url: 'http://127.0.0.1' }])).ok).toBe(false);
  expect((await f.call('getState', [null])).ok).toBe(false);
  expect((await f.call('pushAudio', [{ ...key, sequence: 0 }, [0, 1]])).ok).toBe(false);
  expect((await f.call('pushAudio', [{ ...key, sequence: 0 }, new Uint8Array(4), null])).ok).toBe(
    false,
  );
  const bytes = new Uint8Array(6400);
  expect((await f.call('pushAudio', [{ ...key, sequence: 0 }, bytes])).ok).toBe(true);
  expect(f.controller.pushAudio).toHaveBeenCalledWith(key, f.frame, 0, bytes);
  expect((await f.call('reportCaptureReleased', [key])).ok).toBe(true);
  expect(f.controller.reportCaptureReleased).toHaveBeenCalledWith(key, f.frame);
  expect(f.service.voiceSession).not.toHaveBeenCalled();
});
it('requires the complete captured begin selection and forwards it without allocating new choices', async () => {
  const f = fixture();
  const input = {
    connectionId: 'connection',
    captureId: 'capture',
    expectedFeatureRevision: 2,
    providerRef: 'pet.asr-magpie/magpie',
    bindingId: 'rendered-binding',
    finishMode: 'review',
  };
  for (const key of ['expectedFeatureRevision', 'providerRef', 'bindingId', 'finishMode']) {
    const incomplete = { ...input } as Record<string, unknown>;
    delete incomplete[key];
    expect((await f.call('begin', [incomplete])).ok).toBe(false);
  }
  expect((await f.call('begin', [input])).ok).toBe(true);
  expect(f.controller.begin).toHaveBeenCalledWith(input, f.frame);
  expect(f.service.voiceSession).not.toHaveBeenCalled();
});
it('accepts only the two fixed bounded settings DTOs and rejects credential/path fields', async () => {
  const f = fixture();
  const settings = {
    providerRef: 'pet.asr-magpie/magpie',
    expectedRevision: 0,
    finishMode: 'send',
  };
  expect(
    (await f.call('saveVoiceSettings', [{ connectionId: 'connection', command: settings }])).ok,
  ).toBe(true);
  const provider = {
    providerRef: 'pet.asr-magpie/magpie',
    expectedRevision: 0,
    settings: {
      baseUrl: 'http://127.0.0.1:1/v1',
      modelRef: 'fixture/asr',
      authMode: 'local-client-id',
      protocol: 'mimo-native',
    },
  };
  expect(
    (await f.call('saveAsrProvider', [{ connectionId: 'connection', command: provider }])).ok,
  ).toBe(true);
  for (const extra of [{ key: 'secret' }, { path: '/api/voice/credential' }]) {
    expect(
      (
        await f.call('saveAsrProvider', [
          { connectionId: 'connection', command: { ...provider, ...extra } },
        ])
      ).ok,
    ).toBe(false);
    expect(
      (
        await f.call('saveVoiceSettings', [
          { connectionId: 'connection', command: { ...settings, ...extra } },
        ])
      ).ok,
    ).toBe(false);
  }
  expect(f.session.saveSettings).toHaveBeenCalledTimes(1);
  expect(f.session.saveProvider).toHaveBeenCalledTimes(1);
});
