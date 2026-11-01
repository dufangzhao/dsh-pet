/* eslint-disable @typescript-eslint/no-require-imports -- This Electron Node worker uses native CommonJS bindings. */
'use strict';
const path = require('node:path');
const sherpa = require('sherpa-onnx-node');
const { verifyLocalModel } = require('./model-store.ts');
const { sapiRecognize } = require('./sapi.ts');
const lifetime = new AbortController();
const cache = path.resolve(__dirname, '../../../.cache/asr-models');
let recognizer,
  modelId,
  job,
  loading = false,
  partialAck;
const send = (value) => {
  if (process.connected) process.send(value);
};
const fail = (id, errorCode) => {
  job = undefined;
  send({ kind: 'result', id, ok: false, errorCode });
};
async function load(message) {
  if (loading || job) return fail(message.id, 'asr-failed');
  loading = true;
  try {
    if (message.modelId === 'windows-sapi') {
      await sapiRecognize(null, lifetime.signal);
      recognizer = null;
      modelId = message.modelId;
      send({ kind: 'result', id: message.id, ok: true, modelId });
      return;
    }
    const files = await verifyLocalModel(cache, message.modelId);
    const config = {
      tokens: files['tokens.txt'] ?? files['small-tokens.txt'],
      numThreads: 2,
      provider: 'cpu',
      debug: 0,
    };
    recognizer =
      message.modelId === 'whisper-small-int8'
        ? new sherpa.OfflineRecognizer({
            featConfig: { sampleRate: 16000, featureDim: 80 },
            modelConfig: {
              ...config,
              whisper: {
                encoder: files['small-encoder.int8.onnx'],
                decoder: files['small-decoder.int8.onnx'],
                language: '',
                task: 'transcribe',
                tailPaddings: 1000,
              },
            },
          })
        : message.modelId === 'sensevoice-small-int8'
          ? new sherpa.OfflineRecognizer({
              featConfig: { sampleRate: 16000, featureDim: 80 },
              modelConfig: {
                ...config,
                senseVoice: {
                  model: files['model.int8.onnx'],
                  language: 'auto',
                  useInverseTextNormalization: 1,
                },
              },
            })
          : new sherpa.OnlineRecognizer({
              featConfig: { sampleRate: 16000, featureDim: 80 },
              modelConfig: {
                ...config,
                paraformer: {
                  encoder: files['encoder.int8.onnx'],
                  decoder: files['decoder.int8.onnx'],
                },
              },
              decodingMethod: 'greedy_search',
              enableEndpoint: false,
            });
    modelId = message.modelId;
    send({ kind: 'result', id: message.id, ok: true, modelId, verified: true });
  } catch (error) {
    fail(
      message.id,
      ['model-missing', 'model-integrity', 'not-ready'].includes(error?.message)
        ? error.message
        : 'asr-failed',
    );
  } finally {
    loading = false;
  }
}
async function infer(current) {
  try {
    if (modelId === 'windows-sapi') {
      const text = await sapiRecognize(current.samples, lifetime.signal);
      job = undefined;
      send({ kind: 'result', id: current.id, ok: true, modelId, text });
      return;
    }
    const stream = recognizer.createStream();
    let steps = 0,
      last = '',
      partial = 0;
    if (modelId === 'sensevoice-small-int8' || modelId === 'whisper-small-int8') {
      stream.acceptWaveform({ sampleRate: 16000, samples: current.samples });
      recognizer.decode(stream);
    } else {
      const drain = () => {
        while (recognizer.isReady(stream)) {
          if (++steps > 10000) throw new Error('decode-budget');
          recognizer.decode(stream);
        }
      };
      for (let i = 0; i < current.samples.length; i += 1600) {
        const owned = new Float32Array(current.samples.subarray(i, i + 1600));
        stream.acceptWaveform({ sampleRate: 16000, samples: owned });
        drain();
        const text = recognizer.getResult(stream).text;
        if (text && text !== last) {
          if (typeof text !== 'string' || text.length > 8192) throw new Error('text-budget');
          last = text;
          await new Promise((resolve) => {
            partialAck = { id: current.id, sequence: partial, resolve };
            send({ kind: 'partial', id: current.id, sequence: partial++, text });
          });
        }
      }
      stream.acceptWaveform({ sampleRate: 16000, samples: new Float32Array(8000) });
      stream.inputFinished();
      drain();
    }
    const text = recognizer.getResult(stream).text;
    if (typeof text !== 'string' || text.length > 8192) throw new Error('text-budget');
    job = undefined;
    send({ kind: 'result', id: current.id, ok: true, modelId, text: text.trim() });
  } catch {
    fail(current.id, 'asr-failed');
  }
}
process.on('message', (message) => {
  if (message?.op === 'close') {
    lifetime.abort();
    process.exit(0);
    return;
  }
  if (!message || typeof message.id !== 'string') return;
  if (message.op === 'ack') {
    if (partialAck?.id === message.id && partialAck.sequence === message.sequence) {
      const ack = partialAck;
      partialAck = undefined;
      ack.resolve();
    }
    return;
  }
  if (message.op === 'load') {
    void load(message);
    return;
  }
  if (message.op === 'recognize') {
    if (
      loading ||
      job ||
      (!recognizer && modelId !== 'windows-sapi') ||
      !Number.isSafeInteger(message.samples) ||
      message.samples < 1 ||
      message.samples > 320000
    )
      return fail(message.id, 'asr-failed');
    job = { id: message.id, samples: new Float32Array(message.samples), written: 0, sequence: 0 };
    return;
  }
  if (message.op !== 'pcm' || !job || message.id !== job.id) return;
  const bytes = message.payload;
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength < 4 ||
    bytes.byteLength > 6400 ||
    bytes.byteLength % 4 ||
    message.sequence !== job.sequence++ ||
    job.written + bytes.byteLength / 4 > job.samples.length
  )
    return fail(message.id, 'asr-failed');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < bytes.byteLength / 4; i++) {
    const value = view.getFloat32(i * 4, true);
    if (!Number.isFinite(value) || Math.abs(value) > 1) return fail(message.id, 'asr-failed');
    job.samples[job.written++] = value;
  }
  if (job.written === job.samples.length) void infer(job);
});
process.on('disconnect', () => {
  lifetime.abort();
  process.exit(0);
});
