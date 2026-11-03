/* eslint-disable @typescript-eslint/no-require-imports -- This Electron Node worker uses native CommonJS bindings. */
'use strict';
const path = require('node:path');
const sherpa = require('sherpa-onnx-node');
const { verifyLocalModel } = require('./model-store.ts');
const { sapiRecognize } = require('./sapi.ts');
const { StreamingAsrSession } = require('./stream-session.ts');
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
  if (job?.id === id) {
    job.abort.abort();
    job = undefined;
  }
  if (partialAck?.id === id) {
    const ack = partialAck;
    partialAck = undefined;
    ack.resolve();
  }
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
async function accept(current, message) {
  current.processing = true;
  try {
    if (message.op === 'finish') {
      if (message.frames !== current.sequence || message.samples !== current.session.sampleCount)
        throw new Error('asr-failed');
      const text = await current.session.finish();
      if (job !== current) return;
      job = undefined;
      send({ kind: 'result', id: current.id, ok: true, modelId, text });
      return;
    }
    const bytes = message.payload;
    if (
      !(bytes instanceof Uint8Array) ||
      bytes.byteLength < 4 ||
      bytes.byteLength > 6400 ||
      bytes.byteLength % 4 ||
      message.sequence !== current.sequence
    )
      throw new Error('asr-failed');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      samples = new Float32Array(bytes.byteLength / 4);
    for (let i = 0; i < samples.length; i++) samples[i] = view.getFloat32(i * 4, true);
    await current.session.push(samples);
    if (job !== current) return;
    send({ kind: 'pcm-ack', id: current.id, sequence: current.sequence++ });
  } catch {
    fail(current.id, 'asr-failed');
  } finally {
    current.processing = false;
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
    if (loading || job || (!recognizer && modelId !== 'windows-sapi'))
      return fail(message.id, 'asr-failed');
    const current = {
      id: message.id,
      sequence: 0,
      partial: 0,
      processing: false,
      abort: new AbortController(),
      session: null,
    };
    current.session = new StreamingAsrSession(
      modelId,
      recognizer,
      async (text) => {
        await new Promise((resolve) => {
          partialAck = { id: current.id, sequence: current.partial, resolve };
          send({ kind: 'partial', id: current.id, sequence: current.partial++, text });
        });
      },
      (samples) => sapiRecognize(samples, AbortSignal.any([lifetime.signal, current.abort.signal])),
    );
    job = current;
    return;
  }
  if (!job || message.id !== job.id || !['pcm', 'finish'].includes(message.op)) return;
  if (job.processing) return fail(message.id, 'asr-failed');
  void accept(job, message);
});
process.on('disconnect', () => {
  lifetime.abort();
  process.exit(0);
});
