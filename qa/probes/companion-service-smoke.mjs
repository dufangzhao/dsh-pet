import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCompanionService } from '../../apps/companion-service/src/service.ts';

const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'companion-service-smoke-'));
const token = randomUUID() + randomUUID();
const service = await createCompanionService({ dataDirectory, token,
  ...(process.env.PET_CLOUD_EXEC_IMAGE ? { image: process.env.PET_CLOUD_EXEC_IMAGE } : {}),
});
try {
  const denied = await fetch(service.url + '/api/snapshot');
  assert.equal(denied.status, 401);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const initial = await fetch(service.url + '/api/snapshot', { headers }).then((r) => r.json());
  assert.equal(initial.ok, true);
  assert.equal(initial.value.agent.status, 'ready');
  const received = await fetch(service.url + '/api/messages', {
    method: 'POST', headers, body: JSON.stringify({ commandId: randomUUID(), text: '你好' }),
  }).then((r) => r.json());
  assert.equal(received.ok, true);
  const deadline = Date.now() + 10000;
  let snapshot = initial;
  while (!snapshot.value.messages.some((message) => message.role === 'assistant') && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    snapshot = await fetch(service.url + '/api/snapshot', { headers }).then((r) => r.json());
    assert.equal(snapshot.ok, true);
  }
  assert(snapshot.value.messages.some((message) => message.role === 'assistant'));
  console.log(JSON.stringify({ status: 'passed', agentId: snapshot.value.agent.id,
    messages: snapshot.value.messages.length, dataDirectory }));
} finally {
  await service.close();
}
