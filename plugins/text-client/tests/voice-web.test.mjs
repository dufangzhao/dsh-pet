import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { CompanionClient } from '../src/client/client.ts';
import { createWebVoiceTransport } from '../src/client/voice-web.ts';
import { snapshot } from './fixtures.mjs';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const response = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const stream = () =>
  new Response(new ReadableStream({ start() {} }), {
    headers: { 'Content-Type': 'text/event-stream' },
  });

/** 票据身份由服务端补：夹具用连接真正拿到的那一份 clientId/agentId。 */
let identity = { clientId: 'client-1', agentId: 'agent-1' };
const ticket = () => ({
  version: 1,
  captureId: 'capture-1',
  clientId: identity.clientId,
  agentId: identity.agentId,
  serviceEpoch: 'service-1',
  bindingId: 'binding-1',
  finishMode: 'send',
  encoding: 'f32le',
  sampleRate: 16000,
  channels: 1,
  chunkSamples: 1600,
  maxSamples: 320000,
  expiresAt: Date.now() + 120000,
});
const final = () => ({
  ticket: ticket(),
  phase: 'final',
  samples: 2,
  cleanup: 'settled',
  outcome: { kind: 'final', text: 'hello' },
  error: null,
  completedAt: Date.now(),
});

/** 记录真实 HTTP 形状：语音的音频必须是独立的二进制请求体，不进 JSON。 */
function setup(handler) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    if (url.startsWith('/api/events')) return stream();
    if (url === '/api/snapshot') return response({ ok: true, value: snapshot() });
    calls.push({ url, init });
    return handler(url, init);
  };
  return calls;
}

async function connected() {
  const client = new CompanionClient();
  await client.connect('token');
  const target = client.getVoiceTarget();
  assert.ok(target);
  identity = target;
  return { client, target, transport: createWebVoiceTransport(client, target) };
}

test('begin 只补真实身份：选择来自渲染时读到的那一份', async () => {
  const calls = setup(async () => response({ ok: true, value: ticket() }));
  const { client, transport } = await connected();
  const result = await transport.begin({
    captureId: 'capture-1',
    expectedFeatureRevision: 7,
    providerRef: 'pet.asr-magpie/magpie',
    bindingId: 'binding-1',
    finishMode: 'send',
  });
  assert.equal(result.ok, true);
  const body = JSON.parse(calls.at(-1).init.body);
  assert.deepEqual(body, {
    captureId: 'capture-1',
    clientId: identity.clientId,
    agentId: 'agent-1',
    expectedFeatureRevision: 7,
    providerRef: 'pet.asr-magpie/magpie',
    bindingId: 'binding-1',
    finishMode: 'send',
  });
  client.dispose();
});

test('finish 只上传一次整段 f32le；recover 读同一个票据且不再上传', async () => {
  const calls = setup(async (url) => {
    if (url.endsWith('/audio')) return response({ ok: true, value: final() });
    if (url.startsWith('/api/voice/captures/capture-1?'))
      return response({ ok: true, value: final() });
    return response({ ok: true, value: ticket() });
  });
  const { client, transport } = await connected();
  const began = await transport.begin({
    captureId: 'capture-1',
    expectedFeatureRevision: 1,
    providerRef: 'pet.asr-magpie/magpie',
    bindingId: 'binding-1',
    finishMode: 'send',
  });
  assert.equal(began.ok, true, JSON.stringify(began));
  const t = began.value;

  // 两帧 2 个采样点，字节数与 samples*4 一致。
  await transport.push(t, new Uint8Array(4));
  await transport.push(t, new Uint8Array(4));
  const uploaded = await transport.finish(t, { frames: 2, samples: 2 });
  assert.equal(uploaded.ok, true);
  const audio = calls.filter((call) => call.url.endsWith('/audio'));
  assert.equal(audio.length, 1);
  assert.equal(audio[0].init.headers['X-Pet-Voice-Samples'], '2');
  assert.equal(audio[0].init.body.byteLength, 8);

  // 恢复：GET 同一个 capture，带完整 owner，没有任何新的音频请求体。
  const recovered = await transport.recover(t);
  assert.equal(recovered.ok, true);
  const status = calls.filter((call) => call.url.startsWith('/api/voice/captures/capture-1?'));
  assert.equal(status.length, 1);
  assert.match(status[0].url, new RegExp(`clientId=${identity.clientId}`));
  assert.match(status[0].url, /agentId=agent-1/);
  assert.match(status[0].url, /serviceEpoch=service-1/);
  assert.equal(calls.filter((call) => call.url.endsWith('/audio')).length, 1);
  client.dispose();
});

test('取消清掉本地片段，之后 finish 上传的是空 buffer 而不是旧音频', async () => {
  const calls = setup(async (url) => {
    if (url.endsWith('/cancel'))
      return response({ ok: true, value: { ...final(), phase: 'cancelled' } });
    if (url.endsWith('/audio')) return response({ ok: true, value: { ...final(), samples: 0 } });
    return response({ ok: true, value: ticket() });
  });
  const { client, transport } = await connected();
  const began = await transport.begin({
    captureId: 'capture-1',
    expectedFeatureRevision: 1,
    providerRef: 'pet.asr-magpie/magpie',
    bindingId: 'binding-1',
    finishMode: 'send',
  });
  assert.equal(began.ok, true, JSON.stringify(began));
  const t = began.value;
  await transport.push(t, new Uint8Array(4));
  await transport.cancel(t);
  assert.equal(calls.at(-1).url, '/api/voice/captures/capture-1/cancel');
  const uploaded = await transport.finish(t, { frames: 0, samples: 0 });
  assert.equal(uploaded.ok, true);
  assert.equal(calls.filter((call) => call.url.endsWith('/audio')).at(-1).init.body.byteLength, 0);
  client.dispose();
});

test('web 没有第二个释放确认方：released 立即成功，不产生 HTTP', async () => {
  const calls = setup(async () => response({ ok: true, value: ticket() }));
  const { client, transport } = await connected();
  const before = calls.length;
  const released = await transport.released(ticket());
  assert.equal(released.ok, true);
  assert.equal(calls.length, before);
  client.dispose();
});

test('超预算的帧不进入本地片段：quota-exceeded，不上传', async () => {
  const calls = setup(async () => response({ ok: true, value: ticket() }));
  const { client, transport } = await connected();
  const t = ticket();
  const tooBig = new Uint8Array(1_280_004);
  const pushed = await transport.push(t, tooBig);
  assert.equal(pushed.ok, false);
  assert.equal(pushed.error.code, 'quota-exceeded');
  assert.equal(calls.length, 0);
  client.dispose();
});
