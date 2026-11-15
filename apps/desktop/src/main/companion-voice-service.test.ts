import { afterEach, expect, it, vi } from 'vitest';
import { createServer, type ServerResponse, type IncomingHttpHeaders } from 'node:http';
import { once } from 'node:events';
import {
  type CompanionSnapshot,
  type VoiceView,
  type VoiceTicket,
  makeError,
} from '@pet/contracts';
import { DesktopCompanionController } from './companion-client-controller.js';
import type { DesktopCompanionHostPort, DesktopCompanionSource } from './companion-client-types.js';
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const snapshot: CompanionSnapshot = {
  protocolVersion: 1,
  epoch: 'epoch',
  cursor: 0,
  now: 1,
  agent: {
    id: 'agent',
    name: 'fixture',
    profileRevision: 1,
    harness: 'fixture',
    mode: 'scripted',
    status: 'busy',
    error: null,
  },
  messages: [],
  tasks: [],
  facts: [],
  plugins: [],
};
const selection = {
  captureId: 'capture',
  expectedFeatureRevision: 1,
  providerRef: 'pet.asr-magpie/magpie',
  bindingId: 'binding',
  finishMode: 'send' as const,
};
const view: VoiceView = {
  version: 1,
  feature: {
    source: 'ready',
    configRevision: 1,
    providerRef: 'pet.asr-magpie/magpie',
    finishMode: 'send',
  },
  providers: [
    {
      providerRef: 'pet.asr-magpie/magpie',
      label: 'fixture',
      synthetic: true,
      source: 'ready',
      configRevision: 1,
      settings: {
        baseUrl: 'http://127.0.0.1:1/v1',
        modelRef: 'fixture/mimo-asr',
        authMode: 'local-client-id',
        protocol: 'mimo-native',
      },
      bindingId: 'binding',
      credential: { available: true, writable: true, version: '1', source: 'local-client-id' },
      readiness: 'configured',
      reason: null,
    },
  ],
};
async function fixture() {
  const streams = new Set<ServerResponse>();
  const requests: Array<{
    method: string;
    url: string;
    body: Uint8Array;
    auth: string;
    headers: IncomingHttpHeaders;
  }> = [];
  let ticket: VoiceTicket | null = null;
  let held: (() => Promise<void>) | null = null;
  let projected = snapshot;
  const server = createServer((request, response) => {
    const url = request.url ?? '';
    if (url.startsWith('/api/events')) {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(':keepalive\n\n');
      streams.add(response);
      response.on('close', () => streams.delete(response));
      return;
    }
    if (url === '/api/snapshot') {
      response.end(JSON.stringify({ ok: true, value: projected }));
      return;
    }
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      requests.push({
        method: request.method ?? '',
        url,
        body,
        auth: request.headers.authorization ?? '',
        headers: request.headers,
      });
      if (held) await held();
      let value: unknown;
      if (url === '/api/voice' || url === '/api/voice/settings' || url === '/api/voice/provider')
        value = view;
      else if (url === '/api/voice/captures') {
        const input = JSON.parse(body.toString());
        if (
          input.expectedFeatureRevision !== 1 ||
          input.bindingId !== 'binding' ||
          input.finishMode !== 'send'
        ) {
          response
            .writeHead(409)
            .end(JSON.stringify({ ok: false, error: makeError('conflict', false) }));
          return;
        }
        ticket = {
          ...input,
          version: 1,
          serviceEpoch: 'epoch',
          expiresAt: Date.now() + 120000,
          encoding: 'f32le',
          sampleRate: 16000,
          channels: 1,
          chunkSamples: 1600,
          maxSamples: 320000,
        };
        value = ticket;
      } else if (url.startsWith('/api/voice/captures/'))
        value = {
          ticket,
          phase: 'final',
          samples: 2,
          cleanup: 'settled',
          outcome: { kind: 'final', text: 'controlled peer' },
          error: null,
          completedAt: 1,
        };
      else {
        response.writeHead(404).end('{}');
        return;
      }
      response.end(JSON.stringify({ ok: true, value }));
    })().catch(() => response.destroy());
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No peer address');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let revision = 1;
  const lifetime = new AbortController();
  const source = (): DesktopCompanionSource => ({
    owner: { pluginId: 'pet.companion-client', instanceId: 'default', generation: 1 },
    digest: 'fixture',
    policyEpoch: 1,
    configRevision: revision,
    baseUrl,
    signal: lifetime.signal,
  });
  let uses = 0;
  const host: DesktopCompanionHostPort = {
    readEndpoint: async () => ({ ok: true, value: { baseUrl, revision } }),
    readSource: async () => ({ ok: true, value: source() }),
    saveEndpoint: async (_url, expected) =>
      expected !== revision
        ? { ok: false, error: makeError('conflict', false) }
        : {
            ok: true,
            value: { baseUrl, configRevision: ++revision, source: { ok: true, value: source() } },
          },
    onConfigurationCommit: () => () => {},
    isCurrent: async (entry) => entry.configRevision === revision && !lifetime.signal.aborted,
    withToken: async (_source, token, signal, operation) => {
      uses++;
      try {
        return await operation(token, signal);
      } finally {
        uses--;
      }
    },
  };
  const controller = new DesktopCompanionController(host, { choose: async () => null }, () => {});
  cleanups.push(async () => {
    for (const stream of streams) stream.end();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  });
  cleanups.push(() => controller.close());
  await controller.initialize();
  const connect = async (expectedRevision: number) => {
    const result = await controller.connect({ expectedRevision, baseUrl, token: 't'.repeat(24) });
    if (!result.ok || !result.value.connectionId) throw new Error('No captured connection');
    return { connectionId: result.value.connectionId };
  };
  const target = await connect(1);
  return {
    controller,
    requests,
    target,
    connect,
    uses: () => uses,
    hold: (gate: () => Promise<void>) => {
      held = gate;
    },
    project: async (next: CompanionSnapshot) => {
      projected = next;
      await controller.refresh(target);
    },
  };
}
it('uses fixed authenticated binary protocol under the captured binding, permits busy Agent, and never exposes credential writes', async () => {
  const f = await fixture();
  const session = f.controller.voiceSession(f.target);
  const read = await session.readVoice();
  expect(read.ok && read.value.providers[0]?.credential.writable).toBe(false);
  const begun = await session.begin(selection, new AbortController().signal);
  if (!begun.ok) throw new Error('No voice ticket');
  expect(begun.value.clientId).toBe(session.clientId);
  expect(begun.value.agentId).toBe('agent');
  const audio = new Uint8Array(new Float32Array([0.25, -0.25]).buffer);
  expect((await session.upload(begun.value, 2, audio, new AbortController().signal)).ok).toBe(true);
  const upload = f.requests.find((item) => item.url.endsWith('/audio'));
  expect(upload?.method).toBe('POST');
  expect(upload?.headers['content-type']).toBe('application/octet-stream');
  expect(upload?.headers['x-pet-voice-client']).toBe(session.clientId);
  expect(upload?.headers['x-pet-voice-agent']).toBe('agent');
  expect(upload?.headers['x-pet-voice-samples']).toBe('2');
  expect(Array.from(upload?.body ?? [])).toEqual(Array.from(audio));
  expect(f.requests.every((request) => request.auth === `Bearer ${'t'.repeat(24)}`)).toBe(true);
  const count = f.requests.length;
  expect((await session.result({ ...begun.value, clientId: 'foreign' })).ok).toBe(false);
  expect(
    (
      await session.upload(
        { ...begun.value, agentId: 'foreign' },
        2,
        audio,
        new AbortController().signal,
      )
    ).ok,
  ).toBe(false);
  expect(f.requests).toHaveLength(count);
  expect(Object.keys(session)).not.toContain('writeCredential');
  const replacement = await f.connect(2);
  expect(f.controller.voiceSession(replacement).clientId).not.toBe(session.clientId);
  expect((await session.readVoice()).ok).toBe(false);
});
it('sends the exact old UI selection to service CAS without refreshing it into a new authorized intent', async () => {
  const f = await fixture();
  const session = f.controller.voiceSession(f.target);
  const old = {
    ...selection,
    expectedFeatureRevision: 0,
    bindingId: 'old-binding',
    finishMode: 'review' as const,
  };
  expect(await session.begin(old, new AbortController().signal)).toMatchObject({
    ok: false,
    error: { code: 'conflict' },
  });
  expect(f.requests).toHaveLength(1);
  expect(f.requests[0]?.url).toBe('/api/voice/captures');
  expect(JSON.parse(Buffer.from(f.requests[0]?.body ?? []).toString())).toEqual({
    ...old,
    clientId: session.clientId,
    agentId: 'agent',
  });
});
it('disconnect waits capture retirement and tracked HTTP cleanup before replacement can connect', async () => {
  const f = await fixture();
  const session = f.controller.voiceSession(f.target);
  let release = () => {};
  const gate = new Promise<void>((done) => {
    release = done;
  });
  f.hold(() => gate);
  const read = session.readVoice();
  await vi.waitFor(() => expect(f.requests.some((item) => item.url === '/api/voice')).toBe(true));
  let notified = false;
  const off = f.controller.onVoiceRetiring(async (id) => {
    expect(id).toBe(f.target.connectionId);
    notified = true;
    await gate;
  });
  const disconnect = f.controller.disconnect(f.target);
  await vi.waitFor(() => expect(notified).toBe(true));
  expect(session.signal.aborted).toBe(true);
  expect(await f.controller.getState()).toMatchObject({ ok: true, value: { phase: 'retiring' } });
  const before = f.requests.length;
  expect((await session.readVoice()).ok).toBe(false);
  expect(f.requests).toHaveLength(before);
  release();
  await disconnect;
  await read;
  off();
  expect(f.uses()).toBe(0);
  expect(await f.controller.getState()).toMatchObject({
    ok: true,
    value: { phase: 'idle', connectionId: null },
  });
});
it('an Agent/service epoch replacement fences audio before publishing the new snapshot while preserving text live state', async () => {
  const f = await fixture();
  const session = f.controller.voiceSession(f.target);
  let retired = false;
  f.controller.onVoiceRetiring(async () => {
    retired = true;
  });
  await f.project({
    ...snapshot,
    epoch: 'next-epoch',
    agent: { ...snapshot.agent, id: 'replacement' },
  });
  expect(retired).toBe(true);
  expect(await session.isCurrent()).toBe(false);
  const before = f.requests.length;
  expect(
    (await session.begin({ ...selection, captureId: 'old-capture' }, new AbortController().signal))
      .ok,
  ).toBe(false);
  expect(f.requests).toHaveLength(before);
  expect(await f.controller.getState()).toMatchObject({
    ok: true,
    value: { phase: 'live', snapshot: { agent: { id: 'replacement' } } },
  });
});
