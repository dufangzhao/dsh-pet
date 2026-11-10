import { expect, it, vi } from 'vitest';
import {
  makeError,
  type VoiceTicket,
  type VoiceCaptureResult,
  type OwnerRef,
} from '@pet/contracts';
import { SharedVoiceController } from './shared-voice-controller.js';
import type { CompanionVoiceService, CompanionVoiceSession } from './companion-voice-service.js';
import type { VoiceCaptureHost } from './shared-voice-capture-host.js';
const deferred = () => {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const ticket: VoiceTicket = {
  version: 1,
  captureId: 'capture',
  clientId: 'client',
  agentId: 'agent',
  serviceEpoch: 'epoch',
  bindingId: 'binding',
  finishMode: 'send',
  expiresAt: Date.now() + 120000,
  encoding: 'f32le',
  sampleRate: 16000,
  channels: 1,
  chunkSamples: 1600,
  maxSamples: 320000,
};
const final: VoiceCaptureResult = {
  ticket,
  phase: 'final',
  samples: 1,
  cleanup: 'settled',
  outcome: { kind: 'final', text: 'fixture' },
  error: null,
  completedAt: 1,
};
function fixture() {
  const initialFrame = {};
  let frame: object | null = initialFrame;
  const source = new AbortController();
  const connection = new AbortController();
  const owner: OwnerRef = { pluginId: 'pet.audio-capture', instanceId: 'default', generation: 1 };
  let retiring: (id: string) => Promise<void> = async () => {};
  const leaseEnd = deferred();
  const session: CompanionVoiceSession = {
    connectionId: 'connection',
    clientId: 'client',
    agentId: 'agent',
    signal: connection.signal,
    isCurrent: async () => !connection.signal.aborted,
    readVoice: vi.fn(),
    saveSettings: vi.fn(),
    saveProvider: vi.fn(),
    catalog: vi.fn(),
    begin: vi.fn(async () => ({ ok: true as const, value: ticket })),
    upload: vi.fn(async () => ({ ok: true as const, value: final })),
    result: vi.fn(async () => ({ ok: true as const, value: final })),
    cancel: vi.fn(async () => ({
      ok: true as const,
      value: { ...final, phase: 'cancelled' as const },
    })),
  };
  const service: CompanionVoiceService = {
    voiceSession: vi.fn(() => session),
    onVoiceRetiring(listener) {
      retiring = listener;
      return () => {};
    },
  };
  let physicallyReleased = false;
  const host: VoiceCaptureHost = {
    acquire: vi.fn(async (_signal, released) => {
      void released.then(() => {
        physicallyReleased = true;
        leaseEnd.resolve();
      });
      return {
        owner,
        signal: source.signal,
        settled: leaseEnd.promise,
        valid: () => !source.signal.aborted && !physicallyReleased,
        sourceValid: () => !source.signal.aborted,
        isCurrent: async () => !source.signal.aborted,
      };
    }),
  };
  const controller = new SharedVoiceController(
    service,
    host,
    () => frame,
    () => {},
  );
  const key = { connectionId: 'connection', captureId: 'capture' };
  const input = {
    ...key,
    expectedFeatureRevision: 1,
    providerRef: 'pet.asr-magpie/magpie',
    bindingId: 'binding',
    finishMode: 'send' as const,
  };
  return {
    controller,
    session,
    host,
    key,
    input,
    initialFrame,
    source,
    service,
    replaceFrame() {
      frame = {};
      return frame;
    },
    retire() {
      connection.abort();
      return retiring('connection');
    },
    released: () => physicallyReleased,
  };
}
const pcm = (count: number, value = 0.25) =>
  new Uint8Array(new Float32Array(count).fill(value).buffer);
it('forwards the rendered selection and rejects stale configuration before any microphone task', async () => {
  const f = fixture();
  vi.mocked(f.session.begin).mockResolvedValue({ ok: false, error: makeError('conflict', false) });
  expect(
    await f.controller.begin(
      { ...f.input, expectedFeatureRevision: 0, finishMode: 'review', bindingId: 'old-binding' },
      f.initialFrame,
    ),
  ).toMatchObject({ ok: false, error: { code: 'conflict' } });
  expect(f.session.begin).toHaveBeenCalledWith(
    {
      captureId: 'capture',
      expectedFeatureRevision: 0,
      providerRef: 'pet.asr-magpie/magpie',
      bindingId: 'old-binding',
      finishMode: 'review',
    },
    expect.any(AbortSignal),
  );
  expect(f.host.acquire).not.toHaveBeenCalled();
  expect(f.controller.microphoneAllowed(f.initialFrame)).toBe(false);
  await f.controller.close();
});
it('same capture ID coalesces only the identical complete intent and rejects changed revision/provider/binding/mode', async () => {
  const f = fixture();
  const first = f.controller.begin(f.input, f.initialFrame);
  expect(f.controller.begin({ ...f.input }, f.initialFrame)).toBe(first);
  for (const change of [
    { expectedFeatureRevision: 2 },
    { providerRef: 'pet.other/provider' },
    { bindingId: 'other' },
    { finishMode: 'review' as const },
  ])
    expect(await f.controller.begin({ ...f.input, ...change }, f.initialFrame)).toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    });
  await first;
  expect(f.session.begin).toHaveBeenCalledTimes(1);
  expect(f.host.acquire).toHaveBeenCalledTimes(1);
  await f.controller.reportCaptureReleased(f.key, f.initialFrame);
  await f.controller.cancelCapture(f.key, f.initialFrame);
  await f.controller.close();
});
it('accepts bounded ordered frames and a tail; release ends mic task but finish still uploads full owned clip', async () => {
  const f = fixture();
  expect((await f.controller.begin(f.input, f.initialFrame)).ok).toBe(true);
  expect(f.controller.microphoneAllowed(f.initialFrame)).toBe(true);
  expect((await f.controller.captureReady(f.key, f.initialFrame, 16000)).ok).toBe(true);
  const first = pcm(1600);
  expect((await f.controller.pushAudio(f.key, f.initialFrame, 0, first)).ok).toBe(true);
  first.fill(0); // renderer cannot mutate Main's accepted frame
  expect((await f.controller.pushAudio(f.key, f.initialFrame, 1, pcm(37))).ok).toBe(true);
  expect((await f.controller.finishCapture(f.key, f.initialFrame, 2)).ok).toBe(false);
  expect(f.session.upload).not.toHaveBeenCalled();
  await f.controller.reportCaptureReleased(f.key, f.initialFrame);
  expect(f.released()).toBe(true);
  expect(f.controller.microphoneAllowed(f.initialFrame)).toBe(false);
  expect((await f.controller.finishCapture(f.key, f.initialFrame, 1)).ok).toBe(false);
  const result = await f.controller.finishCapture(f.key, f.initialFrame, 2);
  expect(result).toEqual({ ok: true, value: final });
  expect(f.session.upload).toHaveBeenCalledTimes(1);
  const args = vi.mocked(f.session.upload).mock.calls[0];
  expect(args?.[1]).toBe(1637);
  expect(args?.[2].byteLength).toBe(6548);
  if (!args) throw new Error('No completed audio upload');
  expect(new DataView(args[2].buffer).getFloat32(0, true)).toBe(0.25);
  expect(await f.controller.getState()).toMatchObject({
    ok: true,
    value: { phase: 'idle', cleanup: 'settled' },
  });
  await f.controller.close();
});
it('rejects nonfinite PCM, duplicate/out of order sequence and bytes after a partial tail without accepting them', async () => {
  const f = fixture();
  await f.controller.begin(f.input, f.initialFrame);
  expect((await f.controller.pushAudio(f.key, f.initialFrame, 0, pcm(1))).ok).toBe(false);
  await f.controller.captureReady(f.key, f.initialFrame, 16000);
  for (const bytes of [pcm(1, NaN), pcm(1, Infinity), pcm(1601), new Uint8Array(3), pcm(1, 1.01)])
    expect((await f.controller.pushAudio(f.key, f.initialFrame, 0, bytes)).ok).toBe(false);
  expect((await f.controller.pushAudio(f.key, f.initialFrame, 1, pcm(1600))).ok).toBe(false);
  expect((await f.controller.pushAudio(f.key, f.initialFrame, 0, pcm(1))).ok).toBe(true);
  expect((await f.controller.pushAudio(f.key, f.initialFrame, 0, pcm(1))).ok).toBe(false);
  expect((await f.controller.pushAudio(f.key, f.initialFrame, 1, pcm(1))).ok).toBe(false);
  expect(await f.controller.getState()).toMatchObject({ ok: true, value: { samples: 1 } });
  await f.controller.reportCaptureReleased(f.key, f.initialFrame);
  await f.controller.cancelCapture(f.key, f.initialFrame);
  await f.controller.close();
});
it('retarget joins real release; exact old ACK does zero service I/O, replacement frame cannot ACK or grant permission', async () => {
  const f = fixture();
  await f.controller.begin(f.input, f.initialFrame);
  let settled = false;
  const retired = f.retire().then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(f.controller.microphoneAllowed(f.initialFrame)).toBe(false);
  expect(await f.controller.getState()).toMatchObject({
    ok: true,
    value: { phase: 'retiring', cleanup: 'pending' },
  });
  expect((await f.controller.begin({ ...f.input, captureId: 'other' }, f.initialFrame)).ok).toBe(
    false,
  );
  expect((await f.controller.reportCaptureReleased(f.key, {})).ok).toBe(false);
  expect(f.released()).toBe(false);
  const calls = vi.mocked(f.service.voiceSession).mock.calls.length;
  expect((await f.controller.reportCaptureReleased(f.key, f.initialFrame)).ok).toBe(true);
  await retired;
  expect(vi.mocked(f.service.voiceSession).mock.calls.length).toBe(calls);
  expect(f.session.cancel).not.toHaveBeenCalled();
  expect(f.session.upload).not.toHaveBeenCalled();
  expect((await f.controller.reportCaptureReleased(f.key, f.initialFrame)).ok).toBe(false);
  await f.controller.close();
});
it('cancel fences immediately but a pending getUserMedia owner remains pending until actual release', async () => {
  const f = fixture();
  await f.controller.begin(f.input, f.initialFrame);
  const cancelled = await f.controller.cancelCapture(f.key, f.initialFrame);
  expect(cancelled).toMatchObject({ ok: true, value: { phase: 'retiring', cleanup: 'pending' } });
  expect(f.released()).toBe(false);
  expect(f.controller.microphoneAllowed(f.initialFrame)).toBe(false);
  expect((await f.controller.finishCapture(f.key, f.initialFrame, 0)).ok).toBe(false);
  await f.controller.reportCaptureReleased(f.key, f.initialFrame);
  await f.controller.close();
  expect(f.session.upload).not.toHaveBeenCalled();
  expect(f.session.cancel).toHaveBeenCalledTimes(1);
});
it('known frame destruction settles an outstanding physical owner; source withdrawal waits release', async () => {
  const f = fixture();
  await f.controller.begin(f.input, f.initialFrame);
  f.source.abort();
  let stopped = false;
  const stop = f.controller
    .retireSource({ pluginId: 'pet.audio-capture', instanceId: 'default', generation: 1 })
    .then(() => {
      stopped = true;
    });
  await Promise.resolve();
  expect(stopped).toBe(false);
  const replacement = f.replaceFrame();
  expect((await f.controller.reportCaptureReleased(f.key, replacement)).ok).toBe(false);
  f.controller.ownerGone(f.initialFrame);
  await stop;
  expect(f.released()).toBe(true);
  expect(f.session.upload).not.toHaveBeenCalled();
  await f.controller.close();
});
it('coalesces finish and retains failed upload for explicit result recovery, never uploads twice', async () => {
  const f = fixture();
  await f.controller.begin(f.input, f.initialFrame);
  await f.controller.captureReady(f.key, f.initialFrame, 16000);
  await f.controller.reportCaptureReleased(f.key, f.initialFrame);
  vi.mocked(f.session.upload).mockResolvedValue({ ok: false, error: makeError('network', false) });
  const first = f.controller.finishCapture(f.key, f.initialFrame, 0);
  expect(f.controller.finishCapture(f.key, f.initialFrame, 0)).toBe(first);
  expect((await first).ok).toBe(false);
  expect((await f.controller.readCaptureResult({ ...f.key, ...ticket }, f.initialFrame)).ok).toBe(
    true,
  );
  expect(f.session.upload).toHaveBeenCalledTimes(1);
  expect(await f.controller.getState()).toMatchObject({ ok: true, value: { phase: 'idle' } });
  await f.controller.close();
});
