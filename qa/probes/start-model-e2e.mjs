import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { closeSync, openSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const executable = path.join(path.dirname(require.resolve('electron/package.json')), 'dist/electron.exe');
await fs.mkdir(path.join(root, '.cache'), { recursive: true });
const directory = await fs.mkdtemp(path.join(root, '.cache/start-model-'));
const entry = path.join(directory, 'main.cjs');
const stderrPath = path.join(directory, 'stderr.log');
const resultPath = path.join(root, 'qa/start-model-results.json');
const redact = text => text.replace(/QA_START_(?:KEY|STALE)_[A-Za-z0-9_-]+/g, '[redacted QA credential]');
let result = { status: 'failed', directory: path.relative(root, directory) };
try {
  // Parent builds product artifacts first. This bundles only the QA entry, with esbuild kept external.
  await build({ entryPoints: [path.join(root, 'qa/probes/start-model-host.ts')], outfile: entry,
    bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron', 'esbuild'] });
  const env = { ELECTRON_RUN_AS_NODE: '1' };
  for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'])
    if (process.env[key]) env[key] = process.env[key];
  const exit = await new Promise((resolve, reject) => {
    const fd = openSync(stderrPath, 'w');
    let child;
    try {
      child = fork(entry, [], { cwd: root, execPath: executable, env, windowsHide: true,
        serialization: 'json', stdio: ['ignore', 'ignore', fd, 'ipc'] });
    } finally { closeSync(fd); }
    let report;
    let reportFailure;
    let forced = false;
    const timer = setTimeout(() => { forced = true; child.kill(); }, 120000);
    child.on('message', data => {
      if (report !== undefined || !data || typeof data !== 'object' || Array.isArray(data)) {
        reportFailure = 'Host emitted an invalid or duplicate report';
        return;
      }
      const serialized = JSON.stringify(data);
      if (Buffer.byteLength(serialized) > 96 * 1024) reportFailure = 'Host report exceeded 96 KiB';
      else {
        const safe = redact(serialized);
        if (safe !== serialized) reportFailure = 'Host report failed credential exclusion';
        report = JSON.parse(safe);
      }
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ status: 'failed', ...report, ...(reportFailure ? { status: 'failed', failure: reportFailure } : {}),
        exitCode: code, processExit: { confirmed: true, forced, signal } });
    });
  });
  result = { ...result, ...exit };
  if (result.exitCode !== 0 || result.processExit.forced || result.processExit.signal !== null ||
    result.hostShutdown?.exitConfirmed !== true || result.hostShutdown?.forced !== false) {
    result.status = 'failed';
    result.failure ??= 'Native Host or runner process did not shut down cleanly';
  }
  if (result.status === 'passed' && (!Array.isArray(result.hostShutdowns) ||
    result.hostShutdowns.map(stage => stage.phase).join(',') !== 'initial,restored,user-disabled,disabled-reopen' ||
    result.hostShutdowns.some(stage => stage.exitConfirmed !== true || stage.forced !== false))) {
    result.status = 'failed';
    result.failure = 'Every reopened host must confirm clean shutdown in the expected serial order';
  }
} catch (error) {
  result.failure = redact(error instanceof Error ? error.stack ?? error.message : String(error)).slice(-8000);
}
try {
  const log = await fs.open(stderrPath, 'r');
  let tail;
  try {
    const stat = await log.stat();
    const bytes = Buffer.alloc(Math.min(stat.size, 8000));
    const read = await log.read(bytes, 0, bytes.length, Math.max(0, stat.size - bytes.length));
    tail = bytes.subarray(0, read.bytesRead).toString('utf8');
  } finally { await log.close(); }
  const safe = redact(tail);
  if (safe !== tail) {
    result.status = 'failed';
    result.failure ??= 'A QA credential canary reached stderr; the retained log was redacted';
  }
  // Retain only bounded, redacted diagnostic text, even on a failed run.
  await fs.writeFile(stderrPath, safe);
  result.stderr = safe;
} catch (error) {
  if (error?.code !== 'ENOENT') {
    result.status = 'failed';
    result.failure ??= 'Runner could not collect bounded diagnostics';
  }
}
await fs.writeFile(resultPath, JSON.stringify(result, null, 2) + String.fromCharCode(10));
console.log(JSON.stringify(result));
if (result.status !== 'passed') process.exitCode = 1;
