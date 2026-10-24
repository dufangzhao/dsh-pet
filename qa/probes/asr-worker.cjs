'use strict';
// M0 compatibility probe; public fixtures only, no microphone, network or transcript logging.
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHash } = require('node:crypto');
const sherpa = require('sherpa-onnx-node');
const root = path.resolve(__dirname, '../..');
const modelId = process.argv[2];
const allowed = ['sensevoice-small-int8', 'streaming-paraformer-zh-en-int8'];
const round = value => Math.round(value * 100) / 100;

(async () => {
  assert.ok(allowed.includes(modelId), 'unsupported M0 model');
  assert.equal(process.versions.electron, '45.0.0');
  const { runDownload } = await import('./asr-download.mjs');
  const { decodePcm16Wave } = await import('../../packages/host-kernel/dist/m0/wave-pcm.mjs');
  const { receipt } = await runDownload({ only: modelId, checkOnly: true,
    fetchImpl: async () => { throw new Error('M0 inference must not use network'); } });
  assert.equal(receipt.ok, true, 'all model files must pass their fixed hashes before loading');
  process.send({ type: 'm0.stage', stage: 'hashes-verified' });
  const dir = path.join(root, '.cache/asr-models', modelId);
  const modelConfig = { tokens: path.join(dir, 'tokens.txt'), numThreads: 2, provider: 'cpu', debug: 0 };
  const offline = modelId === 'sensevoice-small-int8';
  const started = performance.now();
  const recognizer = offline
    ? new sherpa.OfflineRecognizer({ featConfig: { sampleRate: 16000, featureDim: 80 }, modelConfig: {
      ...modelConfig, senseVoice: { model: path.join(dir, 'model.int8.onnx'), language: 'auto', useInverseTextNormalization: 1 },
    } })
    : new sherpa.OnlineRecognizer({ featConfig: { sampleRate: 16000, featureDim: 80 }, modelConfig: {
      ...modelConfig, paraformer: { encoder: path.join(dir, 'encoder.int8.onnx'), decoder: path.join(dir, 'decoder.int8.onnx') },
    }, decodingMethod: 'greedy_search', enableEndpoint: false });
  const loadMs = round(performance.now() - started);
  process.send({ type: 'm0.stage', stage: 'recognizer-created' });
  const samples = [];
  const files = offline ? ['test_wavs/zh.wav', 'test_wavs/en.wav'] : ['test_wavs/0.wav', 'test_wavs/1.wav'];
  for (const file of files) {
    process.send({ type: 'm0.stage', stage: 'before-read-wave' });
    const wave = decodePcm16Wave(require('node:fs').readFileSync(path.join(dir, file)));
    process.send({ type: 'm0.stage', stage: 'wave-read' });
    assert.ok(wave.samples instanceof Float32Array && wave.samples.length > 0);
    assert.equal(wave.sampleRate, 16000);
    const stream = recognizer.createStream();
    const start = performance.now();
    const cpuStart = process.cpuUsage();
    let revisions = 0;
    let last = '';
    let decodes = 0;
    if (offline) {
      stream.acceptWaveform(wave);
      recognizer.decode(stream);
      decodes = 1;
    } else {
      const drain = () => {
        while (recognizer.isReady(stream)) {
          if (++decodes > 10000) throw new Error('decoder exceeded bounded step budget');
          recognizer.decode(stream);
        }
      };
      for (let i = 0; i < wave.samples.length; i += 1600) {
        stream.acceptWaveform({ sampleRate: wave.sampleRate, samples: wave.samples.subarray(i, i + 1600) });
        drain();
        const text = recognizer.getResult(stream).text;
        if (text && text !== last) { last = text; revisions += 1; }
      }
      stream.acceptWaveform({ sampleRate: wave.sampleRate, samples: new Float32Array(8000) });
      stream.inputFinished();
      drain();
    }
    const text = recognizer.getResult(stream).text;
    assert.equal(typeof text, 'string');
    assert.ok(text.trim().length > 0, 'recognizer must produce a nonempty transcript');
    const cpu = process.cpuUsage(cpuStart);
    samples.push({ file, audioSeconds: round(wave.samples.length / wave.sampleRate),
      inferenceMs: round(performance.now() - start), cpuMs: round((cpu.user + cpu.system) / 1000),
      characters: [...text].length, transcriptSha256: createHash('sha256').update(text).digest('hex'),
      nonemptyPartialRevisions: revisions, decodeCalls: decodes, rssMiB: round(process.memoryUsage().rss / 1048576) });
  }
  process.send({ type: 'm0.result', report: { modelId, sherpa: typeof sherpa.version === 'function' ? sherpa.version() : sherpa.version, waveDecoder: 'JS-owned PCM16 mono 16kHz', provider: 'cpu', numThreads: 2,
    processMode: 'Electron RUN_AS_NODE', hashesVerified: receipt.totals.files, loadMs,
    feedMode: offline ? 'whole-file' : '100ms chunks faster-than-real-time; 500ms zero tail', samples } });
})().catch(error => {
  process.send?.({ type: 'm0.error', message: error.message });
  process.exitCode = 1;
}).finally(() => { if (process.connected) process.disconnect(); });
