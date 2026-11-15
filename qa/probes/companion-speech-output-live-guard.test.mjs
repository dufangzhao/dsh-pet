// Pure/controlled guard tests. Never imports a product service or calls any gateway/network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LIVE_SCOPE, LIVE_SCOPE_SHA256, LIVE_TEXT, validateLiveApproval, claimLiveAttempt,
  createLiveFetchGuard, wavHeader, safeLiveFailure, persistLiveReport } from './companion-speech-output-live.mjs';
const scriptHash = 'a'.repeat(64);
const env = () => ({ PET_SPEECH_LIVE_SCOPE_SHA256: LIVE_SCOPE_SHA256, PET_SPEECH_LIVE_SCRIPT_SHA256: scriptHash });
const args = () => ['--run-authorized', '--approval-reference', 'CONTROLLED-GUARD-TEST-NOT-HUMAN-AUTHORIZATION'];
const init = () => ({ method: 'POST', headers: { 'User-Agent': LIVE_SCOPE.userAgent, Authorization: `Bearer ${LIVE_SCOPE.publicClientId}`,
  Accept: 'text/event-stream', 'Content-Type': 'application/json' }, body: JSON.stringify({ model: LIVE_SCOPE.wireModel, stream: true,
    messages: [{ role: 'assistant', content: LIVE_TEXT }], audio: { format: 'pcm16', voice: '冰糖' } }) });

test('scope is the exact review proposal; no text/voice/target/budget override or prior ASR opt-in', () => {
  assert.equal(LIVE_TEXT, '你好，我是你的桌宠。现在正在测试语音朗读。');
  assert.equal(LIVE_SCOPE.maxNativePosts, 1); assert.equal(LIVE_SCOPE.maxSegments, 1);
  assert.equal(LIVE_SCOPE.maxWindowMs, 60000); assert.equal(LIVE_SCOPE.maxAcceptedPcmBytes, 1048576);
  assert.equal(LIVE_SCOPE.voice, '冰糖'); assert.equal(LIVE_SCOPE.playback, false);
  assert.equal(validateLiveApproval(args(), env(), scriptHash).scopeSha256, LIVE_SCOPE_SHA256);
  for (const invalid of [[], ['--run-frozen'], [...args(), '--retry'], ['--run-authorized', '--approval-reference', ''], ['--run-authorized', '--approval-reference', 'line\nbreak']])
    assert.throws(() => validateLiveApproval(invalid, env(), scriptHash));
  assert.throws(() => validateLiveApproval(args(), {}, scriptHash));
  assert.throws(() => validateLiveApproval(args(), { PET_COMPANION_LIVE_MAGPIE: '1' }, scriptHash));
  assert.throws(() => validateLiveApproval(args(), { ...env(), PET_SPEECH_LIVE_SCRIPT_SHA256: 'b'.repeat(64) }, scriptHash));
});

test('exclusive real filesystem attempt marker survives unknown outcomes and rejects a second claimant', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'speech-live-guard-'));
  const marker = path.join(directory, 'synthetic-attempt.json');
  const record = { scopeSha256: LIVE_SCOPE_SHA256, state: 'guard-test-reserved-never-real-live' };
  const outcomes = await Promise.allSettled([claimLiveAttempt(marker, record), claimLiveAttempt(marker, record)]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(result => result.status === 'rejected' && result.reason.code === 'EEXIST').length, 1);
  assert.deepEqual(JSON.parse(await readFile(marker, 'utf8')), record);
  await assert.rejects(claimLiveAttempt(marker, { state: 'must-not-replace' }), { code: 'EEXIST' });
  assert.deepEqual(JSON.parse(await readFile(marker, 'utf8')), record);
  // Tiny private guard-test marker intentionally retained, never the real fixed attempt path.
});

test('no native delegation is possible before a marker, and the actual response is returned unchanged', async () => {
  let calls = 0;
  const actualResponse = new Response('data: controlled-no-network\n\n', { headers: { 'content-type': 'text/event-stream' } });
  const delegate = async () => { calls++; return actualResponse; };
  assert.throws(() => createLiveFetchGuard({ delegate, markerClaimed: false, localOrigin: () => null, signal: new AbortController().signal }));
  assert.equal(calls, 0);
  const guard = createLiveFetchGuard({ delegate, markerClaimed: true, localOrigin: () => 'http://127.0.0.1:12345', signal: new AbortController().signal });
  assert.equal(await guard.fetch(LIVE_SCOPE.nativeUrl, init()), actualResponse);
  await assert.rejects(guard.fetch(LIVE_SCOPE.nativeUrl, init())); assert.equal(calls, 1);
  assert.equal(guard.stats.nativeDelegations, 1); assert.equal(guard.stats.nativeAttempts, 2);
});

test('changed text, voice, model, streaming, auth or route is refused before any network delegate', async () => {
  let calls = 0;
  for (const mutate of [body => { body.messages[0].content += ' '; }, body => { body.audio.voice = 'Mia'; },
    body => { body.model = 'mimo-v2.5-tts-voicedesign'; }, body => { body.stream = false; }, body => { body.messages[0].role = 'user'; }]) {
    const guard = createLiveFetchGuard({ delegate: async () => { calls++; }, markerClaimed: true, localOrigin: () => null, signal: new AbortController().signal });
    const request = init(), body = JSON.parse(request.body); mutate(body); request.body = JSON.stringify(body);
    await assert.rejects(guard.fetch(LIVE_SCOPE.nativeUrl, request));
  }
  const guard = createLiveFetchGuard({ delegate: async () => { calls++; }, markerClaimed: true, localOrigin: () => null, signal: new AbortController().signal });
  await assert.rejects(guard.fetch('http://127.0.0.1:3425/v1/models?kind=all'));
  await assert.rejects(guard.fetch('https://mimo.mi.com/v1/chat/completions', init()));
  const wrongAuth = init(); wrongAuth.headers.Authorization = 'Bearer synthetic-unapproved-key';
  await assert.rejects(guard.fetch(LIVE_SCOPE.nativeUrl, wrongAuth)); assert.equal(calls, 0);
});

test('single consumer GET cannot be replayed, and the native deadline signal aborts its real delegation', async () => {
  let calls = 0, delegatedSignal;
  const abort = new AbortController();
  const guard = createLiveFetchGuard({ delegate: async (_url, options) => { calls++; delegatedSignal = options.signal; return new Response('controlled'); },
    markerClaimed: true, localOrigin: () => 'http://127.0.0.1:12345', signal: abort.signal });
  const audio = 'http://127.0.0.1:12345/api/speech/utterances/test/segments/0/audio?clientId=synthetic';
  await guard.fetch(audio, { method: 'GET' }); await assert.rejects(guard.fetch(audio, { method: 'GET' }));
  assert.equal(calls, 1);
  await guard.fetch(LIVE_SCOPE.nativeUrl, init()); assert.equal(calls, 2); assert.equal(delegatedSignal.aborted, false);
  abort.abort(); assert.equal(delegatedSignal.aborted, true);
});

test('private WAV header is bounded PCM16/24k/mono and rejects odd/over-budget promotion', () => {
  const header = wavHeader(9600); assert.equal(header.length, 44);
  assert.equal(header.toString('ascii', 0, 4), 'RIFF'); assert.equal(header.readUInt16LE(22), 1);
  assert.equal(header.readUInt32LE(24), 24000); assert.equal(header.readUInt16LE(34), 16); assert.equal(header.readUInt32LE(40), 9600);
  assert.throws(() => wavHeader(3)); assert.throws(() => wavHeader(1048578));
});

test('post-marker/report failures stay attempted-unknown with safe counts and actual report writer works', async () => {
  const facts = { claimed: true, marker: '/synthetic/marker.json', stats: { nativeDelegations: 1 }, cleanup: { service: 'closed', remote: 'unknown' } };
  const safe = safeLiveFailure(facts);
  assert.equal(safe.status, 'attempt-failed-or-unknown-no-retry'); assert.equal(safe.nativePosts, 1); assert.equal(safe.attemptMarkerClaimed, true);
  assert.equal(safe.cleanup.service, 'closed'); assert.equal(safe.cleanup.remote, 'unknown');
  assert.equal(await persistLiveReport('/synthetic/no-write.json', {}, async () => { throw new Error('controlled report failure'); }), false);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'speech-live-report-guard-'));
  const filename = path.join(directory, 'report.json'); assert.equal(await persistLiveReport(filename, safe), true);
  assert.deepEqual(JSON.parse(await readFile(filename, 'utf8')), safe);
  assert.equal(safeLiveFailure({ ...facts, claimed: false }, true).status, 'attempt-marker-refused-no-new-request-prior-outcome-unknown');
});

test('describe and missing approval CLI paths exit without product imports, marker creation or network', () => {
  const script = fileURLToPath(new URL('./companion-speech-output-live.mjs', import.meta.url));
  const described = spawnSync(process.execPath, [script, '--describe'], { encoding: 'utf8' });
  assert.equal(described.status, 0); const review = JSON.parse(described.stdout);
  assert.equal(review.status, 'proposal-only-not-authorized-not-run'); assert.equal(review.scopeSha256, LIVE_SCOPE_SHA256);
  const refused = spawnSync(process.execPath, [script], { encoding: 'utf8', env: {} });
  assert.equal(refused.status, 2); assert.equal(JSON.parse(refused.stderr).status, 'not-run-approval-required');
  const noLoader = spawnSync(process.execPath, [script, ...args()], { encoding: 'utf8', env: {
    PET_SPEECH_LIVE_SCOPE_SHA256: LIVE_SCOPE_SHA256, PET_SPEECH_LIVE_SCRIPT_SHA256: review.scriptSha256 } });
  assert.equal(noLoader.status, 2); assert.equal(JSON.parse(noLoader.stderr).status, 'not-run-approval-required');
});
