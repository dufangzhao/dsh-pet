import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import {
  ALTERNATIVE,
  HARNESS,
  KernelFault,
  STATE,
  assertAbsent,
  cleanupContainers,
  deferred,
  effectRecord,
  fixture,
  forbidExecution,
  inspectOwned,
  jobsRoot,
  patch,
  profile,
  records,
  snapshot,
  subprocess,
  task,
  until,
  value,
  within,
} from '../fixtures/companion-service/helpers.mjs';
import {
  assistantMessage,
  controlledClient,
  functionCall,
} from '../fixtures/companion-service/controlled-client.mjs';

const image = process.env.PET_CLOUD_EXEC_IMAGE;
const terminal = (task) =>
  ['completed', 'cancelled', 'failed', 'unknown', 'interrupted'].includes(task.status);
const appendOnce = `import { appendFileSync } from 'node:fs'; appendFileSync('effect.txt', 'once\\n');`;
const boundedWork = `${appendOnce}
import { existsSync } from 'node:fs';
const deadline = Date.now() + 20000;
while (!existsSync('release') && Date.now() < deadline) {
  await new Promise(resolve => setTimeout(resolve, 25));
}
if (!existsSync('release')) throw new Error('Fixture release watchdog expired');
`;
const command = (title) => ({
  commandId: randomUUID(),
  title,
  code: appendOnce,
  outputs: [{ path: 'effect.txt', mediaType: 'text/plain' }],
  timeoutMs: 10000,
});

for (const boundary of ['committed-create-return', 'running-write']) {
  test(
    `visible task can stop at ${boundary} before any external execution`,
    { timeout: 30000 },
    async (t) => {
      const f = await fixture(t);
      const reached = deferred();
      const release = deferred();
      const execute = forbidExecution(f.service);
      const restore = patch(
        f.service.host,
        'call',
        (original) =>
          async (capability, method, input, ...rest) => {
            if (
              capability === STATE &&
              boundary === 'committed-create-return' &&
              method === 'createTask'
            ) {
              const result = await original(capability, method, input, ...rest);
              reached.resolve();
              await release.promise;
              return result;
            }
            if (
              capability === STATE &&
              boundary === 'running-write' &&
              method === 'updateTask' &&
              input.status === 'running'
            ) {
              reached.resolve();
              await release.promise;
            }
            return original(capability, method, input, ...rest);
          },
      );
      let admission;
      try {
        const start = command(boundary);
        admission = f.post('/api/tasks', start);
        await within(reached.promise, boundary);
        const visible = (await snapshot(f)).tasks;
        assert.equal(visible.length, 1);
        assert.equal(visible[0].status, 'accepted');
        const stop = { commandId: randomUUID() };
        value(await f.post(`/api/tasks/${visible[0].id}/stop`, stop));
        assert.equal((await task(f, visible[0].id)).status, 'cancel-requested');
        assert.equal(f.service.runtime.diagnostics().work, 1);
        release.resolve();
        assert.equal(value(await admission).taskId, visible[0].id);
        await within(f.service.runtime.whenWorkSettled(), 'cancelled admission drain');
        assert.equal((await task(f, visible[0].id)).status, 'cancelled');
        assert.equal(execute.calls, 0, 'no execute request may cross the external-effect boundary');
        assert.equal(value(await f.post('/api/tasks', start)).status, 'duplicate');
        assert.equal(
          value(await f.post(`/api/tasks/${visible[0].id}/stop`, stop)).status,
          'duplicate',
        );
        assert.equal((await snapshot(f)).tasks.length, 1);
        assert.equal(f.service.runtime.diagnostics().work, 0);
      } finally {
        release.resolve();
        if (admission) await admission;
        restore();
        execute.restore();
        await f.close();
      }
    },
  );
}

test(
  'running-state persistence failure fails the accepted task and drains without executing',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const execute = forbidExecution(f.service);
    let failures = 0;
    const restore = patch(
      f.service.host,
      'call',
      (original) =>
        async (capability, method, input, ...rest) => {
          if (capability === STATE && method === 'updateTask' && input.status === 'running') {
            failures++;
            throw new KernelFault('unavailable');
          }
          return original(capability, method, input, ...rest);
        },
    );
    try {
      const start = command('Persistence failure');
      const accepted = value(await f.post('/api/tasks', start));
      assert.equal(accepted.status, 'accepted');
      await within(f.service.runtime.whenWorkSettled(), 'failed admission drain');
      const failed = await task(f, accepted.taskId);
      assert.equal(failures, 1);
      assert.equal(failed.status, 'failed');
      assert.equal(failed.error.code, 'unavailable');
      assert.equal(failed.exitCode, null);
      assert.equal(failed.artifacts.length, 0);
      assert.equal(execute.calls, 0);
      assert.equal(f.service.runtime.diagnostics().work, 0);
      const repeated = value(await f.post('/api/tasks', start));
      assert.equal(repeated.status, 'duplicate');
      assert.equal(repeated.taskId, failed.id);
      assert.equal((await snapshot(f)).tasks.length, 1);
      assert.equal(execute.calls, 0);
    } finally {
      restore();
      execute.restore();
      await f.close();
    }
  },
);

test(
  'failed stop persistence can retry the same commandId and converge on cancellation',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const committed = deferred();
    const release = deferred();
    const execute = forbidExecution(f.service);
    let stopWrites = 0;
    const restore = patch(
      f.service.host,
      'call',
      (original) =>
        async (capability, method, input, ...rest) => {
          if (capability === STATE && method === 'createTask') {
            const result = await original(capability, method, input, ...rest);
            committed.resolve();
            await release.promise;
            return result;
          }
          if (
            capability === STATE &&
            method === 'updateTask' &&
            input.status === 'cancel-requested' &&
            ++stopWrites === 1
          )
            throw new KernelFault('unavailable');
          return original(capability, method, input, ...rest);
        },
    );
    let admission;
    try {
      admission = f.post('/api/tasks', command('Retry stopping'));
      await within(committed.promise, 'real task commit');
      const visible = (await snapshot(f)).tasks[0];
      const stop = { commandId: randomUUID() };
      const first = await f.post(`/api/tasks/${visible.id}/stop`, stop);
      assert.equal(first.body.ok, false);
      assert.equal(first.body.error.code, 'unavailable');
      assert.equal((await task(f, visible.id)).status, 'accepted');
      const retry = value(await f.post(`/api/tasks/${visible.id}/stop`, stop));
      assert.equal(
        retry.status,
        'accepted',
        'failed application cannot become a permanent duplicate success',
      );
      assert.equal(stopWrites, 2);
      assert.equal((await task(f, visible.id)).status, 'cancel-requested');
      release.resolve();
      value(await admission);
      await within(f.service.runtime.whenWorkSettled(), 'retried cancellation drain');
      assert.equal((await task(f, visible.id)).status, 'cancelled');
      assert.equal(value(await f.post(`/api/tasks/${visible.id}/stop`, stop)).status, 'duplicate');
      assert.equal(execute.calls, 0);
    } finally {
      release.resolve();
      if (admission) await admission;
      restore();
      execute.restore();
      await f.close();
    }
  },
);

test(
  'plugin lifecycle failure retries its command and unknown targets never become duplicate successes',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    let attempts = 0;
    const restore = patch(f.service.host.manager, 'disable', (original) => async (identity) => {
      if (identity.pluginId === 'pet.text-client' && ++attempts === 1)
        return { ok: false, error: new KernelFault('unavailable').error };
      return original(identity);
    });
    try {
      const disable = { commandId: randomUUID(), enabled: false };
      const first = await f.post('/api/plugins/pet.text-client', disable);
      assert.equal(first.body.ok, false);
      assert.equal(first.body.error.code, 'unavailable');
      assert.equal(f.service.host.isEnabled('pet.text-client'), true);
      assert.equal(value(await f.post('/api/plugins/pet.text-client', disable)).status, 'accepted');
      assert.equal(attempts, 2);
      assert.equal(f.service.host.isEnabled('pet.text-client'), false);
      assert.equal(
        value(await f.post('/api/plugins/pet.text-client', disable)).status,
        'duplicate',
      );
      value(
        await f.post('/api/plugins/pet.text-client', { commandId: randomUUID(), enabled: true }),
      );
      assert.equal(f.service.host.isEnabled('pet.text-client'), true);
      const unknown = { commandId: randomUUID(), enabled: true };
      for (let index = 0; index < 2; index++) {
        const denied = await f.post('/api/plugins/pet.does-not-exist', unknown);
        assert.equal(denied.status, 400);
        assert.equal(denied.body.ok, false);
        assert.equal(denied.body.error.code, 'invalid-input');
      }
      assert.equal(
        await f.service.runtime.state('getCommand', {
          commandId: unknown.commandId,
          kind: 'plugin.select',
          payload: { id: 'pet.does-not-exist', enabled: true },
        }),
        null,
      );
    } finally {
      restore();
      await f.close();
    }
  },
);

test(
  'real rejecting Cordis disposer leaves pending_restart and blocks harness replacement',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    // Decorate the registered real Cortico definition before a fresh activation. All production
    // source bytes and fingerprints remain unchanged; the extra Cordis effect alone is faulty.
    const registration = f.service.host.sources.get(HARNESS).registration;
    const original = registration.definition;
    let disposed = 0;
    try {
      value(await f.post(`/api/plugins/${HARNESS}`, { commandId: randomUUID(), enabled: false }));
      registration.definition = {
        ...original,
        async activate(context) {
          await original.activate(context);
          context.effect(() => async () => {
            disposed++;
            throw new Error('Injected disposer rejection');
          });
        },
      };
      value(await f.post(`/api/plugins/${HARNESS}`, { commandId: randomUUID(), enabled: true }));
      const select = { commandId: randomUUID(), harness: ALTERNATIVE };
      for (let index = 0; index < 2; index++) {
        const result = await f.post('/api/harness', select);
        assert.equal(result.body.ok, false, 'unconfirmed drain must not allow replacement');
        const current = await snapshot(f);
        assert.equal(current.agent.harness, `${HARNESS}/cortico`);
        assert.equal(current.agent.status, 'unavailable');
        assert.equal(
          current.plugins.find((plugin) => plugin.id === HARNESS).state,
          'pending_restart',
        );
        assert.equal(f.service.host.isEnabled('pet.harness-fixture'), false);
      }
      assert.equal(disposed, 1);
      assert.equal(
        await f.service.runtime.state('getCommand', {
          commandId: select.commandId,
          kind: 'harness.select',
          payload: { harness: ALTERNATIVE },
        }),
        null,
      );
    } finally {
      registration.definition = original;
      // The injected disposer poisons the driver's confirmation even though its real Core closes.
      await assert.rejects(f.close(), /Runtime cleanup incomplete/);
      assert.equal(f.service.host.driver.diagnostics().fibers, 0);
    }
  },
);

for (const recoveredState of ['exited', 'running']) {
  test(
    `SIGKILL service during Docker work reconciles ${recoveredState} execution without replay`,
    {
      skip: !image,
      timeout: 70000,
    },
    async (t) => {
      const root = await profile(t);
      let first;
      let second;
      let record;
      try {
        first = await subprocess(t, root, image);
        const identity = (await snapshot(first)).agent.id;
        const memory = value(await first.get('/api/memory'));
        assert.ok(Number.isSafeInteger(memory.revision));
        assert.equal(
          memory.facts.find((fact) => fact.key === 'recovery'),
          undefined,
        );
        const remembered = value(
          await first.post('/api/facts', {
            commandId: randomUUID(),
            expectedMemoryRevision: memory.revision,
            expectedFactRevision: 0,
            key: 'recovery',
            value: 'same durable root',
          }),
        );
        assert.equal(remembered.receipt.status, 'accepted');
        const start = {
          ...command(`Crash recovery ${recoveredState}`),
          code: boundedWork,
          timeoutMs: 30000,
        };
        const accepted = value(await first.post('/api/tasks', start));
        record = await effectRecord(root);
        const before = await task(first, accepted.taskId);
        assert.equal(before.status, 'running');
        assert.equal(before.executionId, record.executionId);
        assert.equal((await first.stop(true)).signal, 'SIGKILL');
        assert.equal((await inspectOwned(record)).kind, 'owned');
        if (recoveredState === 'exited') {
          await writeFile(path.join(jobsRoot(root), record.jobId, 'work', 'release'), 'release');
          await until(
            () => inspectOwned(record),
            (result) => result.kind === 'owned' && !result.container.state.Running,
            'container finishes independently while service is dead',
          );
        }
        second = await subprocess(t, root, image);
        const recovered = await task(second, before.id);
        assert.equal(recovered.id, before.id);
        assert.equal(recovered.executionId, before.executionId);
        assert.equal(recovered.createdAt, before.createdAt);
        assert.equal(recovered.title, before.title);
        assert.equal(recovered.status, recoveredState === 'exited' ? 'completed' : 'unknown');
        assert.equal(
          recovered.artifacts.length,
          1,
          'recovery must attach the original verified artifact to its logical task',
        );
        const content = await second.artifact(recovered.artifacts[0].id);
        assert.equal(content, 'once\n');
        assert.equal(
          await readFile(path.join(jobsRoot(root), record.jobId, 'work', 'effect.txt'), 'utf8'),
          'once\n',
        );
        await assertAbsent(record);
        const durable = await records(root);
        assert.equal(durable.length, 1);
        assert.equal(durable[0].executionId, before.executionId);
        assert.equal(durable[0].result.settled, true);
        const stable = await snapshot(second);
        assert.equal(stable.agent.id, identity);
        assert.equal(
          stable.facts.find((fact) => fact.key === 'recovery').value,
          'same durable root',
        );
        assert.equal(stable.tasks.length, 1);
        assert.equal(value(await second.post('/api/tasks', start)).status, 'duplicate');
        for (let index = 0; index < 3; index++) {
          await second.control('reconcile');
          const repeated = await snapshot(second);
          assert.equal(
            repeated.cursor,
            stable.cursor,
            'reconciliation must not churn the durable event cursor',
          );
          assert.deepEqual(repeated.tasks, stable.tasks);
          assert.deepEqual(repeated.messages, stable.messages);
          assert.equal((await records(root)).length, 1);
        }
        assert.equal((await second.control('diagnostics')).work, 0);
        await assertAbsent(record);
      } finally {
        // Terminate exact fixture process groups before verifying and removing exact owned containers.
        try {
          if (second) await second.stop();
        } finally {
          try {
            if (first) await first.stop(true);
          } finally {
            await cleanupContainers(root);
          }
        }
      }
    },
  );
}

test(
  'HTTP input B gets the next model permit while A retains its actual receipt and Docker work runs',
  {
    skip: !image,
    timeout: 60000,
  },
  async (t) => {
    const controlled = controlledClient({ holdResponses: 3 });
    const f = await fixture(t, {
      image,
      mode: 'model',
      model: 'controlled-offline',
      client: controlled.client,
    });
    let record;
    const phases = [];
    const restore = patch(f.service.runtime, 'harnessPorts', (original) => (...args) => {
      const ports = original(...args);
      return {
        ...ports,
        status(status, error) {
          phases.push(status);
          ports.status(status, error);
        },
      };
    });
    try {
      // Reconstruct once so the injected status observer watches the actual Core generation.
      value(await f.post(`/api/plugins/${HARNESS}`, { commandId: randomUUID(), enabled: false }));
      value(await f.post(`/api/plugins/${HARNESS}`, { commandId: randomUUID(), enabled: true }));
      const inputA = value(
        await f.post('/api/messages', {
          commandId: randomUUID(),
          text: 'INPUT_A start independent work',
        }),
      );
      const first = await controlled.next(1);
      phases.length = 0;
      const inputB = value(
        await f.post('/api/messages', {
          commandId: randomUUID(),
          text: 'INPUT_B continue talking now',
        }),
      );
      assert.equal(
        controlled.requests.length,
        1,
        'B is submitted while inference A remains unresolved',
      );
      assert.equal(first.done, false);
      assert.equal(first.options.signal.aborted, false);
      first.complete([
        functionCall('start_work', 'http-start-A', {
          inputId: inputA.messageId,
          title: 'Independent actual Docker work',
          code: boundedWork,
          timeoutMs: 30000,
          outputs: [{ path: 'effect.txt', mediaType: 'text/plain' }],
        }),
      ]);
      const second = await controlled.next(2);
      const rendered = JSON.stringify(second.request.input);
      assert.match(rendered, /INPUT_B continue talking now/);
      assert.match(rendered, new RegExp(inputB.messageId));
      assert.equal(
        second.request.input.some(
          (item) => item.type === 'function_call_output' && item.call_id === 'http-start-A',
        ),
        false,
        "B cannot inherit A's private native tool tail",
      );
      assert.notEqual(second.options.sessionId, first.options.sessionId);
      record = await effectRecord(f.dataDirectory);
      const current = await snapshot(f);
      assert.equal(current.tasks.length, 1);
      assert.equal(
        phases.includes('ready'),
        false,
        'no onIdle-ready boundary may precede B entering the next inference',
      );
      assert.equal((await task(f, current.tasks[0].id)).status, 'running');
      assert.equal(f.service.runtime.diagnostics().work, 1);
      second.complete([assistantMessage('ANSWER_B while independent work is running')]);
      const continuationA = await controlled.next(3);
      assert.equal(
        continuationA.options.sessionId,
        first.options.sessionId,
        'A resumes its retained native session rather than being reconstructed',
      );
      assert.equal(continuationA.options.signal.aborted, false);
      const output = continuationA.request.input.find(
        (item) => item.type === 'function_call_output' && item.call_id === 'http-start-A',
      );
      assert.ok(output, 'A continuation carries its actual start_work tool output');
      assert.match(JSON.stringify(output), /accepted/);
      const receiptMatch = JSON.stringify(output).match(
        /[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}/g,
      );
      assert(
        receiptMatch?.includes(current.tasks[0].id),
        'A tool receipt identifies the canonical logical task',
      );
      await until(
        () => snapshot(f),
        (state) =>
          state.messages.some(
            (message) =>
              message.role === 'assistant' &&
              message.inputId === inputB.messageId &&
              message.text === 'ANSWER_B while independent work is running',
          ),
        'committed answer B',
      );
      assert.equal((await inspectOwned(record)).container.state.Running, true);
      assert.equal((await task(f, current.tasks[0].id)).status, 'running');
      value(await f.post('/api/foreground/stop', { commandId: randomUUID() }));
      assert.equal(continuationA.done, true, 'foreground stop joins the outstanding A inference');
      assert.equal(continuationA.options.signal.aborted, true);
      assert.equal(
        (await inspectOwned(record)).container.state.Running,
        true,
        'foreground reconstruction must not stop independent work',
      );
      await writeFile(
        path.join(jobsRoot(f.dataDirectory), record.jobId, 'work', 'release'),
        'release',
      );
      const done = await until(
        () => task(f, current.tasks[0].id),
        terminal,
        'independent work completion',
        20000,
      );
      assert.equal(done.status, 'completed');
      assert.equal(await f.artifact(done.artifacts[0].id), 'once\n');
      await within(f.service.runtime.whenWorkSettled(), 'independent work drain');
      await assertAbsent(record);
      assert.equal(controlled.requests.length >= 3, true);
    } finally {
      controlled.close();
      restore();
      try {
        await f.close();
      } finally {
        await cleanupContainers(f.dataDirectory);
      }
    }
  },
);
