import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import {
  call,
  createProofSource,
  message,
  within,
} from '../fixtures/companion-qq-context-proof/runtime.mjs';

// node qa/probes/companion-qq-context-proof.mjs
// Real Cortico + TaskSupervisor + CredentialBroker, synthetic grants/provider/work; no service/socket.
const root = await mkdtemp(path.join(tmpdir(), 'companion-qq-context-proof-'));
const report = {
  scope: 'phase0-native-core-permit-proof',
  status: 'failed',
  node: process.versions.node,
  root,
  startedAt: new Date().toISOString(),
  checks: [],
  networkCalls: 0,
  sources: Object.fromEntries(
    await Promise.all(
      [
        'plugins/harness-cortico/src/model-permit.ts',
        'qa/fixtures/companion-qq-context-proof/runtime.mjs',
        'qa/probes/companion-qq-context-proof.mjs',
        'plugins/harness-cortico/node_modules/cortico/src/core/core.ts',
        'plugins/harness-cortico/node_modules/cortico/src/core/loop.ts',
      ].map(async (file) => [
        file,
        createHash('sha256')
          .update(await readFile(new URL(`../../${file}`, import.meta.url)))
          .digest('hex'),
      ]),
    ),
  ),
  limits: [
    'Synthetic credential grants/provider/work bodies; no real model, QQ, Docker or service.',
    'Does not establish runtime audience policy, canonical State admissions or integrated source lifecycle.',
    'Main Harness/index/facade/runtime remain unchanged; this proves the SDK composition and permit.',
  ],
};
const fetchBefore = globalThis.fetch;
globalThis.fetch = async () => {
  report.networkCalls++;
  throw new Error('Network access is forbidden in this controlled proof');
};
let source;
let stage = 'load';
try {
  source = await createProofSource(root);
  stage = 'independent-contexts';
  const a = await source.openContext('input-A', 'PRIVATE_A_CANARY_7291');
  const b = await source.openContext('input-B', 'PRIVATE_B_CANARY_6042', { holdWorldStop: true });
  assert.notEqual(a.directory, b.directory);
  assert.notEqual(a.core.session, b.core.session);
  assert.notEqual(a.core.store, b.core.store);
  assert.notEqual(a.core.bus, b.core.bus);
  await a.push();
  const first = await source.next('input-A:1');
  await b.push();
  await source.wait(() => source.requests.some((entry) => entry.label === 'input-B:1'), 'B parked');
  assert.deepEqual(source.permit.diagnostics(), { active: true, waiting: 1 });
  assert.equal(source.trace.filter((entry) => entry.kind === 'credential.borrow').length, 1);
  assert.ok(!source.calls.some((entry) => entry.label === 'input-B:1'));
  first.complete([
    call('input-A', 'First independent work', 'A-work-1'),
    call('input-A', 'Second independent work', 'A-work-2'),
  ]);
  const second = await source.next('input-B:1');
  await source.wait(
    () => source.requests.some((entry) => entry.label === 'input-A:2'),
    'A next step parked',
  );
  assert.equal(source.workers.length, 2);
  assert.deepEqual(
    source.calls.map((entry) => entry.label),
    ['input-A:1', 'input-B:1'],
  );
  assert.deepEqual(source.permit.diagnostics(), { active: true, waiting: 1 });
  assert.ok(JSON.stringify(second.request.input).includes(b.canary));
  assert.ok(!JSON.stringify(second.request.input).includes(a.canary));
  assert.equal(second.options.sessionId, 'input-B:foreground');
  report.checks.push('independent-Core-dataDir-store-bus-and-native-input-canaries');
  report.checks.push('FIFO-B-gets-next-native-dispatch-before-A-second-step');
  report.checks.push('parked-input-holds-no-credential-borrow');

  stage = 'retained-tail-and-sibling-close';
  second.complete([message('B completed in its own scope', 'B-answer')]);
  const third = await source.next('input-A:2');
  await source.wait(() => b.idleCount === 1, 'B terminal');
  const tail = third.request.input;
  for (const [index, callId] of ['A-work-1', 'A-work-2'].entries()) {
    assert.equal(
      tail.filter((entry) => entry.type === 'function_call' && entry.call_id === callId).length,
      1,
    );
    const receipt = tail.find(
      (entry) => entry.type === 'function_call_output' && entry.call_id === callId,
    );
    assert.ok(receipt);
    assert.ok(JSON.stringify(receipt).includes(source.workers[index].receipt.taskId));
  }
  assert.ok(JSON.stringify(tail).includes(a.canary));
  assert.ok(!JSON.stringify(tail).includes(b.canary));
  let bClosed = false;
  const closingB = b.close().then(() => {
    bClosed = true;
  });
  await within(b.worldEntered, 'B actual world stop');
  await nextTurn();
  assert.equal(bClosed, false, 'close must wait the actual World disposer');
  assert.equal(third.options.signal.aborted, false, 'closing B must not abort A');
  b.releaseWorld();
  await within(closingB, 'B close joined');
  assert.equal(source.nativeActive, 1);
  third.complete([call('input-A', 'Third work after sibling close', 'A-work-3')]);
  const fourth = await source.next('input-A:3');
  assert.equal(source.workers.length, 3);
  assert.ok(
    fourth.request.input.some(
      (entry) => entry.type === 'function_call_output' && entry.call_id === 'A-work-3',
    ),
  );
  fourth.complete([message('A completed with three accepted work receipts', 'A-answer')]);
  await source.wait(() => a.idleCount === 1, 'A terminal');
  await within(a.close(), 'A close joined');
  assert.ok(source.workers.every((worker) => worker.handle.snapshot().workPending));
  await source.finishWorkers();
  assert.ok(source.workers.every((worker) => !worker.handle.snapshot().workPending));
  const logA = await readFile(path.join(a.directory, 'data/session-main.jsonl'), 'utf8');
  const logB = await readFile(path.join(b.directory, 'data/session-main.jsonl'), 'utf8');
  assert.ok(logA.includes(a.canary) && !logA.includes(b.canary));
  assert.ok(logB.includes(b.canary) && !logB.includes(a.canary));
  assert.ok(logA.includes('A-work-1') && logA.includes('A-work-2') && logA.includes('A-work-3'));
  report.checks.push('A-retains-original-native-tool-calls-and-actual-supervisor-receipts');
  report.checks.push('three-start_work-effects-without-rebuild-or-one-work-cap');
  report.checks.push('sibling-close-waits-World-return-and-does-not-retire-A-or-independent-work');
  report.checks.push('separate-persisted-native-tails-with-zero-foreign-canaries');

  stage = 'park-cancel-and-actual-native-join';
  const c = await source.openContext('input-C', 'PRIVATE_C_ACTIVE');
  const d = await source.openContext('input-D', 'PRIVATE_D_CANCELLED');
  await c.push();
  const held = await source.next('input-C:1');
  await d.push();
  await source.wait(() => source.requests.some((entry) => entry.label === 'input-D:1'), 'D parked');
  d.cancel();
  const logicalD = await d.handle.result;
  assert.equal(logicalD.ok, false);
  await within(d.close(), 'D cancelled parked context joined');
  assert.ok(!source.calls.some((entry) => entry.label.startsWith('input-D:')));
  assert.ok(
    !source.trace.some(
      (entry) => entry.kind === 'credential.borrow' && entry.label.startsWith('input-D:'),
    ),
  );
  assert.equal(held.options.signal.aborted, false);
  assert.deepEqual(source.permit.diagnostics(), { active: true, waiting: 0 });
  c.cancel();
  const logicalC = await c.handle.result;
  assert.equal(logicalC.ok, false);
  await within(held.aborted, 'C native abort observed');
  let cClosed = false;
  const closingC = c.close().then(() => {
    cClosed = true;
  });
  await nextTurn();
  assert.equal(cClosed, false, 'logical cancellation must not count as native drain');
  assert.equal(held.settled, false);
  assert.equal(
    source.permit.diagnostics().active,
    true,
    'native work retains the permit until actual settlement',
  );
  held.fail();
  await within(closingC, 'C native/task/world join');
  assert.equal(held.settled, true);
  assert.equal(c.pending, 0);
  assert.equal(d.pending, 0);
  report.checks.push('cancelled-parked-D-unblocks-with-zero-provider-and-credential-calls');
  report.checks.push('logical-cancel-keeps-permit-until-native-and-broker-task-actually-settle');
  assert.equal(source.maxNativeActive, 1);
  assert.equal(report.networkCalls, 0);
  report.status = 'passed';
} catch (error) {
  report.failure = { stage, message: error instanceof Error ? error.message : String(error) };
} finally {
  try {
    if (source) {
      await within(source.close(), 'whole proof source cleanup');
      assert.equal(source.trace.at(-1).kind, 'loader.unregistered');
      assert.ok(
        source.trace
          .filter((entry) => entry.kind === 'context.joined')
          .every((entry) => entry.stopFailures === 0 && entry.remaining === 0),
      );
      report.cleanup = {
        contextsJoined: source.trace
          .filter((entry) => entry.kind === 'context.closed')
          .map((entry) => entry.id),
        worldsStopped: source.trace
          .filter((entry) => entry.kind === 'world.stopped')
          .map((entry) => entry.id),
        nativeCalls: source.calls.length,
        nativeSettled: source.calls.filter((entry) => entry.settled).length,
        maxNativeActive: source.maxNativeActive,
        leases: source.leases,
        tasks: source.tasks.diagnostics(),
        credentials: source.broker.diagnostics(),
        permit: source.permit.diagnostics(),
        loaderUnregisteredLast: true,
      };
      report.checks.push(
        'all-native-world-task-credential-work-joined-before-awaited-loader-unregister',
      );
      await writeFile(path.join(root, 'trace.json'), JSON.stringify(source.trace, null, 2), {
        flag: 'wx',
      });
    }
  } catch (error) {
    report.status = 'failed';
    report.cleanupFailure = error instanceof Error ? error.message : String(error);
  } finally {
    globalThis.fetch = fetchBefore;
  }
  await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.status === 'passed' ? 0 : 1;
}
