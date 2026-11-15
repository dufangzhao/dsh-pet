import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { register } from 'tsx/esm/api';
register();
const { createCompanionService } = await import('../../apps/companion-service/src/service.ts');

async function fixture(options = {}) {
  const dataDirectory = options.dataDirectory ?? await mkdtemp(path.join(os.tmpdir(), 'companion-http-test-'));
  const token = options.token ?? randomUUID() + randomUUID();
  const service = await createCompanionService({ dataDirectory, token, ...options });
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const get = async (route) => {
    const response = await fetch(service.url + route, { headers });
    return { status: response.status, body: await response.json() };
  };
  const post = async (route, value) => {
    const response = await fetch(service.url + route, { method: 'POST', headers, body: JSON.stringify(value) });
    return { status: response.status, body: await response.json() };
  };
  return { service, token, headers, dataDirectory, get, post };
}

async function until(read, predicate, timeout = 10000) {
  const deadline = Date.now() + timeout;
  let last;
  do {
    last = await read();
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 15));
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for service state: ${JSON.stringify(last)}`);
}

test('independent service authenticates, admits real Core text and deduplicates commands', async () => {
  const f = await fixture();
  try {
    assert.equal((await fetch(f.service.url + '/api/snapshot')).status, 401);
    assert.equal((await fetch(f.service.url + '/api/snapshot', {
      headers: { ...f.headers, Origin: 'https://unrelated.invalid' },
    })).status, 403);
    const first = await f.get('/api/snapshot');
    assert.equal(first.status, 200);
    assert.equal(first.body.value.agent.status, 'ready');
    const command = { commandId: randomUUID(), text: '你好，文字服务' };
    assert.equal((await f.post('/api/messages', command)).body.value.status, 'accepted');
    assert.equal((await f.post('/api/messages', command)).body.value.status, 'duplicate');
    assert.equal((await f.post('/api/messages', { ...command, text: 'changed' })).status, 409);
    const answered = await until(() => f.get('/api/snapshot'), (value) =>
      value.body.ok && value.body.value.messages.some((message) => message.role === 'assistant'));
    assert.equal(answered.body.value.messages.filter((message) => message.role === 'user').length, 1);
    assert.match(answered.body.value.messages.find((message) => message.role === 'assistant').text, /脚本/);
    const html = await fetch(f.service.url).then((response) => response.text());
    assert.match(html, /client\.js/);
    assert(!html.includes(f.token));
  } finally { await f.service.close(); }
});

test('committed SSE events reconnect by cursor and stale epochs are rejected', async () => {
  const f = await fixture();
  const controller = new AbortController();
  try {
    const snapshot = (await f.get('/api/snapshot')).body.value;
    const denied = await fetch(`${f.service.url}/api/events?after=0&epoch=wrong`, { headers: f.headers });
    assert.equal(denied.status, 409);
    const response = await fetch(`${f.service.url}/api/events?after=${snapshot.cursor}&epoch=${snapshot.epoch}`, {
      headers: f.headers, signal: controller.signal,
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    const reader = response.body.getReader();
    const observing = (async () => {
      let text = '';
      while (!text.includes('event: companion')) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error('Event stream ended before a committed event');
        text += new TextDecoder().decode(chunk.value);
      }
      return text;
    })();
    const memoryRead = await f.get('/api/memory');
    assert.equal(memoryRead.status, 200);
    assert.equal(memoryRead.body.ok, true);
    const memory = memoryRead.body.value;
    assert.ok(Number.isSafeInteger(memory.revision));
    assert.equal(memory.facts.find((fact) => fact.key === 'drink'), undefined);
    const remembered = await f.post('/api/facts', {
      commandId: randomUUID(), expectedMemoryRevision: memory.revision, expectedFactRevision: 0,
      key: 'drink', value: 'tea',
    });
    assert.equal(remembered.body.ok, true);
    assert.equal(remembered.body.value.receipt.status, 'accepted');
    const frames = await observing;
    assert.match(frames, /event: companion/);
    assert(!frames.includes(f.token));
    const after = (await f.get('/api/snapshot')).body.value;
    assert(after.cursor > snapshot.cursor);
    assert.equal(after.facts.find((fact) => fact.key === 'drink').value, 'tea');
  } finally { controller.abort(); await f.service.close(); }
});

test('state survives restart and an actual alternative harness without a Session picker', async () => {
  const f = await fixture();
  const first = (await f.get('/api/snapshot')).body.value;
  try {
    const memoryRead = await f.get('/api/memory');
    assert.equal(memoryRead.status, 200);
    assert.equal(memoryRead.body.ok, true);
    const memory = memoryRead.body.value;
    assert.ok(Number.isSafeInteger(memory.revision));
    assert.equal(memory.facts.find((fact) => fact.key === 'preference'), undefined);
    const remembered = await f.post('/api/facts', {
      commandId: randomUUID(), expectedMemoryRevision: memory.revision, expectedFactRevision: 0,
      key: 'preference', value: 'clear explanations',
    });
    assert.equal(remembered.body.ok, true);
    assert.equal(remembered.body.value.receipt.status, 'accepted');
    const selected = await f.post('/api/harness', { commandId: randomUUID(), harness: 'pet.harness-fixture/fixture' });
    assert.equal(selected.body.ok, true);
    const replied = await f.post('/api/messages', { commandId: randomUUID(), text: '记得我的偏好吗' });
    assert.equal(replied.body.ok, true);
    const next = (await f.get('/api/snapshot')).body.value;
    assert.equal(next.agent.id, first.agent.id);
    assert.equal(next.agent.harness, 'pet.harness-fixture/fixture');
    assert(next.messages.some((message) => message.text.includes('clear explanations')));
  } finally { await f.service.close(); }
  const restarted = await fixture({ dataDirectory: f.dataDirectory });
  try {
    const snapshot = (await restarted.get('/api/snapshot')).body.value;
    assert.equal(snapshot.agent.id, first.agent.id);
    assert.equal(snapshot.agent.harness, 'pet.harness-fixture/fixture');
    assert.equal(snapshot.facts.find((fact) => fact.key === 'preference').value, 'clear explanations');
  } finally { await restarted.service.close(); }
});

test('withdrawing the text view preserves the Agent and task control data', async () => {
  const f = await fixture();
  try {
    const initial = (await f.get('/api/snapshot')).body.value;
    assert.equal((await f.post('/api/plugins/pet.text-client', { commandId: randomUUID(), enabled: false })).body.ok, true);
    assert.equal((await fetch(f.service.url)).status, 404);
    const after = (await f.get('/api/snapshot')).body.value;
    assert.equal(after.agent.id, initial.agent.id);
    assert(after.plugins.some((plugin) => plugin.id === 'pet.text-client' && !plugin.desiredActive));
    assert.equal((await f.post('/api/plugins/pet.text-client', { commandId: randomUUID(), enabled: true })).body.ok, true);
    assert.equal((await fetch(f.service.url)).status, 200);
  } finally { await f.service.close(); }
});

test('cloud work continues across text activity and reconnect, with exact target cancellation', {
  skip: !process.env.PET_CLOUD_EXEC_IMAGE,
  timeout: 60000,
}, async () => {
  const f = await fixture({ image: process.env.PET_CLOUD_EXEC_IMAGE });
  try {
    const code = "import {writeFileSync} from 'node:fs'; await new Promise(r=>setTimeout(r,1500)); writeFileSync('answer.txt','42\\n');";
    const start = await f.post('/api/tasks', { commandId: randomUUID(), title: '保留云端结果', code,
      outputs: [{ path: 'answer.txt', mediaType: 'text/plain' }] });
    assert.equal(start.body.ok, true);
    const taskId = start.body.value.taskId;
    const long = await f.post('/api/tasks', { commandId: randomUUID(), title: '可停止工作',
      code: 'setInterval(()=>{},1000)', timeoutMs: 10000 });
    assert.equal(long.body.ok, true);
    const reply = await f.post('/api/messages', { commandId: randomUUID(), text: '现在可以继续交流吗' });
    assert.equal(reply.body.ok, true);
    const stop = await f.post(`/api/tasks/${long.body.value.taskId}/stop`, { commandId: randomUUID() });
    assert.equal(stop.body.ok, true);
    const finished = await until(() => f.get(`/api/tasks/${taskId}`), (value) =>
      value.body.ok && ['completed', 'failed', 'unknown'].includes(value.body.value.status), 20000);
    assert.equal(finished.body.value.status, 'completed', JSON.stringify(finished.body));
    const cancelled = await until(() => f.get(`/api/tasks/${long.body.value.taskId}`), (value) =>
      value.body.ok && ['cancelled', 'completed', 'failed', 'unknown'].includes(value.body.value.status), 20000);
    assert.equal(cancelled.body.value.status, 'cancelled');
    assert.equal(finished.body.value.artifacts.length, 1);
    const artifact = finished.body.value.artifacts[0];
    assert.equal((await fetch(f.service.url + `/api/artifacts/${artifact.id}`)).status, 401);
    const content = await fetch(f.service.url + `/api/artifacts/${artifact.id}`, { headers: f.headers }).then((r) => r.text());
    assert.equal(content, '42\n');
    const snapshot = (await f.get('/api/snapshot')).body.value;
    assert.equal(snapshot.tasks.filter((task) => task.id === taskId).length, 1);
    const bytes = await readFile(path.join(f.dataDirectory, 'state', 'state.sqlite'));
    assert(!bytes.includes(Buffer.from(f.token)));
  } finally { await f.service.close(); }
});
