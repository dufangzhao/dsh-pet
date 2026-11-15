import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createAuthorizedAsrTransport } from './voice-client.js';
import { createMagpieAsrPlugin, parseMagpieAsrSettings } from '@pet/asr-magpie';
import type {
  VoiceView,
  VoiceTicket,
  VoiceCaptureResult,
  Result,
  PluginManifest,
} from '@pet/contracts';
import { createCompanionService, type CompanionService } from './service.js';

function deferred<T = void>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const token = 'isolated-service-voice-test-token-123456';
const ref = 'pet.asr-magpie/magpie';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  try {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  } finally {
    vi.restoreAllMocks();
  }
});
async function fixture(
  handler?: (
    request: IncomingMessage,
    response: ServerResponse,
    body: Record<string, unknown>,
  ) => void,
  alternate = false,
) {
  const requests: Array<{
    path: string;
    method: string;
    headers: IncomingMessage['headers'];
    body: Record<string, unknown>;
  }> = [];
  const peer = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body: unknown = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      const record = body as Record<string, unknown>;
      requests.push({
        path: request.url ?? '',
        method: request.method ?? '',
        headers: request.headers,
        body: record,
      });
      if (handler) {
        handler(request, response, record);
        return;
      }
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify(
          request.method === 'GET'
            ? {
                data: [
                  { id: 'xiaomi/mimo-v2.5-asr' },
                  { id: 'xiaomi/mimo-v2.5-tts' },
                  { id: 'xiaomi/mimo-v2.5-tts-voicedesign' },
                  { id: 'vendor/audio-chat', kind: 'chat', input_modalities: ['audio'] },
                  { id: 'vendor/whisper' },
                ],
              }
            : {
                choices: [{ message: { content: ' fixture transcript ' }, finish_reason: 'stop' }],
              },
        ),
      );
    })().catch(() => response.destroy());
  });
  await new Promise<void>((resolve) => peer.listen(0, '127.0.0.1', resolve));
  const address = peer.address();
  if (!address || typeof address === 'string') throw new Error('peer address');
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  const directory = await mkdtemp(path.join(tmpdir(), 'companion-voice-test-'));
  const service: { current?: CompanionService } = {};
  cleanups.push(async () => {
    if (
      path.dirname(directory) !== tmpdir() ||
      !path.basename(directory).startsWith('companion-voice-test-')
    )
      throw new Error('Unexpected fixture directory');
    try {
      await service.current?.close();
    } finally {
      peer.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        peer.close((error) => (error ? reject(error) : resolve())),
      );
      await rm(directory, { recursive: true });
    }
  });
  const asrDirectory = path.resolve(import.meta.dirname, '../../../plugins/asr-magpie');
  const asrManifest = JSON.parse(
    await readFile(path.join(asrDirectory, 'plugin.json'), 'utf8'),
  ) as PluginManifest;
  service.current = await createCompanionService({
    dataDirectory: directory,
    token,
    ...(alternate
      ? {
          voicePlugins: [
            (portsFor) => ({
              manifest: { ...asrManifest, id: 'pet.asr-alternative' },
              directory: asrDirectory,
              preset: 'allow',
              enabled: true,
              hostCredentials: ['asr-api-key'],
              definition: createMagpieAsrPlugin(portsFor),
              asr: {
                providerId: 'magpie',
                label: 'Synthetic alternate',
                synthetic: true,
                parseConfig: parseMagpieAsrSettings,
              },
            }),
          ],
        }
      : {}),
  });
  const active = service.current;
  async function call<T>(
    route: string,
    body?: unknown,
  ): Promise<{ status: number; result: Result<T> }> {
    const response = await fetch(`${active.url}${route}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
    });
    return { status: response.status, result: (await response.json()) as Result<T> };
  }
  const unwrap = <T>(value: { result: Result<T> }): T => {
    if (!value.result.ok) throw new Error(JSON.stringify(value.result.error));
    return value.result.value;
  };
  async function view() {
    return unwrap(await call<VoiceView>('/api/voice'));
  }
  async function configure(
    modelRef = 'xiaomi/mimo-v2.5-asr',
    authMode: 'local-client-id' | 'gateway-key' = 'local-client-id',
  ) {
    const current = await view(),
      provider = current.providers[0];
    if (!provider) throw new Error('missing provider');
    return unwrap(
      await call<VoiceView>('/api/voice/provider', {
        providerRef: ref,
        expectedRevision: provider.configRevision,
        settings: { baseUrl, modelRef, authMode, protocol: 'mimo-native' },
      }),
    );
  }
  let next = 0;
  async function begin(clientId = 'client-a') {
    const current = await view(),
      snapshot = await active.runtime.snapshot();
    const binding = current.providers[0]?.bindingId;
    if (!binding) throw new Error('missing binding');
    const input = {
      captureId: `capture-${++next}`,
      clientId,
      agentId: snapshot.agent.id,
      expectedFeatureRevision: current.feature.configRevision,
      providerRef: ref,
      bindingId: binding,
      finishMode: current.feature.finishMode,
    };
    return { input, ticket: unwrap(await call<VoiceTicket>('/api/voice/captures', input)) };
  }
  async function upload(ticket: VoiceTicket, samples = 3, bytes?: Uint8Array) {
    const pcm = bytes ?? new Uint8Array(new Float32Array([0, 0.5, -1]).buffer);
    const response = await fetch(`${active.url}/api/voice/captures/${ticket.captureId}/audio`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'X-Pet-Voice-Client': ticket.clientId,
        'X-Pet-Voice-Agent': ticket.agentId,
        'X-Pet-Voice-Epoch': ticket.serviceEpoch,
        'X-Pet-Voice-Samples': String(samples),
      },
      body: Buffer.from(pcm),
    });
    return {
      status: response.status,
      result: (await response.json()) as Result<VoiceCaptureResult>,
    };
  }
  const result = (ticket: VoiceTicket) =>
    call<VoiceCaptureResult>(
      `/api/voice/captures/${ticket.captureId}?clientId=${ticket.clientId}&agentId=${ticket.agentId}&serviceEpoch=${ticket.serviceEpoch}`,
    );
  return {
    service: active,
    call,
    view,
    configure,
    begin,
    upload,
    result,
    unwrap,
    requests,
    baseUrl,
  };
}

it('rejects a transport model mismatch before credential/network use', async () => {
  const f = await fixture();
  const transport = createAuthorizedAsrTransport(
    f.service.host,
    'pet.asr-magpie',
    {
      baseUrl: f.baseUrl,
      modelRef: 'xiaomi/mimo-v2.5-asr',
      authMode: 'gateway-key',
      protocol: 'mimo-native',
    },
    undefined,
  );
  try {
    await expect(
      transport.mimoAsr(
        { modelRef: 'other/mimo-asr', wav: new Uint8Array(44) },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ error: { code: 'permission-denied' } });
  } finally {
    await transport.close();
  }
  expect(f.requests).toHaveLength(0);
});

it('applies the exact 40s native budget and joins actual HTTP cancellation (accelerated timer)', async () => {
  const closed = deferred();
  const f = await fixture((_request, response) => response.once('close', () => closed.resolve()));
  await f.configure();
  const { ticket } = await f.begin();
  const original = AbortSignal.timeout.bind(AbortSignal),
    budgets: number[] = [];
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    budgets.push(ms);
    return original(ms === 40000 ? 100 : ms);
  });
  expect(f.unwrap(await f.upload(ticket))).toMatchObject({
    phase: 'failed',
    cleanup: 'settled',
    error: { code: 'timeout' },
  });
  await closed.promise;
  expect(budgets).toContain(40000);
  expect(f.requests).toHaveLength(1);
});

it('starts ordinary sources with empty-model catalog, own identity and no inference at save/begin', async () => {
  const f = await fixture();
  expect(f.requests).toHaveLength(0);
  let view = await f.configure('');
  expect(f.requests).toHaveLength(0);
  const provider = view.providers[0];
  expect(provider?.readiness).toBe('unconfigured');
  expect(provider?.reason).toBe('model-unconfigured');
  const catalog = await f.call<{ candidates: Array<{ modelRef: string; selectable: boolean }> }>(
    `/api/voice/catalog?providerRef=${ref}&bindingId=${provider?.bindingId}`,
  );
  expect(catalog.status).toBe(200);
  expect(f.unwrap(catalog).candidates).toEqual([
    expect.objectContaining({ modelRef: 'vendor/whisper', selectable: false }),
    expect.objectContaining({ modelRef: 'xiaomi/mimo-v2.5-asr', selectable: true }),
  ]);
  expect(f.requests[0]).toMatchObject({
    path: '/v1/models?kind=all',
    headers: { 'user-agent': 'dsh-pet-voice/1', authorization: 'Bearer magpie-dsh-pet' },
  });
  view = await f.configure();
  const { ticket } = await f.begin();
  expect(ticket.finishMode).toBe('send');
  expect(f.requests).toHaveLength(1);
  expect(view.feature.source).toBe('ready');
});

it('runs actual owned media and native MiMo bytes once, recovers retained results without writing messages', async () => {
  const f = await fixture();
  await f.configure();
  const before = await f.service.runtime.snapshot();
  const { ticket, input } = await f.begin();
  expect(f.unwrap(await f.call<VoiceTicket>('/api/voice/captures', input))).toEqual(ticket);
  expect((await f.call('/api/voice/captures', { ...input, finishMode: 'review' })).status).toBe(
    409,
  );
  const uploaded = f.unwrap(await f.upload(ticket));
  expect(uploaded).toMatchObject({
    phase: 'final',
    cleanup: 'settled',
    outcome: { kind: 'final', text: 'fixture transcript' },
    samples: 3,
  });
  expect(f.requests).toHaveLength(1);
  const request = f.requests[0];
  expect(request).toMatchObject({
    path: '/v1/magpie/native/xiaomi/v1/chat/completions',
    method: 'POST',
    body: { model: 'mimo-v2.5-asr', max_completion_tokens: 1024 },
  });
  const messages = request?.body['messages'] as Array<{
    role: string;
    content: Array<{ type: string; input_audio: { data: string } }>;
  }>;
  const audio = messages[0]?.content[0]?.input_audio.data;
  if (!audio) throw new Error('missing WAV');
  expect(audio.startsWith('data:audio/wav;base64,')).toBe(true);
  const wav = Buffer.from(audio.split(',')[1] ?? '', 'base64');
  expect(wav.length).toBe(50);
  expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
  expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
  expect(wav.readUInt32LE(24)).toBe(16000);
  expect(wav.readInt16LE(44)).toBe(0);
  expect(wav.readInt16LE(46)).toBe(16384);
  expect(wav.readInt16LE(48)).toBe(-32768);
  expect(f.unwrap(await f.result(ticket))).toEqual(uploaded);
  expect((await f.upload(ticket)).status).toBe(409);
  expect(f.requests).toHaveLength(1);
  const after = await f.service.runtime.snapshot();
  expect(after.messages).toEqual(before.messages);
  expect(after.facts).toEqual(before.facts);
  expect(after.tasks).toEqual(before.tasks);
  expect(f.service.host.permissions.diagnostics().leases).toBe(0);
});

it('rejects invalid PCM and foreign ownership with zero model calls, empty input is no-speech', async () => {
  const f = await fixture();
  await f.configure();
  const first = await f.begin();
  expect(f.unwrap(await f.upload(first.ticket, 0, new Uint8Array()))).toMatchObject({
    phase: 'empty',
    outcome: { kind: 'no-speech' },
  });
  const second = await f.begin();
  expect(
    f.unwrap(await f.upload(second.ticket, 1, new Uint8Array(new Float32Array([NaN]).buffer))),
  ).toMatchObject({ phase: 'failed', error: { code: 'audio-format' }, outcome: null });
  const third = await f.begin();
  expect((await f.upload({ ...third.ticket, clientId: 'foreign' })).status).toBe(503);
  expect(f.requests).toHaveLength(0);
});

it.each([401, 403])(
  'keeps provider %i failures inside HTTP200 and leaves text bearer healthy',
  async (status) => {
    const f = await fixture((_request, response) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'private provider body' }));
    });
    const view = await f.configure();
    const catalog = await f.call(
      `/api/voice/catalog?providerRef=${ref}&bindingId=${view.providers[0]?.bindingId}`,
    );
    expect(catalog).toMatchObject({
      status: 200,
      result: { ok: false, error: { code: 'auth-failed' } },
    });
    const { ticket } = await f.begin();
    expect(await f.upload(ticket)).toMatchObject({
      status: 200,
      result: { ok: true, value: { phase: 'failed', error: { code: 'auth-failed' } } },
    });
    expect((await f.call('/api/snapshot')).status).toBe(200);
  },
);

it('preference-only committed CAS preserves captures; provider reload fences captures', async () => {
  const f = await fixture();
  await f.configure();
  const { ticket } = await f.begin();
  const view = await f.view();
  expect(
    (
      await f.call('/api/voice/settings', {
        expectedRevision: view.feature.configRevision,
        providerRef: ref,
        finishMode: 'review',
      })
    ).status,
  ).toBe(200);
  expect(f.unwrap(await f.result(ticket)).phase).toBe('awaiting-audio');
  const config = await f.service.host.configs.get({
    pluginId: 'pet.shared-voice',
    instanceId: 'default',
  });
  if (!config.ok) throw new Error('feature config');
  const saved = await f.service.host.configs.save(
    { pluginId: 'pet.shared-voice', instanceId: 'default' },
    { ...config.value.data, finishMode: 'send' },
    config.value.revision,
  );
  expect(saved.ok).toBe(true);
  expect(f.unwrap(await f.result(ticket)).phase).toBe('awaiting-audio');
  const provider = (await f.view()).providers[0];
  if (!provider) throw new Error('provider');
  expect(
    (
      await f.call('/api/voice/provider', {
        providerRef: ref,
        expectedRevision: provider.configRevision - 1,
        settings: provider.settings,
      })
    ).status,
  ).toBe(409);
  expect(f.unwrap(await f.result(ticket)).phase).toBe('awaiting-audio');
  await f.configure('xiaomi/mimo-v2.5-asr-2');
  expect(f.unwrap(await f.result(ticket)).phase).toBe('cancelled');
  expect(f.requests).toHaveLength(0);
});

it('ordinary feature/provider disable drains captures while same-Agent text remains available', async () => {
  const f = await fixture();
  await f.configure();
  const before = await f.service.runtime.snapshot();
  const first = await f.begin();
  expect(
    (await f.call('/api/plugins/pet.asr-magpie', { commandId: 'disable-asr', enabled: false }))
      .status,
  ).toBe(200);
  expect(f.unwrap(await f.result(first.ticket)).phase).toBe('cancelled');
  expect((await f.view()).providers[0]?.source).toBe('disabled');
  expect(
    (await f.call('/api/plugins/pet.asr-magpie', { commandId: 'enable-asr', enabled: true }))
      .status,
  ).toBe(200);
  await f.begin();
  expect(
    (await f.call('/api/plugins/pet.shared-voice', { commandId: 'disable-voice', enabled: false }))
      .status,
  ).toBe(200);
  expect((await f.view()).feature.source).toBe('disabled');
  expect((await f.view()).providers[0]?.bindingId).toBeNull();
  expect(
    (await f.call('/api/plugins/pet.shared-voice', { commandId: 'enable-voice', enabled: true }))
      .status,
  ).toBe(200);
  expect((await f.service.runtime.snapshot()).agent.id).toBe(before.agent.id);
  expect((await f.call('/api/snapshot')).status).toBe(200);
  expect(f.requests).toHaveLength(0);
});

it('rotates process-only credential CAS on target/auth change and preserves it for model-only saves', async () => {
  const f = await fixture();
  await f.configure('xiaomi/mimo-v2.5-asr', 'gateway-key');
  let provider = (await f.view()).providers[0];
  if (!provider) throw new Error('provider');
  expect(provider.reason).toBe('key-required');
  const key = 'voice-quoted-"canary\\\\-123456';
  const command = {
    providerRef: ref,
    expectedRevision: provider.configRevision,
    expectedCredentialVersion: provider.credential.version,
    value: key,
  };
  expect(
    (await f.call('/api/voice/credential', { ...command, expectedCredentialVersion: 'stale' }))
      .status,
  ).toBe(409);
  let view = f.unwrap(await f.call<VoiceView>('/api/voice/credential', command));
  provider = view.providers[0];
  if (!provider) throw new Error('provider');
  const version = provider.credential.version;
  expect(provider.credential).toMatchObject({ available: true, source: 'memory' });
  expect(JSON.stringify(view)).not.toContain(key);
  await f.configure('xiaomi/mimo-v2.5-asr-2', 'gateway-key');
  provider = (await f.view()).providers[0];
  expect(provider?.credential.version).toBe(version);
  const { ticket } = await f.begin();
  await f.upload(ticket);
  expect(f.requests[0]?.headers.authorization).toBe(`Bearer ${key}`);
  if (!provider) throw new Error('provider');
  view = f.unwrap(
    await f.call<VoiceView>('/api/voice/provider', {
      providerRef: ref,
      expectedRevision: provider.configRevision,
      settings: { ...provider.settings, baseUrl: `${f.baseUrl}/different` },
    }),
  );
  expect(view.providers[0]?.credential).toMatchObject({ available: false, source: 'none' });
  expect(view.providers[0]?.credential.version).not.toBe(version);
  expect((await f.call('/api/voice/credential', command)).status).toBe(409);
});

it('rejects decoded quoted/backslash provider secret echoes', async () => {
  const key = 'voice-quoted-"key\\\\-canary-123456';
  const f = await fixture((_request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ choices: [{ message: { content: key } }] }));
  });
  await f.configure('xiaomi/mimo-v2.5-asr', 'gateway-key');
  const provider = (await f.view()).providers[0];
  if (!provider) throw new Error('provider');
  f.unwrap(
    await f.call('/api/voice/credential', {
      providerRef: ref,
      expectedRevision: provider.configRevision,
      expectedCredentialVersion: provider.credential.version,
      value: key,
    }),
  );
  const { ticket } = await f.begin();
  expect(f.unwrap(await f.upload(ticket))).toMatchObject({
    phase: 'failed',
    outcome: null,
    error: { code: 'permission-denied' },
  });
});

it('admits one racing upload, isolates cancellation from another client and awaits the real HTTP socket close', async () => {
  const started = deferred(),
    closed = deferred();
  let pending: ServerResponse | undefined;
  const f = await fixture((_request, response) => {
    if (!pending) {
      pending = response;
      response.once('close', () => closed.resolve());
      started.resolve();
    } else {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ choices: [{ message: { content: 'other client' } }] }));
    }
  });
  await f.configure();
  const first = await f.begin('client-a'),
    second = await f.begin('client-b');
  const running = f.upload(first.ticket);
  await started.promise;
  expect((await f.upload(first.ticket)).status).toBe(409);
  expect(f.unwrap(await f.result(first.ticket)).phase).toBe('transcribing');
  const cancel = f.call<VoiceCaptureResult>(
    `/api/voice/captures/${first.ticket.captureId}/cancel`,
    {
      clientId: first.ticket.clientId,
      agentId: first.ticket.agentId,
      serviceEpoch: first.ticket.serviceEpoch,
    },
  );
  expect(f.unwrap(await cancel)).toMatchObject({ phase: 'cancelled', cleanup: 'settled' });
  await closed.promise;
  expect(f.unwrap(await running).phase).toBe('cancelled');
  expect(f.unwrap(await f.upload(second.ticket))).toMatchObject({
    phase: 'final',
    outcome: { kind: 'final', text: 'other client' },
  });
  expect(f.requests).toHaveLength(2);
  expect((await f.view()).providers[0]?.readiness).toBe('configured');
});

it('fences selected-provider changes synchronously at commit and preserves a healthy binding when selected again', async () => {
  const f = await fixture(undefined, true);
  await f.configure();
  const { ticket } = await f.begin();
  const config = await f.service.host.configs.get({
    pluginId: 'pet.shared-voice',
    instanceId: 'default',
  });
  if (!config.ok) throw new Error('feature config');
  const saved = await f.service.host.configs.save(
    { pluginId: 'pet.shared-voice', instanceId: 'default' },
    { ...config.value.data, providerRef: 'pet.asr-alternative/magpie' },
    config.value.revision,
  );
  expect(saved.ok).toBe(true);
  expect(f.unwrap(await f.result(ticket)).phase).toBe('cancelled');
  const current = await f.view();
  f.unwrap(
    await f.call('/api/voice/settings', {
      expectedRevision: current.feature.configRevision,
      providerRef: ref,
      finishMode: 'send',
    }),
  );
  expect((await f.view()).providers[0]?.readiness).toBe('configured');
  expect(f.requests).toHaveLength(0);
});

it.each([
  [{ choices: [{ message: { content: '' } }] }, 'empty', undefined],
  [{ choices: [{ message: { reasoning_content: 'not transcription' } }] }, 'failed', 'asr-failed'],
  [{ choices: [{ message: { content: { text: 'wrong type' } } }] }, 'failed', 'asr-failed'],
  [
    { choices: [{ message: { content: 'words', tool_calls: [{ name: 'tool' }] } }] },
    'failed',
    'asr-failed',
  ],
  [
    { choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] },
    'failed',
    'asr-failed',
  ],
  [{ choices: [{ message: { content: '字'.repeat(8001) } }] }, 'failed', 'quota-exceeded'],
])('decodes only complete bounded final content (case %#)', async (body, phase, code) => {
  const f = await fixture((_request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(body));
  });
  await f.configure();
  const { ticket } = await f.begin();
  const result = f.unwrap(await f.upload(ticket));
  expect(result.phase).toBe(phase);
  expect(result.error?.code).toBe(code);
  expect((await f.service.runtime.snapshot()).messages).toHaveLength(0);
});
