// Real service restart + supported Harness changes against one fresh synthetic root.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { register } from 'tsx/esm/api';

register();
const { createCompanionService } = await import('../../apps/companion-service/src/service.ts');
const { controlledClient, assistantMessage } = await import('../fixtures/companion-service/controlled-client.mjs');
const report = { scope: 'actual-service-persona-memory-restart', status: 'running', checks: [],
  limit: 'Fresh synthetic root and controlled Responses; no original configuration or live model.' };
let service, peer, token;
let stage = 'preflight', exit = 1;
try {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'companion-m3-persist-'));
  async function start() {
    token = randomUUID() + randomUUID(); peer = controlledClient();
    // Do not pass name/persona overrides: persist only the user's saved Config values.
    service = await createCompanionService({ dataDirectory, token, mode: 'model',
      model: 'controlled-offline', client: peer.client });
  }
  async function request(route, body) {
    const response = await fetch(service.url + route, { headers: { Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000),
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
    const envelope = await response.json();
    assert.equal(envelope.ok, true, `service ${route} failed: ${response.status}`);
    return envelope.value;
  }
  async function waitReady() {
    const deadline = Date.now() + 15000;
    while ((await request('/api/snapshot')).agent.status !== 'ready') {
      assert.ok(Date.now() < deadline, 'foreground did not become ready');
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  }
  function contextOf(requestValue) {
    const marker = 'Previously committed product context (historical data; do not replay effects):\n';
    const texts = [];
    const collect = (value) => {
      if (typeof value === 'string') { if (value.startsWith(marker)) texts.push(value); return; }
      if (Array.isArray(value)) for (const item of value) collect(item);
      else if (value && typeof value === 'object') for (const item of Object.values(value)) collect(item);
    };
    collect(requestValue.input);
    assert.equal(texts.length, 1, 'exactly one current canonical context must be supplied');
    return JSON.parse(texts[0].slice(marker.length));
  }
  await start();
  stage = 'save-canonical-values';
  const initial = await request('/api/profile');
  assert.deepEqual(initial.management.launchOverrides, { name: false, persona: false });
  const initialSnapshot = await request('/api/snapshot');
  const name = 'M3 Persistent Companion';
  const persona = 'A saved synthetic persona that remains after the service restarts.';
  const saved = await request('/api/profile', { expectedProfileRevision: initial.revision, name, persona });
  assert.equal(saved.name, name); assert.equal(saved.persona, persona);
  assert.equal(saved.management.application.appliedRevision, saved.revision);
  const view = await request('/api/memory');
  const first = await request('/api/facts', { commandId: randomUUID(), expectedMemoryRevision: view.revision,
    expectedFactRevision: 0, key: 'long-preference', value: 'initial synthetic preference' });
  const row = first.view.facts.find((fact) => fact.key === 'long-preference');
  const long = `完整偏好:${'字'.repeat(1800)}`;
  const corrected = await request('/api/facts', { commandId: randomUUID(), expectedMemoryRevision: first.view.revision,
    expectedFactRevision: row.revision, key: row.key, value: long });
  assert.equal(corrected.view.facts.find((fact) => fact.key === row.key).value, long);
  assert.equal(peer.requests.length, 0, 'owner saves must not invoke a model');
  stage = 'supported-harness-replacement';
  const fixtureKey = 'pet.harness-fixture/fixture';
  const corticoKey = 'pet.harness-cortico/cortico';
  await request('/api/harness', { commandId: randomUUID(), harness: fixtureKey });
  assert.equal((await request('/api/snapshot')).agent.harness, fixtureKey);
  assert.equal((await request('/api/profile')).persona, persona);
  assert.equal((await request('/api/memory')).facts.find((fact) => fact.key === row.key).value, long);
  report.checks.push('profile-and-corrected-full-memory-survive-harness-replacement');
  stage = 'actual-service-restart-without-profile-overrides';
  peer.close(); await service.close(); service = undefined; peer = undefined;
  await start();
  const restored = await request('/api/profile');
  const restoredSnapshot = await request('/api/snapshot');
  const restoredMemory = await request('/api/memory');
  assert.equal(restored.agentId, initial.agentId); assert.equal(restoredSnapshot.epoch, initialSnapshot.epoch);
  assert.equal(restored.name, name); assert.equal(restored.persona, persona);
  assert.deepEqual(restored.management.launchOverrides, { name: false, persona: false });
  assert.equal(restoredSnapshot.agent.harness, fixtureKey);
  assert.equal(restoredMemory.facts.find((fact) => fact.key === row.key).value, long);
  await request('/api/harness', { commandId: randomUUID(), harness: corticoKey });
  assert.equal((await request('/api/snapshot')).agent.harness, corticoKey);
  assert.equal(peer.requests.length, 0);
  report.checks.push('actual-service-restart-preserves-persona-memory-identity-and-harness');
  stage = 'restored-native-full-value-context';
  await request('/api/messages', { commandId: randomUUID(), text: '检查当前上下文。' });
  const inference = await peer.next(1);
  assert.ok(JSON.stringify(inference.request).includes(persona));
  assert.equal(contextOf(inference.request).facts.find((fact) => fact.key === row.key)?.value, long);
  inference.complete([assistantMessage('上下文已检查。')]);
  await waitReady();
  const active = await request('/api/memory');
  const activeRow = active.facts.find((fact) => fact.key === row.key);
  const forgotten = await request('/api/facts/forget', { commandId: randomUUID(),
    expectedMemoryRevision: active.revision, expectedFactRevision: activeRow.revision, key: row.key });
  assert.equal(forgotten.receipt.status, 'accepted');
  assert.equal(forgotten.view.facts.some((fact) => fact.key === row.key), false);
  await request('/api/messages', { commandId: randomUUID(), text: '再次检查当前上下文。' });
  const later = await peer.next(2);
  assert.equal(contextOf(later.request).facts.some((fact) => fact.key === row.key), false);
  later.complete([assistantMessage('当前记忆已检查。')]);
  await waitReady();
  report.checks.push('native-active-context-preserves-full-value-and-removes-forgotten-fact');
  report.status = 'restart-persistence-passed'; exit = 0;
} catch (error) {
  let detail = error instanceof Error ? error.message : 'Non-error failure';
  for (const secret of [token].filter(Boolean))
    for (const value of [secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64'), JSON.stringify(secret).slice(1, -1)])
      detail = detail.split(value).join('[redacted]');
  report.status = 'restart-persistence-failed'; report.failure = `${stage}: ${detail.slice(0, 1000)}`;
} finally {
  try { peer?.close(); await service?.close(); }
  catch { report.status = 'cleanup-failed'; exit = 1; }
  console.log(JSON.stringify(report, null, 2)); process.exitCode = exit;
}
