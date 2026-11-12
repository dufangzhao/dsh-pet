import { mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  SPEECH_SERVICE_PLUGIN_ID,
  SPEECH_TTS_PLUGIN_ID,
  SPEECH_TTS_PROVIDER,
  SPEECH_PLAN_TIMEOUT_MS,
  SPEECH_ATTACH_TIMEOUT_MS,
  SPEECH_NEXT_SEGMENT_GRACE_MS,
  type Result,
  type SpeechBegin,
  type SpeechSegmentKey,
} from '@pet/contracts';
import {
  beginSpeechUtterance,
  cancelSpeechUtterance,
  consumeSpeechAudio,
  getSpeech,
  getSpeechCatalog,
  getSpeechUtterance,
  reserveSpeechSegment,
  saveSpeechProvider,
  writeSpeechCredential,
} from '@pet/text-client/protocol';
import { createCompanionService, type CompanionService } from './service.js';
import { SPEECH_TTS_USER_AGENT } from './speech-client.js';
import { SpeechController } from './speech-controller.js';
import type { SharedSpeechPorts, SpeechSynthesisOperation } from '@pet/companion-runtime';

interface Peer {
  baseUrl: string;
  snapshot: {
    requestCount: number;
    catalogCount: number;
    rejectedCount: number;
    openSockets: number;
    pendingHandlers: number;
    requests: Array<{ textSha256: string; pcmBytesWritten: number }>;
  };
  firstRequest: Promise<unknown>;
  beforeTerminal: Promise<unknown>;
  firstResponseAborted: Promise<unknown>;
  releaseTerminal(): void;
  close(): Promise<unknown>;
}
const fixtureUrl = new URL(
  '../../../qa/fixtures/companion-speech-output/controlled-magpie.mjs',
  import.meta.url,
).href;
const fixtures = (await import(/* @vite-ignore */ fixtureUrl)) as {
  startControlledSpeechMagpie(input: Record<string, unknown>): Promise<Peer>;
};
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanups.splice(0).reverse()) await close();
});
const unwrap = <T>(result: Result<T>): T => {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
};
const deferred = () => {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
async function setup(options: Record<string, unknown> = {}) {
  const peer = await fixtures.startControlledSpeechMagpie({
    expectedUserAgent: SPEECH_TTS_USER_AGENT,
    expectedAuthorization: 'Bearer magpie-dsh-pet',
    voice: 'Mia',
    frames: 9600,
    pcmChunkBytes: 4801,
    ...options,
  });
  const directory = await mkdtemp(path.join(tmpdir(), 'companion-speech-test-'));
  const service: { current?: CompanionService } = {};
  cleanups.push(async () => {
    if (
      path.dirname(directory) !== tmpdir() ||
      !path.basename(directory).startsWith('companion-speech-test-')
    )
      throw new Error('Unexpected speech fixture root');
    try {
      await service.current?.close();
    } finally {
      await peer.close();
      await rm(directory, { recursive: true });
    }
  });
  service.current = await createCompanionService({
    dataDirectory: directory,
    token: 'controlled-speech-service-token-123456',
  });
  const active = service.current;
  const transport = { baseUrl: active.url, token: 'controlled-speech-service-token-123456' };
  const configure = async (
    modelRef = 'xiaomi/mimo-v2.5-tts',
    authMode: 'local-client-id' | 'gateway-key' = 'local-client-id',
  ) => {
    const view = unwrap(await getSpeech(transport));
    const provider = view.providers[0];
    if (!provider) throw new Error('No speech provider');
    return unwrap(
      await saveSpeechProvider(transport, {
        providerRef: SPEECH_TTS_PROVIDER,
        expectedRevision: provider.configRevision,
        settings: {
          baseUrl: peer.baseUrl,
          modelRef,
          authMode,
          protocol: 'mimo-native-pcm16-sse',
          voice: 'Mia',
        },
      }),
    );
  };
  let number = 0;
  const begin = async (text = ' 正式回复🌳。\r\n保留空白。 ', clientId = 'speech-client') => {
    const before = await active.runtime.snapshot();
    const message = await active.runtime.state('appendMessage', {
      id: `tts-message-${++number}`,
      role: 'assistant',
      text,
    });
    const events = await active.runtime.events(before.cursor, before.epoch);
    const event = events.events.find(
      (event) => event.kind === 'message' && event.data['messageId'] === message.id,
    );
    const view = unwrap(await getSpeech(transport));
    const provider = view.providers[0];
    if (!event || !provider?.bindingId) throw new Error('No canonical event/provider binding');
    const input: SpeechBegin = {
      utteranceId: `utterance-${number}`,
      clientId,
      agentId: before.agent.id,
      serviceEpoch: before.epoch,
      messageId: message.id,
      eventSequence: event.sequence,
      expectedFeatureRevision: view.feature.configRevision,
      volume: 85,
      providerRef: SPEECH_TTS_PROVIDER,
      bindingId: provider.bindingId,
    };
    return { input, receipt: unwrap(await beginSpeechUtterance(transport, input)) };
  };
  const reserve = async (
    receipt: Awaited<ReturnType<typeof begin>>['receipt'],
    segmentIndex = 0,
  ): Promise<SpeechSegmentKey> => {
    const key = {
      utteranceId: receipt.utteranceId,
      clientId: receipt.clientId,
      agentId: receipt.agentId,
      serviceEpoch: receipt.serviceEpoch,
      utteranceBindingId: receipt.utteranceBindingId,
      segmentIndex,
      requestId: `${receipt.utteranceId}-part-${segmentIndex}`,
    };
    unwrap(await reserveSpeechSegment(transport, key));
    return key;
  };
  return { peer, service: active, transport, configure, begin, reserve };
}

it.each(['plan', 'attach', 'next-segment'] as const)(
  'releases orphan %s native lifetime tasks and both leases without a status/cancel request',
  async (stage) => {
    const f = await setup({ frames: 4, pcmChunkBytes: 8, fragments: [65536] });
    await f.configure();
    const baselineTasks = f.service.host.tasks.diagnostics().pendingWork;
    const baselineLeases = f.service.host.permissions.diagnostics().leases;
    const budget =
      stage === 'plan'
        ? SPEECH_PLAN_TIMEOUT_MS
        : stage === 'attach'
          ? SPEECH_ATTACH_TIMEOUT_MS
          : SPEECH_NEXT_SEGMENT_GRACE_MS + 1;
    const originalTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, ms, ...args) =>
      originalTimeout(callback, ms === budget ? 500 : ms, ...args),
    );
    const { receipt } = await f.begin(
      stage === 'next-segment' ? '甲'.repeat(4000) + '乙'.repeat(2000) : 'orphan',
    );
    if (stage !== 'plan') {
      const key = await f.reserve(receipt);
      if (stage === 'next-segment')
        unwrap(
          await consumeSpeechAudio(f.transport, key, receipt, async (_header, audio) => {
            for await (const chunk of audio) expect(chunk.length).toBeGreaterThan(0);
          }),
        );
    }
    expect(f.service.host.tasks.diagnostics().pendingWork).toBeGreaterThan(baselineTasks);
    expect(f.service.host.permissions.diagnostics().leases).toBe(baselineLeases + 2);
    // These diagnostics do not call the feature, so only its actual watchdog/settled notification can release authority.
    await vi.waitFor(
      () => {
        expect(f.service.host.tasks.diagnostics().pendingWork).toBe(baselineTasks);
        expect(f.service.host.permissions.diagnostics().leases).toBe(baselineLeases);
      },
      { timeout: 4000, interval: 20 },
    );
    expect(f.peer.snapshot.requestCount).toBe(stage === 'next-segment' ? 1 : 0);
  },
  20000,
);

it('late old terminal callbacks cannot release a replacement logical lifetime', async () => {
  const callbacks: SharedSpeechPorts['settled'][] = [];
  const original = SpeechController.prototype.featurePorts;
  vi.spyOn(SpeechController.prototype, 'featurePorts').mockImplementation(function (
    this: SpeechController,
    context,
  ) {
    const ports = original.call(this, context);
    callbacks.push(ports.settled);
    return ports;
  });
  const f = await setup();
  await f.configure();
  const { input, receipt: oldReceipt } = await f.begin();
  await f.service.host.setEnabled(SPEECH_SERVICE_PLUGIN_ID, false);
  await f.service.host.setEnabled(SPEECH_SERVICE_PLUGIN_ID, true);
  const view = unwrap(await getSpeech(f.transport));
  const bindingId = view.providers[0]?.bindingId;
  if (!bindingId) throw new Error('No replacement binding');
  const currentReceipt = unwrap(
    await beginSpeechUtterance(f.transport, {
      ...input,
      bindingId,
      expectedFeatureRevision: view.feature.configRevision,
    }),
  );
  expect(currentReceipt.utteranceBindingId).not.toBe(oldReceipt.utteranceBindingId);
  const pending = f.service.host.tasks.diagnostics().pendingWork;
  const leases = f.service.host.permissions.diagnostics().leases;
  for (const callback of callbacks) callback(oldReceipt);
  await Promise.resolve();
  await Promise.resolve();
  expect(f.service.host.tasks.diagnostics().pendingWork).toBe(pending);
  expect(f.service.host.permissions.diagnostics().leases).toBe(leases);
  unwrap(await cancelSpeechUtterance(f.transport, currentReceipt));
}, 20000);

it('retains verified native produced progress ahead of a gated HTTP consumer on partial failure', async () => {
  const f = await setup({
    mode: 'length',
    holdTerminal: true,
    frames: 9600,
    pcmChunkBytes: 4800,
    fragments: [65536],
  });
  await f.configure();
  const original = f.service.speech.providers.synthesize.bind(f.service.speech.providers);
  let operation: SpeechSynthesisOperation | undefined;
  vi.spyOn(f.service.speech.providers, 'synthesize').mockImplementation(async (...args) => {
    const value = await original(...args);
    operation = value;
    return value;
  });
  const { receipt } = await f.begin();
  const key = await f.reserve(receipt);
  const first = deferred(),
    release = deferred();
  const work = f.service.speech
    .audio(key, new AbortController().signal, async (consumer) => {
      let blocked = false;
      for await (const chunk of consumer.audio) {
        expect(chunk.length).toBeGreaterThan(0);
        if (!blocked) {
          blocked = true;
          first.resolve();
          await release.promise;
        }
      }
    })
    .then(
      () => null,
      (error: unknown) => error,
    );
  try {
    await first.promise;
    await f.peer.beforeTerminal;
    await vi.waitFor(async () => {
      const status = unwrap(await getSpeechUtterance(f.transport, receipt));
      expect(status.currentSegment?.producedFrames).toBe(9600);
      expect(status.currentSegment?.drainedFrames).toBe(2400);
    });
    f.peer.releaseTerminal();
    if (!operation) throw new Error('No owned synthesis operation');
    await operation.settled;
    release.resolve();
    // The immediate transport failure is generic; the verified native reason is read below.
    expect(await work).toMatchObject({ error: { code: 'unavailable' } });
    const status = unwrap(await getSpeechUtterance(f.transport, receipt));
    expect(status).toMatchObject({
      outcome: 'failed',
      cleanup: 'settled',
      reason: 'partial-output',
      currentSegment: {
        producedFrames: 9600,
        drainedFrames: 2400,
        terminal: {
          outcome: 'failed',
          finishReason: 'length',
          producedBytes: 19200,
          drainedBytes: 4800,
        },
      },
    });
    expect(f.peer.snapshot.requestCount).toBe(1);
  } finally {
    f.peer.releaseTerminal();
    release.resolve();
    await work;
  }
}, 20000);

it('keeps TTS key CAS and full-path target ownership independent without leaking credentials', async () => {
  const secret = 'synthetic-tts-only-key-"quoted"-\\value';
  const f = await setup({
    expectedAuthorization: `Bearer ${secret}`,
    frames: 4,
    fragments: [65536],
  });
  const configured = await f.configure('xiaomi/mimo-v2.5-tts', 'gateway-key');
  const before = configured.providers[0];
  if (!before) throw new Error('No TTS provider');
  expect(before.credential.available).toBe(false);
  const command = {
    providerRef: before.providerRef,
    expectedRevision: before.configRevision,
    expectedCredentialVersion: before.credential.version,
    value: secret,
  };
  const saved = unwrap(await writeSpeechCredential(f.transport, command));
  const provider = saved.providers[0];
  if (!provider) throw new Error('No saved TTS provider');
  expect(provider.credential.available).toBe(true);
  expect(provider.credential.version).not.toBe(before.credential.version);
  expect((await writeSpeechCredential(f.transport, command)).ok).toBe(false);
  expect(JSON.stringify(saved)).not.toContain(secret);
  expect(f.peer.snapshot.requestCount).toBe(0);
  const { receipt } = await f.begin();
  const key = await f.reserve(receipt);
  unwrap(
    await consumeSpeechAudio(f.transport, key, receipt, async (_header, audio) => {
      for await (const chunk of audio) expect(chunk.length).toBeGreaterThan(0);
    }),
  );
  expect(f.peer.snapshot.requestCount).toBe(1);
  const current = unwrap(await getSpeech(f.transport)).providers[0];
  if (!current) throw new Error('No current provider');
  const retargeted = unwrap(
    await saveSpeechProvider(f.transport, {
      providerRef: current.providerRef,
      expectedRevision: current.configRevision,
      settings: { ...current.settings, baseUrl: `${f.peer.baseUrl}/alternate` },
    }),
  );
  expect(retargeted.providers[0]?.credential.available).toBe(false);
  expect(retargeted.providers[0]?.credential.version).not.toBe(current.credential.version);
  expect(JSON.stringify(await f.service.runtime.snapshot())).not.toContain(secret);
}, 20000);

it('scopes remote bindings to real service-feature generations and rejects stale metadata without inference', async () => {
  const f = await setup({ frames: 4, fragments: [65536] });
  await f.configure();
  const { input } = await f.begin();
  const old = unwrap(await getSpeech(f.transport));
  await f.service.host.setEnabled(SPEECH_SERVICE_PLUGIN_ID, false);
  const disabled = unwrap(await getSpeech(f.transport));
  expect(disabled.feature.source).toBe('disabled');
  expect(f.service.host.isEnabled(SPEECH_TTS_PLUGIN_ID)).toBe(true);
  await f.service.host.setEnabled(SPEECH_SERVICE_PLUGIN_ID, true);
  const enabled = unwrap(await getSpeech(f.transport));
  expect(enabled.feature.configRevision).toBe(old.feature.configRevision);
  expect(enabled.providers[0]?.bindingId).not.toBe(old.providers[0]?.bindingId);
  expect(
    (await beginSpeechUtterance(f.transport, { ...input, utteranceId: 'stale-feature' })).ok,
  ).toBe(false);
  expect(f.peer.snapshot.requestCount).toBe(0);
}, 20000);

it('provider policy withdrawal aborts and joins the owned native socket without stopping text', async () => {
  const f = await setup({ holdFirst: true });
  await f.configure();
  const { receipt } = await f.begin();
  const key = await f.reserve(receipt);
  const before = await f.service.runtime.snapshot();
  const download = consumeSpeechAudio(f.transport, key, receipt, async (_header, audio) => {
    for await (const chunk of audio) expect(chunk.byteLength).toBeGreaterThan(0);
  });
  await f.peer.firstRequest;
  f.service.host.permissionControl.setPreset(
    { pluginId: SPEECH_TTS_PLUGIN_ID, instanceId: 'default' },
    'deny',
  );
  expect((await download).ok).toBe(false);
  await f.peer.firstResponseAborted;
  expect((await f.service.runtime.snapshot()).agent.id).toBe(before.agent.id);
  expect(unwrap(await getSpeech(f.transport)).providers[0]?.source).toBe('unavailable');
}, 20000);

it('configures actual independent service sources without inference and excludes design/ASR', async () => {
  const f = await setup();
  expect(f.peer.snapshot.requestCount).toBe(0);
  const view = await f.configure('');
  expect(view.feature.sourcePluginId).toBe(SPEECH_SERVICE_PLUGIN_ID);
  expect(view.feature.source).toBe('ready');
  expect(f.service.host.isEnabled(SPEECH_TTS_PLUGIN_ID)).toBe(true);
  expect(f.peer.snapshot.requestCount).toBe(0);
  const provider = view.providers[0];
  if (!provider?.bindingId) throw new Error('No catalog binding');
  const catalog = unwrap(
    await getSpeechCatalog(f.transport, {
      providerRef: provider.providerRef,
      bindingId: provider.bindingId,
    }),
  );
  expect(catalog.candidates.find((p) => p.modelRef === 'xiaomi/mimo-v2.5-tts')?.selectable).toBe(
    true,
  );
  expect(catalog.candidates.filter((p) => p.selectable)).toHaveLength(1);
  expect(catalog.candidates.every((p) => !p.modelRef.includes('asr'))).toBe(true);
  expect(f.peer.snapshot.catalogCount).toBe(1);
  expect(f.peer.snapshot.requestCount).toBe(0);
}, 20000);

it('streams owned TaskMediaPeer PCM before native completion and publishes terminal before HTTP EOF', async () => {
  const text = ' 正式回复🌳。\r\n保留空白。 ';
  const f = await setup({ holdTerminal: true, expectedText: text });
  await f.configure();
  await f.service.host.setEnabled('pet.shared-voice', false);
  await f.service.host.setEnabled('pet.asr-magpie', false);
  const { input, receipt } = await f.begin(text);
  const key = await f.reserve(receipt);
  expect(f.peer.snapshot.requestCount).toBe(0);
  const first = deferred();
  let bytes = 0;
  const download = consumeSpeechAudio(f.transport, key, receipt, async (_header, audio) => {
    for await (const chunk of audio) {
      bytes += chunk.byteLength;
      first.resolve();
    }
  });
  await first.promise;
  const during = unwrap(await getSpeechUtterance(f.transport, receipt));
  expect(during.currentSegment?.nativeSettled).toBe(false);
  expect(during.outcome).toBe('pending');
  f.peer.releaseTerminal();
  const consumed = unwrap(await download);
  expect(consumed.receivedBytes).toBe(19200);
  expect(bytes).toBe(19200);
  const status = unwrap(await getSpeechUtterance(f.transport, receipt));
  expect(status).toMatchObject({
    outcome: 'completed',
    cleanup: 'settled',
    deliveredThrough: 0,
    currentSegment: {
      terminal: {
        outcome: 'completed',
        finishReason: 'stop',
        nativeSettled: true,
        producedFrames: 9600,
        drainedFrames: 9600,
        transportCleanup: 'settled',
      },
    },
  });
  expect(f.peer.snapshot.requestCount).toBe(1);
  expect((await consumeSpeechAudio(f.transport, key, receipt, async () => {})).ok).toBe(false);
  expect(unwrap(await beginSpeechUtterance(f.transport, input))).toEqual(receipt);
  expect(f.peer.snapshot.requestCount).toBe(1);
}, 20000);

it('streams more than the old whole-buffer cap without a new native attempt', async () => {
  const f = await setup({ frames: 1_100_003, pcmChunkBytes: 8193, fragments: [65536] });
  await f.configure();
  const { receipt } = await f.begin();
  const key = await f.reserve(receipt);
  let max = 0;
  const read = unwrap(
    await consumeSpeechAudio(f.transport, key, receipt, async (_header, audio) => {
      for await (const chunk of audio) max = Math.max(max, chunk.byteLength);
    }),
  );
  expect(read.receivedBytes).toBe(2_200_006);
  expect(max).toBeLessThanOrEqual(256 * 1024);
  expect(
    unwrap(await getSpeechUtterance(f.transport, receipt)).currentSegment?.terminal?.outcome,
  ).toBe('completed');
  expect(f.peer.snapshot.requestCount).toBe(1);
}, 20000);

it('delivers all canonical long reply slices in order with cumulative audio above the old cap', async () => {
  const f = await setup({ frames: 400_003, pcmChunkBytes: 8193, fragments: [65536] });
  await f.configure();
  const sourceParts = ['甲'.repeat(2000) + '。', '乙'.repeat(2000) + '。', '尾'.repeat(2000)];
  const { receipt } = await f.begin(sourceParts.join(''));
  expect(receipt.segmentCount).toBe(3);
  let bytes = 0;
  for (let index = 0; index < receipt.segmentCount; index++) {
    const key = await f.reserve(receipt, index);
    const part = unwrap(
      await consumeSpeechAudio(f.transport, key, receipt, async (_header, audio) => {
        for await (const chunk of audio) expect(chunk.byteLength).toBeGreaterThan(0);
      }),
    );
    bytes += part.receivedBytes;
    const status = unwrap(await getSpeechUtterance(f.transport, receipt));
    expect(status.deliveredThrough).toBe(index);
    expect(status.outcome).toBe(index === 2 ? 'completed' : 'pending');
  }
  expect(bytes).toBe(2_400_018);
  expect(f.peer.snapshot.requestCount).toBe(3);
  expect(f.peer.snapshot.requests.map((request) => request.textSha256)).toEqual(
    sourceParts.map((text) => createHash('sha256').update(text).digest('hex')),
  );
}, 20000);

it('preserves canonical long reply segments and whole cancellation prevents the next model call', async () => {
  const f = await setup({ frames: 4, fragments: [65536] });
  await f.configure();
  const text = '开'.repeat(2000) + '。' + '中'.repeat(2000) + '。' + '尾'.repeat(2000);
  const { receipt } = await f.begin(text);
  expect(receipt.segmentCount).toBeGreaterThan(1);
  const first = await f.reserve(receipt);
  unwrap(
    await consumeSpeechAudio(f.transport, first, receipt, async (_header, audio) => {
      for await (const chunk of audio) expect(chunk.length).toBeGreaterThan(0);
    }),
  );
  await f.reserve(receipt, 1);
  expect(unwrap(await cancelSpeechUtterance(f.transport, receipt))).toMatchObject({
    outcome: 'cancelled',
    cleanup: 'settled',
    deliveredThrough: 0,
  });
  expect(
    (
      await reserveSpeechSegment(f.transport, {
        ...first,
        segmentIndex: 2,
        requestId: 'future-part',
      })
    ).ok,
  ).toBe(false);
  expect(f.peer.snapshot.requestCount).toBe(1);
}, 20000);

it.each([
  'length',
  'content-filter',
  'eof',
  'odd-tail',
  'invalid-base64',
  'audio-after-stop',
  'nonstream-json',
  'done-without-stop',
  'zero-audio',
  'usage-only',
  'truncated-event',
  'error-event',
  'oversized-event',
  'decoded-oversize',
  'auth',
  'forbidden',
  'rate-limited',
])(
  'keeps %s incomplete with actual cleanup and no replay',
  async (mode) => {
    const f = await setup({ mode, frames: 8, fragments: [65536] });
    await f.configure();
    const { receipt } = await f.begin();
    const key = await f.reserve(receipt);
    const result = await consumeSpeechAudio(f.transport, key, receipt, async (_header, audio) => {
      for await (const chunk of audio) expect(chunk.length).toBeGreaterThan(0);
    });
    expect(result.ok).toBe(false);
    const status = unwrap(await getSpeechUtterance(f.transport, receipt));
    expect(status.outcome).toBe('failed');
    expect(status.cleanup).toBe('settled');
    if (mode === 'length' || mode === 'content-filter')
      expect(status.currentSegment?.terminal?.finishReason).toBe(
        mode === 'length' ? 'length' : 'content_filter',
      );
    expect(f.peer.snapshot.requestCount).toBe(1);
  },
  20000,
);

it('fences cancel before admission and rejects wrong canonical role/target without native work', async () => {
  const f = await setup();
  await f.configure();
  const snapshot = await f.service.runtime.snapshot();
  const key = {
    utteranceId: 'cancel-before',
    clientId: 'client',
    agentId: snapshot.agent.id,
    serviceEpoch: snapshot.epoch,
  };
  expect(unwrap(await cancelSpeechUtterance(f.transport, key))).toMatchObject({
    outcome: 'cancelled',
    receipt: null,
  });
  const { input } = await f.begin();
  expect((await beginSpeechUtterance(f.transport, { ...input, ...key })).ok).toBe(false);
  expect(
    (
      await beginSpeechUtterance(f.transport, {
        ...input,
        utteranceId: 'wrong-target',
        agentId: 'other-agent',
      })
    ).ok,
  ).toBe(false);
  expect(f.peer.snapshot.requestCount).toBe(0);
  await cancelSpeechUtterance(f.transport, input);
}, 20000);

it('cancels and joins a live held native response without touching Core identity', async () => {
  const f = await setup({ holdTerminal: true, frames: 9600 });
  await f.configure();
  const { receipt } = await f.begin();
  const key = await f.reserve(receipt);
  const first = deferred();
  const download = consumeSpeechAudio(f.transport, key, receipt, async (_header, audio) => {
    for await (const chunk of audio) {
      expect(chunk.length).toBeGreaterThan(0);
      first.resolve();
    }
  });
  await first.promise;
  const before = await f.service.runtime.snapshot();
  const cancelled = unwrap(await cancelSpeechUtterance(f.transport, receipt));
  expect(cancelled).toMatchObject({ outcome: 'cancelled', cleanup: 'settled' });
  expect((await download).ok).toBe(false);
  await f.peer.firstResponseAborted;
  expect((await f.service.runtime.snapshot()).agent.id).toBe(before.agent.id);
  expect(f.peer.snapshot.requestCount).toBe(1);
}, 20000);
