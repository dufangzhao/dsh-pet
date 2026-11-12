import { expect, it, vi } from 'vitest';
import { SPEECH_FORMAT, SPEECH_PROTOCOL, makeError, type Result } from '@pet/contracts';
import { handleDesktopSpeechRequest } from './shared-speech-request.js';
import { initialDesktopSpeechState } from './shared-speech-controller.js';
import type { CompanionSpeechSession, CompanionSpeechService } from './companion-speech-service.js';
const ok = async (): Promise<Result<null>> => ({ ok: true, value: null });
const unavailable = async <T>(): Promise<Result<T>> => ({
  ok: false,
  error: makeError('unavailable', false),
});
it('admits only console configuration and exact Pet cleanup ACK without a service/token lookup', async () => {
  const controller = {
    getState: vi.fn(async () => ({ ok: true as const, value: initialDesktopSpeechState() })),
    stop: vi.fn(async () => ({ ok: true as const, value: initialDesktopSpeechState() })),
    playerReady: vi.fn(ok),
    consume: vi.fn(ok),
    reportPlayback: vi.fn(ok),
    reportReleased: vi.fn(ok),
  };
  const session: CompanionSpeechSession = {
    connectionId: 'connection',
    clientId: 'client',
    agentId: 'agent',
    serviceEpoch: 'epoch',
    signal: new AbortController().signal,
    isCurrent: async () => false,
    baseline: unavailable,
    readSpeech: unavailable,
    saveProvider: vi.fn<CompanionSpeechSession['saveProvider']>(unavailable),
    catalog: unavailable,
    begin: unavailable,
    reserve: unavailable,
    consumeAudio: unavailable,
    status: unavailable,
    cancel: unavailable,
  };
  const service: CompanionSpeechService = {
    getState: unavailable,
    speechSession: vi.fn(() => session),
    onSpeechEvent: () => () => {},
    onSpeechRetiring: () => () => {},
  };
  const source = {
    senderId: 1,
    expectedId: 1,
    mainFrame: true,
    frameUrl: 'file:///pet.html',
    expectedUrl: 'file:///pet.html',
    role: 'pet' as const,
  };
  const frame = {};
  const identity = {
    connectionId: 'old-connection',
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
  const released = { ...identity, sequence: 4, cleanup: 'settled' };
  expect(
    await handleDesktopSpeechRequest(
      source,
      frame,
      'reportReleased',
      [released],
      controller,
      service,
    ),
  ).toEqual({ ok: true, value: null });
  expect(service.speechSession).not.toHaveBeenCalled();
  expect(controller.reportReleased).toHaveBeenCalledWith(released, frame);
  expect(
    await handleDesktopSpeechRequest(
      { ...source, role: 'console' },
      frame,
      'reportReleased',
      [released],
      controller,
      service,
    ),
  ).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
  expect(
    await handleDesktopSpeechRequest(
      { ...source, mainFrame: false },
      frame,
      'playerReady',
      [{ ...identity, sequence: 0, format: SPEECH_FORMAT }],
      controller,
      service,
    ),
  ).toMatchObject({ ok: false });
  expect(
    await handleDesktopSpeechRequest(
      source,
      frame,
      'consume',
      [{ ...identity, sequence: 1, byteLength: 2 }, new Uint8Array(2)],
      controller,
      service,
    ),
  ).toMatchObject({ ok: false });
  expect(
    await handleDesktopSpeechRequest(
      source,
      frame,
      'consume',
      [{ ...identity, sequence: 1, byteLength: 3 }],
      controller,
      service,
    ),
  ).toMatchObject({ ok: false });
  const command = {
    providerRef: 'pet.tts-magpie/magpie',
    expectedRevision: 1,
    settings: {
      baseUrl: 'https://gateway.example',
      modelRef: '',
      authMode: 'gateway-key',
      protocol: SPEECH_PROTOCOL,
      voice: 'Mia',
    },
  };
  const args = [{ connectionId: 'connection', command }];
  expect(
    await handleDesktopSpeechRequest(source, frame, 'saveTtsProvider', args, controller, service),
  ).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
  await handleDesktopSpeechRequest(
    { ...source, role: 'console' },
    frame,
    'saveTtsProvider',
    args,
    controller,
    service,
  );
  expect(session.saveProvider).toHaveBeenCalledWith(command);
  expect(
    await handleDesktopSpeechRequest(
      { ...source, role: 'console' },
      frame,
      'readSpeech',
      [{ connectionId: 'connection', url: 'https://other' }],
      controller,
      service,
    ),
  ).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
});
