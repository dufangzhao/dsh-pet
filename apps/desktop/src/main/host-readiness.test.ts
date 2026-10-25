import { expect, it } from 'vitest';
import { ConfigService, MemoryConfigStore, createPermissionKernel } from '@pet/host-kernel';
import type { PermissionDeclaration, PluginManifest } from '@pet/contracts';
import { checkHostReadiness } from './host-readiness.js';
const owner = { pluginId: 'test.readiness', instanceId: 'default', generation: 1 };
const identity = { pluginId: owner.pluginId, instanceId: owner.instanceId };
const manifest = (permissions: PermissionDeclaration[] = []): PluginManifest => ({
  schemaVersion: 1,
  id: owner.pluginId,
  version: '1.0.0',
  displayName: { 'zh-CN': '测试' },
  description: { 'zh-CN': '就绪不等于授权' },
  license: 'MIT',
  host: '^1.0.0',
  platforms: ['win32-x64'],
  entries: { runtime: 'entry.mjs' },
  permissions,
});
async function config(m: PluginManifest) {
  const value = new ConfigService(new MemoryConfigStore(), () => true);
  expect(value.register(identity, m).ok).toBe(true);
  expect((await value.initialize(identity)).ok).toBe(true);
  return value;
}
it('makes the already-implemented capability service available without granting it', async () => {
  const m = manifest([{ kind: 'capability-use', capability: 'test.available@1' }]),
    configs = await config(m);
  try {
    expect(await checkHostReadiness(owner, m, {}, configs, false)).toBeNull();
  } finally {
    configs.close();
  }
});
it('makes credentials available only with an approved cipher backend', async () => {
  const m = manifest([{ kind: 'credentials', keys: ['key'] }]),
    configs = await config(m);
  try {
    expect(await checkHostReadiness(owner, m, {}, configs, true)).toBeNull();
    expect(await checkHostReadiness(owner, m, {}, configs, false)).toMatchObject({
      code: 'not-ready',
    });
  } finally {
    configs.close();
  }
});
it('keeps unsupported system permissions unavailable', async () => {
  for (const permission of [
    { kind: 'microphone' },
    { kind: 'screen-capture' },
    { kind: 'text-input' },
    { kind: 'network', origins: ['https://api.example.com'] },
    { kind: 'files', scope: 'plugin-data', access: 'read' },
    { kind: 'clipboard', access: 'read' },
  ] as PermissionDeclaration[]) {
    const m = manifest([permission]),
      configs = await config(m);
    try {
      expect(await checkHostReadiness(owner, m, {}, configs, true)).toMatchObject({
        code: 'not-ready',
      });
    } finally {
      configs.close();
    }
  }
});
it('does not treat a resource declaration as a verified download', async () => {
  const m = manifest();
  m.resources = [
    {
      id: 'model',
      url: 'https://example.com/model.bin',
      bytes: 1,
      sha256: 'a'.repeat(64),
      license: 'MIT',
      shared: false,
    },
  ];
  const configs = await config(m);
  try {
    expect(await checkHostReadiness(owner, m, {}, configs, true)).toMatchObject({
      code: 'not-ready',
    });
  } finally {
    configs.close();
  }
});
it('still requires a validated initialized configuration', async () => {
  const m = manifest(),
    configs = new ConfigService(new MemoryConfigStore(), () => true);
  try {
    expect(await checkHostReadiness(owner, m, {}, configs, true)).toMatchObject({
      code: 'not-ready',
    });
    configs.register(identity, m);
    expect(await checkHostReadiness(owner, m, {}, configs, true)).toMatchObject({
      code: 'not-ready',
    });
    await configs.initialize(identity);
    expect(await checkHostReadiness(owner, m, { undeclared: true }, configs, true)).toMatchObject({
      code: 'not-ready',
    });
  } finally {
    configs.close();
  }
});
it('readiness never supplies the missing approval channel or authorizes the declared credential', async () => {
  const m = manifest([{ kind: 'credentials', keys: ['key'] }]),
    configs = await config(m),
    scope = new AbortController(),
    digest = 'e'.repeat(64);
  const kernel = createPermissionKernel({
    host: {
      fingerprint: () => digest,
      describe: () => ({ manifest: m, digest }),
      isLive: () => true,
      ownerSignal: () => scope.signal,
      taskSignal: () => scope.signal,
    },
  });
  try {
    kernel.control.confirmTrust(
      { pluginId: owner.pluginId, instanceId: owner.instanceId },
      digest,
      true,
    );
    expect(kernel.service.isTrusted(identity, digest)).toBe(true);
    expect(await checkHostReadiness(owner, m, {}, configs, true)).toBeNull();
    expect(
      await kernel.service.authorize(owner, 'task', { kind: 'credentials', keys: ['key'] }),
    ).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
  } finally {
    kernel.service.close();
    configs.close();
  }
});
