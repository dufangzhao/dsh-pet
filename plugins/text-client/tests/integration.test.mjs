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

/**
 * 模型设置的完整往返：保存 → 应用 → 显式测试 → 终态。
 * 夹具会先返回 validating，再在 120ms 后结算，用来证明「受理 ≠ 完成」。
 */
test('a model save and an explicit test settle through the real HTTP contract', async () => {
  const client = new CompanionClient({ baseUrl: ORIGIN, refreshDelayMs: 10 });
  await client.connect(TOKEN);
  await waitFor(() => client.getState().phase === 'live', 'never reached live');

  const initial = client.getState().snapshot.model;
  assert.equal(initial.check.state, 'unconfigured');
  assert.equal(initial.connectors.length, 2);
  assert.equal(initial.connectors[0].label, 'Magpie');
  assert.equal(initial.connectors[1].synthetic, true);

  const saved = await client.saveModel({
    commandId: 'cmd-save',
    expectedProfileRevision: initial.profileRevision,
    connectorId: 'pet.model-connection-magpie/magpie',
    expectedConfigRevision: 1,
    mode: 'model',
    config: {
      baseUrl: 'http://127.0.0.1:3425/v1',
      model: 'fixture-model',
      authMode: 'local-client-id',
    },
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.value.applied.connectorId, 'pet.model-connection-magpie/magpie');
  assert.equal(saved.value.enabled, true);
  assert.equal(saved.value.check.state, 'configured');
  // 保存本身不发推理：结果里没有任何 check 结论。
  assert.equal(saved.value.check.checkedAt, null);

  const admitted = await client.testModel({
    commandId: 'cmd-test',
    connectorId: saved.value.applied.connectorId,
    expectedConfigRevision: saved.value.applied.configRevision,
    expectedCredentialVersion: saved.value.applied.credentialVersion,
  });
  assert.equal(admitted.ok, true);
  assert.equal(admitted.value.check.state, 'validating');

  await waitFor(
    () => client.getState().snapshot.model.check.state === 'verified',
    'the check never settled',
  );
  const settled = client.getState().snapshot.model.check;
  assert.equal(settled.evidence, 'network');
  assert.notEqual(settled.checkedAt, null);

  client.dispose();
});

test('a changed config revision is a conflict, not a silent overwrite', async () => {
  const client = new CompanionClient({ baseUrl: ORIGIN, refreshDelayMs: 10 });
  await client.connect(TOKEN);
  await waitFor(() => client.getState().phase === 'live', 'never reached live');

  const result = await client.saveModel({
    commandId: 'cmd-stale',
    expectedProfileRevision: 1,
    connectorId: 'pet.model-connection-magpie/magpie',
    expectedConfigRevision: 99,
    mode: 'model',
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'conflict');
  client.dispose();
});

test('a test with a stale credential version is refused instead of run', async () => {
  const client = new CompanionClient({ baseUrl: ORIGIN, refreshDelayMs: 10 });
  await client.connect(TOKEN);
  await waitFor(() => client.getState().phase === 'live', 'never reached live');

  // 夹具服务跨用例共享状态，这里自己先建立一份确定的应用绑定。
  const view = client.getState().snapshot.model;
  const connector = view.connectors[0];
  const saved = await client.saveModel({
    commandId: 'cmd-save-for-stale',
    expectedProfileRevision: view.profileRevision,
    connectorId: connector.id,
    expectedConfigRevision: connector.configRevision,
    mode: 'model',
    config: { ...connector.settings, model: 'fixture-model' },
  });
  assert.equal(saved.ok, true);
  const applied = saved.value.applied;
  assert.notEqual(applied, null);
  const result = await client.testModel({
    commandId: 'cmd-test-stale',
    connectorId: applied.connectorId,
    expectedConfigRevision: applied.configRevision,
    expectedCredentialVersion: `${applied.credentialVersion}-stale`,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'conflict');
  client.dispose();
});

test('the synthetic connector labels its verified check as simulated', async () => {
  const client = new CompanionClient({ baseUrl: ORIGIN, refreshDelayMs: 10 });
  await client.connect(TOKEN);
  await waitFor(() => client.getState().phase === 'live', 'never reached live');

  const view = client.getState().snapshot.model;
  const fixture = view.connectors.find((item) => item.synthetic);
  assert.notEqual(fixture, undefined);
  const saved = await client.saveModel({
    commandId: 'cmd-save-fixture',
    expectedProfileRevision: view.profileRevision,
    connectorId: fixture.id,
    expectedConfigRevision: fixture.configRevision,
    mode: 'model',
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.value.applied.connectorId, fixture.id);

  const admitted = await client.testModel({
    commandId: 'cmd-test-fixture',
    connectorId: saved.value.applied.connectorId,
    expectedConfigRevision: saved.value.applied.configRevision,
    expectedCredentialVersion: saved.value.applied.credentialVersion,
  });
  assert.equal(admitted.ok, true);
  assert.equal(admitted.value.check.evidence, 'synthetic');

  await waitFor(
    () => client.getState().snapshot.model.check.state === 'verified',
    'the synthetic check never settled',
  );
  assert.equal(client.getState().snapshot.model.check.evidence, 'synthetic');
  client.dispose();
});

/**
 * 迟到响应的跨层回归：命令响应没有顺序信息，只有快照读取是权威。
 *
 * 这里让服务端把 A 的保存响应压住，同时让 A 的变更先被快照读到；然后发 B
 * 并让 B 的快照落地；最后才放行 A 的旧响应。全局视图必须仍是 B。
 */
test('a late save response never rolls the snapshot back to an older binding', async () => {
  const client = new CompanionClient({ baseUrl: ORIGIN, refreshDelayMs: 5 });
  await client.connect(TOKEN);
  await waitFor(() => client.getState().phase === 'live', 'never reached live');

  const before = client.getState().snapshot.model;
  const magpie = before.connectors.find((item) => !item.synthetic);
  assert.notEqual(magpie, undefined);

  // A：保存到 Magpie，但响应被压住 600ms。
  await fetch(`${ORIGIN}/__fixture/hold-save`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ms: 600 }),
  });
  const saveA = client.saveModel({
    commandId: 'cmd-late-a',
    expectedProfileRevision: before.profileRevision,
    connectorId: magpie.id,
    expectedConfigRevision: magpie.configRevision,
    mode: 'model',
  });

  // A 的变更先被权威快照读到。
  await waitFor(
    () => client.getState().snapshot.model.applied?.connectorId === magpie.id,
    'A was never observed by the snapshot',
  );

  // B：立刻再存一次，切到模拟连接，并等 B 的快照落地。
  await fetch(`${ORIGIN}/__fixture/hold-save`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ms: 0 }),
  });
  const current = client.getState().snapshot.model;
  const fixture = current.connectors.find((item) => item.synthetic);
  assert.notEqual(fixture, undefined);
  const saveB = await client.saveModel({
    commandId: 'cmd-late-b',
    expectedProfileRevision: current.profileRevision,
    connectorId: fixture.id,
    expectedConfigRevision: fixture.configRevision,
    mode: 'model',
  });
  assert.equal(saveB.ok, true);
  await waitFor(
    () => client.getState().snapshot.model.applied?.connectorId === fixture.id,
    'B was never observed by the snapshot',
  );

  // 现在才放行 A 的旧响应。
  const lateA = await saveA;
  assert.equal(lateA.ok, true);

  // 给迟到响应足够时间落地：如果它会写全局，这里就会被回退。
  await tick(120);
  assert.equal(client.getState().snapshot.model.applied.connectorId, fixture.id);
  client.dispose();
});

test('a late credential response does not overwrite a newer check result', async () => {
  const client = new CompanionClient({ baseUrl: ORIGIN, refreshDelayMs: 5 });
  await client.connect(TOKEN);
  await waitFor(() => client.getState().phase === 'live', 'never reached live');

  const view = client.getState().snapshot.model;
  const magpie = view.connectors.find((item) => !item.synthetic);
  const saved = await client.saveModel({
    commandId: 'cmd-cred-setup',
    expectedProfileRevision: view.profileRevision,
    connectorId: magpie.id,
    expectedConfigRevision: magpie.configRevision,
    mode: 'model',
  });
  assert.equal(saved.ok, true);
  // 夹具状态在用例之间共享：等的是**这一次**绑到 Magpie，而不是任意绑定。
  await waitFor(
    () => client.getState().snapshot.model.applied?.connectorId === magpie.id,
    'the Magpie binding never appeared',
  );

  const applied = client.getState().snapshot.model.applied;
  const target = client
    .getState()
    .snapshot.model.connectors.find((item) => item.id === applied.connectorId);

  // 密钥写入被压住，期间测试已经结算。
  await fetch(`${ORIGIN}/__fixture/hold-credential`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ms: 600 }),
  });
  const lateCredential = client.writeModelCredential({
    connectorId: target.id,
    expectedConfigRevision: target.configRevision,
    expectedCredentialVersion: target.credential.version,
    apiKey: 'sk-late',
  });
  const admitted = await client.testModel({
    commandId: 'cmd-cred-test',
    connectorId: applied.connectorId,
    expectedConfigRevision: applied.configRevision,
    expectedCredentialVersion: applied.credentialVersion,
  });
  assert.equal(admitted.ok, true);
  await waitFor(
    () => client.getState().snapshot.model.check.state === 'verified',
    'the check never settled',
  );

  await fetch(`${ORIGIN}/__fixture/hold-credential`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ms: 0 }),
  });
  const credential = await lateCredential;
  assert.equal(credential.ok, true);
  await tick(120);
  // 旧凭据响应不能把已经结算的 check 抹回 validating/旧版本。
  assert.equal(client.getState().snapshot.model.check.state, 'verified');
  client.dispose();
});
