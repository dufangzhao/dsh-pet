import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import type { ApplicationController } from '../../apps/desktop/src/main/application-controller.js';
import type { DesktopHost } from '../../apps/desktop/src/main/desktop-host.js';
export const fixtureId = 'qa.external-panel';
export async function createFixture(directory: string, workspace: string): Promise<void> {
  const root = path.join(directory, fixtureId);
  await fs.mkdir(path.join(root, 'ui'), { recursive: true });
  const manifest = { schemaVersion: 1, id: fixtureId, version: '0.1.0', displayName: { 'zh-CN': '外部便签' }, description: { 'zh-CN': '真实外部配置与动作验收' }, license: 'MIT', host: '^1.0.0', platforms: ['win32-x64'], entries: { runtime: 'dist/index.mjs' }, permissions: [{ kind: 'files', scope: 'plugin-data', access: 'read-write' }], config: { version: 1, schema: { type: 'object', additionalProperties: false, properties: { label: { type: 'string', maxLength: 128, default: '外部配置' }, count: { type: 'integer', minimum: 0, maximum: 1000, default: 0 } } }, apply: { label: 'immediate', count: 'immediate' } }, contributes: [{ id: 'page', kind: 'panel', title: { 'zh-CN': '外部便签' }, entry: 'ui/page.json' }, { id: 'increment', kind: 'command', title: { 'zh-CN': '增加一次' }, handler: 'increment' }, { id: 'crash', kind: 'command', title: { 'zh-CN': '故障探针' }, handler: 'crash' }] };
  await fs.writeFile(path.join(root, 'plugin.json'), JSON.stringify(manifest));
  await fs.writeFile(path.join(root, 'ui/page.json'), JSON.stringify({ id: 'world:external-notes', kind: 'world', label: '外部便签', availability: 'active', panels: [{ id: 'main', title: '便签', builtin: 'pet.start' }], configGroups: [fixtureId], client: { js: '/assets/ignored.js' } }));
  await build({ stdin: { contents: "import { definePlugin } from '@pet/plugin-sdk'; export default definePlugin({ activate(ctx) { ctx.contribute('page'); ctx.contribute('increment', async task => { const read = await ctx.host.config.get(); if (!read.ok || !ctx.host.config.save) return { errorCode:'not-ready' }; const saved = await ctx.host.config.save(task, { ...read.value.data, count:read.value.data.count+1 }, read.value.revision); return saved.ok ? { count:saved.value.snapshot.data.count } : { errorCode:saved.error.code }; }); ctx.contribute('crash', async () => { process.exit(9); }); } });", resolveDir: path.join(workspace, 'plugins/profile'), loader: 'ts' }, outfile: path.join(root, 'dist/index.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node24' });
}
export async function verifyFixture(host: DesktopHost, application: ApplicationController): Promise<void> {
  const identity = { pluginId: fixtureId, instanceId: 'default' };
  const entry = host.manager.get(identity); assert.ok(entry);
  const review = host.describeTrust(entry.owner); assert.ok(review);
  assert.equal(host.permissionControl.confirmTrust(identity, review.digest, true), true);
  host.permissionControl.setPreset(identity, 'local');
  const cfg = await host.configs.get(identity); assert.ok(cfg.ok);
  const enabled = await host.manager.enable(identity, cfg.value.data); assert.ok(enabled.ok); assert.equal(enabled.value.state, 'active');
  let state = await application.snapshot();
  let page = state.pages.find(p => p.owner.pluginId === fixtureId); assert.ok(page);
  assert.equal((page.manifest['panels'] as Array<Record<string, unknown>>)[0]?.['builtin'], undefined);
  assert.equal(page.manifest['client'], undefined);
  assert.equal(page.actions?.length, 2);
  const changed = await host.configs.save(identity, { label: '已编辑外部配置', count: 0 }, cfg.value.revision); assert.ok(changed.ok);
  const action = await application.runPageAction(page.owner, page.id, 'main', 'increment', null); assert.ok(action.ok); assert.deepEqual(action.value, { count: 1 });
  const other = state.profile!.owner;
  assert.equal((await application.runPageAction(other, page.id, 'main', 'increment', null)).ok, false);
  const stale = page.owner;
  assert.ok((await host.manager.disable(identity)).ok);
  assert.equal((await application.snapshot()).pages.some(p => p.owner.pluginId === fixtureId), false);
  const saved = await host.configs.get(identity); assert.ok(saved.ok); assert.equal(saved.value.data['count'], 1);
  assert.ok((await host.manager.enable(identity, saved.value.data)).ok);
  state = await application.snapshot(); page = state.pages.find(p => p.owner.pluginId === fixtureId); assert.ok(page);
  assert.notEqual(page.owner.generation, stale.generation);
  assert.equal((await application.runPageAction(stale, page.id, 'main', 'increment', null)).ok, false);
  await application.runPageAction(page.owner, page.id, 'main', 'crash', null);
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline && host.manager.isActive(page.owner)) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(host.manager.isActive(page.owner), false);
  assert.equal((await application.snapshot()).pages.some(p => p.owner.pluginId === fixtureId), false);
  assert.equal((await host.configs.get(identity)).ok, true);
}
