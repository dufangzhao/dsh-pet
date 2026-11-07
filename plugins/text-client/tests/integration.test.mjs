import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

import { CompanionClient } from '../src/client/client.ts';

const PORT = 4329;
const TOKEN = 'fixture-token';
const ORIGIN = `http://127.0.0.1:${PORT}`;
let server;

before(async () => {
  server = spawn(
    process.execPath,
    [fileURLToPath(new URL('./fixture-server.mjs', import.meta.url)), String(PORT)],
    {
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (chunk) => {
      if (String(chunk).includes('fixture server')) resolve();
    });
    server.on('error', reject);
  });
});

after(() => {
  server?.kill();
});

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, message) {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return;
    await tick(20);
  }
  throw new Error(message);
}

/**
 * 真实 HTTP + SSE 往返，但数据来自夹具服务：验证协议接线与状态语义，
 * 不证明真实模型、真实执行或云端部署。
 */
test('a full fixture round trip: connect, send, stop, artifact', async () => {
  const client = new CompanionClient({ baseUrl: ORIGIN, refreshDelayMs: 10 });
  await client.connect(TOKEN);
  await waitFor(() => client.getState().phase === 'live', 'never reached live');

  const first = client.getState().snapshot;
  assert.equal(first.agent.mode, 'scripted');
  assert.equal(first.messages.length, 2);

  // 发送：服务端确认后由事件触发一次快照刷新，本地待确认行随之消失。
  await client.submit('夹具里的一条新消息');
  await waitFor(
    () =>
      client.getState().snapshot.messages.some((message) => message.text === '夹具里的一条新消息'),
    'message never appeared in the snapshot',
  );
  assert.equal(client.getState().outbox.length, 0);

  // 停止：先显示请求，随后真实终态到达。
  const running = client.getState().snapshot.tasks.find((task) => task.id === 'task-1');
  assert.equal(running.status, 'running');
  await client.requestStop('task-1');
  assert.equal(client.getState().stops['task-1'].uncertain, false);
  await waitFor(
    () =>
      client.getState().snapshot.tasks.find((task) => task.id === 'task-1').status === 'cancelled',
    'task never reached the terminal state',
  );
  assert.deepEqual(client.getState().stops, {});

  client.dispose();
});

test('an unauthorized token is rejected and never reaches live', async () => {
  const client = new CompanionClient({ baseUrl: ORIGIN, refreshDelayMs: 10 });
  await client.connect('not-the-token');
  const state = client.getState();
  assert.equal(state.phase, 'offline');
  assert.equal(state.error?.code, 'auth-failed');
  assert.equal(state.snapshot, null);
  client.dispose();
});

test('reconnecting reconciles to the current snapshot instead of replaying', async () => {
  const client = new CompanionClient({ baseUrl: ORIGIN, refreshDelayMs: 10 });
  await client.connect(TOKEN);
  await waitFor(() => client.getState().phase === 'live', 'never reached live');

  client.disconnect();
  assert.equal(client.getState().phase, 'idle');
  assert.equal(client.getState().snapshot, null);

  await client.reconnect();
  await waitFor(() => client.getState().phase === 'live', 'never reconnected');
  assert.ok(client.getState().snapshot !== null);
  client.dispose();
});
