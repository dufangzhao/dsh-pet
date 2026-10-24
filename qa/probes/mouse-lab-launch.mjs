// Fixed, background-safe application launcher. Input stays exclusively on Cua.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const pkgPath = require.resolve('electron/package.json');
if (JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version !== '45.0.0') throw new Error('Wrong Electron package');
const executable = path.join(path.dirname(pkgPath), 'dist/electron.exe');
const out = path.join(root, '.cache/m0-native-mouse');
fs.mkdirSync(out, { recursive: true });
const env = {};
for (const name of ['SystemRoot','WINDIR','TEMP','TMP','PATH','USERPROFILE','APPDATA','LOCALAPPDATA','HOMEDRIVE','HOMEPATH']) {
  if (process.env[name]) env[name] = process.env[name];
}
const status = { launcherPid: process.pid, createdAt: new Date().toISOString(), status: 'starting' };
const save = () => fs.writeFileSync(path.join(out, 'launch.json'), JSON.stringify(status, null, 2));
save();
const child = spawn(executable, [path.join(root, 'qa/probes/mouse-lab-main.cjs'), '--m0-mouse-lab'], {
  cwd: root, env, stdio: 'ignore', windowsHide: true,
});
const timer = setTimeout(() => { status.reason = 'launcher-watchdog'; child.kill(); }, 11 * 60 * 1000);
child.once('spawn', () => { status.status = 'spawned'; status.childPid = child.pid; save(); });
child.once('error', error => { clearTimeout(timer); status.status = 'failed'; status.error = error.message; save(); process.exitCode = 1; });
child.once('exit', code => { clearTimeout(timer); status.status = 'closed'; status.exitCode = code; save(); process.exitCode = code ?? 1; });
