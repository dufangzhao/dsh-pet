'use strict';
// Test application. Creates owned windows and observes them; all input is delivered by Cua.
const { app, BrowserWindow, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, '.cache/m0-native-mouse');
fs.mkdirSync(out, { recursive: true });
const statePath = path.join(out, 'state.json');
const state = { runId: randomUUID(), pid: process.pid, status: 'starting', createdAt: new Date().toISOString(),
  scope: 'Owned prototype + mouse-only target; no OS key injection or system settings', history: [] };
let pet;
let target;
let interval;
let watchdog;
let stopping = false;
let inFlight = false;
let lastSignature = '';
function save() {
  const summary = { ...state }; delete summary.history;
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  const tmp = statePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, statePath);
}
function finish(reason) {
  if (stopping) return;
  stopping = true; clearInterval(interval); clearTimeout(watchdog);
  state.status = 'closed'; state.reason = reason; state.closedAt = new Date().toISOString(); save();
  app.quit();
}
function describe(window) {
  if (!window || window.isDestroyed()) return null;
  return { id: window.id, windowId: Number(window.getNativeWindowHandle().readBigUInt64LE()),
    bounds: window.getBounds(), visible: window.isVisible(), focused: window.isFocused() };
}
async function refresh() {
  if (stopping || inFlight) return;
  inFlight = true;
  try {
    if (!pet || pet.isDestroyed() || !target || target.isDestroyed()) return;
    const [petData, targetData] = await Promise.all([
      pet.webContents.executeJavaScript('({ pointer: globalThis.__m0PetMouse, snapshot: globalThis.__m0PetSnapshot })'),
      target.webContents.executeJavaScript('globalThis.__m0MouseTarget'),
    ]);
    if (stopping) return;
    state.pet = describe(pet); state.target = describe(target);
    state.petData = petData; state.targetData = targetData;
    state.updatedAt = new Date().toISOString();
    const signature = JSON.stringify([state.pet.bounds, petData, targetData]);
    if (signature !== lastSignature) {
      state.history.push({ at: state.updatedAt, pet: state.pet, petData, targetData });
      if (state.history.length > 128) state.history.shift();
      lastSignature = signature;
    }
    save();
  } catch (error) {
    if (!stopping) { state.observationError = error.message; save(); }
  } finally { inFlight = false; }
}
state.launchDiagnostics = { electron: process.versions.electron, node: process.versions.node, mainApi: Boolean(app?.whenReady), hasLabFlag: process.argv.includes('--m0-mouse-lab'), nodeModeFlag: process.env.ELECTRON_RUN_AS_NODE === '1' };
save();
(async () => {
  if (process.versions.electron !== '45.0.0' || !app || !process.argv.includes('--m0-mouse-lab')) throw new Error('Use pinned Electron main mode with --m0-mouse-lab');
  app.on('before-quit', () => {
    if (stopping) return;
    stopping = true; clearInterval(interval); clearTimeout(watchdog);
    state.status = 'closed'; state.reason = 'operator-app-quit'; state.closedAt = new Date().toISOString(); save();
  });
  await import(pathToFileURL(path.join(root, 'apps/desktop/dist/main/index.mjs')).href);
  await app.whenReady();
  pet = BrowserWindow.getAllWindows()[0];
  if (!pet) throw new Error('Prototype did not create its window');
  if (pet.webContents.isLoading()) await new Promise((resolve, reject) => {
    pet.webContents.once('did-finish-load', resolve); pet.webContents.once('did-fail-load', () => reject(new Error('Prototype load failed')));
  });
  const petObserver = [
    "globalThis.__m0PetMouse = { downs: 0, ups: 0, clicks: 0, events: [] };",
    "for (const type of ['pointerdown','pointerup','click']) document.addEventListener(type, e => { if (e.button !== 0 || (type !== 'click' && e.pointerType !== 'mouse')) return; const s=globalThis.__m0PetMouse; s[type==='pointerdown'?'downs':type==='pointerup'?'ups':'clicks']++; s.events.push({type, x:e.clientX, y:e.clientY, trusted:e.isTrusted, at:Date.now()}); if(s.events.length>64)s.events.shift(); }, {capture:true,passive:true});",
    "globalThis.pet.onSnapshot(s => { globalThis.__m0PetSnapshot=s; });",
    "globalThis.pet.getSnapshot().then(r => { if(r.ok)globalThis.__m0PetSnapshot=r.value; });",
  ].join(String.fromCharCode(10));
  await pet.webContents.executeJavaScript(petObserver);
  const b = pet.getBounds(); const d = screen.getDisplayMatching(b);
  const { x, y, width, height } = d.workArea;
  target = new BrowserWindow({ x, y, width, height, frame: false, show: false, resizable: false,
    skipTaskbar: true, alwaysOnTop: true, backgroundColor: '#f4f6f9', title: '桌宠原生鼠标测试底板',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  target.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  target.webContents.on('will-navigate', e => e.preventDefault());
  await target.loadFile(path.join(root, 'qa/fixtures/mouse-target.html'));
  target.showInactive();
  pet.moveTop();
  pet.once('closed', () => finish('prototype-window-closed'));
  target.once('closed', () => finish('target-window-closed'));
  state.runtime = { electron: process.versions.electron, node: process.versions.node };
  state.initialPet = describe(pet); state.initialTarget = describe(target);
  state.displays = screen.getAllDisplays().map(v => ({ id:v.id,bounds:v.bounds,workArea:v.workArea,scaleFactor:v.scaleFactor }));
  state.avatar = await pet.webContents.executeJavaScript("(() => { const r=document.querySelector('[data-testid=pet-avatar]').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,dpr:devicePixelRatio}; })()");
  state.status = 'ready';
  await refresh();
  interval = setInterval(refresh, 300);
  watchdog = setTimeout(() => finish('ten-minute-watchdog'), 10 * 60 * 1000);
})().catch(error => {
  state.status = 'failed'; state.error = error.message; save();
  clearInterval(interval); clearTimeout(watchdog); if (app) app.exit(1); else process.exitCode=1;
});
