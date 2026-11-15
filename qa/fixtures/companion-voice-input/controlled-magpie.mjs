// Test-only loopback peer for the reviewed Magpie ASR contract. Importing it starts nothing.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import http from 'node:http';
import { VOICE_GATEWAY_CATALOG_MAX_BYTES, VOICE_MIMO_MAX_REQUEST_BYTES } from '../../../packages/contracts/src/companion-voice.ts';

const AUDIO_ROUTE = '/v1/magpie/native/xiaomi/v1/chat/completions';
const SYNTHETIC_TRANSCRIPT = '受控测试转录';
const catalog = {
  object: 'list',
  data: [
    { id: 'xiaomi/mimo-v2.5-asr' },
    { id: 'xiaomi/mimo-v2.5-tts', serves: ['speech'] },
    { id: 'example/whisper-asr', serves: ['transcription'] },
    { id: 'example/audio-chat', kind: 'chat', input_modalities: ['audio'] },
  ],
};

/** Inspect synthetic peer input in memory; return no audio, credentials or raw JSON. */
export function inspectMimoRequest({ method, path, headers, bytes }, expectedWav) {
  assert.equal(method, 'POST'); assert.equal(path, AUDIO_ROUTE);
  assert.equal(headers['user-agent'], 'dsh-pet-voice/1');
  assert.match(String(headers['content-type']), /^application\/json(?:\s*;|$)/i);
  assert.ok(bytes instanceof Uint8Array && bytes.byteLength <= VOICE_MIMO_MAX_REQUEST_BYTES);
  const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  assert.equal(body.model, 'mimo-v2.5-asr'); assert.equal(body.max_completion_tokens, 1024);
  assert.ok(!('tools' in body) && !('tool_choice' in body));
  assert.ok(Array.isArray(body.messages) && body.messages.length === 1);
  assert.equal(body.messages[0].role, 'user');
  const content = body.messages[0].content;
  assert.ok(Array.isArray(content) && content.length === 1 && content[0].type === 'input_audio');
  const data = content[0].input_audio?.data;
  assert.ok(typeof data === 'string' && data.startsWith('data:audio/wav;base64,'));
  const encoded = data.slice('data:audio/wav;base64,'.length);
  assert.match(encoded, /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
  const wav = Buffer.from(encoded, 'base64');
  assert.equal(wav.toString('base64'), encoded);
  assert.ok(wav.length >= 44 && wav.length <= 640044);
  assert.equal(wav.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(wav.subarray(8, 16).toString('ascii'), 'WAVEfmt ');
  assert.equal(wav.readUInt32LE(4), wav.length - 8);
  assert.equal(wav.readUInt32LE(16), 16);
  assert.equal(wav.readUInt16LE(20), 1); assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 16000); assert.equal(wav.readUInt32LE(28), 32000);
  assert.equal(wav.readUInt16LE(32), 2); assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.subarray(36, 40).toString('ascii'), 'data');
  assert.equal(wav.readUInt32LE(40), wav.length - 44);
  assert.equal((wav.length - 44) % 2, 0);
  if (expectedWav !== undefined) assert.deepEqual(wav, expectedWav);
  return { method, path, userAgent: headers['user-agent'], hasAuthorization: typeof headers.authorization === 'string',
    bodyBytes: bytes.byteLength, wavBytes: wav.length, samples: (wav.length - 44) / 2,
    wavSha256: createHash('sha256').update(wav).digest('hex') };
}

export function controlledResponse(kind, syntheticEcho = 'synthetic-key-only') {
  switch (kind) {
    case 'final': return { status: 200, body: JSON.stringify({ choices: [{ message: { content: SYNTHETIC_TRANSCRIPT } }] }) };
    case 'empty': return { status: 200, body: JSON.stringify({ choices: [{ message: { content: '' } }] }) };
    case 'reasoning-only': return { status: 200, body: JSON.stringify({ choices: [{ message: { reasoning_content: 'not transcription' } }] }) };
    case 'secret-echo': return { status: 200, body: JSON.stringify({ choices: [{ message: { content: syntheticEcho } }] }) };
    case 'tools-only': return { status: 200, body: JSON.stringify({ choices: [{ message: { tool_calls: [{ id: 'synthetic-call', type: 'function', function: { name: 'synthetic', arguments: '{}' } }] } }] }) };
    case 'malformed': return { status: 200, body: '{' };
    case 'oversized': return { status: 200, body: JSON.stringify({ choices: [{ message: { content: 'x'.repeat(65537) } }] }) };
    case 'auth': return { status: 401, body: '{"error":"synthetic"}' };
    case 'forbidden': return { status: 403, body: '{"error":"synthetic"}' };
    case 'rate-limited': return { status: 429, body: '{"error":"synthetic"}' };
    case 'unsupported': return { status: 404, body: '{"error":"synthetic"}' };
    default: throw new TypeError('Unknown controlled response');
  }
}

export function controlledCatalogResponse(kind) {
  switch (kind) {
    case 'catalog': return { status: 200, body: JSON.stringify(catalog) };
    case 'auth': case 'forbidden': case 'rate-limited': case 'malformed': return controlledResponse(kind);
    case 'oversized': return { status: 200, body: 'x'.repeat(VOICE_GATEWAY_CATALOG_MAX_BYTES + 1) };
    default: throw new TypeError('Unknown controlled catalog response');
  }
}

/** Explicitly invoked only during authorized integration; binds an ephemeral loopback port. */
export async function startControlledMagpie({ result = 'final', catalogResult = 'catalog', expectedWav, expectedAuthorization, syntheticEcho, hold = false } = {}) {
  const reply = controlledResponse(result, syntheticEcho);
  const catalogReply = controlledCatalogResponse(catalogResult);
  const requests = [];
  const sockets = new Set();
  const held = new Set();
  const firstAudio = Promise.withResolvers();
  void firstAudio.promise.catch(() => {});
  let audioCount = 0, catalogCount = 0, abortedResponses = 0;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/v1/models' && url.search === '?kind=all') {
      catalogCount++;
      if (expectedAuthorization !== undefined && req.headers.authorization !== expectedAuthorization) {
        res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":"synthetic"}'); return;
      }
      requests.push({ method: 'GET', path: '/v1/models?kind=all', userAgent: req.headers['user-agent'],
        hasAuthorization: typeof req.headers.authorization === 'string' });
      res.writeHead(catalogReply.status, { 'content-type': 'application/json' }); res.end(catalogReply.body); return;
    }
    if (req.method !== 'POST' || url.pathname !== AUDIO_ROUTE || url.search) {
      res.writeHead(404); res.end(); return;
    }
    audioCount++;
    let length = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      length += chunk.length;
      if (length > VOICE_MIMO_MAX_REQUEST_BYTES) req.destroy();
      else chunks.push(chunk);
    });
    req.on('error', () => {});
    req.on('end', () => {
      try {
        if (expectedAuthorization !== undefined) assert.equal(req.headers.authorization, expectedAuthorization);
        const observation = inspectMimoRequest({ method: req.method, path: url.pathname,
          headers: req.headers, bytes: Buffer.concat(chunks) }, expectedWav);
        requests.push(observation); firstAudio.resolve(observation);
        res.on('close', () => { if (!res.writableFinished) abortedResponses++; held.delete(res); });
        res.writeHead(reply.status, { 'content-type': 'application/json' });
        if (hold) { res.flushHeaders(); held.add(res); }
        else res.end(reply.body);
      } catch (error) {
        firstAudio.reject(new Error(`Controlled peer request rejected: ${error.name}`));
        res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"error":"fixture-request-invalid"}');
      }
    });
  });
  server.on('connection', (socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    firstAudio: firstAudio.promise,
    get snapshot() { return { audioCount, catalogCount, abortedResponses, requests: [...requests] }; },
    release() { for (const response of held) response.end(reply.body); held.clear(); },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
