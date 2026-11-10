import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { CompanionClient } from '../src/client/client.ts';
import { snapshot } from './fixtures.mjs';
import {
  parseVoiceCaptureResult,
  parseVoiceCatalog,
  parseVoiceTicket,
  parseVoiceView,
} from '../src/client/voice-guards.ts';
import {
  beginVoiceCapture,
  createUnavailableDesktopVoiceBridge,
  getVoiceCatalog,
  unavailableVoiceView,
  uploadVoiceCapture,
} from '../src/client/voice-protocol.ts';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const response = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const failure = (code) => ({
  ok: false,
  error: { code, messageKey: `errors.${code}`, retryable: false },
});
const ticket = () => ({
  version: 1,
  captureId: 'capture-1',
  clientId: 'client-1',
  agentId: 'agent-1',
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
function stream() {
  return new Response(new ReadableStream({ start() {} }), {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}
function setup(messages) {
  globalThis.fetch = async (url, init) => {
    if (url.startsWith('/api/events')) return stream();
    if (url === '/api/snapshot') return response({ ok: true, value: snapshot() });
    return messages(url, init);
  };
}

test('voice guards preserve truthful unavailable state and reject typed/format contradictions', async () => {
  assert.equal(parseVoiceView(unavailableVoiceView())?.feature.source, 'unavailable');
  assert.equal(
    (await createUnavailableDesktopVoiceBridge().begin({ connectionId: 'x', captureId: 'c' })).ok,
    false,
  );
  assert.equal(parseVoiceTicket({ ...ticket(), sampleRate: 48000 }), null);
  assert.equal(
    parseVoiceCatalog({
      providerRef: 'pet.asr-magpie/magpie',
      bindingId: 'b',
      candidates: [
        {
          modelRef: 'vendor/mimo-asr',
          label: 'voice',
          role: 'tts',
          classification: 'known-name',
          protocol: 'mimo-native',
          selectable: true,
          reason: null,
        },
      ],
    }),
    null,
  );
  assert.equal(parseVoiceCaptureResult({ ...final(), cleanup: 'pending' }), null);
  assert.equal(parseVoiceCaptureResult({ ...final(), phase: 'failed', outcome: null }), null);
  assert.equal(parseVoiceCaptureResult(final())?.outcome?.kind, 'final');
});

test('binary upload stays outside JSON and rejects foreign final identity', async () => {
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(url, '/api/voice/captures/capture-1/audio');
    assert.equal(init.headers['Content-Type'], 'application/octet-stream');
    assert.equal(init.headers.Authorization, 'Bearer private-token');
    assert.equal(init.headers['X-Pet-Voice-Samples'], '2');
    assert.ok(init.body instanceof Uint8Array);
    assert.equal(init.body.byteLength, 8);
    return response({
      ok: true,
      value: { ...final(), ticket: { ...ticket(), captureId: 'foreign' } },
    });
  };
  const result = await uploadVoiceCapture(
    { baseUrl: '', token: 'private-token' },
    ticket(),
    2,
    new Uint8Array(8),
  );
  assert.equal(result.ok, false);
  assert.equal(calls, 1);
  assert.equal(
    (await uploadVoiceCapture({ baseUrl: '', token: 't' }, ticket(), 2, new Uint8Array(9))).ok,
    false,
  );
  assert.equal(calls, 1);
});

test('begin/catalog responses must match captured provider, mode and identity', async () => {
  globalThis.fetch = async () =>
    response({ ok: true, value: { ...ticket(), finishMode: 'review' } });
  const input = {
    captureId: 'capture-1',
    clientId: 'client-1',
    agentId: 'agent-1',
    expectedFeatureRevision: 1,
    providerRef: 'pet.asr-magpie/magpie',
    bindingId: 'binding-1',
    finishMode: 'send',
  };
  assert.equal((await beginVoiceCapture({ baseUrl: '', token: 't' }, input)).ok, false);
  globalThis.fetch = async () =>
    response({
      ok: true,
      value: { providerRef: 'pet.asr-magpie/magpie', bindingId: 'wrong', candidates: [] },
    });
  assert.equal(
    (
      await getVoiceCatalog(
        { baseUrl: '', token: 't' },
        { providerRef: 'pet.asr-magpie/magpie', bindingId: 'binding-1' },
      )
    ).ok,
    false,
  );
});

test('explicit voice intent shares multi-ID outbox without replacing an uncertain typed message', async () => {
  const sent = [];
  setup(async (_url, init) => {
    const command = JSON.parse(init.body);
    sent.push(command);
    if (sent.length === 1) throw new Error('lost response');
    return response({
      ok: true,
      value: { commandId: command.commandId, status: 'accepted', messageId: null, taskId: null },
    });
  });
  const client = new CompanionClient({ newCommandId: () => 'typed-1' });
  await client.connect('token');
  assert.equal(await client.submit('typed draft'), 'uncertain');
  const target = client.getVoiceTarget();
  assert.ok(target);
  assert.equal(
    await client.submitIntent({ commandId: 'voice-1', text: 'voice text' }, target),
    'accepted',
  );
  assert.deepEqual(client.getState().outbox, [
    { commandId: 'typed-1', text: 'typed draft', uncertain: true },
  ]);
  assert.equal(sent.length, 2);
  assert.equal(
    await client.submitIntent({ commandId: 'typed-1', text: 'replacement' }, target),
    'failed',
  );
  assert.equal(sent.length, 2);
  client.dispose();
});

test('equal distinct utterances keep separate IDs; retry preserves the given ID', async () => {
  const sent = [];
  setup(async (_url, init) => {
    const command = JSON.parse(init.body);
    sent.push(command);
    return response({
      ok: true,
      value: { commandId: command.commandId, status: 'accepted', messageId: null, taskId: null },
    });
  });
  const client = new CompanionClient();
  await client.connect('token');
  const target = client.getVoiceTarget();
  await client.submitIntent({ commandId: 'voice-a', text: 'same' }, target);
  await client.submitIntent({ commandId: 'voice-b', text: 'same' }, target);
  assert.deepEqual(
    sent.map((c) => c.commandId),
    ['voice-a', 'voice-b'],
  );
  client.dispose();
});

test('old voice target does zero dispatch; late old response cannot mutate replacement outbox', async () => {
  let release;
  let calls = 0;
  setup(async () => {
    calls++;
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  const client = new CompanionClient();
  await client.connect('a');
  const old = client.getVoiceTarget();
  const pending = client.submitIntent({ commandId: 'old-voice', text: 'old' }, old);
  await client.connect('b');
  const before = client.getState();
  assert.equal(await client.submitIntent({ commandId: 'never-send', text: 'old' }, old), 'skipped');
  assert.equal(calls, 1);
  release(
    response({
      ok: true,
      value: { commandId: 'old-voice', status: 'accepted', messageId: null, taskId: null },
    }),
  );
  assert.equal(await pending, 'skipped');
  assert.equal(client.getState(), before);
  client.dispose();
});

test('failed ASR upload and retained reads preserve fixed errors while the text connection stays live', async () => {
  for (const code of ['auth-failed', 'rate-limited', 'audio-format']) {
    let captured;
    setup(async () =>
      response({
        ok: true,
        value: {
          ...final(),
          ticket: captured,
          phase: 'failed',
          outcome: null,
          error: failure(code).error,
        },
      }),
    );
    const client = new CompanionClient();
    await client.connect('token');
    const target = client.getVoiceTarget();
    captured = { ...ticket(), ...target };
    try {
      const uploaded = await client.uploadVoiceCapture(captured, 2, new Uint8Array(8));
      const recovered = await client.readVoiceCapture({
        captureId: captured.captureId,
        clientId: captured.clientId,
        agentId: captured.agentId,
        serviceEpoch: captured.serviceEpoch,
      });
      for (const result of [uploaded, recovered]) {
        assert.equal(result.ok, true);
        assert.equal(result.value.phase, 'failed');
        assert.equal(result.value.error.code, code);
      }
      assert.equal(client.getState().phase, 'live');
      assert.equal(client.getVoiceTarget().agentId, target.agentId);
      assert.deepEqual(client.getState().outbox, []);
    } finally {
      client.dispose();
    }
  }
});

test('provider auth failure in a 200 envelope does not disconnect the valid text client', async () => {
  setup(async () => response(failure('auth-failed')));
  const client = new CompanionClient();
  await client.connect('token');
  const result = await client.readAsrCatalog(
    { providerRef: 'pet.asr-magpie/magpie', bindingId: 'binding-1' },
    client.getVoiceTarget(),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'auth-failed');
  assert.equal(client.getState().phase, 'live');
  client.dispose();
});
