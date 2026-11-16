#!/usr/bin/env node
// Local operator entry: start / status / stop one companion service instance.
// The service keeps running after this command exits; shutdown is requested
// through a stop file because a detached Windows process has no SIGTERM.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDirectory = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.resolve(
  process.env['COMPANION_DATA_DIR'] ?? path.join(appDirectory, '../../.companion-data/agent'),
);
const port = Number(process.env['COMPANION_PORT'] ?? '4120');
const hostname = process.env['COMPANION_HOST'] ?? '127.0.0.1';
const baseUrl = `http://${hostname}:${port}`;
const tokenPath = path.join(dataDirectory, 'operator-token');
const pidPath = path.join(dataDirectory, 'service.pid');
const stopPath = path.join(dataDirectory, 'stop.request');
const logPath = path.join(dataDirectory, 'service.log');

function ensureToken() {
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  if (existsSync(tokenPath)) return readFileSync(tokenPath, 'utf8').trim();
  const token = randomBytes(32).toString('hex');
  writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });
  console.log(`Created operator token: ${tokenPath}`);
  return token;
}

function readPid() {
  if (!existsSync(pidPath)) return null;
  const value = Number(readFileSync(pidPath, 'utf8').trim());
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function snapshot(token) {
  const response = await fetch(`${baseUrl}/api/snapshot`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`snapshot returned HTTP ${response.status}`);
  return (await response.json()).value;
}

async function waitFor(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const value = await check();
      if (value) return value;
    } catch {
      // The service is still starting; keep waiting until the deadline.
    }
    if (Date.now() >= deadline) throw new Error(`${label} did not complete within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function start() {
  const token = ensureToken();
  const pid = readPid();
  if (pid && alive(pid)) {
    const view = await snapshot(token).catch(() => null);
    if (view) {
      console.log(`Already running: ${baseUrl} (pid ${pid})`);
      return;
    }
    throw new Error(`Process ${pid} is alive but the service does not answer at ${baseUrl}`);
  }
  rmSync(pidPath, { force: true });
  // A stop request left by a crashed instance must not stop the new one.
  rmSync(stopPath, { force: true });
  const log = openSync(logPath, 'a');
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: appDirectory,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', log, log],
    env: {
      ...process.env,
      COMPANION_DATA_DIR: dataDirectory,
      COMPANION_TOKEN: token,
      COMPANION_PORT: String(port),
      COMPANION_HOST: hostname,
      COMPANION_STOP_FILE: stopPath,
    },
  });
  child.unref();
  closeSync(log);
  writeFileSync(pidPath, `${child.pid}\n`);
  try {
    await waitFor(async () => Boolean(await snapshot(token)), 120000, 'service start');
  } catch (error) {
    console.error(`Service did not become ready. See ${logPath}.`);
    throw error;
  }
  console.log(`Started: ${baseUrl} (pid ${child.pid})`);
  console.log(`Data:    ${dataDirectory}`);
  console.log(`Log:     ${logPath}`);
}

async function status() {
  const token = ensureToken();
  const pid = readPid();
  if (!pid || !alive(pid)) {
    console.log(`Stopped (no live pid at ${pidPath}).`);
    process.exitCode = 1;
    return;
  }
  const view = await snapshot(token);
  const rejected = view.plugins.filter((plugin) => plugin.state === 'rejected');
  console.log(`Running: ${baseUrl} (pid ${pid})`);
  console.log(`Agent:   ${view.agent?.status ?? 'unknown'}`);
  if (rejected.length)
    console.log(`Unavailable on this host: ${rejected.map((p) => p.id).join(', ')}`);
}

async function stop() {
  const pid = readPid();
  if (!pid || !alive(pid)) {
    rmSync(pidPath, { force: true });
    console.log('Already stopped.');
    return;
  }
  writeFileSync(stopPath, 'stop\n');
  await waitFor(() => !alive(pid), 60000, 'service stop');
  rmSync(pidPath, { force: true });
  rmSync(stopPath, { force: true });
  console.log(`Stopped (pid ${pid}).`);
}

const command = process.argv[2] ?? 'start';
try {
  if (command === 'start') await start();
  else if (command === 'status') await status();
  else if (command === 'stop') await stop();
  else {
    console.error('Usage: node local.mjs [start|status|stop]');
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
