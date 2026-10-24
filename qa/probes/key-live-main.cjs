'use strict';
const { app, BrowserWindow } = require('electron');
const { fork } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, '.cache/m0-key-live'); fs.mkdirSync(out, { recursive: true });
const report = { status: 'starting', key: 'F8', pid: process.pid, createdAt: new Date().toISOString(), expected: [], scope: 'F8 only, owned focused window only; no input injection, no audio' };
let child, window, captureTimer, idleTimer, killTimer, stopping = false;
function save() { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); }
function stop(reason) {
  if (stopping) return; stopping = true; report.reason = reason;
  clearTimeout(captureTimer); clearTimeout(idleTimer);
  if (child?.connected) child.send({ type: 'stop' });
  killTimer = setTimeout(() => { child?.kill(); report.status = 'incomplete'; save(); app.quit(); }, 3000);
}
(async () => {
  if (process.versions.electron !== '45.0.0' || !app || !process.argv.includes('--m0-key-lab')) throw new Error('Wrong runtime or profile');
  await import(pathToFileURL(path.join(root, 'apps/desktop/dist/main/index.mjs')).href);
  await app.whenReady(); window = BrowserWindow.getAllWindows()[0];
  if (!window) throw new Error('No owned prototype window');
  if (window.webContents.isLoading()) await new Promise(resolve => window.webContents.once('did-finish-load', resolve));
  report.windowId = Number(window.getNativeWindowHandle().readBigUInt64LE());
  const env = { ELECTRON_RUN_AS_NODE: '1' };
  for (const name of ['SystemRoot','WINDIR','TEMP','TMP','PATH']) if (process.env[name]) env[name] = process.env[name];
  child = fork(path.join(root, 'qa/probes/key-live-worker.cjs'), [String(report.windowId)], { execPath: process.execPath, env, stdio: ['ignore','ignore','ignore','ipc'] });
  child.on('message', message => {
    if (message?.type === 'ready') { report.status = 'waiting-for-first-F8'; report.workerRuntime = message.runtime; save(); }
    if (message?.type === 'edge' && !window.isDestroyed()) {
      const state = message.edge.type === 'down' ? 'listening' : 'idle';
      void window.webContents.executeJavaScript("globalThis.pet.previewState('" + state + "')").catch(() => {});
    }
    if (message?.type === 'result') {
      clearTimeout(killTimer); clearTimeout(captureTimer); clearTimeout(idleTimer);
      report.observed = message.report; report.status = report.expected.length ? 'captured' : 'no-samples'; report.finishedAt = new Date().toISOString();
      save(); app.quit();
    }
  });
  child.on('error', error => { report.error = error.message; stop('worker-error'); });
  child.on('exit', code => { if (!report.observed) { clearTimeout(killTimer); report.status = 'incomplete'; report.workerExit = code; save(); app.quit(); } });
  window.webContents.on('before-input-event', (_event, input) => {
    if (stopping || !report.workerRuntime || input.code !== 'F8' || input.isAutoRepeat || !window.isFocused()) return;
    if (!report.startedAt && input.type !== 'keyDown') return;
    if (input.type !== 'keyDown' && input.type !== 'keyUp') return;
    report.expected.push({ type: input.type === 'keyDown' ? 'down' : 'up', at: Date.now(), monotonic: performance.now() });
    if (!report.startedAt) { report.startedAt = new Date().toISOString(); report.status = 'collecting-60s'; clearTimeout(idleTimer); captureTimer = setTimeout(() => stop('60s-complete'), 60000); }
    save();
  });
  window.on('closed', () => stop('window-closed'));
  app.on('before-quit', () => { if (!report.observed) { stopping = true; child?.kill(); clearTimeout(captureTimer); clearTimeout(idleTimer); report.status = 'incomplete'; save(); } });
  idleTimer = setTimeout(() => stop('no-input-timeout'), 4 * 60 * 1000);
  save();
})().catch(error => { report.status = 'failed'; report.error = error.message; save(); app.exit(1); });
