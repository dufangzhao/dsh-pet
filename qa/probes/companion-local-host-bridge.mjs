import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'tsx/esm/api';
register();
const { createServerFixture } = await import('../fixtures/local-host/bridge-server.mjs');
const { createNativePeer } = await import('../fixtures/local-host/bridge-native.mjs');
const { deferred, within, ok, png, noPrivate, sha } =
  await import('../fixtures/local-host/bridge-common.mjs');

const root = await mkdtemp(path.join(tmpdir(), 'pet-bridge-g0-'));
let server, native, child, exit, localCleanup;
let stdout = '',
  stderr = '';
const pending = new Map(),
  childReady = deferred();
const processControl = (kind) => {
  const id = randomUUID(),
    response = deferred();
  pending.set(id, response);
  child.send({ kind, id });
  return within(response.promise, `local process ${kind}`, 20000);
};
const report = {
  gate: 'G0 two-process owner-claimed native feasibility',
  result: 'running',
  root,
  incomplete: [
    'Remote participant/native ingress and Core facade (G3)',
    'Production remote sender/global cleanup hold recovery (G5)',
    'State4 durable execution binding and same-attempt enrichment (G1)',
    'Production raw-custody/actor-revocation cut before codec/ASR (G4)',
  ],
};
try {
  native = await createNativePeer();
  server = await createServerFixture(path.join(root, 'server'));
  const localDirectory = path.join(root, 'local');
  await mkdir(localDirectory);
  child = fork(
    fileURLToPath(new URL('../fixtures/local-host/bridge-local.mjs', import.meta.url)),
    [],
    {
      execArgv: ['--import', 'tsx'],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, TSX_DISABLE_CACHE: '1' },
    },
  );
  const exited = deferred();
  exit = exited.promise;
  child.stdout.on('data', (bytes) => {
    stdout = (stdout + bytes).slice(-65536);
  });
  child.stderr.on('data', (bytes) => {
    stderr = (stderr + bytes).slice(-65536);
  });
  child.on('error', (error) => childReady.reject(error));
  child.once('exit', (code, signal) => {
    exited.resolve({ code, signal });
    for (const current of pending.values())
      current.reject(new Error(`Local process exited before control reply: ${code}`));
    pending.clear();
    if (code !== 0) childReady.reject(new Error(`Local exit ${code}: ${stderr}`));
  });
  child.on('message', (message) => {
    if (message.kind === 'ready') childReady.resolve(message);
    else if (message.kind === 'error') {
      const error = new Error(message.stack ?? message.error);
      childReady.reject(error);
      for (const current of pending.values()) current.reject(error);
    } else if (message.id && pending.has(message.id)) {
      pending.get(message.id).resolve(message);
      pending.delete(message.id);
    }
  });
  child.send({
    kind: 'start',
    directory: localDirectory,
    baseUrl: server.baseUrl,
    nativeUrl: native.url,
    token: server.token,
    hostId: server.hostId,
    agentId: server.initial.assistantId,
    agentEpoch: server.initial.epoch,
  });
  const localReady = await within(childReady.promise, 'local host process ready', 20000);
  const offered = await server.ready();
  assert.notEqual(localReady.pid, process.pid);
  assert.equal(offered.bootId, localReady.bootId);
  assert.deepEqual(offered.sources.map((value) => value.account.protocol).sort(), [
    'official',
    'onebot-v11',
  ]);
  report.processes = {
    serverPid: process.pid,
    localPid: localReady.pid,
    bootId: localReady.bootId,
  };
  report.kernelOwners = offered.sources.map((value) => value.owner);

  const issue = async (delivery, partId, operation, options) => {
    const claim = await server.claim(delivery.id, partId, operation);
    const attempt = claim.delivery.parts.find((value) => value.id === partId)[
      operation === 'send' ? 'send' : 'upload'
    ];
    native.expectClaim(async () => {
      const current = await server.state('getDelivery', {
        id: delivery.id,
        scope: { kind: 'management' },
      });
      const actual = current.parts.find((value) => value.id === partId)[
        operation === 'send' ? 'send' : 'upload'
      ];
      assert.equal(actual.id, attempt.id);
      assert.equal(actual.phase, 'claimed');
    });
    const execution = await server.execute(claim, partId, operation, options);
    return { ...execution, claim, attempt };
  };
  const reconnect = async () => {
    await server.prepareReconnect();
    await processControl('reconnect');
    await server.ready();
    assert.equal(server.offers.at(-1).bootId, localReady.bootId);
  };

  const lost = await server.seed('lost bridge reply after actual native acceptance');
  const lostResult = await issue(lost, lost.parts[0].id, 'send', { dropReply: true });
  assert.equal(lostResult.result.ok, false);
  assert.equal(
    native.messages.filter((value) => value.body.content === lost.parts[0].content.text).length,
    1,
    JSON.stringify({
      bridgeResult: lostResult.result,
      authorityChecks: server.checks,
      nativeErrors: native.errors.map(String),
    }),
  );
  const unknown = await server.settle(lost.id, lost.parts[0].id, 'send', {
    outcome: 'unknown',
    cleanup: 'unknown',
    receipt: null,
    error: { code: 'unavailable', messageKey: 'errors.unavailable', retryable: false },
  });
  assert.equal(unknown.phase, 'terminal');
  assert.equal(unknown.outcome, 'unknown');
  await reconnect();
  assert.notEqual(server.peer.context.sessionId, lostResult.context.sessionId);
  const known = await server.inspect(lostResult);
  assert.equal(known.outcome.outcome, 'accepted');
  assert.equal(known.outcome.cleanup, 'settled');
  assert.equal(known.outcome.receipt.messageId, native.messages[0].id);
  assert.equal(known.workPending, false);
  assert.equal(known.cleanupFailed, false);
  assert.deepEqual(known.localTask, lostResult.localTask);
  const duplicate = await server.state('claimDeliveryAttempt', {
    id: lost.id,
    partId: lost.parts[0].id,
    attempt: lostResult.attempt,
  });
  assert.equal(duplicate.claimed, false);
  await assert.rejects(
    server.settle(lost.id, lost.parts[0].id, 'send', known.outcome),
    /conflict/,
    'State3 does not implement terminal same-attempt enrichment; do not fake a G1 pass',
  );
  const repeatedExecute = await server.peer.rpc.request(
    'delivery.execute',
    { ...lostResult.request, identity: lostResult.identity },
    { taskId: lostResult.request.wireTaskId },
  );
  assert.equal(repeatedExecute.ok, false);
  assert.equal(native.messages.length, 1);
  report.lostReply = {
    oldNativeEffectCount: 1,
    inspectOutcome: known.outcome.outcome,
    nativeMessageId: known.outcome.receipt.messageId,
    state3Outcome: (
      await server.state('getDelivery', { id: lost.id, scope: { kind: 'management' } })
    ).outcome,
    enrichment: 'expected State3 conflict; pending G1',
  };

  const next = await server.seed('new owner-seeded claim after same-boot reconnect');
  const nextResult = await issue(next, next.parts[0].id, 'send');
  const nextOutcome = ok(nextResult.result);
  assert.equal(nextOutcome.outcome, 'accepted');
  assert.equal(
    (await server.settle(next.id, next.parts[0].id, 'send', nextOutcome)).outcome,
    'accepted',
  );
  assert.equal(native.messages.length, 2);

  const bytes = png(96 * 1024);
  assert(bytes.length > 64 * 1024);
  const image = await server.seed('actual image follows this mandatory text', bytes);
  const textResult = await issue(image, image.parts[0].id, 'send');
  await server.settle(image.id, image.parts[0].id, 'send', ok(textResult.result));
  const upload = await issue(image, image.parts[1].id, 'upload');
  const uploaded = ok(upload.result);
  assert.equal(uploaded.outcome, 'accepted');
  assert.equal(typeof uploaded.continuation, 'string');
  assert.equal(noPrivate(uploaded), true);
  assert.equal(native.uploads.length, 1);
  assert.deepEqual(native.uploads[0].bytes, bytes);
  assert.equal(native.uploads[0].sha256, sha(bytes));
  await server.settle(image.id, image.parts[1].id, 'upload', uploaded);
  const send = await issue(image, image.parts[1].id, 'send', {
    continuation: uploaded.continuation,
  });
  assert.equal(ok(send.result).outcome, 'accepted');
  assert.equal(
    (await server.settle(image.id, image.parts[1].id, 'send', ok(send.result))).outcome,
    'accepted',
  );
  assert.equal(native.messages.at(-1).body.media.file_info, native.uploads[0].fileInfo);
  report.twoStage = {
    imageBytes: bytes.length,
    sha256: sha(bytes),
    uploadCount: 1,
    nativeMediaSendCount: 1,
    nativeFileId: uploaded.receipt.fileId,
    nativeMessageId: ok(send.result).receipt.messageId,
  };

  const stale = await server.seed('second image continuation must not cross bridge session', bytes);
  const staleText = await issue(stale, stale.parts[0].id, 'send');
  await server.settle(stale.id, stale.parts[0].id, 'send', ok(staleText.result));
  const staleUpload = await issue(stale, stale.parts[1].id, 'upload');
  const staleUploaded = ok(staleUpload.result);
  await server.settle(stale.id, stale.parts[1].id, 'upload', staleUploaded);
  const before = native.messages.length;
  server.peer.close();
  await reconnect();
  const rejected = await issue(stale, stale.parts[1].id, 'send', {
    continuation: staleUploaded.continuation,
  });
  assert.equal(rejected.result.ok, false);
  assert.equal(rejected.result.error.code, 'permission-denied');
  assert.equal(
    native.messages.length,
    before,
    'old continuation cannot publish on replacement bridge',
  );
  const fabricatedStream = server.peer.media.createReader({
    owner: server.peer.context.owner,
    taskId: 'not-an-owned-task',
    streamId: 'not-an-owned-stream',
  });
  assert.equal(fabricatedStream.ok, false);
  assert.equal(native.errors.length, 0);
  assert.equal(server.wireValues.every(noPrivate), true);
  assert(server.checks.length > 0);
  report.native = {
    publications: native.messages.length,
    uploads: native.uploads.length,
    stateClaimObservationsAtNativeIO: native.claimObservations,
    freshChecks: server.checks.length,
    oldContinuationRejected: true,
    fabricatedTaskStreamRejected: true,
    privateReferenceWireLeaks: 0,
  };
  localCleanup = (await processControl('close')).summary;
  const end = await within(exit, 'local process exit');
  assert.equal(end.code, 0);
  assert.equal(end.signal, null);
  assert.deepEqual(localCleanup.localPlugins.sort(), ['pet.qq-official', 'pet.qq-onebot']);
  assert.equal(localCleanup.rootEntries.includes('state'), false);
  assert.equal(localCleanup.rootEntries.includes('state.sqlite'), false);
  assert.equal(localCleanup.pendingWork, 0);
  assert.equal(localCleanup.leases, 0);
  assert.equal(localCleanup.privateWireLeaks, 0);
  assert.deepEqual(localCleanup.errors, []);
  assert.equal(stdout.includes('PRIVATE_LOCAL_FILE_INFO_CANARY'), false);
  assert.equal(stderr.includes('CONTROLLED_QQ_SECRET_CANARY'), false);
  report.cleanup = { local: localCleanup, childExit: end };
  report.result = 'passed feasibility; production-dependent gates explicitly incomplete';
} catch (error) {
  report.result = 'failed';
  report.error = error.stack ?? String(error);
  report.childStderr = stderr;
  process.exitCode = 1;
} finally {
  let clean = true;
  try {
    if (child && child.exitCode === null && child.signalCode === null) {
      await Promise.race([processControl('close'), exit]);
      await within(exit, 'local cleanup exit');
    }
  } catch (error) {
    clean = false;
    report.cleanupError = String(error);
    process.exitCode = 1;
    child?.kill('SIGTERM');
    if (exit) await within(exit, 'forced local process exit').catch(() => {});
  }
  try {
    await server?.close();
    await native?.close();
  } catch (error) {
    clean = false;
    report.cleanupError = String(error);
    process.exitCode = 1;
  }
  if (clean) {
    const target = await realpath(root);
    assert.equal(path.dirname(target), await realpath(tmpdir()));
    assert(path.basename(target).startsWith('pet-bridge-g0-'));
    await rm(target, { recursive: true });
    report.rootRemovedAfterJoin = true;
  }
  console.log(JSON.stringify(report, null, 2));
}
