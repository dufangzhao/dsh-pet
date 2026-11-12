// Owned loopback Magpie native TTS SSE peer. Importing this module starts nothing.
// No product DTO/bridge is declared here; only the reviewed upstream MiMo wire contract.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { syntheticPcmChunks, SYNTHETIC_PCM_FORMAT } from './synthetic-pcm.mjs';

const MODES = new Set(['stop', 'length', 'content-filter', 'eof', 'done-without-stop', 'odd-tail',
  'invalid-base64', 'truncated-event', 'error-event', 'audio-after-stop', 'zero-audio', 'usage-only',
  'oversized-event', 'decoded-oversize', 'auth', 'forbidden', 'rate-limited', 'nonstream-json']);
const catalog = { object: 'list', data: [
  { id: 'xiaomi/mimo-v2.5-tts' },
  { id: 'xiaomi/mimo-v2.5-tts-voicedesign', serves: ['tts'] },
  { id: 'example/mimo-tts-voiceclone', kind: 'tts' },
  { id: 'example/other-tts', serves: ['speech'] },
  { id: 'xiaomi/mimo-v2.5-asr', serves: ['asr'] },
  { id: 'example/audio-chat', kind: 'chat', input_modalities: ['audio'] },
] };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const abortError = () => new DOMException('Fixture operation aborted', 'AbortError');

export function inspectTtsRequest({ method, pathname, headers, bytes }, expected) {
  assert.equal(method, 'POST'); assert.equal(pathname, `/v1/magpie/native/${encodeURIComponent(expected.vendor)}/v1/chat/completions`);
  assert.equal(headers['user-agent'], expected.userAgent);
  assert.match(String(headers.accept), /(?:^|,)\s*text\/event-stream(?:\s*;|\s*,|$)/i);
  assert.match(String(headers['content-type']), /^application\/json(?:\s*;|$)/i);
  assert.ok(bytes instanceof Uint8Array && bytes.byteLength <= 64 * 1024);
  const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  assert.deepEqual(Object.keys(body).sort(), ['audio', 'messages', 'model', 'stream']);
  assert.equal(body.model, expected.model); assert.equal(body.stream, true);
  assert.deepEqual(body.audio, { format: 'pcm16', voice: expected.voice });
  assert.equal(body.messages.length, 1);
  assert.deepEqual(Object.keys(body.messages[0]).sort(), ['content', 'role']);
  assert.equal(body.messages[0].role, 'assistant'); assert.equal(typeof body.messages[0].content, 'string');
  assert.ok(body.messages[0].content.length > 0 && [...body.messages[0].content].length <= 4000);
  if (expected.text !== undefined) assert.equal(body.messages[0].content, expected.text);
  return { method, pathname, userAgent: headers['user-agent'], hasAuthorization: typeof headers.authorization === 'string',
    bodyBytes: bytes.byteLength, bodyKeys: Object.keys(body).sort(), model: body.model, stream: body.stream,
    audio: body.audio, messageRole: 'assistant', textUnits: body.messages[0].content.length,
    textCodePoints: [...body.messages[0].content].length, textSha256: sha(body.messages[0].content) };
}

async function untilAbort(promise, signal) {
  if (signal.aborted) throw abortError();
  let onAbort;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      onAbort = () => reject(abortError()); signal.addEventListener('abort', onAbort, { once: true });
    })]);
  } finally { if (onAbort) signal.removeEventListener('abort', onAbort); }
}
async function drain(response, signal) {
  if (signal.aborted) throw abortError();
  await new Promise((resolve, reject) => {
    const cleanup = () => { response.off('drain', ready); signal.removeEventListener('abort', aborted); };
    const ready = () => { cleanup(); resolve(); };
    const aborted = () => { cleanup(); reject(abortError()); };
    response.once('drain', ready); signal.addEventListener('abort', aborted, { once: true });
  });
}

/** expectedUserAgent is explicit so Phase 0's actual identity can be supplied, never guessed. */
export async function startControlledSpeechMagpie({ expectedUserAgent, expectedAuthorization,
  vendor = 'xiaomi', model = 'mimo-v2.5-tts', voice = 'Mia', expectedText,
  frames = 4800, pcmChunkBytes = 4800, fragments = [29, 257, 1021], mode = 'stop',
  holdFirst = false, holdTerminal = false, usage = true, responseModes } = {}) {
  assert.ok(typeof expectedUserAgent === 'string' && expectedUserAgent.length > 0);
  assert.ok(MODES.has(mode), 'Unknown fixture mode');
  assert.ok(responseModes === undefined || (Array.isArray(responseModes) && responseModes.length > 0 && responseModes.every(value => MODES.has(value))));
  const defaultMode = mode;
  assert.match(vendor, /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
  assert.ok(Number.isSafeInteger(frames) && frames >= 0 && frames <= 16 * 1024 * 1024);
  assert.ok(Number.isSafeInteger(pcmChunkBytes) && pcmChunkBytes > 0 && pcmChunkBytes <= 512 * 1024);
  assert.ok(Array.isArray(fragments) && fragments.length > 0 && fragments.every(size => Number.isSafeInteger(size) && size > 0 && size <= 1024 * 1024));
  const route = `/v1/magpie/native/${encodeURIComponent(vendor)}/v1/chat/completions`;
  const sockets = new Set(), socketCloses = new Map(), work = new Set(), gates = new Map(), records = [], catalogRequests = [];
  const firstRequest = Promise.withResolvers(), firstAudio = Promise.withResolvers(), beforeTerminal = Promise.withResolvers(), firstAborted = Promise.withResolvers();
  let catalogCount = 0, requestCount = 0, rejectedCount = 0, abortedResponses = 0, closing = false, closePromise;
  const safeSnapshot = () => ({ catalogCount, requestCount, rejectedCount, abortedResponses,
    openSockets: sockets.size, pendingHandlers: work.size, listening: server.listening,
    catalogRequests: catalogRequests.map(record => ({ ...record })), requests: records.map(record => ({ ...record })) });

  async function respond(req, res, signal, observation, number) {
    const mode = responseModes === undefined ? defaultMode : responseModes[number - 1];
    assert.ok(MODES.has(mode), 'Fixture response sequence exhausted');
    const record = { requestNumber: number, responseMode: mode, ...observation, pcmBytesWritten: 0, framesWritten: 0,
      audioEventsWritten: 0, networkWrites: 0, wireBytesWritten: 0, backpressureWaits: 0,
      responseFinished: false, cancelled: false, terminalWritten: null };
    records.push(record); firstRequest.resolve({ ...record });
    const firstGate = Promise.withResolvers(), terminalGate = Promise.withResolvers();
    gates.set(number, { first: firstGate, terminal: terminalGate });
    if (!holdFirst) firstGate.resolve(); if (!holdTerminal) terminalGate.resolve();
    let fragmentIndex = 0;
    async function raw(value) {
      const bytes = typeof value === 'string' ? Buffer.from(value) : value;
      for (let offset = 0; offset < bytes.length;) {
        if (signal.aborted) throw abortError();
        const size = fragments[fragmentIndex++ % fragments.length];
        const next = bytes.subarray(offset, offset + size); offset += next.length;
        const accepted = res.write(next); record.networkWrites++; record.wireBytesWritten += next.length;
        if (!accepted) { record.backpressureWaits++; await drain(res, signal); }
        // Actual separate writes/yields; TCP/Fetch may still coalesce them differently.
        await yieldTurn();
      }
    }
    const event = data => raw(`data: ${JSON.stringify(data)}\r\n\r\n`);
    const chunk = (delta, reason = null) => ({ id: `synthetic-completion-${number}`, object: 'chat.completion.chunk',
      model, choices: [{ index: 0, delta, finish_reason: reason }] });
    const audio = async pcm => {
      await event(chunk({ audio: { id: `synthetic-audio-${number}`, data: pcm.toString('base64') } }));
      record.pcmBytesWritten += pcm.length; record.framesWritten = Math.floor(record.pcmBytesWritten / 2);
      record.audioEventsWritten++; firstAudio.resolve({ requestNumber: number, pcmBytesWritten: record.pcmBytesWritten });
    };
    try {
      if (['auth', 'forbidden', 'rate-limited'].includes(mode)) {
        res.writeHead({ auth: 401, forbidden: 403, 'rate-limited': 429 }[mode], { 'content-type': 'application/json' });
        res.end('{"error":"synthetic-fixture-only"}'); return;
      }
      if (mode === 'nonstream-json') {
        res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"choices":[]}'); return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' }); res.flushHeaders();
      await raw(': 合成PCM—fixture\r\n\r\n');
      if (usage) await event({ id: `synthetic-completion-${number}`, model, choices: [], usage: { completion_tokens: 0 } });
      await untilAbort(firstGate.promise, signal);
      if (!['zero-audio', 'usage-only'].includes(mode)) {
        for (const pcm of syntheticPcmChunks(frames, pcmChunkBytes)) await audio(pcm);
      }
      beforeTerminal.resolve({ requestNumber: number, pcmBytesWritten: record.pcmBytesWritten, framesWritten: record.framesWritten });
      await untilAbort(terminalGate.promise, signal);
      if (mode === 'truncated-event') { await raw('data: {"choices":['); res.end(); return; }
      if (mode === 'eof') { res.end(); return; }
      if (mode === 'done-without-stop' || mode === 'usage-only') { await raw('data: [DONE]\r\n\r\n'); res.end(); return; }
      if (mode === 'invalid-base64') await event(chunk({ audio: { id: `synthetic-audio-${number}`, data: '%%%not-base64%%%' } }));
      if (mode === 'odd-tail') await audio(Buffer.from([0x7f]));
      if (mode === 'oversized-event') await raw(`data: ${'x'.repeat(1024 * 1024 + 1)}\r\n\r\n`);
      if (mode === 'decoded-oversize') await audio(Buffer.alloc(512 * 1024 + 2));
      if (mode === 'error-event') {
        await raw('event: error\r\ndata: {"error":{"code":"synthetic-error"}}\r\n\r\n'); res.end(); return;
      }
      const reason = mode === 'length' ? 'length' : mode === 'content-filter' ? 'content_filter' : 'stop';
      await event(chunk({}, reason)); record.terminalWritten = reason;
      if (mode === 'audio-after-stop') await audio(Buffer.from([0, 0]));
      if (usage) await event({ id: `synthetic-completion-${number}`, model, choices: [], usage: { completion_tokens: 1 } });
      await raw('data: [DONE]\r\n\r\n'); res.end();
    } finally { record.cancelled = signal.aborted; gates.delete(number); }
  }

  const server = http.createServer((req, res) => {
    const abort = new AbortController();
    res.on('error', () => {}); req.on('error', () => {});
    res.once('finish', () => { const record = records.find(item => item.requestNumber === res.requestNumber); if (record) record.responseFinished = true; });
    res.once('close', () => {
      if (!res.writableFinished && res.requestNumber) { abortedResponses++; firstAborted.resolve({ requestNumber: res.requestNumber }); }
      abort.abort();
    });
    const operation = (async () => {
      if (closing) { res.writeHead(503); res.end(); return; }
      if (expectedAuthorization !== undefined && req.headers.authorization !== expectedAuthorization) {
        rejectedCount++; res.writeHead(401); res.end(); req.resume(); return;
      }
      if (req.headers['user-agent'] !== expectedUserAgent) { rejectedCount++; res.writeHead(400); res.end(); req.resume(); return; }
      if (req.method === 'GET' && req.url === '/v1/models?kind=all') {
        catalogCount++;
        catalogRequests.push({ method: 'GET', pathname: '/v1/models', query: '?kind=all', userAgent: req.headers['user-agent'], hasAuthorization: typeof req.headers.authorization === 'string' });
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(catalog)); return;
      }
      if (req.method !== 'POST' || req.url !== route) { rejectedCount++; res.writeHead(404); res.end(); req.resume(); return; }
      const parts = []; let size = 0;
      for await (const part of req) { size += part.length; if (size > 64 * 1024) throw new Error('fixture-body-limit'); parts.push(part); }
      const observation = inspectTtsRequest({ method: req.method, pathname: req.url, headers: req.headers, bytes: Buffer.concat(parts) },
        { vendor, model, voice, text: expectedText, userAgent: expectedUserAgent });
      const number = ++requestCount; res.requestNumber = number;
      await respond(req, res, abort.signal, observation, number);
    })();
    work.add(operation);
    void operation.catch(error => {
      if (error.name !== 'AbortError') {
        rejectedCount++;
        if (!res.headersSent) { res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"error":"fixture-request-invalid"}'); }
        else res.destroy();
      }
    }).finally(() => work.delete(operation));
  });
  server.on('connection', socket => {
    sockets.add(socket);
    socketCloses.set(socket, new Promise(resolve => socket.once('close', () => {
      sockets.delete(socket); socketCloses.delete(socket); resolve();
    })));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`, nativePath: route, format: SYNTHETIC_PCM_FORMAT,
    firstRequest: firstRequest.promise, firstAudioWritten: firstAudio.promise, beforeTerminal: beforeTerminal.promise, firstResponseAborted: firstAborted.promise,
    get snapshot() { return safeSnapshot(); },
    releaseFirst(requestNumber) { for (const [number, value] of gates) if (requestNumber === undefined || number === requestNumber) value.first.resolve(); },
    releaseTerminal(requestNumber) { for (const [number, value] of gates) if (requestNumber === undefined || number === requestNumber) value.terminal.resolve(); },
    close() {
      closePromise ??= (async () => {
        closing = true;
        const closedSockets = [...socketCloses.values()];
        for (const socket of sockets) socket.destroy();
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        await Promise.all(closedSockets);
        await Promise.allSettled([...work]);
        return safeSnapshot();
      })();
      return closePromise;
    },
  };
}
