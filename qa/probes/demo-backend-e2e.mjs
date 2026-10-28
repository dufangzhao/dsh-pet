import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const require = createRequire(import.meta.url),
  executable = path.join(
    path.dirname(require.resolve('electron/package.json')),
    'dist/electron.exe',
  );
const entry = path.join(root, '.cache/demo-backend-' + stamp + '/main.cjs');
await build({
  entryPoints: [path.join(root, 'qa/probes/demo-backend-host.ts')],
  outfile: entry,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  external: ['electron'],
});
const env = { ELECTRON_RUN_AS_NODE: '1' };
for (const name of [
  'SystemRoot',
  'WINDIR',
  'TEMP',
  'TMP',
  'PATH',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
])
  if (process.env[name]) env[name] = process.env[name];
const report = await new Promise((resolve, reject) => {
  const child = fork(entry, [], {
    execPath: executable,
    env,
    windowsHide: true,
    serialization: 'json',
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  let report;
  const timer = setTimeout(() => {
    child.kill();
    reject(new Error('Backend demo timed out'));
  }, 60000);
  child.on('message', (data) => {
    report = data;
  });
  child.once('error', (error) => {
    clearTimeout(timer);
    reject(error);
  });
  child.once('exit', (code) => {
    clearTimeout(timer);
    if (code === 0 && report?.status === 'passed') resolve(report);
    else reject(new Error(report?.failure ?? 'Backend demo failed'));
  });
});
await fs.writeFile(
  path.join(root, 'qa/demo-backend-results.json'),
  JSON.stringify(report, null, 2) + String.fromCharCode(10),
);
console.log(JSON.stringify(report));
