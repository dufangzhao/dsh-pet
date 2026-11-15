import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { PluginManifest, VoiceAsrSettings, VoiceFinal } from '@pet/contracts';
import { definePlugin, type PluginContext } from '@pet/plugin-sdk';
import { companionHostDefinition, companionHostManifest } from './core-plugin.js';
import { CompanionPluginHost } from './plugin-host.js';
import { VoiceProviders } from './voice-providers.js';
import type { NativeAsrBinding, VoiceAsrRegistration } from './voice-input-types.js';
function deferred<T = void>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const ref = 'pet.asr-magpie/magpie',
  feature = 'pet.shared-voice';
const settings: VoiceAsrSettings = {
  baseUrl: 'http://127.0.0.1:3425/v1',
  modelRef: 'xiaomi/mimo-v2.5-asr',
  authMode: 'local-client-id',
  protocol: 'mimo-native',
};
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
async function fixture(
  native: NativeAsrBinding,
  options: { noFeatureGrant?: boolean; noProviderFiles?: boolean } = {},
) {
  const directory = await mkdtemp(path.join(tmpdir(), 'voice-provider-test-'));
  const asr = JSON.parse(
    await readFile(new URL('../../../plugins/asr-magpie/plugin.json', import.meta.url), 'utf8'),
  ) as PluginManifest;
  const shared = JSON.parse(
    await readFile(new URL('../../../plugins/shared-voice/plugin.json', import.meta.url), 'utf8'),
  ) as PluginManifest;
  const asrManifest = {
    ...asr,
    permissions: (asr.permissions ?? []).filter(
      (p) => !options.noProviderFiles || p.kind !== 'files',
    ),
  };
  const sharedManifest = {
    ...shared,
    permissions: (shared.permissions ?? []).filter(
      (p) => !options.noFeatureGrant || p.kind !== 'capability-use',
    ),
  };
  let context: PluginContext | undefined;
  for (const manifest of [companionHostManifest, asrManifest, sharedManifest]) {
    const source = path.join(directory, manifest.id);
    await mkdir(source);
    await writeFile(path.join(source, 'plugin.json'), JSON.stringify(manifest));
  }
  const registration: VoiceAsrRegistration = {
    manifest: asrManifest,
    directory: path.join(directory, asr.id),
    enabled: false,
    preset: 'allow',
    hostCredentials: ['asr-api-key'],
    config: { ...settings },
    asr: { providerId: 'magpie', label: 'Synthetic', synthetic: true, parseConfig: () => settings },
    definition: definePlugin({
      async activate(ctx) {
        context = ctx;
        if (!providers) throw new Error('providers unavailable');
        await providers.prepare(ctx);
        ctx.provide('magpie', { describe: async () => null });
        ctx.effect(() => providers?.portsFor(ctx).bind(native) ?? (() => Promise.resolve()));
      },
    }),
  };
  const host = await CompanionPluginHost.create({
    dataDirectory: path.join(directory, 'data'),
    plugins: [
      {
        manifest: companionHostManifest,
        directory: path.join(directory, companionHostManifest.id),
        definition: companionHostDefinition,
        enabled: true,
        preset: 'allow',
      },
      {
        manifest: sharedManifest,
        directory: path.join(directory, shared.id),
        definition: definePlugin({
          activate(ctx) {
            ctx.provide('input', { describe: async () => null });
          },
        }),
        enabled: true,
        preset: 'allow',
      },
      registration,
    ],
  });
  const providers = new VoiceProviders(host, [registration], () => {
    throw new Error('No native transport in synthetic binding');
  });
  const active = providers;
  active.select(ref);
  await active.enable(ref);
  cleanups.push(async () => {
    if (
      path.dirname(directory) !== tmpdir() ||
      !path.basename(directory).startsWith('voice-provider-test-')
    )
      throw new Error('Unexpected fixture path');
    try {
      await active.close();
      await host.close();
    } finally {
      await rm(directory, { recursive: true });
    }
  });
  const binding = active.binding(ref);
  if (!binding || !context) throw new Error('No native binding');
  return { host, providers: active, binding, context, directory };
}
async function* pcm(samples: number): AsyncIterable<Uint8Array> {
  const bytes = new Uint8Array(new Float32Array(samples).fill(0.25).buffer);
  for (let at = 0; at < bytes.length; at += 7999) yield bytes.subarray(at, at + 7999);
}
it('uses the real exact task-owned media pair with credit recycling and keeps generic SDK media unavailable', async () => {
  let bytes = 0,
    frames = 0;
  const result: VoiceFinal = { kind: 'final', text: 'synthetic media result' };
  const f: Awaited<ReturnType<typeof fixture>> = await fixture({
    catalog: async () => [],
    transcribe: async (input, signal) => {
      expect(input.audio.reference.owner).toEqual(f.host.owner('pet.asr-magpie'));
      expect(
        f.host.tasks.taskSignal(input.audio.reference.taskId, input.audio.reference.owner)?.aborted,
      ).toBe(false);
      const task = { taskId: input.audio.reference.taskId, signal };
      expect(await f.context.host.media.openInput(task)).toMatchObject({
        ok: false,
        error: { code: 'unavailable' },
      });
      expect(await f.context.host.media.openOutput(task)).toMatchObject({
        ok: false,
        error: { code: 'unavailable' },
      });
      for await (const frame of input.audio) {
        expect(frame.byteLength).toBeLessThanOrEqual(6400);
        expect(frame.byteLength % 4).toBe(0);
        bytes += frame.byteLength;
        frames++;
      }
      expect(() => input.audio[Symbol.asyncIterator]()).toThrow('one consumer');
      return result;
    },
  });
  expect(
    await f.providers.recognize(
      feature,
      ref,
      f.binding.bindingId,
      20000,
      pcm(20000),
      new AbortController().signal,
      40000,
    ),
  ).toBe(result);
  expect(bytes).toBe(80000);
  expect(frames).toBeGreaterThan(8);
  expect(f.host.permissions.diagnostics().leases).toBe(0);
});
it.each([{ noFeatureGrant: true }, { noProviderFiles: true }])(
  'refuses missing consumer/provider authority before native work (%j)',
  async (options) => {
    const transcribe = vi.fn(async () => ({ kind: 'no-speech' as const }));
    const f = await fixture({ catalog: async () => [], transcribe }, options);
    await expect(
      f.providers.recognize(
        feature,
        ref,
        f.binding.bindingId,
        3,
        pcm(3),
        new AbortController().signal,
        40000,
      ),
    ).rejects.toMatchObject({ error: { code: 'permission-denied' } });
    expect(transcribe).not.toHaveBeenCalled();
  },
);
it('revocation and disable fence immediately but join raw native work before a replacement is available', async () => {
  const started = deferred(),
    aborted = deferred(),
    release = deferred<VoiceFinal>();
  const f = await fixture({
    catalog: async () => [],
    transcribe: async (input, signal) => {
      for await (const frame of input.audio) {
        expect(frame.byteLength).toBeGreaterThan(0);
      }
      signal.addEventListener('abort', () => aborted.resolve(), { once: true });
      started.resolve();
      return release.promise;
    },
  });
  cleanups.push(async () => {
    release.resolve({ kind: 'no-speech' });
  });
  const running = f.providers
    .recognize(feature, ref, f.binding.bindingId, 3, pcm(3), new AbortController().signal, 40000)
    .catch((error: unknown) => error);
  await started.promise;
  expect(
    f.host.permissionControl.revoke({ pluginId: 'pet.asr-magpie', instanceId: 'default' }),
  ).toBe(true);
  await aborted.promise;
  let disabled = false;
  const disabling = f.providers.disable(ref).then(() => {
    disabled = true;
  });
  await Promise.resolve();
  expect(disabled).toBe(false);
  expect(f.providers.binding(ref)).toBeNull();
  release.resolve({ kind: 'final', text: 'late' });
  await running;
  await disabling;
  expect(disabled).toBe(true);
  expect(f.host.permissions.diagnostics().leases).toBe(0);
});
it('committed provider CAS invalidates a captured binding while a failed CAS leaves it intact', async () => {
  const transcribe = vi.fn(async () => ({ kind: 'no-speech' as const })),
    f = await fixture({ catalog: async () => [], transcribe });
  const config = await f.host.configs.get({ pluginId: 'pet.asr-magpie', instanceId: 'default' });
  if (!config.ok) throw new Error('config');
  expect(
    (
      await f.host.configs.save(
        { pluginId: 'pet.asr-magpie', instanceId: 'default' },
        config.value.data,
        config.value.revision - 1,
      )
    ).ok,
  ).toBe(false);
  expect(f.providers.binding(ref)?.bindingId).toBe(f.binding.bindingId);
  expect(
    (
      await f.host.configs.save(
        { pluginId: 'pet.asr-magpie', instanceId: 'default' },
        { ...config.value.data, modelRef: 'xiaomi/mimo-v2.5-asr-2' },
        config.value.revision,
      )
    ).ok,
  ).toBe(true);
  expect(f.providers.binding(ref)).toBeNull();
  await expect(
    f.providers.recognize(
      feature,
      ref,
      f.binding.bindingId,
      3,
      pcm(3),
      new AbortController().signal,
      40000,
    ),
  ).rejects.toMatchObject({ error: { code: 'conflict' } });
  expect(transcribe).not.toHaveBeenCalled();
});
it('rejects a changed package fingerprint at native admission with no provider call', async () => {
  const transcribe = vi.fn(async () => ({ kind: 'no-speech' as const })),
    f = await fixture({ catalog: async () => [], transcribe });
  await writeFile(
    path.join(f.directory, 'pet.asr-magpie', 'changed-source.txt'),
    'controlled fingerprint change',
  );
  await expect(
    f.providers.recognize(
      feature,
      ref,
      f.binding.bindingId,
      3,
      pcm(3),
      new AbortController().signal,
      40000,
    ),
  ).rejects.toMatchObject({ error: { code: 'stale-owner' } });
  expect(transcribe).not.toHaveBeenCalled();
});
