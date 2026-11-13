/**
 * QQ 客户端协议层的真实异步回归。
 *
 * 起一个真的 127.0.0.1 HTTP 服务，用真的 fetch 走完整链路——
 * 不是拿 state 纯函数模拟。守两条会静默写错数据的：
 * 1. 投递列表项是 Pick 摘要，用完整行 guard 会把每一条都拒掉。
 * 2. 凭据提交必须用**草稿捕获的** target/CAS，不能在点击那一刻取最新值。
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import {
  getQQ,
  readQQDeliveries,
  readQQPrincipals,
  setQQSourceEnabled,
  writeQQCredential,
} from '../src/client/qq-protocol.ts';

const account = {
  protocol: 'official',
  sourcePluginId: 'pet.qq-official',
  instanceId: 'default',
  accountId: 'app-1',
};
const audience = { kind: 'qq-group', account, groupId: 'group-A' };
const route = {
  kind: 'qq',
  account,
  scene: 'group',
  targetId: 'group-A',
  reference: { eventId: 'event-1', messageId: 'message-1', occurredAt: 1, displayReference: null },
};

const deliverySummary = (id) => ({
  id,
  messageIds: ['m1'],
  audience,
  route,
  phase: 'terminal',
  outcome: 'accepted',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_001_000,
});

const qqView = () => ({
  version: 1,
  policy: {
    revision: 7,
    settings: {
      privateAllowlist: [],
      groupAllowlist: [],
      principalAliases: [],
      administratorPrincipalIds: [],
      knownMachineActors: [],
      groupDefaults: {
        contextMessages: 30,
        contextMaxAgeMs: 1_800_000,
        mentionEnabled: true,
        wakeWords: [],
        proactive: {
          enabled: false,
          mode: 'rule-probability',
          probability: 0.1,
          cooldownMs: 60_000,
          maxRepliesPerHour: 6,
        },
      },
      groups: [],
      voiceOutputEnabled: false,
      judge: {
        providerRef: 'pet.qq-participation-magpie/magpie',
        maxAttemptsPerHour: 30,
        perGroupIntervalMs: 60_000,
        timeoutMs: 10_000,
        maxOutputTokens: 256,
      },
    },
  },
  sources: [
    {
      protocol: 'official',
      sourcePluginId: 'pet.qq-official',
      instanceId: 'default',
      desiredEnabled: true,
      source: 'ready',
      configRevision: 4,
      appliedRevision: 4,
      settings: { protocol: 'official', appId: 'app-1', scenes: ['private', 'group'] },
      account,
      bindingId: 'binding-1',
      phase: 'ready',
      credential: { available: true, writable: true, version: 'v1', source: 'managed' },
      installedVersion: '1.0.0',
      media: { text: 'available', image: 'unverified', voice: 'unavailable', file: 'unverified' },
      cleanup: 'settled',
      error: null,
    },
  ],
  judge: {
    sourcePluginId: 'pet.qq-participation-magpie',
    configRevision: 1,
    appliedRevision: 1,
    settings: {
      providerRef: 'pet.qq-participation-magpie/magpie',
      maxAttemptsPerHour: 30,
      perGroupIntervalMs: 60_000,
      timeoutMs: 10_000,
      maxOutputTokens: 256,
      connection: { baseUrl: 'https://judge.invalid', model: 'magpie', authMode: 'gateway-key' },
    },
    bindingId: 'judge-binding',
    credential: { available: true, writable: true, version: 'v1', source: 'managed' },
    readiness: 'configured',
    active: 0,
    admittedAttempts: 0,
    inputTokens: null,
    outputTokens: null,
    error: null,
  },
  codec: {
    source: 'ready',
    imageId: `sha256:${'a'.repeat(64)}`,
    manifestSha256: 'b'.repeat(64),
    cleanup: 'settled',
    error: null,
  },
});

/** 真服务：记录请求体，按路径返回夹具。 */
async function serve(handlers) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length === 0 ? null : JSON.parse(Buffer.concat(chunks).toString('utf8'));
    requests.push({ method: request.method, url: request.url, body });
    const handler = handlers[request.url?.split('?')[0] ?? ''];
    if (!handler) {
      response.writeHead(404).end(JSON.stringify({ ok: false, error: { code: 'unavailable' } }));
      return;
    }
    const value = handler(body);
    response.writeHead(value.status ?? 200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(value.body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    transport: { baseUrl: `http://127.0.0.1:${port}`, token: 'fixture-token' },
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test('投递列表按摘要解析，不要求完整行', async () => {
  const service = await serve({
    '/api/qq/deliveries': () => ({
      body: {
        ok: true,
        value: { deliveries: [deliverySummary('d1'), deliverySummary('d2')], next: null },
      },
    }),
  });
  try {
    const result = await readQQDeliveries(service.transport);
    assert.equal(result.ok, true);
    assert.equal(result.value.deliveries.length, 2);
    assert.equal(result.value.deliveries[0].outcome, 'accepted');
    // 摘要里没有 parts/mode：能读到这两条，说明没有拿完整行去卡它们。
    assert.equal('parts' in result.value.deliveries[0], false);
  } finally {
    await service.close();
  }
});

test('摘要多一个字段就整页作废，不吞半条', async () => {
  const service = await serve({
    '/api/qq/deliveries': () => ({
      body: {
        ok: true,
        value: { deliveries: [{ ...deliverySummary('d1'), parts: [] }], next: null },
      },
    }),
  });
  try {
    const result = await readQQDeliveries(service.transport);
    assert.equal(result.ok, false);
  } finally {
    await service.close();
  }
});

test('凭据提交带的是调用方捕获的 revision 与版本，不是最新值', async () => {
  const service = await serve({
    '/api/qq/credential': () => ({ body: { ok: true, value: qqView() } }),
  });
  try {
    // 捕获时读到的是 rev 4 / v1；之后服务端可能已经变了，但这次提交必须用它自己的。
    const result = await writeQQCredential(service.transport, {
      protocol: 'official',
      expectedRevision: 4,
      expectedCredentialVersion: 'v1',
      value: 'secret-value',
    });
    assert.equal(result.ok, true);
    const sent = service.requests.find((item) => item.url === '/api/qq/credential');
    assert.deepEqual(sent.body, {
      protocol: 'official',
      expectedRevision: 4,
      expectedCredentialVersion: 'v1',
      value: 'secret-value',
    });
  } finally {
    await service.close();
  }
});

test('启用走插件命令路由并要求回执对应本次 commandId', async () => {
  const service = await serve({
    '/api/plugins/pet.qq-official': (body) => ({
      body: {
        ok: true,
        value: {
          commandId: body.commandId,
          status: 'accepted',
          messageId: null,
          taskId: null,
          revision: null,
        },
      },
    }),
  });
  try {
    const result = await setQQSourceEnabled(service.transport, 'pet.qq-official', 'cmd-1', true);
    assert.equal(result.ok, true);
    const sent = service.requests[0];
    assert.deepEqual(sent.body, { commandId: 'cmd-1', enabled: true });
  } finally {
    await service.close();
  }
});

test('回执 commandId 对不上时按结果未知处理，不宣称已启用', async () => {
  const service = await serve({
    '/api/plugins/pet.qq-official': () => ({
      body: {
        ok: true,
        value: {
          commandId: 'someone-else',
          status: 'accepted',
          messageId: null,
          taskId: null,
          revision: null,
        },
      },
    }),
  });
  try {
    const result = await setQQSourceEnabled(service.transport, 'pet.qq-official', 'cmd-1', true);
    assert.equal(result.ok, false);
  } finally {
    await service.close();
  }
});

test('坏掉的 QQView 不落到界面：整份作废', async () => {
  const broken = qqView();
  delete broken.codec.manifestSha256;
  const service = await serve({ '/api/qq': () => ({ body: { ok: true, value: broken } }) });
  try {
    const result = await getQQ(service.transport);
    assert.equal(result.ok, false);
  } finally {
    await service.close();
  }
});

test('principal 分页按契约 guard 逐条校验', async () => {
  const service = await serve({
    '/api/qq/principals': () => ({
      body: {
        ok: true,
        value: {
          principals: [{ id: 'person-1', kind: 'person', displayName: '小明' }],
          next: null,
        },
      },
    }),
  });
  try {
    const result = await readQQPrincipals(service.transport);
    assert.equal(result.ok, true);
    assert.equal(result.value.principals[0].displayName, '小明');
  } finally {
    await service.close();
  }
});
