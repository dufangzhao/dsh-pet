import * as fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { decodePcm16Wave } from '../../packages/host-kernel/src/experiments/wave-pcm.js';
const root = path.resolve(__dirname, '../..');
void (async () => {
  const plugin = (
    await import(pathToFileURL(path.join(root, 'plugins/asr-local/dist/index.mjs')).href)
  ).default;
  let methods: Record<string, (task: any, input: any) => Promise<any>> = {};
  const cleanup: Array<() => void | Promise<void>> = [];
  let samples = new Float32Array();
  let partials: string[] = [];
  const lifetime = new AbortController();
  process.once('disconnect', () => {
    lifetime.abort();
    for (const dispose of cleanup) void dispose();
  });
  await plugin.activate({
    owner: { pluginId: 'pet.asr-local', instanceId: 'default', generation: 1 },
    signal: lifetime.signal,
    config: {},
    provide(_id: string, value: typeof methods) {
      methods = value;
    },
    contribute() {},
    effect(factory: () => () => void | Promise<void>) {
      cleanup.push(factory());
    },
    host: {
      version: 1,
      config: { get: async () => ({ ok: false }) },
      capabilities: { invoke: async () => ({ ok: false }) },
      media: {
        async openInput() {
          return {
            ok: true,
            value: {
              reference: {},
              cancel() {},
              async *[Symbol.asyncIterator]() {
                for (let i = 0; i < samples.length; i += 1600)
                  yield new Uint8Array(new Float32Array(samples.subarray(i, i + 1600)).buffer);
              },
            },
          };
        },
        async openOutput() {
          return {
            ok: true,
            value: {
              reference: {},
              async write(bytes: Uint8Array) {
                partials.push(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
                return { ok: true, value: null };
              },
              async end() {
                return { ok: true, value: null };
              },
              cancel() {},
            },
          };
        },
      },
    },
  });
  const inventory = JSON.parse(fs.readFileSync(path.join(root, 'qa/M0-asr-fixtures.json'), 'utf8'));
  const reports = [];
  try {
    for (const [id, name] of [
      ['sensevoice-small-int8', 'test_wavs/zh.wav'],
      ['streaming-paraformer-zh-en-int8', 'test_wavs/0.wav'],
    ]) {
      const model = inventory.models.find((item: any) => item.id === id),
        file = model.files.find((item: any) => item.path === name);
      const raw = fs.readFileSync(path.join(root, '.cache/asr-models', id!, name!));
      const hash = createHash('sha1')
        .update(Buffer.from('blob ' + raw.byteLength + String.fromCharCode(0)))
        .update(raw)
        .digest('hex');
      if (hash !== file.gitBlobSha1) throw new Error('Public fixture changed');
      samples = decodePcm16Wave(raw).samples;
      partials = [];
      const started = performance.now(),
        controller = new AbortController(),
        task = {
          taskId: 'probe-' + id,
          signal: AbortSignal.any([controller.signal, lifetime.signal]),
        };
      const prepared = await methods['prepare']!(task, { model: id });
      if (prepared.errorCode) throw new Error(prepared.errorCode);
      const readyMs = performance.now() - started;
      const transcript = await methods['transcribe']!(task, { model: id });
      if (transcript.errorCode || !transcript.text?.trim())
        throw new Error('Product recognition failed');
      reports.push({
        modelId: id,
        modelPrepared: prepared.modelId === id,
        audioSeconds: samples.length / 16000,
        readyMs,
        totalMs: performance.now() - started,
        characters: [...transcript.text].length,
        transcriptSha256: createHash('sha256').update(transcript.text).digest('hex'),
        partialFrames: partials.length,
        finalMatches: partials.at(-1) === transcript.text,
      });
    }
  } finally {
    lifetime.abort();
    for (const dispose of cleanup) await dispose();
  }
  process.send?.({
    status: 'passed',
    runtime: { electron: process.versions.electron, node: process.versions.node },
    reports,
    closed: true,
  });
})()
  .catch((error) => {
    process.send?.({ status: 'failed', failure: String(error?.message ?? 'failed') });
    process.exitCode = 1;
  })
  .finally(() => {
    if (process.connected) process.disconnect();
  });
