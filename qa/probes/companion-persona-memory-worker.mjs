// Actual independent Docker work across owner persona/memory apply and a controlled Core turn.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { register } from 'tsx/esm/api';

register();
const { createCompanionService } = await import('../../apps/companion-service/src/service.ts');
const { controlledClient, functionCall, assistantMessage } = await import('../fixtures/companion-service/controlled-client.mjs');
const { effectRecord, jobsRoot, records, cleanupContainers } = await import('../fixtures/companion-service/helpers.mjs');
const report = { scope: 'actual-worker-persona-memory-continuity', status: 'running', checks: [],
  limit: 'Real isolated Docker work and actual service/Core; model responses are controlled.' };
let service, peer, token, root;
let stage = 'preflight', exit = 1;
try {
  const image = process.env.PET_CLOUD_EXEC_IMAGE;
  assert.ok(image, 'PET_CLOUD_EXEC_IMAGE must name an already prepared image');
  root = await mkdtemp(path.join(os.tmpdir(), 'companion-m3-worker-'));
  report.syntheticRoot = root;
  token = randomUUID() + randomUUID(); peer = controlledClient();
  service = await createCompanionService({ dataDirectory: root, token, image,
    mode: 'model', model: 'controlled-offline', client: peer.client });
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const request = async (route, body) => {
    const response = await fetch(service.url + route, { headers, signal: AbortSignal.timeout(10000),
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
    const envelope = await response.json();
    assert.equal(envelope.ok, true, `actual service ${route} failed: ${response.status}`);
    return envelope.value;
  };
  stage = 'start-real-work';
  const initialProfile = await request('/api/profile');
  const initialModel = await request('/api/model');
  const start = { commandId: randomUUID(), title: 'M3 independent work',
    code: "import {appendFileSync,existsSync,writeFileSync} from 'node:fs'; appendFileSync('effect.txt','once\\n'); const deadline=Date.now()+25000; while (!existsSync('release') && Date.now()<deadline) await new Promise(r=>setTimeout(r,40)); if (!existsSync('release')) throw new Error('release watchdog'); writeFileSync('result.txt','independent work completed\\n');",
    outputs: [{ path: 'result.txt', mediaType: 'text/plain' }], timeoutMs: 28000 };
  const admitted = await request('/api/tasks', start);
  assert.ok(admitted.taskId);
  const record = await effectRecord(root);
  const workDir = path.join(jobsRoot(root), record.jobId, 'work');
  assert.equal(record.mounts[0].Source, workDir);
  const initialTask = await request(`/api/tasks/${admitted.taskId}`);
  assert.equal(initialTask.status, 'running');
  assert.equal(initialTask.executionId, record.executionId);
  async function unchangedWork() {
    const task = await request(`/api/tasks/${admitted.taskId}`);
    assert.equal(task.status, 'running'); assert.equal(task.executionId, initialTask.executionId);
    const current = await records(root);
    assert.equal(current.length, 1); assert.equal(current[0].jobId, record.jobId);
    assert.equal(current[0].containerId, record.containerId);
    assert.equal(await readFile(path.join(workDir, 'effect.txt'), 'utf8'), 'once\n');
  }
  stage = 'owner-persona-and-memory-while-running';
  const persona = 'Keep answers grounded and concise in this synthetic scenario.';
  const saved = await request('/api/profile', { expectedProfileRevision: initialProfile.revision,
    name: 'M3 Work Companion', persona });
  assert.equal(saved.name, 'M3 Work Companion'); assert.equal(saved.persona, persona);
  assert.equal(saved.management.application.appliedRevision, saved.revision);
  await unchangedWork();
  const memory = await request('/api/memory');
  assert.equal(memory.facts.some((fact) => fact.key === 'worker-context'), false);
  const remembered = await request('/api/facts', { commandId: randomUUID(), expectedMemoryRevision: memory.revision,
    expectedFactRevision: 0, key: 'worker-context', value: '独立任务继续运行' });
  assert.equal(remembered.receipt.status, 'accepted');
  assert.equal(remembered.view.application.appliedRevision, remembered.view.revision);
  await unchangedWork(); assert.equal(peer.requests.length, 0, 'owner edits must not trigger inference');
  const afterModel = await request('/api/model');
  assert.deepEqual(afterModel.desired, initialModel.desired);
  assert.deepEqual(afterModel.applied, initialModel.applied);
  assert.deepEqual(afterModel.connectors.map(({id,configRevision,credential}) => ({id,configRevision,version:credential.version})),
    initialModel.connectors.map(({id,configRevision,credential}) => ({id,configRevision,version:credential.version})));
  report.checks.push('same-running-task-through-owner-profile-and-memory-apply-without-inference');
  stage = 'current-turn-remember-while-running';
  const user = await request('/api/messages', { commandId: randomUUID(), text: '请记住我喜欢乌龙茶。' });
  const first = await peer.next(1);
  first.complete([functionCall('remember', 'worker-remember', { inputId: user.messageId,
    key: 'tea', value: '我喜欢乌龙茶' })]);
  const second = await peer.next(2);
  assert.equal(second.options.signal.aborted, false);
  assert.ok(second.request.input.some((item) => item.type === 'function_call_output' && item.call_id === 'worker-remember'));
  assert.equal((await request('/api/memory')).facts.find((fact) => fact.key === 'tea')?.value, '我喜欢乌龙茶');
  await unchangedWork();
  second.complete([assistantMessage('已记住。')]);
  const idleDeadline = Date.now() + 15000;
  while ((await request('/api/snapshot')).agent.status !== 'ready') {
    assert.ok(Date.now() < idleDeadline, 'foreground did not finish');
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  await unchangedWork();
  report.checks.push('current-turn-remember-completes-with-independent-worker-still-running');
  stage = 'same-work-completes-once-with-artifact';
  await writeFile(path.join(workDir, 'release'), 'release\n', { flag: 'wx', mode: 0o600 });
  const deadline = Date.now() + 30000;
  let finished;
  do {
    finished = await request(`/api/tasks/${admitted.taskId}`);
    if (['completed', 'failed', 'cancelled', 'unknown', 'interrupted'].includes(finished.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  assert.equal(finished.status, 'completed'); assert.equal(finished.executionId, initialTask.executionId);
  assert.equal(finished.artifacts.length, 1);
  const artifact = finished.artifacts[0];
  const response = await fetch(`${service.url}/api/artifacts/${artifact.id}`, { headers, signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.toString('utf8'), 'independent work completed\n');
  assert.equal(await readFile(path.join(workDir, 'effect.txt'), 'utf8'), 'once\n');
  assert.equal((await records(root)).length, 1);
  report.work = { taskId: admitted.taskId, executionId: initialTask.executionId, jobId: record.jobId,
    artifactId: artifact.id, artifactSha256: createHash('sha256').update(bytes).digest('hex') };
  report.checks.push('same-task-execution-and-artifact-complete-without-replay');
  report.status = 'worker-continuity-passed'; exit = 0;
} catch (error) {
  let detail = error instanceof Error ? error.message : 'Non-error failure';
  for (const secret of [token].filter(Boolean))
    for (const value of [secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64'), JSON.stringify(secret).slice(1, -1)])
      detail = detail.split(value).join('[redacted]');
  report.status = 'worker-continuity-failed'; report.failure = `${stage}: ${detail.slice(0, 1000)}`;
} finally {
  try { peer?.close(); await service?.close(); }
  catch { report.status = 'cleanup-failed'; exit = 1; }
  if (root) {
    try {
      const exists = await access(jobsRoot(root)).then(() => true, (error) => {
        if (error.code === 'ENOENT') return false; throw error;
      });
      if (exists) await cleanupContainers(root);
    } catch { report.status = 'cleanup-failed'; exit = 1; }
  }
  console.log(JSON.stringify(report, null, 2)); process.exitCode = exit;
}
