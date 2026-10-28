import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const executable = path.join(
  path.dirname(require.resolve('electron/package.json')),
  'dist/electron.exe',
);
const profile = path.join(root, '.cache/cortico-native-' + Date.now());
await fs.mkdir(profile, { recursive: true });
const env = { ELECTRON_RUN_AS_NODE: '1', TSX_DISABLE_CACHE: '1' };
for (const name of [
  'SystemRoot',
  'WINDIR',
  'TEMP',
  'TMP',
  'PATH',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
]) {
  if (process.env[name]) env[name] = process.env[name];
}
const result = await new Promise((resolve, reject) => {
  const child = fork(path.join(root, 'qa/probes/cortico-host.mjs'), [profile], {
    execPath: executable,
    env,
    windowsHide: true,
    serialization: 'json',
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  let report;
  const timer = setTimeout(() => {
    child.kill();
    reject(new Error('Cortico native probe timed out'));
  }, 30000);
  child.on('message', (value) => {
    report = value;
  });
  child.once('error', (error) => {
    clearTimeout(timer);
    reject(error);
  });
  child.once('exit', (code) => {
    clearTimeout(timer);
    resolve({ ...report, exitCode: code, shutdown: { exitConfirmed: true, forced: false } });
  });
});
await fs.writeFile(
  path.join(root, 'qa/cortico-runtime-results.json'),
  JSON.stringify(result, null, 2) + '\n',
);
console.log(JSON.stringify(result));
if (result.status !== 'passed' || result.exitCode !== 0) process.exitCode = 1;
