// Actual lost HTTP response and same-intent durable replay on a synthetic root.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { register } from 'tsx/esm/api';
import { startResponseGate } from '../fixtures/companion-persona-memory/response-gate.mjs';

register();
const { createCompanionService } = await import('../../apps/companion-service/src/service.ts');
const report = { scope: 'real-http-lost-receipt-durable-replay', status: 'running', checks: [] };
let service, gate, token;
let stage = 'preflight', exit = 1;
try {
  const root = await mkdtemp(path.join(os.tmpdir(), 'companion-m3-replay-'));
  report.syntheticRoot = root;
  async function start() {
    token = randomUUID() + randomUUID();
    service = await createCompanionService({ dataDirectory: root, token, mode: 'scripted' });
  }
  async function response(route, input) {
    const result = await fetch(service.url + route, { headers: { Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000),
      ...(input === undefined ? {} : { method: 'POST', body: JSON.stringify(input) }) });
    return { status: result.status, body: await result.json() };
  }
  async function value(route, input) {
    const result = await response(route, input);
    assert.equal(result.body.ok, true, `service ${route} failed: ${result.status}`);
    return result.body.value;
  }
  await start(); gate = await startResponseGate(service.url);
  stage = 'drop-committed-upsert-receipt';
  const memory = await value('/api/memory');
  const key = 'replay-key', original = { commandId: randomUUID(), expectedMemoryRevision: memory.revision,
    expectedFactRevision: 0, key, value: 'first durable value' };
  assert.equal(memory.facts.find((fact) => fact.key === key), undefined);
  const held = gate.arm('/api/facts');
  const controller = new AbortController();
  const lost = fetch(gate.url + '/api/facts', { method: 'POST', signal: controller.signal,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(original) });
  void lost.catch(() => {});
  const committed = await held.observed;
  assert.equal(committed.method, 'POST'); assert.equal(committed.status, 200);
  const afterCommit = await value('/api/memory');
  const cursorAfterCommit = (await value('/api/snapshot')).cursor;
  assert.equal(afterCommit.facts.find((fact) => fact.key === key)?.value, original.value);
  controller.abort(); await assert.rejects(lost);
  report.cancelledSocketReleased = held.release();
  const duplicate = await value('/api/facts', original);
  assert.equal(duplicate.receipt.status, 'duplicate'); assert.equal(duplicate.committedRevision, afterCommit.revision);
  assert.equal((await value('/api/snapshot')).cursor, cursorAfterCommit);
  const changed = await response('/api/facts', { ...original, value: 'different reused payload' });
  assert.equal(changed.status, 409); assert.equal(changed.body.error.code, 'conflict');
  report.checks.push('lost-committed-http-receipt-retries-as-same-duplicate-without-event');
  stage = 'correct-forget-recreate-and-replay';
  const row = afterCommit.facts.find((fact) => fact.key === key);
  const correction = await value('/api/facts', { commandId: randomUUID(), expectedMemoryRevision: afterCommit.revision,
    expectedFactRevision: row.revision, key, value: 'corrected value' });
  const afterCorrection = await value('/api/snapshot');
  const oldRetry = await value('/api/facts', original);
  assert.equal(oldRetry.receipt.status, 'duplicate');
  assert.equal(oldRetry.view.facts.find((fact) => fact.key === key)?.value, 'corrected value');
  assert.equal((await value('/api/snapshot')).cursor, afterCorrection.cursor);
  const changedRow = correction.view.facts.find((fact) => fact.key === key);
  const forget = { commandId: randomUUID(), expectedMemoryRevision: correction.view.revision,
    expectedFactRevision: changedRow.revision, key };
  const forgotten = await value('/api/facts/forget', forget);
  assert.equal(forgotten.receipt.status, 'accepted');
  const recreated = await value('/api/facts', { commandId: randomUUID(), expectedMemoryRevision: forgotten.view.revision,
    expectedFactRevision: 0, key, value: 'new incarnation' });
  const afterRecreate = await value('/api/snapshot');
  const duplicateForget = await value('/api/facts/forget', forget);
  assert.equal(duplicateForget.receipt.status, 'duplicate');
  assert.equal(duplicateForget.committedRevision, forgotten.committedRevision);
  assert.equal(duplicateForget.view.facts.find((fact) => fact.key === key)?.value, 'new incarnation');
  assert.equal((await value('/api/snapshot')).cursor, afterRecreate.cursor);
  report.checks.push('old-upsert-and-forget-retries-cannot-undo-correction-or-recreate');
  stage = 'real-service-restart-and-replay';
  await gate.close(); gate = undefined;
  await service.close(); service = undefined;
  await start();
  const beforeRetries = await value('/api/snapshot');
  assert.equal(beforeRetries.facts.find((fact) => fact.key === key)?.value, 'new incarnation');
  const retryUpsert = await value('/api/facts', original);
  const retryForget = await value('/api/facts/forget', forget);
  assert.equal(retryUpsert.receipt.status, 'duplicate'); assert.equal(retryForget.receipt.status, 'duplicate');
  assert.equal(retryForget.view.facts.find((fact) => fact.key === key)?.value, 'new incarnation');
  assert.equal((await value('/api/snapshot')).cursor, beforeRetries.cursor);
  assert.equal(retryForget.view.revision, recreated.view.revision);
  report.checks.push('real-service-restart-keeps-receipts-and-current-memory-without-new-events');
  report.status = 'durable-replay-passed'; exit = 0;
} catch (error) {
  let detail = error instanceof Error ? error.message : 'Non-error failure';
  for (const secret of [token].filter(Boolean))
    for (const value of [secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64'), JSON.stringify(secret).slice(1, -1)])
      detail = detail.split(value).join('[redacted]');
  report.status = 'durable-replay-failed'; report.failure = `${stage}: ${detail.slice(0, 1000)}`;
} finally {
  try { await gate?.close(); await service?.close(); }
  catch { report.status = 'cleanup-failed'; exit = 1; }
  console.log(JSON.stringify(report, null, 2)); process.exitCode = exit;
}
