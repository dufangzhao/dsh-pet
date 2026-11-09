// Records frozen QA and product fingerprints before invoking one integration probe.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const cases = {
  migration: ['qa/probes/companion-persona-memory-migration.mjs'],
  natural: ['qa/probes/companion-persona-memory-natural.mjs'],
  'work-result': ['qa/probes/companion-persona-memory-work-result.mjs'],
  worker: ['qa/probes/companion-persona-memory-worker.mjs'],
  persistence: ['qa/probes/companion-persona-memory-persistence.mjs'],
  replay: ['qa/probes/companion-persona-memory-replay.mjs'],
  'build1-ui': ['qa/probes/companion-persona-memory-build1-ui.mjs'],
  rail: ['qa/probes/companion-persona-memory-rail.mjs'],
  forms: ['qa/probes/companion-persona-memory-forms.mjs', '--run-frozen'],
};
const selection = process.argv[2];
assert.ok(Object.hasOwn(cases, selection) && process.argv.length === 3, 'Expected one known probe name');
const sources = [
  'apps/companion-service/src', 'apps/companion-service/dist', 'apps/desktop/dist',
  'packages/companion-runtime/src', 'packages/contracts/src', 'packages/host-kernel/src',
  'packages/plugin-sdk/src', 'plugins/state-sqlite/src', 'plugins/cloud-exec/src',
  'plugins/harness-cortico/src', 'plugins/model-connection-magpie/src', 'plugins/text-client/dist',
];
const singles = ['apps/desktop/src/main/builtin-admission.json', 'qa/probes/companion-persona-memory-run.mjs',
  'qa/probes/companion-persona-memory-migration.mjs', 'qa/probes/companion-persona-memory-natural.mjs',
  'qa/probes/companion-persona-memory-work-result.mjs', 'qa/probes/companion-persona-memory-worker.mjs',
  'qa/probes/companion-persona-memory-persistence.mjs', 'qa/probes/companion-persona-memory-replay.mjs',
  'qa/probes/companion-persona-memory-build1-ui.mjs', 'qa/probes/companion-persona-memory-rail.mjs',
  'qa/probes/companion-persona-memory-forms.mjs',
  'qa/fixtures/companion-service/controlled-client.mjs', 'qa/fixtures/companion-service/helpers.mjs',
  'qa/fixtures/companion-desktop/display.mjs', 'qa/fixtures/companion-desktop/service.mjs'];
async function walk(dir) {
  const result = [];
  for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
    const name = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await walk(name));
    else if (entry.isFile() && !/\.test\.[cm]?[jt]sx?$/.test(name) && !name.endsWith('.map')) result.push(name);
    else if (!entry.isFile()) throw new Error(`Unexpected link or entry: ${name}`);
  }
  return result;
}
async function hashes() {
  const extra = (await walk('qa/fixtures/companion-persona-memory')).filter((name) => !name.includes('/evidence/'));
  const paths = [...new Set([...singles, ...extra, ...(await Promise.all(sources.map(walk))).flat()])].sort();
  const pairs = await Promise.all(paths.map(async (name) => {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path.join(root, name))) hash.update(chunk);
    return [name, hash.digest('hex')];
  }));
  return Object.fromEntries(pairs);
}
const evidence = path.join(root, 'qa/fixtures/companion-persona-memory/evidence');
await mkdir(evidence, { recursive: true, mode: 0o700 });
const resultPath = path.join(evidence, `${selection}-${randomUUID()}.json`);
const before = await hashes();
const report = { stage: selection, status: 'running', startedAt: new Date().toISOString(),
  execution: cases[selection][0], productAndRunnerHashesBefore: before };
await writeFile(resultPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const result = await new Promise((resolve) => {
  const child = spawn(process.execPath, ['--no-warnings', ...cases[selection]],
    { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.once('error', (error) => resolve({ code: null, signal: null, launchError: error.name, stdout, stderr }));
  child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
});
let probe;
try { probe = JSON.parse(result.stdout); }
catch { probe = { status: 'invalid-report', stdoutSha256: createHash('sha256').update(result.stdout).digest('hex') }; }
const after = await hashes();
const stable = JSON.stringify(before) === JSON.stringify(after);
Object.assign(report, { completedAt: new Date().toISOString(), exitCode: result.code, signal: result.signal,
  ...(result.launchError ? { launchError: result.launchError } : {}),
  stderrSha256: createHash('sha256').update(result.stderr).digest('hex'), inputsUnchanged: stable,
  probe, status: result.code === 0 && stable ? 'passed' : 'failed' });
await writeFile(resultPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ stage: selection, status: report.status, exitCode: result.code,
  probeStatus: probe.status, checks: probe.checks, failure: probe.failure,
  inputsUnchanged: stable, report: path.relative(root, resultPath) }, null, 2));
process.exitCode = report.status === 'passed' ? 0 : 1;
