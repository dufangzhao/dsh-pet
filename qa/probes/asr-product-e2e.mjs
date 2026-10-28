import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url),
  executable = path.join(
    path.dirname(require.resolve('electron/package.json')),
    'dist/electron.exe',
  );
const entry = path.join(root, '.cache/asr-product/main.cjs');
await build({
  entryPoints: [path.join(root, 'qa/probes/asr-product-host.ts')],
  outfile: entry,
  platform: 'node',
  format: 'cjs',
  bundle: true,
  target: 'node24',
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
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    serialization: 'json',
  });
  const timer = setTimeout(() => {
    child.kill();
    reject(new Error('Product ASR process timed out'));
  }, 60000);
  let report;
  child.on('message', (value) => {
    report = value;
  });
  child.once('error', (error) => {
    clearTimeout(timer);
    reject(error);
  });
  child.once('exit', (code) => {
    clearTimeout(timer);
    if (code === 0 && report?.status === 'passed') resolve(report);
    else reject(new Error(report?.failure ?? 'Product ASR failed'));
  });
});
await fs.writeFile(
  path.join(root, 'qa/M3-asr-product-results.json'),
  JSON.stringify(report, null, 2) + String.fromCharCode(10),
);
console.log(JSON.stringify(report));
