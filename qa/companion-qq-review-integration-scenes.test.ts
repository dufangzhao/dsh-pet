import { strict as assert } from 'node:assert';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import WebSocket, { WebSocketServer } from '../apps/companion-service/node_modules/ws/wrapper.mjs';
import { QQ_OFFICIAL_PLUGIN_ID, type QQInputReceipt } from '../packages/contracts/src/index.js';
import { createCompanionService } from '../apps/companion-service/src/service.js';
import { mapOfficialInput } from '../apps/companion-service/src/qq-input.js';
import { decodeOfficialGatewayFrame } from '../plugins/qq-official/src/index.js';

test('private-only official source ignores group events but keeps the same socket and private path', { timeout: 20000 }, async () => {
  const qa = await realpath(new URL('.', import.meta.url));
  const root = await mkdtemp(path.join(qa, 'companion-qq-review-integration-data-'));
  const server = createServer();
  const ws = new WebSocketServer({ server });
  const reports: QQInputReceipt[] = [];
  let groupHttpCalls = 0;
  let resolveReceipt: (value: QQInputReceipt) => void = () => {};
  const receipt = new Promise<QQInputReceipt>((resolve) => { resolveReceipt = resolve; });
  ws.on('connection', (socket) => {
    setTimeout(() => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 60000 } })); }, 20);
    socket.on('message', (data) => { if ((JSON.parse(String(data)) as { op: number }).op === 2) socket.send(JSON.stringify({ op: 0, t: 'READY', s: 1, d: { session_id: 'review-session', user: { id: 'review-bot' } } })); });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  let service: Awaited<ReturnType<typeof createCompanionService>> | undefined;
  try {
    service = await createCompanionService({
      dataDirectory: root, token: 'review-scenes-synthetic-token-024a', hostname: '127.0.0.1', port: 0, mode: 'scripted',
      qqController: { officialTest: {
        fetch: async (url) => {
          if (String(url).includes('/v2/groups/')) groupHttpCalls++;
          return String(url).endsWith('/app/getAppAccessToken') ? Response.json({ access_token: 'review-synthetic-access', expires_in: 7200 }) : String(url).endsWith('/gateway') ? Response.json({ url: 'wss://gateway.qq.com/socket' }) : Response.json({ id: 'synthetic-response' });
        },
        websocket: () => new WebSocket(`ws://127.0.0.1:${address.port}`),
      } },
      onQQInputReceipt: (value) => { reports.push(value); if (value.state === 'accepted') resolveReceipt(value); },
    });
    let view = await service.qq.view();
    const source = view.sources.find((value) => value.protocol === 'official');
    if (!source) throw new Error('no official source');
    view = await service.qq.saveSource({ protocol: 'official', expectedRevision: source.configRevision, settings: { protocol: 'official', appId: 'review-app', scenes: ['private'] } });
    const account = { protocol: 'official' as const, sourcePluginId: QQ_OFFICIAL_PLUGIN_ID, instanceId: 'default' as const, accountId: 'review-app' };
    view = await service.qq.savePolicy({ expectedRevision: view.policy.revision, settings: { ...view.policy.settings, groupAllowlist: [{ account, groupId: 'opaque_group_fixture' }], privateAllowlist: [{ account, scene: 'private', senderId: 'review-private-user' }] } });
    const configured = view.sources.find((value) => value.protocol === 'official');
    if (!configured) throw new Error('no configured source');
    await service.qq.credential({ protocol: 'official', expectedRevision: configured.configRevision, expectedCredentialVersion: configured.credential.version, value: 'review-synthetic-secret' });
    const connection = once(ws, 'connection');
    await service.qq.setPlugin(QQ_OFFICIAL_PLUGIN_ID, true, 'review-enable-official');
    const [socket] = await connection;
    for (let n = 0; n < 100; n++) {
      if ((await service.qq.status()).sources.find((item) => item.protocol === 'official')?.phase === 'ready') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal((await service.qq.status()).sources.find((item) => item.protocol === 'official')?.phase, 'ready');
    const frame = JSON.parse(await readFile(new URL('./fixtures/companion-qq/protocol/official-group-at.json', import.meta.url), 'utf8'));
    frame.d.attachments = [];
    frame.d.msg_elements = [];
    frame.d.timestamp = new Date().toISOString();
    const decoded = decodeOfficialGatewayFrame(JSON.stringify(frame));
    if (!decoded.ok || decoded.value.kind !== 'message') throw new Error('bad group frame');
    const group = mapOfficialInput(account, decoded.value.event, 'review-bot');
    if (!group) throw new Error('bad group mapping');
    socket.send(JSON.stringify(frame));
    const quiet = structuredClone(frame);
    quiet.s = 43;
    quiet.t = 'GROUP_MESSAGE_CREATE';
    quiet.id = 'review-quiet-event';
    quiet.d.id = 'review-quiet-message';
    quiet.d.content = 'quiet group context';
    socket.send(JSON.stringify(quiet));
    socket.send(JSON.stringify({ op: 0, s: 44, t: 'C2C_MESSAGE_CREATE', id: 'review-private-event', d: { id: 'review-private-message', timestamp: new Date().toISOString(), content: 'approved private input', author: { id: 'review-private-user', user_openid: 'review-private-user', bot: false }, attachments: [] } }));
    const accepted = await Promise.race([receipt, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('private input not admitted')), 4000))]);
    assert.equal(accepted.state, 'accepted');
    assert.ok(accepted.inputId);
    const stored = await service.runtime.state('getInput', { id: accepted.inputId, scope: { kind: 'management' } });
    assert.equal(stored.origin.kind, 'qq');
    assert.equal(stored.origin.audience.kind, 'person-private');
    assert.equal(await service.runtime.state('findInput', { id: group.observationId, scope: { kind: 'management' } }), null);
    assert.equal(reports.some((item) => item.eventKey === group.eventKey), false);
    const observed = await service.runtime.state('observations', { scope: { kind: 'management' } });
    assert.equal(observed.observations.length, 0);
    assert.equal(socket.readyState, WebSocket.OPEN);
    assert.equal((await service.qq.status()).sources.find((item) => item.protocol === 'official')?.phase, 'ready');
    const captured = service.qq.sourceFor(account);
    if (captured.protocol !== 'official') throw new Error('wrong source');
    const prohibited = await captured.driver.send('group', 'opaque_group_fixture', { msg_type: 0, msg_seq: 1, content: 'must not send' }, captured.signal, captured.connectionId);
    if (prohibited.ok) throw new Error('outbound group unexpectedly admitted');
    assert.equal(prohibited.error.code, 'permission-denied');
    assert.equal(groupHttpCalls, 0);
  } finally {
    await service?.close();
    ws.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const target = await realpath(root);
    if (path.dirname(target) !== qa || !path.basename(target).startsWith('companion-qq-review-integration-data-')) throw new Error('wrong fixture path');
    await rm(target, { recursive: true });
  }
});
