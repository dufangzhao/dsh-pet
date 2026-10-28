import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { openSync, closeSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const executable = path.join(path.dirname(require.resolve('electron/package.json')), 'dist/electron.exe');
await fs.mkdir(path.join(root, '.cache'), { recursive: true });
const directory = await fs.mkdtemp(path.join(root, '.cache/application-model-'));
const entry = path.join(directory, 'main.cjs');
await build({ entryPoints: [path.join(root, 'qa/probes/application-model-host.ts')], outfile: entry, bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron', 'esbuild'] });
const stderrPath = path.join(directory, 'stderr.log');
const env = { ELECTRON_RUN_AS_NODE: '1' };
for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) if (process.env[key]) env[key] = process.env[key];
const result = await new Promise((resolve, reject) => {
  const fd = openSync(stderrPath, 'w');
  const child = fork(entry, [], { execPath: executable, env, windowsHide: true, serialization: 'json', stdio: ['ignore', 'ignore', fd, 'ipc'] });
  closeSync(fd);
  let report;
  let forced = false;
  const timer = setTimeout(() => { forced = true; child.kill(); }, 90000);
  child.on('message', data => { report = data; });
  child.once('error', error => { clearTimeout(timer); reject(error); });
  child.once('exit', (code, signal) => {
    clearTimeout(timer);
    resolve({ status: 'failed', ...report, exitCode: code, processExit: { confirmed: true, forced, signal } });
  });
});
result.stderr = (await fs.readFile(stderrPath, 'utf8')).slice(-6000);
if (result.exitCode !== 0 || result.processExit.forced || result.processExit.signal !== null || result.hostShutdown?.exitConfirmed !== true || result.hostShutdown?.forced !== false) {
  result.status = 'failed';
  result.failure ??= 'Native Host or runner process did not shut down cleanly';
}
await fs.writeFile(path.join(root, 'qa/application-model-results.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
if (result.status !== 'passed') process.exitCode = 1;
