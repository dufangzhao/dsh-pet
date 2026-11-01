import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import {
  APPLICATION_PLUGIN_IDS,
  makeError,
  type OwnerRef,
  type PluginManifest,
  type SpeechOutputAudioEvent,
  type TaskEvent,
} from '@pet/contracts';
import {
  ConfigService,
  MemoryConfigStore,
  PluginManager,
  TaskSupervisor,
  record,
  type RuntimeDriver,
} from '@pet/host-kernel';
import profileManifestJson from '../../../../plugins/profile/plugin.json' with { type: 'json' };
import systemManifestJson from '../../../../plugins/system-tts/plugin.json' with { type: 'json' };
import tonesManifestJson from '../../../../plugins/builtin-speech/plugin.json' with { type: 'json' };
import { SpeechOutputController, handleSpeechOutputRequest } from './speech-output-controller.js';
import type { DesktopHost } from './desktop-host.js';
const profileIdentity = { pluginId: APPLICATION_PLUGIN_IDS.profile, instanceId: 'default' };
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});
const unwrap = <T>(r: { ok: true; value: T } | { ok: false; error: { code: string } }): T => {
  if (!r.ok) throw new Error(r.error.code);
  return r.value;
};
async function fixture(options: { hold?: boolean; forge?: boolean; deny?: boolean } = {}) {
  let release: (() => void) | undefined;
  const calls = vi.fn();
  const events: { event: SpeechOutputAudioEvent; payload?: Uint8Array }[] = [];
  const taskEvents: TaskEvent<never>[] = [];
  const driver: RuntimeDriver = {
    start(activation, registrar) {
      for (const p of activation.manifest.provides ?? [])
        registrar.provide(p.id, {
          synthesize: async (task, input) => {
            calls(activation.owner, input);
            if (options.hold)
              await new Promise<void>((resolve) => {
                release = resolve;
                task.signal.addEventListener('abort', () => resolve(), { once: true });
              });
            if (task.signal.aborted) return null;
            const body = record(input);
            const reference = {
              streamId: 'stream-' + task.taskId,
              taskId: task.taskId,
              owner: activation.owner,
            };
            const pcm = new Uint8Array([0, 0, 100, 0]);
            const reader = {
              reference,
              cancel: vi.fn(),
              async *[Symbol.asyncIterator]() {
                yield pcm;
              },
            };
            expect(speech.output(reference, reader)).toBe(true);
            return {
              utteranceId: body?.['utteranceId'] ?? '',
              codec: 'pcm-s16le',
              sampleRate: 24000,
              channels: 1,
              frames: 2,
              media: {
                ...reference,
                owner: options.forge
                  ? { ...reference.owner, generation: reference.owner.generation + 1 }
                  : { ...reference.owner },
              },
            };
          },
        });
      return { ready: Promise.resolve(), stop: async () => {} };
    },
  };
  const manager = new PluginManager({
    driver,
    hostApiVersion: '1.0.0',
    platform: 'win32-x64',
    trust: async () => true,
    readiness: async () => null,
  });
  const configs = new ConfigService(new MemoryConfigStore(), (owner) => manager.isLive(owner));
  for (const raw of [profileManifestJson, systemManifestJson, tonesManifestJson]) {
    const manifest = raw as unknown as PluginManifest;
    unwrap(manager.install(manifest, { directory: path.resolve('.'), origin: 'builtin' }));
    const identity = { pluginId: manifest.id, instanceId: 'default' };
    unwrap(configs.register(identity, manifest));
    const config = unwrap(await configs.initialize(identity));
    const enabled = unwrap(await manager.enable(identity, config.data));
    expect(enabled.state).toBe('active');
  }
  const tasks = new TaskSupervisor(manager);
  tasks.subscribe((event) => taskEvents.push(event));
  const authorize = vi.fn(
    async (_owner: OwnerRef, _taskId: string, _permission: unknown, signal: AbortSignal) =>
      options.deny
        ? { ok: false, error: makeError('permission-denied', false) }
        : { ok: true, value: { signal, isValid: () => !signal.aborted, close: () => {} } },
  );
  const host = { manager, tasks, configs, permissions: { authorize } } as unknown as DesktopHost;
  const speech = new SpeechOutputController(host, vi.fn(), (event, payload) =>
    events.push({ event, ...(payload ? { payload } : {}) }),
  );
  cleanups.push(async () => {
    speech.close();
    tasks.shutdown();
    configs.close();
    await manager.shutdown();
  });
  const begin = async (text = '你好，桌宠。', id = 'reply-1') => {
    expect(await speech.speak(text, id)).toEqual({ ok: true, value: null });
    await vi.waitFor(() => expect(calls).toHaveBeenCalled());
  };
  const playback = async (): Promise<SpeechOutputAudioEvent> => {
    await vi.waitFor(() => expect(events.some((x) => x.event.kind === 'end')).toBe(true));
    const event = events.find((x) => x.event.kind === 'start')?.event;
    if (!event) throw new Error('Playback did not start');
    return event;
  };
  return {
    speech,
    manager,
    tasks,
    configs,
    calls,
    events,
    taskEvents,
    authorize,
    begin,
    playback,
    release: () => release?.(),
    options,
  };
}

describe('owned speech synthesis and Pet playback tasks', () => {
  it('binds the selected voice, transports owned PCM separately, then waits for actual playback receipts', async () => {
    const f = await fixture();
    await f.begin();
    const event = await f.playback();
    expect(f.calls.mock.calls[0]?.[0].pluginId).toBe('pet.system-tts');
    expect(f.events.map((x) => x.event.kind)).toEqual(['start', 'chunk', 'end']);
    expect(f.events.map((x) => x.event.sequence)).toEqual([0, 1, 2]);
    expect(f.events[1]?.payload).toEqual(new Uint8Array([0, 0, 100, 0]));
    expect(JSON.stringify(f.events[0]?.event)).not.toContain('payload');
    expect(f.tasks.diagnostics().activeTasks).toBe(1);
    expect(f.speech.reportPlayback({ playbackId: event.playbackId, status: 'started' }).ok).toBe(
      true,
    );
    expect((await f.speech.snapshot()).phase).toBe('playing');
    expect(f.speech.reportPlayback({ playbackId: event.playbackId, status: 'ended' }).ok).toBe(
      true,
    );
    expect(
      f.speech.reportPlayback({ playbackId: event.playbackId, status: 'ended' }),
    ).toMatchObject({ ok: false, error: { code: 'stale-owner' } });
    await vi.waitFor(async () => expect((await f.speech.snapshot()).current).toBeNull());
    expect(new Set(f.taskEvents.map((e) => e.taskId)).size).toBe(2);
    await vi.waitFor(() => expect(f.tasks.diagnostics().pendingWork).toBe(0));
  });
  it('stops synthesis and queued utterances without deleting text or accepting late audio', async () => {
    const f = await fixture({ hold: true });
    await f.begin();
    await f.speech.speak('第二句话。', 'reply-2');
    expect((await f.speech.snapshot()).queued).toBe(1);
    await f.speech.stop();
    f.release();
    await vi.waitFor(() => expect(f.tasks.diagnostics().pendingWork).toBe(0));
    const snapshot = await f.speech.snapshot();
    expect(snapshot).toMatchObject({
      phase: 'idle',
      current: null,
      queued: 0,
      lastUtterance: { text: '第二句话。', utteranceId: 'reply-2' },
    });
    expect(f.calls).toHaveBeenCalledOnce();
    expect(f.events).toEqual([]);
  });
  it('uses exact CAS, keeps unrelated preferences, and disables active playback plus its queue', async () => {
    const f = await fixture();
    await f.begin();
    const audio = await f.playback();
    const before = unwrap(await f.configs.get(profileIdentity));
    const request = {
      expectedRevision: before.revision - 1,
      enabled: false,
      provider: { pluginId: 'pet.system-tts', instanceId: 'default', providerId: 'system' },
      voice: null,
      rate: 0,
      volume: 85,
    };
    expect(await f.speech.saveSettings(request)).toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    });
    expect(f.events.at(-1)?.event.kind).toBe('end');
    await f.speech.speak('待取消。', 'reply-2');
    const saved = unwrap(
      await f.speech.saveSettings({ ...request, expectedRevision: before.revision }),
    );
    expect(saved.settings.enabled).toBe(false);
    expect(saved.current).toBeNull();
    expect(saved.queued).toBe(0);
    expect(f.events.at(-1)?.event.kind).toBe('stop');
    expect(unwrap(await f.configs.get(profileIdentity)).data['petName']).toBe(
      before.data['petName'],
    );
    expect(
      f.speech.reportPlayback({ playbackId: audio.playbackId, status: 'ended' }),
    ).toMatchObject({ ok: false, error: { code: 'stale-owner' } });
    expect(await f.speech.speak('保留文字。', 'reply-3')).toMatchObject({
      ok: false,
      error: { code: 'not-ready' },
    });
  });
  it('never falls back to tones when the selected system provider is disabled', async () => {
    const f = await fixture();
    unwrap(await f.manager.disable({ pluginId: 'pet.system-tts', instanceId: 'default' }));
    f.speech.onHostChanged();
    expect(await f.speech.speak('文字仍在。', 'reply-1')).toMatchObject({
      ok: false,
      error: { code: 'not-ready' },
    });
    expect(f.calls).not.toHaveBeenCalled();
    expect((await f.speech.snapshot()).lastUtterance?.text).toBe('文字仍在。');
  });
  it('cancels already playing audio when its provider generation is disabled', async () => {
    const f = await fixture();
    await f.begin();
    await f.playback();
    unwrap(await f.manager.disable({ pluginId: 'pet.system-tts', instanceId: 'default' }));
    expect(f.events.at(-1)?.event.kind).toBe('stop');
    await vi.waitFor(() => expect(f.tasks.diagnostics().pendingWork).toBe(0));
    expect((await f.speech.snapshot()).current).toBeNull();
  });
  it('rejects forged audio references and permission denial without starting playback', async () => {
    const forged = await fixture({ forge: true });
    await forged.begin();
    await vi.waitFor(async () =>
      expect((await forged.speech.snapshot()).reason).toBe('invalid-audio'),
    );
    expect(forged.events).toEqual([]);
    const denied = await fixture({ deny: true });
    await denied.speech.speak('不会发声。', 'reply-1');
    await vi.waitFor(async () =>
      expect((await denied.speech.snapshot()).error?.code).toBe('permission-denied'),
    );
    expect(denied.calls).not.toHaveBeenCalled();
    expect(denied.events).toEqual([]);
  });
  it('bounds the pending queue and clears it when global sound is muted', async () => {
    const f = await fixture({ hold: true });
    await f.begin();
    for (let i = 2; i <= 4; i++)
      expect((await f.speech.speak('排队。', 'reply-' + i)).ok).toBe(true);
    expect(await f.speech.speak('超出队列。', 'reply-5')).toMatchObject({
      ok: false,
      error: { code: 'quota-exceeded' },
    });
    expect((await f.speech.snapshot()).queued).toBe(3);
    const profile = unwrap(await f.configs.get(profileIdentity));
    unwrap(
      await f.configs.save(
        profileIdentity,
        { ...profile.data, soundEnabled: false },
        profile.revision,
      ),
    );
    f.speech.onHostChanged();
    await vi.waitFor(async () => expect((await f.speech.snapshot()).current).toBeNull());
    f.release();
    expect((await f.speech.snapshot()).queued).toBe(0);
    expect((await f.speech.snapshot()).lastUtterance?.text).toBe('超出队列。');
    expect(f.calls).toHaveBeenCalledOnce();
    expect(f.events).toEqual([]);
    await vi.waitFor(() => expect(f.tasks.diagnostics().pendingWork).toBe(0));
  });
  it('requires the current trusted Pet frame for playback receipts and exact fixed request bodies', async () => {
    const f = await fixture();
    const source = {
      senderId: 1,
      expectedId: 1,
      mainFrame: true,
      frameUrl: 'file:///pet.html',
      expectedUrl: 'file:///pet.html',
      role: 'pet' as const,
    };
    expect(
      await handleSpeechOutputRequest(
        { ...source, mainFrame: false },
        'speak',
        [{ text: '你好', utteranceId: 'reply-1' }],
        f.speech,
      ),
    ).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    expect(
      await handleSpeechOutputRequest(
        source,
        'speak',
        [{ text: '你好', utteranceId: 'reply-1', owner: profileIdentity }],
        f.speech,
      ),
    ).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
    expect(
      await handleSpeechOutputRequest(
        { ...source, role: 'console' },
        'playback',
        [{ playbackId: 'play-1', status: 'ended' }],
        f.speech,
      ),
    ).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    expect(await handleSpeechOutputRequest(source, 'snapshot', [null], f.speech)).toMatchObject({
      ok: false,
      error: { code: 'invalid-input' },
    });
  });
});
