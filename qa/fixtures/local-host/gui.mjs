// Controlled native GUI process. It uses the production attach/start client, never owns kernel shutdown.
import { register } from 'tsx/esm/api';
import { app, BrowserWindow } from 'electron';
register();
const { startOrAttachLocalHost, localHostEnvironment } = await import('../../../apps/desktop/src/local-host/client.ts');
const argument = name => {
  const found = process.argv.find(value => value.startsWith(`--${name}=`));
  if (!found) throw new Error('Missing fixed G0 GUI argument');
  return found.slice(name.length + 3);
};
app.setName('pet-local-host-g0-gui'); app.setPath('userData', argument('gui-profile'));
if (!app.requestSingleInstanceLock()) app.exit(1);
void app.whenReady().then(async () => {
// Synthetic sentinels exist only in this owned GUI; no real environment values are logged.
for (const name of ['AGENT_TOKEN', 'MODEL_API_KEY', 'DSH_API_KEY', 'G0_UNDECLARED_KEY', 'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE']) process.env[name] = 'g0-never-inherit';
const environment = localHostEnvironment();
for (const name of ['LD_LIBRARY_PATH', 'FONTCONFIG_FILE', 'GSETTINGS_SCHEMA_DIR', 'GSETTINGS_BACKEND']) if (process.env[name] !== undefined) environment[name] = process.env[name];
const client = await startOrAttachLocalHost({ profileDirectory: argument('local-host-profile'), packageVersion: '0.1.0', launch: { executablePath: process.execPath, entryPath: argument('host-entry'), environment, noSandbox: true } });
const status = await client.status();
if (!status.ok) throw new Error('G0 management attach failed');
globalThis.__localHostGuiProof = { status };
const window = new BrowserWindow({ width: 400, height: 180, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
await window.loadURL('data:text/html,<title>G0 local host GUI</title><p>Authenticated local host attached. Closing this GUI only detaches.</p>');
let detached = false;
app.on('before-quit', event => {
  if (detached) return;
  event.preventDefault();
  void client.close().then(() => { detached = true; app.quit(); });
});
app.on('window-all-closed', () => app.quit());
}).catch(error => { process.stderr.write(`G0 GUI failed: ${error instanceof Error ? error.message : 'unknown'}\n`); app.exit(1); });
