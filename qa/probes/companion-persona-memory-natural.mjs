// Controlled Responses / actual service acceptance for A5 and current-turn non-self-stop.
// Do not run until parent freezes product/build and explicitly authorizes integration.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { register } from 'tsx/esm/api';
import { naturalCases } from '../fixtures/companion-persona-memory/natural-cases.mjs';

register();
const { createCompanionService } = await import('../../apps/companion-service/src/service.ts');
const { controlledClient, functionCall, assistantMessage } =
  await import('../fixtures/companion-service/controlled-client.mjs');
const report = { scope: 'controlled-natural-memory-only', status: 'running', checks: [],
  limit: 'Controlled Responses are not a live model. Work-result authority and the remaining A1–A8 cases require separate actual integration.' };
let activeService, controlled, activeToken;
let stage = 'preflight', exit = 1;
try {
  for (const scenario of naturalCases) {
    stage = scenario.id;
    const root = await mkdtemp(path.join(os.tmpdir(), 'companion-m3-natural-'));
    activeToken = randomUUID() + randomUUID();
    controlled = controlledClient();
    activeService = await createCompanionService({ dataDirectory: root, token: activeToken,
      mode: 'model', model: 'controlled-offline', client: controlled.client });
    const service = activeService;
    const headers = { Authorization: `Bearer ${activeToken}`, 'Content-Type': 'application/json' };
    const request = async (route, body) => {
      const response = await fetch(service.url + route, { headers, signal: AbortSignal.timeout(10000),
        ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
      const envelope = await response.json();
      assert.equal(envelope.ok, true, `service request failed: ${response.status}`);
      return envelope.value;
    };
    try {
      const before = await request('/api/memory');
      const admitted = await request('/api/messages', { commandId: randomUUID(), text: scenario.input });
      assert.ok(admitted.messageId);
      const first = await controlled.next(1);
      assert.match(JSON.stringify(first.request.input), new RegExp(admitted.messageId));
      const callId = `remember-${scenario.id}`;
      first.complete([functionCall('remember', callId, {
        inputId: admitted.messageId, key: scenario.candidate.key, value: scenario.candidate.value,
      })]);
      const second = await controlled.next(2);
      assert.equal(second.options.signal.aborted, false, 'current-turn memory must not stop its own Core');
      const toolOutput = second.request.input.find((item) => item.type === 'function_call_output' && item.call_id === callId);
      assert.ok(toolOutput, 'actual next Core inference must contain the tool result');
      second.complete([assistantMessage(`controlled ${scenario.id}`)]);
      const deadline = Date.now() + 15000;
      let memory, snapshot;
      do {
        [memory, snapshot] = await Promise.all([request('/api/memory'), request('/api/snapshot')]);
        if (snapshot.agent.status === 'ready' && snapshot.messages.some((message) =>
          message.role === 'assistant' && message.inputId === admitted.messageId)) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      } while (Date.now() < deadline);
      assert.equal(snapshot.agent.status, 'ready', 'foreground did not settle');
      const fact = memory.facts.find((item) => item.key === scenario.candidate.key);
      if (scenario.expected === 'admit') {
        assert.equal(fact?.value, scenario.candidate.value);
        assert.equal(fact.origin.kind, 'user-input');
        assert.equal(fact.origin.inputId, admitted.messageId);
        assert.equal(scenario.input.slice(fact.origin.evidence.start, fact.origin.evidence.end), scenario.candidate.value);
        assert.ok(memory.revision > before.revision);
      } else {
        assert.equal(fact, undefined);
        assert.equal(memory.revision, before.revision);
      }
      report.checks.push({ id: scenario.id, expected: scenario.expected,
        source: 'actual service + actual Core + controlled Responses' });
    } finally {
      controlled.close();
      await service.close();
      activeService = undefined; controlled = undefined; activeToken = undefined;
    }
  }
  report.status = 'controlled-natural-subset-passed'; exit = 0;
} catch (error) {
  let detail = error instanceof Error ? error.message : 'Non-error failure';
  for (const token of [activeToken].filter(Boolean))
    for (const value of [token, encodeURIComponent(token), Buffer.from(token).toString('base64'), JSON.stringify(token).slice(1, -1)])
      detail = detail.split(value).join('[redacted]');
  report.status = 'controlled-natural-subset-failed'; report.failure = `${stage}: ${detail.slice(0, 1000)}`;
} finally {
  if (activeService) {
    try { controlled?.close(); await activeService.close(); }
    catch { report.status = 'cleanup-failed'; exit = 1; }
  }
  console.log(JSON.stringify(report, null, 2)); process.exitCode = exit;
}
