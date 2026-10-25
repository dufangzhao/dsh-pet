import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { JsonValue, PluginManifest } from '@pet/contracts';
import { RuntimeWorkerServer } from './worker-server.js';
import { manifestDigest } from './worker-protocol.js';
import type { RpcContext } from '../ipc/control-endpoint.js';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
const owner = { pluginId: 'test.worker', instanceId: 'default', generation: 1 };
const manifest: PluginManifest = {
  schemaVersion: 1,
  id: owner.pluginId,
  version: '1.0.0',
  displayName: { 'zh-CN': '测试' },
  description: { 'zh-CN': '测试' },
  license: 'MIT',
  host: '^1.0.0',
  platforms: ['win32-x64'],
  entries: { runtime: 'entry.mjs' },
  provides: [{ id: 'main', capability: 'test.echo@1' }],
};
async function setup(
  code = 'export default {activate(ctx){ctx.provide("main",{echo:async(task,input)=>({input,aborted:ctx.signal.aborted,taskAborted:task.signal.aborted})});}};',
) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'pet-worker-test-'));
  cleanup.push(async () => {
    if (!path.basename(root).startsWith('pet-worker-test-')) throw new Error('Unsafe cleanup');
    await fs.rm(root, { recursive: true, force: true });
  });
  const directory = path.join(root, 'package');
  await fs.mkdir(directory);
  await fs.writeFile(path.join(directory, 'plugin.json'), JSON.stringify(manifest));
  await fs.writeFile(path.join(directory, 'entry.mjs'), code);
  const server = await RuntimeWorkerServer.create({
    version: 1,
    sessionId: 's',
    owner: { pluginId: 'core.runtime', instanceId: 'peer', generation: 1 },
    roots: [{ directory: root, origin: 'user' }],
  });
  cleanup.push(() => server.shutdown());
  const abort = new AbortController();
  const context: RpcContext = {
    owner: { pluginId: 'core.runtime', instanceId: 'peer', generation: 1 },
    requestId: 'm-1',
    taskId: 't-1',
    signal: abort.signal,
    budgetMs: 1000,
  };
  const payload = {
    owner,
    entryPath: path.join(directory, 'entry.mjs'),
    manifestDigest: manifestDigest(manifest),
    config: {},
  } as unknown as JsonValue;
  return { server, context, abort, payload, directory };
}
it('only loads a discovered matching entry and exact manifest digest', async () => {
  const f = await setup();
  const activate = f.server.handlers()['runtime.activate']!;
  expect(
    await activate(f.context, {
      ...(f.payload as object),
      entryPath: path.join(f.directory, 'other.mjs'),
    } as JsonValue),
  ).toMatchObject({ ok: false, error: { code: 'not-ready' } });
  expect(
    await activate(f.context, { ...(f.payload as object), manifestDigest: 'bad' } as JsonValue),
  ).toMatchObject({ ok: false, error: { code: 'not-ready' } });
});
it('does not tie a ready plugin lifetime to the completed activation RPC', async () => {
  const f = await setup();
  expect((await f.server.handlers()['runtime.activate']!(f.context, f.payload)).ok).toBe(true);
  f.abort.abort();
  const call = { ...f.context, signal: new AbortController().signal, requestId: 'm-2' };
  expect(
    await f.server.handlers()['runtime.invoke']!(call, {
      owner,
      providerId: 'main',
      method: 'echo',
      input: 1,
    } as unknown as JsonValue),
  ).toEqual({ ok: true, value: { input: 1, aborted: false, taskAborted: false } });
});
it('rejects old and repeated generations after stop', async () => {
  const f = await setup();
  const handlers = f.server.handlers();
  expect((await handlers['runtime.activate']!(f.context, f.payload)).ok).toBe(true);
  expect((await handlers['runtime.stop']!(f.context, { owner } as unknown as JsonValue)).ok).toBe(
    true,
  );
  expect(await handlers['runtime.activate']!(f.context, f.payload)).toMatchObject({
    ok: false,
    error: { code: 'stale-owner' },
  });
  expect(
    (
      await handlers['runtime.activate']!(f.context, {
        ...(f.payload as object),
        owner: { ...owner, generation: 2 },
      } as JsonValue)
    ).ok,
  ).toBe(true);
  expect(
    await handlers['runtime.stop']!(f.context, { owner } as unknown as JsonValue),
  ).toMatchObject({ ok: false, error: { code: 'stale-owner' } });
});
it('refuses modified entry bytes before importing the module', async () => {
  const f = await setup();
  await fs.appendFile(path.join(f.directory, 'entry.mjs'), ' // changed');
  expect(await f.server.handlers()['runtime.activate']!(f.context, f.payload)).toMatchObject({
    ok: false,
    error: { code: 'internal' },
  });
  const info = await f.server.handlers()['runtime.info']!(f.context, null);
  expect(info).toMatchObject({ ok: true, value: { instances: 0 } });
});
it('rolls back incomplete registrations instead of publishing partial readiness', async () => {
  const f = await setup('export default {activate(){}};');
  expect((await f.server.handlers()['runtime.activate']!(f.context, f.payload)).ok).toBe(false);
  expect(await f.server.handlers()['runtime.info']!(f.context, null)).toMatchObject({
    ok: true,
    value: { instances: 0 },
  });
});
it('rejects an unknown method and stale target owner without executing code', async () => {
  const f = await setup();
  const handlers = f.server.handlers();
  await handlers['runtime.activate']!(f.context, f.payload);
  expect(
    await handlers['runtime.invoke']!(f.context, {
      owner,
      providerId: 'main',
      method: 'missing',
      input: null,
    } as unknown as JsonValue),
  ).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
  expect(
    await handlers['runtime.invoke']!(f.context, {
      owner: { ...owner, generation: 2 },
      providerId: 'main',
      method: 'echo',
      input: null,
    } as unknown as JsonValue),
  ).toMatchObject({ ok: false, error: { code: 'stale-owner' } });
});
