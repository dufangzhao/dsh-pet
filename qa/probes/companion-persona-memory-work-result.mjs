// Real independent Docker work → actual Core work-result input → controlled remember attempt.
// Run only after parent freezes product/build and authorizes integration.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { register } from 'tsx/esm/api';
import { workResultCase } from '../fixtures/companion-persona-memory/natural-cases.mjs';

register();
const { createCompanionService } = await import('../../apps/companion-service/src/service.ts');
const { controlledClient, functionCall, assistantMessage } =
  await import('../fixtures/companion-service/controlled-client.mjs');
const { cleanupContainers, jobsRoot } = await import('../fixtures/companion-service/helpers.mjs');
const report = { scope: 'real-work-result-controlled-remember-only', status: 'running', checks: [],
  limit: 'Controlled Responses, not a live model; actual Docker work and actual Core work-result delivery.' };
let service, peer, token, root;
let stage = 'preflight', exit = 1;
try {
  const image = process.env.PET_CLOUD_EXEC_IMAGE;
  assert.ok(image, 'PET_CLOUD_EXEC_IMAGE must name an already prepared image');
  root = await mkdtemp(path.join(os.tmpdir(), 'companion-m3-work-result-'));
  token = randomUUID() + randomUUID();
  peer = controlledClient({ holdResponses: 4 });
  service = await createCompanionService({ dataDirectory: root, token, image,
    mode: 'model', model: 'controlled-offline', client: peer.client });
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const request = async (route, body) => {
    const response = await fetch(service.url + route, { headers, signal: AbortSignal.timeout(10000),
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
    const envelope = await response.json();
    assert.equal(envelope.ok, true, `service request failed: ${response.status}`);
    return envelope.value;
  };
  stage = 'real-work-admission';
  const before = await request('/api/memory');
  const input = await request('/api/messages', { commandId: randomUUID(), text: '请执行一个独立小任务并报告结果。' });
  assert.ok(input.messageId);
  const first = await peer.next(1);
  first.complete([functionCall('start_work', 'start-real-work', {
    inputId: input.messageId,
    title: workResultCase.text,
    code: "await new Promise(resolve => setTimeout(resolve, 3000)); console.log('synthetic completed work');",
    timeoutMs: 20000,
  })]);
  const second = await peer.next(2);
  const receipt = second.request.input.find((item) => item.type === 'function_call_output' && item.call_id === 'start-real-work');
  assert.ok(receipt, 'actual start_work receipt must reach the next Core inference');
  const initial = await request('/api/snapshot');
  const task = initial.tasks.find((item) => item.title === workResultCase.text);
  assert.ok(task && JSON.stringify(receipt).includes(task.id), 'actual task ID must match tool receipt');
  second.complete([assistantMessage('已受理独立工作。')]);
  stage = 'actual-completion';
  const deadline = Date.now() + 45000;
  let finished;
  do {
    finished = await request(`/api/tasks/${encodeURIComponent(task.id)}`);
    if (['completed', 'failed', 'cancelled', 'unknown', 'interrupted'].includes(finished.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  assert.equal(finished.status, 'completed');
  const third = await peer.next(3);
  const actualWorkInputId = `work-event-${finished.executionId}`;
  const inputText = JSON.stringify(third.request.input);
  assert.ok(inputText.includes(actualWorkInputId) && inputText.includes(workResultCase.text),
    'controlled attempt must bind the actual delivered work result, not a fabricated user event');
  third.complete([functionCall('remember', 'work-result-remember', {
    inputId: actualWorkInputId, key: workResultCase.candidate.key, value: workResultCase.candidate.value,
  })]);
  stage = 'rejection-and-canonical-state';
  const fourth = await peer.next(4);
  const output = fourth.request.input.find((item) => item.type === 'function_call_output' && item.call_id === 'work-result-remember');
  assert.ok(output, 'actual Core must return a tool result');
  const toolText = typeof output.output === 'string' ? output.output : JSON.stringify(output.output);
  assert.match(toolText, /requires a current user input/);
  const after = await request('/api/memory');
  assert.equal(after.revision, before.revision);
  assert.deepEqual(after.facts, before.facts);
  fourth.complete([assistantMessage('独立工作已完成。')]);
  report.checks.push('real-work-result-tool-refusal-without-memory-write');
  report.task = { id: task.id, executionId: task.executionId, status: finished.status };
  report.toolFailure = { representation: 'actual Core function_call_output text', text: toolText.slice(0, 500) };
  report.status = 'work-result-subset-passed'; exit = 0;
} catch (error) {
  let detail = error instanceof Error ? error.message : 'Non-error failure';
  for (const secret of [token].filter(Boolean))
    for (const value of [secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64'), JSON.stringify(secret).slice(1, -1)])
      detail = detail.split(value).join('[redacted]');
  report.status = 'work-result-subset-failed'; report.failure = `${stage}: ${detail.slice(0, 1000)}`;
} finally {
  try { peer?.close(); await service?.close(); }
  catch { report.status = 'cleanup-failed'; exit = 1; }
  if (root) {
    try {
      const exists = await access(jobsRoot(root)).then(() => true, (error) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      });
      if (exists) await cleanupContainers(root);
    } catch { report.status = 'cleanup-failed'; exit = 1; }
  }
  console.log(JSON.stringify(report, null, 2)); process.exitCode = exit;
}
