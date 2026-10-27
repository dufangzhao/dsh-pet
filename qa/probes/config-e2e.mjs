import { _electron, expect } from '@playwright/test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkContrast } from './contrast.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = path.join(root, '.cache/m2-config-' + stamp);
const shots = path.join(root, 'qa/screenshots/m2-config');
const bridgeOnly = process.argv.includes('--bridge-only');
const sandboxOverride = process.argv.includes('--no-sandbox');
const reportFile = path.join(root, bridgeOnly ? 'qa/M2-config-bridge-results.json' : 'qa/M2-config-ui-results.json');
const require = createRequire(import.meta.url);
const executablePath = path.join(path.dirname(require.resolve('electron/package.json')), 'dist/electron.exe');
const env = {};
for (const name of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH'])
  if (process.env[name]) env[name] = process.env[name];
const report = { status: 'running', at: new Date().toISOString(), bridgeOnly, sandboxOverride, checks: [], errors: [], screenshots: [], themes: [] };
let app;
const capture = async (page, name) => {
  const file = path.join(shots, name + '-' + stamp + '.png');
  await page.screenshot({ path: file, animations: 'disabled' });
  report.screenshots.push(path.relative(root, file).split(path.sep).join('/'));
};
const schema = {
  type: 'object', additionalProperties: false,
  required: ['name', 'engine', 'options', 'tags', 'credential', 'version'],
  properties: {
    name: { type: 'string', title: '显示名称', minLength: 2, maxLength: 12 },
    engine: { type: 'string', title: '识别模型', enum: ['sensevoice', 'paraformer'], default: 'sensevoice' },
    options: { type: 'object', title: '识别选项', additionalProperties: false, required: ['enabled', 'threads'],
      properties: { enabled: { type: 'boolean', title: '启用', default: false }, threads: { type: 'integer', title: '线程数', default: 2, minimum: 1, maximum: 4 } } },
    tags: { type: 'array', title: '词条', minItems: 1, maxItems: 3, uniqueItems: true, default: ['桌宠'], items: { type: 'string', minLength: 1, maxLength: 10 } },
    credential: { type: 'string', title: '服务凭据引用', format: 'credential-ref', enum: ['asr-key'], default: 'asr-key' },
    note: { type: 'string', title: '备注', maxLength: 20 },
    ratio: { type: 'number', title: '比例', minimum: 0, maximum: 1 },
    empty: { type: 'null', title: '空值项' },
    version: { type: 'string', title: '配置版本', const: 'm2', default: 'm2' },
  },
};
try {
  for (const name of ['profile', 'builtin', 'plugins/test.schema-form']) await fs.mkdir(path.join(out, name), { recursive: true });
  await fs.mkdir(shots, { recursive: true });
  const plugin = path.join(out, 'plugins/test.schema-form');
  await fs.writeFile(path.join(plugin, 'plugin.json'), JSON.stringify({ schemaVersion: 1, id: 'test.schema-form', version: '1.0.0',
    displayName: { 'zh-CN': 'Schema 验收插件' }, description: { 'zh-CN': '独立受控验收夹具' }, license: 'MIT', host: '^1.0.0',
    platforms: ['win32-x64'], entries: { runtime: 'entry.mjs' }, permissions: [{ kind: 'credentials', keys: ['asr-key'] }],
    config: { version: 1, schema, apply: { name: 'immediate', engine: 'reload', options: 'immediate', tags: 'restart', credential: 'reload', note: 'immediate', ratio: 'immediate', empty: 'immediate', version: 'immediate' } } }));
  await fs.writeFile(path.join(plugin, 'entry.mjs'), 'export default { activate() {} };');
  await build({ entryPoints: [path.join(root, 'qa/probes/config-ui-host.ts')], outfile: path.join(out, 'main.cjs'), bundle: true,
    platform: 'node', format: 'cjs', target: 'node24', external: ['electron'] });
  app = await _electron.launch({ executablePath, args: [...(sandboxOverride ? ['--no-sandbox'] : []), path.join(out, 'main.cjs')], env, timeout: 20000 });
  let page = await app.firstWindow();
  const watch = target => {
    target.on('pageerror', error => report.errors.push(error.message));
    target.on('request', request => { if (/^https?:/.test(request.url())) report.errors.push('Remote request: ' + request.url()); });
  };
  watch(page);
  await page.waitForURL('**/console/index.html');
  report.runtime = await app.evaluate(() => ({ electron: process.versions.electron, node: process.versions.node, platform: process.platform }));
  const snapshot = await page.evaluate(() => window.petConsole.getSnapshot());
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.value.plugins.length, 1);
  const owner = snapshot.value.plugins[0].owner;
  assert.equal(snapshot.value.plugins[0].state, 'disabled');
  const inspect = () => page.evaluate(owner => window.petConsole.inspectConfig(owner), owner);
  const initial = await inspect();
  assert.equal(initial.ok, true);
  assert.equal(initial.value.snapshot, null);
  assert.deepEqual(Object.keys(initial.value.definition).sort(), ['defaults', 'fields', 'schema', 'version']);
  assert.equal(JSON.stringify(initial).includes(plugin), false);
  assert.equal(JSON.stringify(initial).includes('validate'), false);
  const configDirectory = path.join(out, 'configuration');
  assert.deepEqual(await fs.readdir(configDirectory), []);
  assert.deepEqual(await page.evaluate(() => ({ frozen: Object.isFrozen(window.petConsole), require: typeof window.require, process: typeof window.process })), { frozen: true, require: 'undefined', process: 'undefined' });
  report.checks.push('real-disabled-plugin-first-inspection-is-pure-data-and-does-not-write');
  for (const operation of ['inspectConfig', 'saveConfig']) {
    const bad = operation === 'inspectConfig' ? { ...owner, generation: owner.generation + 1 } : { owner, expectedRevision: 0, data: {} };
    const result = await page.evaluate(({ operation, bad }) => window.petConsole[operation](bad), { operation, bad });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, operation === 'inspectConfig' ? 'stale-owner' : 'invalid-input');
  }
  await app.evaluate(() => globalThis.m2ConfigQA.foreignWindow());
  const foreign = app.windows().find(target => target !== page);
  assert.ok(foreign);
  for (const operation of ['inspectConfig', 'saveConfig']) {
    const result = await foreign.evaluate(({ operation, owner }) => window.petConsole[operation](operation === 'inspectConfig' ? owner : { owner, expectedRevision: 0, data: {} }), { operation, owner });
    assert.equal(result.ok, false); assert.equal(result.error.code, 'permission-denied');
  }
  await app.evaluate(() => globalThis.m2ConfigQA.closeForeign());
  assert.deepEqual(await fs.readdir(configDirectory), []);
  report.checks.push('real-preload-stale-owner-invalid-candidate-and-foreign-window-rejected');
  await app.evaluate(async (_electron, url) => { await globalThis.m2ConfigQA.settings.current.loadURL(url); }, pathToFileURL(path.join(root, 'apps/desktop/dist/renderer/console/index.html')).href + '?source-check=1');
  const wrongUrl = await inspect();
  assert.equal(wrongUrl.ok, false); assert.equal(wrongUrl.error.code, 'permission-denied');
  const wrongUrlSave = await page.evaluate(owner => window.petConsole.saveConfig({ owner, expectedRevision: 0, data: {} }), owner);
  assert.equal(wrongUrlSave.ok, false); assert.equal(wrongUrlSave.error.code, 'permission-denied');
  await app.evaluate(async (_electron, url) => { await globalThis.m2ConfigQA.settings.current.loadURL(url); }, pathToFileURL(path.join(root, 'apps/desktop/dist/renderer/console/index.html')).href);
  await expect(page.getByTestId('nav-plugins')).toBeVisible();
  report.checks.push('same-window-with-changed-url-cannot-inspect-or-write');
  if (bridgeOnly) {
    const candidate = { name: '首次配置', engine: 'sensevoice', options: { enabled: false, threads: 2 }, tags: ['桌宠'], credential: 'asr-key', version: 'm2' };
    const saved = await page.evaluate(({ owner, data }) => window.petConsole.saveConfig({ owner, expectedRevision: 0, data }), { owner, data: candidate });
    assert.equal(saved.ok, true); assert.equal(saved.value.snapshot.revision, 1);
    const raced = await page.evaluate(({ owner, data }) => Promise.all([
      window.petConsole.saveConfig({ owner, expectedRevision: 1, data: { ...data, name: '并发配置甲' } }),
      window.petConsole.saveConfig({ owner, expectedRevision: 1, data: { ...data, name: '并发配置乙' } }),
    ]), { owner, data: candidate });
    assert.equal(raced.filter(result => result.ok).length, 1);
    assert.equal(raced.find(result => !result.ok).error.code, 'conflict');
    assert.equal((await inspect()).value.snapshot.revision, 2);
    report.checks.push('real-preload-first-save-and-concurrent-cas-one-winner');
    const reopened = app.waitForEvent('window'); await app.evaluate(() => globalThis.m2ConfigQA.reopen());
    page = await reopened; watch(page); await page.waitForURL('**/console/index.html');
    assert.equal((await inspect()).value.snapshot.revision, 2);
    const recordFile = path.join(configDirectory, createHash('sha256').update(JSON.stringify([owner.pluginId, owner.instanceId])).digest('hex') + '.config.json');
    const original = await fs.readFile(recordFile, 'utf8');
    for (const broken of ['corrupt-fixture', JSON.stringify({ ...JSON.parse(original), schemaVersion: 2 })]) {
      await fs.writeFile(recordFile, broken);
      const read = await inspect(); assert.equal(read.ok, false);
      const denied = await page.evaluate(({ owner, data }) => window.petConsole.saveConfig({ owner, expectedRevision: 0, data }), { owner, data: candidate });
      assert.equal(denied.ok, false); assert.equal(await fs.readFile(recordFile, 'utf8'), broken);
    }
    await fs.writeFile(recordFile, original);
    report.checks.push('real-file-reopen-persists-and-bad-or-old-record-never-becomes-empty');
  }

  if (!bridgeOnly) {
    // UI assertions continue below after the DeepSeek form integration.
    await page.getByTestId('nav-plugins').click();
    await expect(page.getByRole('main')).toContainText('Schema 验收插件');
    await page.getByRole('button', { name: '配置', exact: true }).click();
    await expect(page.getByLabel('显示名称', { exact: false })).toBeVisible();
    await capture(page, 'first-config');
  }
  const artifacts = ['apps/desktop/dist/main/index.mjs', 'apps/desktop/dist/preload/index.cjs', 'apps/desktop/dist/renderer/console/index.html'];
  for (const name of await fs.readdir(path.join(root, 'apps/desktop/dist/renderer/console/assets')))
    artifacts.push('apps/desktop/dist/renderer/console/assets/' + name);
  report.artifacts = Object.fromEntries(await Promise.all(artifacts.map(async file => [file, createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex')])));
  report.finalInspection = await inspect();
  report.recordFiles = await fs.readdir(configDirectory);
  report.status = 'passed';
  report.shutdown = await app.evaluate(() => globalThis.m2ConfigQA.shutdown());
  assert.equal(report.shutdown.exitConfirmed, true);
  assert.deepEqual(report.errors, []);
} catch (error) {
  report.status = 'failed'; report.failure = error.stack ?? String(error);
  if (app) {
    try { const page = app.windows()[0]; if (page && !bridgeOnly) await capture(page, 'failure'); } catch {}
    try { report.shutdown = await app.evaluate(() => globalThis.m2ConfigQA.shutdown()); } catch {}
  }
  process.exitCode = 1;
} finally {
  if (app) await app.close().catch(() => {});
  await fs.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
