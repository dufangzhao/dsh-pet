// Pure controlled-peer data validation only. No listener, product or network is started.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectMimoRequest, controlledCatalogResponse, controlledResponse } from '../fixtures/companion-voice-input/controlled-magpie.mjs';
import { SAMPLE_COUNT, syntheticWav } from '../fixtures/companion-voice-input/synthetic-audio.mjs';

function request() {
  const wav = syntheticWav();
  const body = { model: 'mimo-v2.5-asr', max_completion_tokens: 1024,
    messages: [{ role: 'user', content: [{ type: 'input_audio',
      input_audio: { data: `data:audio/wav;base64,${wav.toString('base64')}` } }] }] };
  return { method: 'POST', path: '/v1/magpie/native/xiaomi/v1/chat/completions',
    headers: { 'content-type': 'application/json', 'user-agent': 'dsh-pet-voice/1',
      authorization: 'Bearer synthetic-fixture-only' }, bytes: Buffer.from(JSON.stringify(body)) };
}

test('controlled peer validates WAV bytes and returns only safe metadata', () => {
  const summary = inspectMimoRequest(request(), syntheticWav());
  assert.equal(summary.samples, SAMPLE_COUNT);
  assert.equal(summary.wavBytes, syntheticWav().length);
  assert.equal(summary.wavSha256, 'b3b0e82ca963856487afca7a4667aff68eb2d9f2964af746ef28947130b65f6c');
  assert.equal(summary.hasAuthorization, true);
  assert.ok(!JSON.stringify(summary).includes('synthetic-fixture-only'));
  assert.ok(!JSON.stringify(summary).includes('base64,'));
});

test('controlled peer rejects incorrect route, authority identity and corrupted WAV', () => {
  const valid = request();
  assert.throws(() => inspectMimoRequest({ ...valid, path: '/v1/audio/transcriptions' }));
  assert.throws(() => inspectMimoRequest({ ...valid, headers: { ...valid.headers, 'user-agent': 'AstrBot-Magpie/2.0' } }));
  const invalidBody = JSON.parse(valid.bytes.toString('utf8'));
  invalidBody.messages[0].content[0].input_audio.data = 'data:audio/wav;base64,!!';
  assert.throws(() => inspectMimoRequest({ ...valid, bytes: Buffer.from(JSON.stringify(invalidBody)) }));
  const toolBody = JSON.parse(valid.bytes.toString('utf8'));
  toolBody.tools = [];
  assert.throws(() => inspectMimoRequest({ ...valid, bytes: Buffer.from(JSON.stringify(toolBody)) }));
});

test('controlled replies distinguish final, no speech, reasoning and transport failures', () => {
  assert.equal(JSON.parse(controlledResponse('final').body).choices[0].message.content, '受控测试转录');
  assert.equal(JSON.parse(controlledResponse('empty').body).choices[0].message.content, '');
  const reasoning = JSON.parse(controlledResponse('reasoning-only').body).choices[0].message;
  assert.equal(typeof reasoning.reasoning_content, 'string'); assert.equal('content' in reasoning, false);
  assert.equal(controlledResponse('auth').status, 401);
  assert.equal(controlledResponse('forbidden').status, 403);
  assert.equal(controlledResponse('rate-limited').status, 429);
  assert.ok(Buffer.byteLength(controlledResponse('oversized').body) > 65536);
  const catalog = JSON.parse(controlledCatalogResponse('catalog').body);
  assert.ok(catalog.data.some((row) => row.id === 'xiaomi/mimo-v2.5-asr'));
  assert.equal(controlledCatalogResponse('forbidden').status, 403);
  assert.ok(Buffer.byteLength(controlledCatalogResponse('oversized').body) > 1024 * 1024);
  assert.throws(() => controlledResponse('unknown'));
  assert.throws(() => controlledCatalogResponse('unknown'));
});
