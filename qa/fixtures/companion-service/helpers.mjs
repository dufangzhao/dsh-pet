import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { register } from 'tsx/esm/api';

register();
export const { createCompanionService } =
  await import('../../../apps/companion-service/src/service.ts');
export const { KernelFault } = await import('../../../packages/host-kernel/src/index.ts');
const { listRecords, readRecord } = await import('../../../plugins/cloud-exec/src/records.ts');
const { docker, inspectOwned } = await import('../../../plugins/cloud-exec/src/docker.ts');

export const { STATE_CAPABILITY: STATE, EXECUTION_CAPABILITY: EXECUTION } =
  await import('../../../packages/companion-runtime/src/core-plugin.ts');
export const HARNESS = 'pet.harness-cortico';
export const ALTERNATIVE = 'pet.harness-fixture/fixture';

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

export async function within(promise, label, timeoutMs = 10000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Poll observable state; the timer only bounds observation, never orders an effect.
export async function until(read, predicate, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  do {
    last = await read();
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  throw new Error(`${label} timed out: ${JSON.stringify(last)}`);
}

export async function profile(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'companion-recovery-'));
  t.diagnostic(`Retained isolated profile: ${root}`);
  return root;
}

export function http(url, token) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const request = async (route, value) => {
    const response = await fetch(url + route, {
      headers,
      signal: AbortSignal.timeout(10000),
      ...(value === undefined ? {} : { method: 'POST', body: JSON.stringify(value) }),
    });
    return { status: response.status, body: await response.json() };
  };
  return {
    get: (route) => request(route),
    post: (route, value) => request(route, value),
    async artifact(id) {
      const response = await fetch(`${url}/api/artifacts/${id}`, {
        headers,
        signal: AbortSignal.timeout(10000),
      });
      assert.equal(response.status, 200);
      return response.text();
    },
  };
}

export async function fixture(t, options = {}) {
  const dataDirectory = options.dataDirectory ?? (await profile(t));
  const token = randomUUID() + randomUUID();
  const errors = [];
  const service = await createCompanionService({
    dataDirectory,
    token,
    ...options,
    onError: (error) => errors.push(error),
  });
  return {
    ...http(service.url, token),
    service,
    dataDirectory,
    errors,
    close: () => within(service.close(), 'service cleanup', 20000),
  };
}

export function value(reply) {
  assert.equal(reply.body.ok, true, JSON.stringify(reply));
  return reply.body.value;
}

export async function snapshot(f) {
  return value(await f.get('/api/snapshot'));
}
export async function task(f, id) {
  return value(await f.get(`/api/tasks/${id}`));
}

export function patch(object, name, wrap) {
  const original = object[name];
  object[name] = wrap(original.bind(object));
  return () => {
    object[name] = original;
  };
}

export function forbidExecution(service) {
  let calls = 0;
  const restore = patch(service.host, 'runCapability', (original) => (...args) => {
    if (args[0] === EXECUTION && args[1] === 'execute') {
      calls++;
      throw new KernelFault('internal');
    }
    return original(...args);
  });
  return {
    restore,
    get calls() {
      return calls;
    },
  };
}

export const jobsRoot = (root) => path.join(root, 'plugin-data', 'pet.cloud-exec', 'jobs');

export async function records(root) {
  const jobs = jobsRoot(root);
  return Promise.all((await listRecords(jobs)).map((id) => readRecord(jobs, id, 'pet.cloud-exec')));
}

export async function effectRecord(root) {
  return until(
    async () => {
      const jobs = jobsRoot(root);
      const ids = await listRecords(jobs);
      if (ids.length !== 1) return null;
      const jobId = ids[0];
      try {
        const effect = await readFile(path.join(jobs, jobId, 'work', 'effect.txt'), 'utf8');
        if (effect !== 'once\n') return null;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        return null;
      }
      const record = await readRecord(jobs, jobId, 'pet.cloud-exec');
      const inspected = await inspectOwned(record);
      if (inspected.kind !== 'owned' || !inspected.container.state.Running) return null;
      return record;
    },
    Boolean,
    'owned running container and first committed append',
    20000,
  );
}

export async function assertAbsent(record) {
  assert.equal((await inspectOwned(record)).kind, 'absent', 'owned container must be removed');
}

export async function cleanupContainers(root) {
  for (const record of await records(root)) {
    // The durable record and exact mount roots must both belong to this fresh profile.
    assert.equal(record.mounts[0].Source, path.join(jobsRoot(root), record.jobId, 'work'));
    assert.equal(record.mounts[1].Source, path.join(jobsRoot(root), record.jobId, 'code.mjs'));
    const inspected = await inspectOwned(record);
    assert.notEqual(
      inspected.kind,
      'unsafe',
      'refuse cleanup without exact labels, mounts and full ID',
    );
    if (inspected.kind === 'owned') {
      const removed = await docker(['rm', '--force', inspected.container.id]);
      assert.equal(removed.failed, false);
      assert.equal(removed.code, 0, removed.stderr);
    }
    await assertAbsent(record);
  }
}

export async function subprocess(t, root, image) {
  const token = randomUUID() + randomUUID();
  const child = fork(new URL('./service-process.mjs', import.meta.url), [], {
    detached: true,
    execArgv: [],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: {
      ...process.env,
      PET_RECOVERY_ROOT: root,
      PET_RECOVERY_TOKEN: token,
      PET_RECOVERY_IMAGE: image,
    },
  });
  const log = createWriteStream(path.join(root, `service-${child.pid}.log`), { flags: 'wx' });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  const ready = deferred();
  const exited = deferred();
  const replies = new Map();
  child.on('message', (message) => {
    if (message.type === 'ready') ready.resolve(message.url);
    else if (message.type === 'fatal') ready.reject(new Error(message.error));
    else if (message.id) {
      const reply = replies.get(message.id);
      replies.delete(message.id);
      if (message.error) reply?.reject(new Error(message.error));
      else reply?.resolve(message.value);
    }
  });
  child.once('error', (error) => ready.reject(error));
  child.once('exit', (code, signal) => {
    const result = { code, signal };
    exited.resolve(result);
    ready.reject(new Error(`service exited before ready: ${JSON.stringify(result)}`));
    for (const reply of replies.values())
      reply.reject(new Error(`service exited: ${JSON.stringify(result)}`));
    replies.clear();
  });
  child.once('close', () => log.end());
  // A fresh detached process group contains only this fixture service and its Docker CLI children.
  const killGroup = () => {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  const control = async (operation) => {
    const id = randomUUID();
    const reply = deferred();
    replies.set(id, reply);
    child.send({ id, operation });
    return within(reply.promise, `subprocess ${operation}`, 20000);
  };
  const stop = async (crash = false) => {
    if (child.exitCode === null && child.signalCode === null) {
      if (crash) killGroup();
      else {
        try {
          await control('close');
          await within(exited.promise, 'graceful service process exit', 10000);
        } finally {
          if (child.exitCode === null && child.signalCode === null) killGroup();
        }
      }
    }
    const outcome = await within(exited.promise, 'service process exit', 10000);
    killGroup();
    return outcome;
  };
  t.diagnostic(`Owned service subprocess: ${child.pid}`);
  try {
    const url = await within(ready.promise, 'service process readiness', 20000);
    return { ...http(url, token), control, stop, pid: child.pid };
  } catch (error) {
    await stop(true);
    throw error;
  }
}

export { docker, inspectOwned };
