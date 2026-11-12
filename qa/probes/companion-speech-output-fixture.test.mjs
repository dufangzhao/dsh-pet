// Fixture self-tests only: owned synthetic loopback SSE; no product, browser, device or live gateway.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { inspectTtsRequest, startControlledSpeechMagpie } from '../fixtures/companion-speech-output/controlled-magpie.mjs';
import { syntheticPcm16, syntheticPcmChunks, SYNTHETIC_PCM_FORMAT } from '../fixtures/companion-speech-output/synthetic-pcm.mjs';

const ua = 'dsh-pet-speech-fixture/1';
const authorization = 'Bearer speech-fixture-synthetic-canary';
const text = '  合成🙂\r\n完整正文。  ';
const body = () => ({ model: 'mimo-v2.5-tts', stream: true, messages: [{ role: 'assistant', content: text }], audio: { format: 'pcm16', voice: 'Mia' } });
const headers = () => ({ 'content-type': 'application/json', accept: 'text/event-stream', 'user-agent': ua, authorization });
const url = peer => new URL(peer.baseUrl).origin + peer.nativePath;
const post = (peer, options = {}) => fetch(url(peer), { method: 'POST', headers: headers(), body: JSON.stringify(body()), signal: AbortSignal.timeout(5000), ...options });
async function within(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Fixture barrier timeout')), 5000); })]); }
  finally { clearTimeout(timer); }
}
async function withPeer(options, run) {
  const peer = await startControlledSpeechMagpie({ expectedUserAgent: ua, expectedAuthorization: authorization, expectedText: text, ...options });
  try { await run(peer); }
  finally {
    const closed = await within(peer.close());
    assert.equal(closed.listening, false); assert.equal(closed.openSockets, 0); assert.equal(closed.pendingHandlers, 0);
    assert.equal(JSON.stringify(closed).includes(authorization), false);
    assert.equal(JSON.stringify(closed).includes(text), false);
  }
}
// Read the fixture as an independent HTTP client, not a product codec or service mock.
async function* sse(response) {
  const decoder = new TextDecoder('utf-8', { fatal: true }); let pending = '';
  for await (const bytes of response.body) {
    pending += decoder.decode(bytes, { stream: true });
    for (let boundary; (boundary = /\r?\n\r?\n/.exec(pending)) !== null;) {
      const block = pending.slice(0, boundary.index); pending = pending.slice(boundary.index + boundary[0].length);
      const lines = block.split(/\r?\n/); const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (data) yield { event: lines.find(line => line.startsWith('event:'))?.slice(6).trim() ?? 'message', data };
    }
  }
  pending += decoder.decode();
  if (pending.length) yield { event: 'truncated', data: pending };
}
async function collect(response) { const result = []; for await (const event of sse(response)) result.push(event); return result; }
function decoded(events) { return events.filter(event => event.data !== '[DONE]' && event.event === 'message').map(event => JSON.parse(event.data)); }
function audioBytes(events) { return decoded(events).flatMap(event => event.choices?.[0]?.delta?.audio?.data ? [Buffer.from(event.choices[0].delta.audio.data, 'base64')] : []); }
function reasons(events) { return decoded(events).flatMap(event => event.choices?.[0]?.finish_reason ? [event.choices[0].finish_reason] : []); }

test('synthetic PCM is raw deterministic little-endian mono, with exact odd byte slicing', () => {
  assert.deepEqual(SYNTHETIC_PCM_FORMAT, { encoding: 'pcm-s16le', sampleRate: 24000, channels: 1 });
  const bytes = syntheticPcm16(4);
  assert.deepEqual([...bytes], [0, 128, 229, 131, 202, 135, 175, 139]);
  assert.deepEqual(Buffer.concat([...syntheticPcmChunks(100, 3)]), syntheticPcm16(100));
  assert.notEqual(bytes.subarray(0, 4).toString('ascii'), 'RIFF');
});

test('pure request inspection preserves text exactly but records only safe wire metadata', () => {
  const input = { method: 'POST', pathname: '/v1/magpie/native/xiaomi/v1/chat/completions', headers: headers(), bytes: Buffer.from(JSON.stringify(body())) };
  const expected = { vendor: 'xiaomi', model: 'mimo-v2.5-tts', voice: 'Mia', userAgent: ua, text };
  const observation = inspectTtsRequest(input, expected);
  assert.equal(observation.stream, true); assert.equal(observation.textUnits, text.length); assert.equal(observation.messageRole, 'assistant');
  assert.equal(JSON.stringify(observation).includes(text), false); assert.equal(JSON.stringify(observation).includes(authorization), false);
  for (const change of [value => { value.stream = false; }, value => { value.audio.format = 'wav'; },
    value => { value.model = 'mimo-v2.5-tts-voicedesign'; }, value => { value.messages[0].role = 'user'; },
    value => { value.optimize_text_preview = true; }, value => { value.messages[0].content = text.trim(); }]) {
    const invalid = body(); change(invalid);
    assert.throws(() => inspectTtsRequest({ ...input, bytes: Buffer.from(JSON.stringify(invalid)) }, expected));
  }
});

test('actual loopback catalog and fragmented SSE validate own identity and exact streaming body', async () => {
  await withPeer({ frames: 123, pcmChunkBytes: 31, fragments: [1, 2, 5, 13] }, async peer => {
    assert.equal(new URL(peer.baseUrl).hostname, '127.0.0.1'); assert.notEqual(new URL(peer.baseUrl).port, '0');
    const catalog = await fetch(peer.baseUrl + '/models?kind=all', { headers: headers() }).then(response => response.json());
    assert.ok(catalog.data.some(row => row.id === 'xiaomi/mimo-v2.5-tts'));
    const response = await post(peer); assert.match(response.headers.get('content-type'), /^text\/event-stream/);
    const events = await collect(response); const pcm = Buffer.concat(audioBytes(events));
    assert.deepEqual(pcm, syntheticPcm16(123)); assert.deepEqual(reasons(events), ['stop']);
    assert.equal(events.at(-1).data, '[DONE]'); assert.ok(decoded(events).some(event => event.choices.length === 0 && event.usage));
    const snapshot = peer.snapshot; assert.equal(snapshot.catalogCount, 1); assert.equal(snapshot.requestCount, 1);
    assert.deepEqual(snapshot.catalogRequests, [{ method: 'GET', pathname: '/v1/models', query: '?kind=all', userAgent: ua, hasAuthorization: true }]);
    assert.ok(snapshot.requests[0].networkWrites > 100); assert.equal(snapshot.requests[0].pcmBytesWritten, 246);
    assert.equal(snapshot.requests[0].model, 'mimo-v2.5-tts'); assert.deepEqual(snapshot.requests[0].audio, { format: 'pcm16', voice: 'Mia' });
  });
});

test('held first audio and held terminal expose genuine progressive HTTP delivery', async () => {
  await withPeer({ holdFirst: true, holdTerminal: true, frames: 100, pcmChunkBytes: 39 }, async peer => {
    const response = await post(peer); await within(peer.firstRequest);
    assert.equal(peer.snapshot.requests[0].pcmBytesWritten, 0);
    peer.releaseFirst(1);
    const iterator = sse(response); let first;
    while (!first) { const next = await iterator.next(); assert.equal(next.done, false); if (JSON.parse(next.value.data).choices?.[0]?.delta?.audio) first = next.value; }
    await within(peer.beforeTerminal);
    assert.equal(peer.snapshot.requests[0].terminalWritten, null); assert.equal(peer.snapshot.requests[0].responseFinished, false);
    peer.releaseTerminal(1);
    const remaining = []; for await (const event of iterator) remaining.push(event);
    assert.equal(Buffer.concat(audioBytes([first, ...remaining])).length, 200); assert.deepEqual(reasons(remaining), ['stop']);
  });
});

test('real consumer abort cancels held-first and held-terminal handlers without synthetic settlement', async t => {
  for (const gate of ['holdFirst', 'holdTerminal']) await t.test(gate, async () => {
    await withPeer({ [gate]: true, frames: 32 }, async peer => {
      const cancel = new AbortController(); const response = await post(peer, { signal: cancel.signal });
      await within(gate === 'holdFirst' ? peer.firstRequest : peer.beforeTerminal);
      cancel.abort(); await within(peer.firstResponseAborted);
      await assert.rejects(response.arrayBuffer());
      assert.equal(peer.snapshot.abortedResponses, 1);
      peer.releaseFirst(); peer.releaseTerminal();
    });
  });
});

test('long cumulative PCM greater than 2 MiB remains ordered over odd event boundaries', async () => {
  const frames = 1100003; const expectedHash = createHash('sha256');
  for (const part of syntheticPcmChunks(frames, 16384)) expectedHash.update(part);
  await withPeer({ frames, pcmChunkBytes: 8193, fragments: [65536] }, async peer => {
    const response = await post(peer); const hash = createHash('sha256'); let total = 0, largest = 0, stop = false;
    for await (const event of sse(response)) {
      if (event.data === '[DONE]') continue;
      const data = JSON.parse(event.data), choice = data.choices[0];
      if (choice?.delta?.audio) { const pcm = Buffer.from(choice.delta.audio.data, 'base64'); total += pcm.length; largest = Math.max(largest, pcm.length); hash.update(pcm); }
      if (choice?.finish_reason) { assert.equal(choice.finish_reason, 'stop'); stop = true; }
    }
    assert.equal(total, frames * 2); assert.ok(total > 2 * 1024 * 1024); assert.ok(largest <= 8193); assert.equal(stop, true);
    assert.equal(hash.digest('hex'), expectedHash.digest('hex')); assert.equal(peer.snapshot.requests[0].framesWritten, frames);
  });
});

test('large bounded SSE writes actually await HTTP backpressure and drain', async () => {
  await withPeer({ frames: 180000, pcmChunkBytes: 131072, fragments: [65536] }, async peer => {
    const events = await collect(await post(peer));
    assert.equal(Buffer.concat(audioBytes(events)).length, 360000);
    assert.deepEqual(reasons(events), ['stop']);
    assert.ok(peer.snapshot.requests[0].backpressureWaits > 0, 'expected a real response.write(false)/drain path');
  });
});

test('controlled terminal and malformed modes retain their distinctions', async t => {
  for (const mode of ['length', 'content-filter', 'eof', 'done-without-stop', 'zero-audio', 'usage-only',
    'odd-tail', 'invalid-base64', 'truncated-event', 'error-event', 'audio-after-stop', 'oversized-event', 'decoded-oversize']) {
    await t.test(mode, async () => {
      await withPeer({ mode, frames: 8, pcmChunkBytes: 8, fragments: [65536] }, async peer => {
        const events = await collect(await post(peer));
        if (mode === 'length' || mode === 'content-filter') assert.deepEqual(reasons(events), [mode === 'length' ? 'length' : 'content_filter']);
        if (['eof', 'done-without-stop', 'usage-only'].includes(mode)) assert.deepEqual(reasons(events), []);
        if (['zero-audio', 'usage-only'].includes(mode)) assert.equal(audioBytes(events).length, 0);
        if (mode === 'odd-tail') assert.equal(Buffer.concat(audioBytes(events)).length % 2, 1);
        if (mode === 'invalid-base64') assert.ok(decoded(events).some(event => event.choices[0]?.delta?.audio?.data === '%%%not-base64%%%'));
        if (mode === 'truncated-event') assert.equal(events.at(-1).event, 'truncated');
        if (mode === 'error-event') assert.equal(events.at(-1).event, 'error');
        if (mode === 'audio-after-stop') {
          const data = decoded(events); const stop = data.findIndex(event => event.choices[0]?.finish_reason === 'stop');
          assert.ok(data.slice(stop + 1).some(event => event.choices[0]?.delta?.audio));
        }
        if (mode === 'oversized-event') assert.ok(events.some(event => event.data.length > 1024 * 1024));
        if (mode === 'decoded-oversize') assert.ok(audioBytes(events).some(bytes => bytes.length > 512 * 1024));
      });
    });
  }
});

test('actual peer refuses wrong identity/auth/nonstream request and emits selected status/format failures', async () => {
  await withPeer({}, async peer => {
    let response = await post(peer, { headers: { ...headers(), authorization: 'Bearer wrong-synthetic' } }); assert.equal(response.status, 401); await response.arrayBuffer();
    response = await post(peer, { headers: { ...headers(), 'user-agent': 'AstrBot-Magpie/2.0' } }); assert.equal(response.status, 400); await response.arrayBuffer();
    response = await post(peer, { body: JSON.stringify({ ...body(), stream: false }) }); assert.equal(response.status, 400); await response.arrayBuffer();
    assert.equal(peer.snapshot.requestCount, 0); assert.equal(peer.snapshot.rejectedCount, 3);
  });
  for (const [mode, status, type] of [['auth', 401, 'application/json'], ['forbidden', 403, 'application/json'],
    ['rate-limited', 429, 'application/json'], ['nonstream-json', 200, 'application/json']]) {
    await withPeer({ mode }, async peer => { const response = await post(peer); assert.equal(response.status, status); assert.equal(response.headers.get('content-type'), type); await response.arrayBuffer(); });
  }
});

test('explicit per-request response modes prove partial failure then success without rebinding', async () => {
  await withPeer({ responseModes: ['length', 'stop'], frames: 16 }, async peer => {
    assert.deepEqual(reasons(await collect(await post(peer))), ['length']);
    assert.deepEqual(reasons(await collect(await post(peer))), ['stop']);
    assert.deepEqual(peer.snapshot.requests.map(request => request.responseMode), ['length', 'stop']);
    const unexpected = await post(peer); assert.equal(unexpected.status, 400); await unexpected.arrayBuffer();
    assert.equal(peer.snapshot.requests.length, 2);
  });
});

test('closing an owned listener drains blocked SSE and is idempotent', async () => {
  const peer = await startControlledSpeechMagpie({ expectedUserAgent: ua, holdFirst: true });
  try {
    const response = await post(peer); await within(peer.firstRequest);
    const closed = await within(peer.close()); assert.equal(closed.listening, false); assert.equal(closed.openSockets, 0); assert.equal(closed.pendingHandlers, 0);
    assert.deepEqual(await peer.close(), closed); await assert.rejects(response.arrayBuffer());
  } finally { await peer.close(); }
});
