import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpeechPlaybackOwner } from './playback.js';
import type { SpeechOutputAudioEvent } from '@pet/contracts';
const owner = { pluginId: 'pet.profile', instanceId: 'default', generation: 1 };
const provider = { pluginId: 'pet.system-tts', instanceId: 'default', generation: 1 };
const identity = {
  playbackId: 'play-1',
  taskId: 'play-task-1',
  utteranceId: 'reply-1',
  owner,
  provider,
};
const descriptor = {
  utteranceId: 'reply-1',
  codec: 'pcm-s16le' as const,
  sampleRate: 24000,
  channels: 1 as const,
  frames: 2,
  media: { streamId: 'stream-1', taskId: 'synth-task-1', owner: provider },
};
function fixture(resume = Promise.resolve()) {
  const reportPlayback = vi.fn(async () => ({ ok: true as const, value: null }));
  const samples = new Float32Array(2);
  const source = {
    buffer: null,
    onended: null as (() => void) | null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
  const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
  const context = {
    resume: vi.fn(() => resume),
    createBuffer: vi.fn(() => ({ getChannelData: () => samples })),
    createBufferSource: vi.fn(() => source),
    createGain: vi.fn(() => gain),
    destination: {},
    close: vi.fn(async () => {}),
  };
  const createContext = vi.fn(() => context as unknown as AudioContext);
  return {
    owner: new SpeechPlaybackOwner({ reportPlayback }, createContext),
    reportPlayback,
    source,
    gain,
    context,
    createContext,
    samples,
  };
}
function send(p: SpeechPlaybackOwner, override: Partial<typeof identity> = {}): void {
  p.receive({ ...identity, ...override, sequence: 0, kind: 'start', descriptor, volume: 85 });
  p.receive(
    { ...identity, ...override, sequence: 1, kind: 'chunk', byteLength: 4 },
    new Uint8Array([0, 128, 255, 127]),
  );
  p.receive({ ...identity, ...override, sequence: 2, kind: 'end' });
}
afterEach(() => vi.restoreAllMocks());
describe('one Pet playback owner', () => {
  it('decodes the declared PCM, reports actual playback and releases audio resources', async () => {
    const f = fixture();
    send(f.owner);
    await vi.waitFor(() => expect(f.source.start).toHaveBeenCalledOnce());
    expect(f.samples[0]).toBe(-1);
    expect(f.samples[1]).toBeCloseTo(32767 / 32768);
    expect(f.gain.gain.value).toBe(0.85);
    expect(f.reportPlayback).toHaveBeenCalledWith({ playbackId: 'play-1', status: 'started' });
    f.source.onended?.();
    expect(f.reportPlayback).toHaveBeenCalledWith({ playbackId: 'play-1', status: 'ended' });
    expect(f.context.close).toHaveBeenCalledOnce();
    expect(f.source.disconnect).toHaveBeenCalledOnce();
    f.owner.close();
  });
  it('stops immediately while context resume is pending and never starts the late result', async () => {
    let resume: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const f = fixture(pending);
    send(f.owner);
    f.owner.receive({ ...identity, sequence: 3, kind: 'stop' });
    resume?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(f.source.start).not.toHaveBeenCalled();
    expect(f.context.close).toHaveBeenCalledOnce();
    expect(f.reportPlayback).not.toHaveBeenCalled();
    f.owner.close();
  });
  it('rejects sequence gaps and frame mismatches before starting the device', async () => {
    const f = fixture();
    f.owner.receive({ ...identity, sequence: 0, kind: 'start', descriptor, volume: 85 });
    f.owner.receive({ ...identity, sequence: 2, kind: 'chunk', byteLength: 4 }, new Uint8Array(4));
    expect(f.reportPlayback).toHaveBeenCalledWith({ playbackId: 'play-1', status: 'failed' });
    expect(f.createContext).not.toHaveBeenCalled();
    f.reportPlayback.mockClear();
    f.owner.receive({ ...identity, sequence: 0, kind: 'start', descriptor, volume: 85 });
    f.owner.receive({ ...identity, sequence: 1, kind: 'end' });
    expect(f.reportPlayback).toHaveBeenCalledWith({ playbackId: 'play-1', status: 'failed' });
    expect(f.createContext).not.toHaveBeenCalled();
    f.owner.close();
  });
  it('ignores stale owner events and exposes a real device failure', async () => {
    const f = fixture(Promise.reject(new Error('device unavailable')));
    f.owner.receive({ ...identity, sequence: 0, kind: 'start', descriptor, volume: 85 });
    f.owner.receive(
      {
        ...identity,
        sequence: 1,
        kind: 'chunk',
        byteLength: 4,
        provider: { ...provider, generation: 2 },
      },
      new Uint8Array(4),
    );
    f.owner.receive({ ...identity, sequence: 1, kind: 'chunk', byteLength: 4 }, new Uint8Array(4));
    f.owner.receive({ ...identity, sequence: 2, kind: 'end' } as SpeechOutputAudioEvent);
    await vi.waitFor(() =>
      expect(f.reportPlayback).toHaveBeenCalledWith({ playbackId: 'play-1', status: 'failed' }),
    );
    expect(f.source.start).not.toHaveBeenCalled();
    f.owner.close();
  });
});
