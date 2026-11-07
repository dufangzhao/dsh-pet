import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir, symlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { docker, inspectOwned } from '../src/docker.ts';
import plugin, { DockerExecutor } from '../src/index.ts';
import { expectedMounts, readRecord, saveRecord } from '../src/records.ts';
import { retainArtifacts } from '../src/workspace.ts';
import { fixture, marker, task, owner } from './fixtures.mjs';

const enabled = process.env['PET_CLOUD_EXEC_DOCKER_TEST'] === '1';
const integration = (name, body) => test(name, { skip: !enabled, timeout: 60_000 }, body);

async function removed(jobId) {
  const listed = await docker([
    'ps',
    '-a',
    '--filter',
    `label=pet.cloud-exec.job=${jobId}`,
    '--format',
    '{{.ID}}',
  ]);
  assert.equal(listed.code, 0);
  assert.equal(listed.stdout.trim(), '');
}

integration('real Docker reads text, executes code and retains a durable artifact', async (t) => {
  const { root, config } = await fixture(t);
  let execute;
  let reconcile;
  plugin.activate({
    owner,
    config,
    dataDirectory: root,
    signal: new AbortController().signal,
    provide(id, methods) {
      assert.equal(id, 'docker');
      execute = methods.execute;
      reconcile = methods.reconcile;
    },
    effect(factory) {
      t.after(factory());
    },
  });
  assert.equal(typeof execute, 'function');
  assert.equal(typeof reconcile, 'function');
  const executionTask = task();
  const result = await execute(executionTask, {
    code: `import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
if (process.getuid() === 0 || existsSync('/var/run/docker.sock')) throw new Error('unexpected authority');
let readOnly = false;
try { await writeFile('/must-not-write', 'x'); } catch (error) { readOnly = error.code === 'EROFS'; }
if (!readOnly) throw new Error('root filesystem writable');
const text = await readFile('input.txt', 'utf8');
await writeFile('answer.txt', text.toUpperCase());
console.log('processed');`,
    files: [{ path: 'input.txt', content: 'real container work\n' }],
    outputs: [{ path: 'answer.txt', mediaType: 'text/plain' }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.error, null);
  assert.equal(result.value.status, 'exited');
  assert.equal(result.value.exitCode, 0);
  assert.equal(result.value.settled, true);
  assert.match(result.value.stdout, /processed/);
  const artifact = result.value.artifacts[0];
  assert.equal(artifact.path, 'answer.txt');
  assert.equal(path.isAbsolute(artifact.relativePath), false);
  assert.equal(
    await readFile(path.join(root, config.workspaceDirectory, artifact.relativePath), 'utf8'),
    'REAL CONTAINER WORK\n',
  );
  await removed(result.value.jobId);
  const receipts = await reconcile(task(), {});
  assert.equal(receipts.ok, true);
  assert.equal(receipts.value.receipts[0].executionId, executionTask.taskId);
  assert.deepEqual(receipts.value.receipts[0].result, result.value);
});

integration('cancel stops only its owned container while another task completes', async (t) => {
  const { root, executor } = await fixture(t);
  const controller = new AbortController();
  const first = executor.execute(task(controller), {
    code: `import { writeFile } from 'node:fs/promises';
await writeFile('ready', 'yes');
setInterval(() => {}, 1000);`,
  });
  const job = await marker(root);
  const inspected = await docker(
    ['inspect', '--format', '{{json .HostConfig}}', `pet-cloud-exec-${job}`],
    10_000,
    16_384,
  );
  assert.equal(inspected.code, 0);
  const limits = JSON.parse(inspected.stdout);
  assert.equal(limits.NetworkMode, 'none');
  assert.equal(limits.Privileged, false);
  assert.equal(limits.ReadonlyRootfs, true);
  assert.deepEqual(limits.CapDrop, ['ALL']);
  assert.ok(limits.SecurityOpt.includes('no-new-privileges=true'));
  assert.equal(limits.Memory, 128 * 1024 * 1024);
  assert.equal(limits.MemorySwap, limits.Memory);
  assert.equal(limits.PidsLimit, 32);
  assert.equal(limits.Mounts.length, 2);
  assert.ok(limits.Mounts.every((mount) => mount.Source.startsWith(root + path.sep)));
  const second = executor.execute(task(), {
    code: `import { writeFile } from 'node:fs/promises';
await new Promise(resolve => setTimeout(resolve, 500));
await writeFile('other.txt', 'unrelated work survived');`,
    outputs: [{ path: 'other.txt' }],
  });
  controller.abort();
  const cancelled = await first;
  const completed = await second;
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.value.status, 'cancelled');
  assert.equal(cancelled.value.settled, true);
  assert.ok([137, 143].includes(cancelled.value.exitCode));
  assert.equal(completed.ok, true);
  assert.equal(completed.value.exitCode, 0);
  assert.equal(completed.value.error, null);
  await removed(cancelled.value.jobId);
  await removed(completed.value.jobId);
});

integration(
  'timeout and nonzero exit preserve actual Docker status and bounded logs',
  async (t) => {
    const { executor } = await fixture(t);
    const timed = await executor.execute(task(), {
      code: 'setInterval(() => {}, 1000)',
      timeoutMs: 1500,
    });
    assert.equal(timed.ok, true);
    assert.equal(timed.value.status, 'timed-out');
    assert.equal(timed.value.settled, true);
    assert.ok([137, 143].includes(timed.value.exitCode));
    const failed = await executor.execute(task(), {
      code: 'console.log("x".repeat(10000)); console.error("failure"); process.exitCode = 7;',
    });
    assert.equal(failed.ok, true);
    assert.equal(failed.value.exitCode, 7);
    assert.equal(failed.value.logsTruncated, true);
    assert.ok(Buffer.byteLength(failed.value.stdout + failed.value.stderr) <= 4096);
    const binary = await executor.execute(task(), {
      code: 'process.stdout.write(Buffer.alloc(8000, 255));',
    });
    assert.equal(binary.ok, true);
    assert.equal(binary.value.exitCode, 0);
    assert.equal(binary.value.logsTruncated, true);
    assert.ok(Buffer.byteLength(binary.value.stdout + binary.value.stderr) <= 4096);
    assert.ok(Buffer.byteLength(JSON.stringify(binary)) <= 65_536);
    await removed(binary.value.jobId);
    await removed(timed.value.jobId);
    await removed(failed.value.jobId);
  },
);

integration('generated symlink artifacts are refused after real container execution', async (t) => {
  const { executor } = await fixture(t);
  for (const code of [
    `import { symlink } from 'node:fs/promises'; await symlink('/etc/passwd', 'escape.txt');`,
    `import { symlink } from 'node:fs/promises'; await symlink('/etc', 'dir');`,
  ]) {
    const result = await executor.execute(task(), {
      code,
      outputs: [{ path: code.includes("'dir'") ? 'dir/passwd' : 'escape.txt' }],
    });
    assert.equal(result.ok, true);
    assert.equal(result.value.exitCode, 0);
    assert.equal(result.value.settled, true);
    assert.equal(result.value.error.code, 'invalid-input');
    assert.deepEqual(result.value.artifacts, []);
    await removed(result.value.jobId);
  }
});

integration('plugin disposal waits for actual running-container cleanup', async (t) => {
  const { root, executor } = await fixture(t);
  const pending = executor.execute(task(), {
    code: `import { writeFile } from 'node:fs/promises'; await writeFile('ready', 'yes'); setInterval(() => {}, 1000);`,
  });
  await marker(root);
  await executor.close();
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.value.status, 'cancelled');
  assert.equal(result.value.settled, true);
  await removed(result.value.jobId);
  assert.equal((await executor.execute(task(), { code: '1' })).ok, false);
});

async function crashedJob(t, root, config, request, completed = false) {
  const child = spawn(
    process.execPath,
    [
      '--import',
      './tests/source-loader.mjs',
      '--input-type=module',
      '-e',
      `import { DockerExecutor } from './src/index.ts';
const executor = new DockerExecutor(${JSON.stringify({ workspaceRoot: root, config, owner: { ...owner, instanceId: 'crash-test' } })});
await executor.execute({ taskId: 'crash-task', signal: new AbortController().signal }, ${JSON.stringify(request)});`,
    ],
    { cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'ignore' },
  );
  const closed = once(child, 'exit');
  let record;
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await closed;
    }
    if (record) {
      // Test failure cleanup uses the original untampered full ownership/mount evidence.
      let inspected = await inspectOwned(record);
      if (inspected.kind === 'owned' && inspected.container.state.Running) {
        await docker(['stop', '--time', '1', inspected.container.id]);
        inspected = await inspectOwned(record);
      }
      if (inspected.kind === 'owned' && !inspected.container.state.Running)
        assert.equal((await docker(['rm', inspected.container.id])).code, 0);
    }
  });
  const jobId = await marker(root);
  record = await readRecord(root, jobId, owner.pluginId);
  const inspected = await inspectOwned(record);
  assert.equal(inspected.kind, 'owned');
  assert.equal(inspected.container.execution, request.executionId);
  assert.equal(inspected.container.mounts.length, 2);
  assert.ok(
    inspected.container.mounts.every(
      (mount) => !mount.Source.includes('.records') && !mount.Source.includes('artifacts'),
    ),
  );
  if (completed) {
    child.kill('SIGSTOP');
    const waited = await docker(['wait', inspected.container.id]);
    assert.equal(waited.stdout.trim(), '0');
  }
  child.kill('SIGKILL');
  const [, signal] = await closed;
  assert.equal(signal, 'SIGKILL');
  return record;
}

integration(
  'SIGKILL then fresh executor reconcile stops the orphan without repeating its effect',
  async (t) => {
    const { root, config } = await fixture(t);
    const request = {
      executionId: 'product-execution-crash',
      timeoutMs: 2000,
      code: `import { appendFile, writeFile } from 'node:fs/promises';
await appendFile('effect.txt', 'once\\n'); await writeFile('ready','yes'); setInterval(() => {},1000);`,
      outputs: [{ path: 'effect.txt', mediaType: 'text/plain' }],
    };
    const record = await crashedJob(t, root, config, request);
    await setTimeout(2200);
    assert.equal((await inspectOwned(record)).container.state.Running, true);
    // Also cover create succeeding before its full ID checkpoint reached durable storage.
    await saveRecord(root, { ...record, containerId: null });
    const fresh = new DockerExecutor({
      workspaceRoot: root,
      config,
      owner: { ...owner, generation: 2 },
    });
    const reconciled = await fresh.reconcile({ limit: 1 });
    assert.equal(reconciled.ok, true);
    assert.equal(reconciled.value.nextCursor, null);
    assert.equal(reconciled.value.receipts[0].executionId, request.executionId);
    const result = reconciled.value.receipts[0].result;
    assert.equal(result.status, 'unknown');
    assert.equal(result.settled, true);
    assert.ok([137, 143].includes(result.exitCode));
    assert.equal(result.artifacts.length, 1);
    await removed(record.jobId);
    assert.equal(
      await readFile(path.join(root, result.artifacts[0].relativePath), 'utf8'),
      'once\n',
    );
    assert.deepEqual(await fresh.execute(task(), request), { ok: true, value: result });
    assert.deepEqual(await fresh.reconcile({ limit: 1 }), reconciled);
    assert.equal((await readdir(root)).filter((name) => !name.startsWith('.')).length, 1);
    await fresh.close();
  },
);

integration(
  'reconcile preserves an exited-zero effect, verified artifacts and durable receipt across restarts',
  async (t) => {
    const { root, config } = await fixture(t);
    const request = {
      executionId: 'product-execution-completed',
      code: `import { appendFile, writeFile } from 'node:fs/promises';
await appendFile('effect.txt', 'once\\n'); await writeFile('ready','yes'); await new Promise(resolve => setTimeout(resolve,1500));`,
      outputs: [{ path: 'effect.txt', mediaType: 'text/plain' }],
    };
    const record = await crashedJob(t, root, config, request, true);
    // Simulate a crash after artifact publication but before writing the result checkpoint.
    const published = await retainArtifacts(
      root,
      record.jobId,
      request.outputs,
      config.maxArtifactBytes,
    );
    assert.equal(published.length, 1);
    const fresh = new DockerExecutor({ workspaceRoot: root, config, owner });
    const recovered = await fresh.reconcile();
    assert.equal(recovered.ok, true);
    assert.equal(recovered.value.receipts[0].result.status, 'exited');
    assert.equal(recovered.value.receipts[0].result.exitCode, 0);
    assert.equal(recovered.value.receipts[0].result.settled, true);
    assert.equal(recovered.value.receipts[0].result.artifacts.length, 1);
    await removed(record.jobId);
    await fresh.close();
    const restarted = new DockerExecutor({ workspaceRoot: root, config, owner });
    assert.deepEqual(await restarted.reconcile(), recovered);
    assert.deepEqual(await restarted.execute(task(), request), {
      ok: true,
      value: recovered.value.receipts[0].result,
    });
    assert.equal(
      await readFile(path.join(root, record.jobId, 'work/effect.txt'), 'utf8'),
      'once\n',
    );
    await restarted.close();
  },
);

integration(
  'mismatched execution labels and hostile metadata refuse cleanup and block new work',
  async (t) => {
    const { root, config } = await fixture(t);
    const request = {
      executionId: 'original-execution',
      code: `import { writeFile } from 'node:fs/promises'; await writeFile('ready','yes'); setInterval(() => {},1000);`,
    };
    const record = await crashedJob(t, root, config, request);
    await saveRecord(root, { ...record, executionId: 'different-execution' });
    const fresh = new DockerExecutor({ workspaceRoot: root, config, owner });
    assert.equal(
      (
        await inspectOwned({
          ...record,
          mounts: [{ ...record.mounts[0], RW: false }, record.mounts[1]],
        })
      ).kind,
      'unsafe',
    );
    const refused = await fresh.reconcile();
    assert.equal(refused.ok, true);
    assert.equal(refused.value.receipts[0].result.settled, false);
    assert.equal((await inspectOwned(record)).container.state.Running, true);
    assert.equal(
      (await fresh.execute(task(), { code: 'throw new Error("must not run")' })).ok,
      false,
    );
    await saveRecord(root, {
      ...record,
      mounts: [{ ...record.mounts[0], Source: '/etc' }, record.mounts[1]],
    });
    assert.equal((await fresh.reconcile()).ok, false);
    assert.equal((await inspectOwned(record)).container.state.Running, true);
    const metadataPath = path.join(root, '.records', `${record.jobId}.json`);
    const hostilePath = path.join(root, '.records', '00000000-0000-4000-8000-000000000000.json');
    await symlink(metadataPath, hostilePath);
    assert.equal((await fresh.reconcile()).ok, false);
    // Restore the original record while retaining the hostile entry. Admission remains blocked.
    await saveRecord(root, record);
    const isolated = new DockerExecutor({ workspaceRoot: root, config, owner });
    const recovered = await isolated.reconcile({ after: '00000000-0000-4000-8000-000000000000' });
    assert.equal(recovered.ok, true);
    assert.equal((await isolated.execute(task(), { code: '1' })).ok, false);
    await removed(record.jobId);
    await isolated.close();
    // The first executor only observed refusal; refresh its original record before close.
    await fresh.reconcile({ after: '00000000-0000-4000-8000-000000000000' });
    await fresh.close();
  },
);

integration(
  'paged receipts are idempotent and absent containers never authorize effect replay',
  async (t) => {
    const { root, config, executor } = await fixture(t);
    const firstRequest = { executionId: 'page-one', code: 'console.log("first")' };
    const first = await executor.execute(task(), firstRequest);
    const second = await executor.execute(task(), {
      executionId: 'page-two',
      code: `import { writeFile } from 'node:fs/promises'; await writeFile('completed.txt','committed');`,
      outputs: [{ path: 'completed.txt' }],
    });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    const record = await readRecord(root, first.value.jobId, owner.pluginId);
    await saveRecord(root, { ...record, result: null });
    const completed = await readRecord(root, second.value.jobId, owner.pluginId);
    // Removal already succeeded, but its last atomic checkpoint still reports cleanup pending.
    await saveRecord(root, { ...completed, result: { ...completed.result, settled: false } });
    const fresh = new DockerExecutor({ workspaceRoot: root, config, owner });
    let after;
    const receipts = [];
    do {
      const page = await fresh.reconcile({ ...(after ? { after } : {}), limit: 1 });
      assert.equal(page.ok, true);
      assert.ok(Buffer.byteLength(JSON.stringify(page)) < 65_536);
      assert.equal(page.value.receipts.length, 1);
      receipts.push(...page.value.receipts);
      after = page.value.nextCursor;
    } while (after);
    assert.equal(receipts.length, 2);
    const absent = receipts.find((receipt) => receipt.executionId === 'page-one').result;
    assert.equal(absent.status, 'unknown');
    assert.equal(absent.exitCode, null);
    assert.equal(absent.settled, true);
    const preserved = receipts.find((receipt) => receipt.executionId === 'page-two').result;
    assert.deepEqual(preserved, second.value);
    assert.equal(
      await readFile(path.join(root, preserved.artifacts[0].relativePath), 'utf8'),
      'committed',
    );
    assert.deepEqual(await fresh.execute(task(), firstRequest), { ok: true, value: absent });
    const conflict = await fresh.execute(task(), {
      ...firstRequest,
      code: 'console.log("changed")',
    });
    assert.equal(conflict.error.code, 'conflict');
    assert.deepEqual((await fresh.reconcile({ limit: 1 })).value.receipts[0], receipts[0]);
    await fresh.close();
  },
);

integration(
  'bounded recovery must visit every nonterminal record before admitting new execution',
  async (t) => {
    const { root, config } = await fixture(t);
    const request = {
      executionId: 'last-orphan',
      code: `import { writeFile } from 'node:fs/promises'; await writeFile('ready','yes'); setInterval(() => {},1000);`,
    };
    const record = await crashedJob(t, root, config, request);
    for (let index = 0; index < 9; index++) {
      const jobId = `00000000-0000-4000-8000-00000000000${index}`;
      await saveRecord(root, {
        ...record,
        executionId: `pending-${index}`,
        jobId,
        containerName: `pet-cloud-exec-${jobId}`,
        containerId: null,
        mounts: expectedMounts(root, jobId),
        result: null,
      });
    }
    const fresh = new DockerExecutor({ workspaceRoot: root, config, owner });
    const blocked = await fresh.execute(task(), { code: 'console.log("new work")' });
    assert.equal(blocked.error.code, 'not-ready');
    assert.equal((await inspectOwned(record)).container.state.Running, true);
    const first = await fresh.reconcile({ limit: 8 });
    assert.equal(first.value.receipts.length, 8);
    assert.ok(first.value.nextCursor);
    const last = await fresh.reconcile({ after: first.value.nextCursor, limit: 8 });
    assert.equal(last.value.receipts.length, 2);
    assert.equal(last.value.nextCursor, null);
    assert.equal(
      last.value.receipts.find((receipt) => receipt.executionId === 'last-orphan').result.settled,
      true,
    );
    await removed(record.jobId);
    const admitted = await fresh.execute(task(), { code: 'console.log("new work")' });
    assert.equal(admitted.value.exitCode, 0);
    await fresh.close();
  },
);

integration('missing image reports unavailable without pulling or host execution', async (t) => {
  const { executor } = await fixture(t, { image: 'pet-cloud-exec-missing:test-only' });
  const result = await executor.execute(task(), { code: 'throw new Error("not executed")' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'unavailable');
});
