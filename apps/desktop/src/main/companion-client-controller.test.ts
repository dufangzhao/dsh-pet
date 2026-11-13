import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type ServerResponse, type IncomingMessage } from 'node:http';
import { once } from 'node:events';
import {
  DesktopCompanionController,
  companionEndpoint,
  initialDesktopCompanionState,
  desktopPersonalSnapshot,
} from './companion-client-controller.js';
import {
  makeError,
  SPEECH_AUDIO_HEADER,
  SPEECH_FORMAT,
  type CompanionSnapshot,
  type Result,
  type SpeechSegmentKey,
} from '@pet/contracts';
import type { SpeechConnectionEvent } from './companion-speech-service.js';
import type { DesktopCompanionHostPort, DesktopCompanionSource } from './companion-client-types.js';
import { handleDesktopCompanionRequest } from './companion-client-request.js';
import { createDesktopCompanionBridge } from '../preload/companion-bridge.js';
const close: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const stop of close.splice(0).reverse()) await stop();
});
const snapshot: CompanionSnapshot = {
  protocolVersion: 1,
  epoch: 'epoch',
  cursor: 0,
  now: 1,
  agent: {
    id: 'agent',
    name: 'same',
    profileRevision: 1,
    harness: 'fixture',
    mode: 'scripted',
    status: 'ready',
    error: null,
  },
  messages: [],
  tasks: [],
  facts: [],
  plugins: [],
};
async function fixture(
  projected: CompanionSnapshot = snapshot,
  openExternal?: (url: string) => Promise<void>,
) {
  const responses = new Set<ServerResponse>();
  const messages: string[] = [];
  let failReads = false;
  let streamsOpened = 0;
  let snapshotReads = 0;
  let receiptGate: Promise<void> | null = null;
  let dropReceipt = false;
  let admitted = 0;
  let speechRoute: ((request: IncomingMessage, response: ServerResponse) => boolean) | null = null;
  const server = createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${'t'.repeat(24)}`) {
      response.writeHead(401).end('{}');
      return;
    }
    if (speechRoute?.(request, response)) return;
    if (request.url?.startsWith('/api/events')) {
      streamsOpened++;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(': keepalive\n\n');
      responses.add(response);
      response.on('close', () => responses.delete(response));
      return;
    }
    if (request.url === '/api/snapshot') {
      snapshotReads++;
      if (failReads) {
        response.writeHead(503).end('{}');
        return;
      }
      response.end(JSON.stringify({ ok: true, value: projected }));
      return;
    }
    if (request.url === '/api/messages' || request.url === '/api/tasks/task/stop') {
      let body = '';
      request.on('data', (data) => {
        body += data;
      });
      request.on('end', () => {
        const command = JSON.parse(body);
        if (request.url === '/api/messages') messages.push(command.text);
        const serialized = JSON.stringify({
          ok: true,
          value: {
            commandId: command.commandId,
            status: 'accepted',
            messageId: request.url === '/api/messages' ? 'm' : null,
            taskId: request.url === '/api/messages' ? null : 'task',
          },
        });
        admitted++;
        void Promise.resolve(receiptGate).then(() => {
          if (dropReceipt) response.destroy();
          else response.end(serialized);
        });
      });
      return;
    }
    response.writeHead(404).end('{}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let revision = 1;
  const abort = new AbortController();
  const source = (): DesktopCompanionSource => ({
    owner: { pluginId: 'pet.companion-client', instanceId: 'default', generation: 1 },
    digest: 'digest',
    policyEpoch: 1,
    configRevision: revision,
    baseUrl,
    signal: abort.signal,
  });
  let listener = (_revision: number) => {};
  const host: DesktopCompanionHostPort = {
    readEndpoint: async () => ({ ok: true, value: { baseUrl, revision } }),
    readSource: async () => ({ ok: true, value: source() }),
    saveEndpoint: async (_url, expected) => {
      if (expected !== revision) return { ok: false, error: makeError('conflict', false) };
      revision++;
      listener(revision);
      return {
        ok: true,
        value: { baseUrl, configRevision: revision, source: { ok: true, value: source() } },
      };
    },
    onConfigurationCommit: (next) => {
      listener = next;
      return () => {};
    },
    isCurrent: async (entry) => entry.configRevision === revision && !abort.signal.aborted,
    withToken: async (_source, token, signal, operation) => operation(token, signal),
  };
  const controller = new DesktopCompanionController(
    host,
    { choose: async () => null },
    () => {},
    openExternal,
  );
  await controller.initialize();
  close.push(async () => {
    for (const response of responses) response.end();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  close.push(() => controller.close());
  return {
    controller,
    host,
    messages,
    baseUrl,
    abort,
    streamsOpened: () => streamsOpened,
    reads: () => snapshotReads,
    admitted: () => admitted,
    setProjection: (value: CompanionSnapshot) => {
      projected = value;
    },
    holdReceipt: (gate: Promise<void>, drop: boolean) => {
      receiptGate = gate;
      dropReceipt = drop;
    },
    emitRaw: (raw: string | Uint8Array) => {
      for (const response of responses) response.write(raw);
    },
    speechRoute: (route: (request: IncomingMessage, response: ServerResponse) => boolean) => {
      speechRoute = route;
    },
    emitRefresh: () => {
      for (const response of responses) response.write('event: refresh\ndata: {}\n\n');
    },
    failReads: (value: boolean) => {
      failReads = value;
    },
    endStreams: () => {
      for (const response of responses) response.end();
    },
  };
}
describe('shared desktop contract seam', () => {
  it('delivers formal events synchronously and observes malformed events without disrupting text', async () => {
    const f = await fixture();
    const observed: SpeechConnectionEvent[] = [];
    f.controller.onSpeechEvent((event) => observed.push(event));
    await f.controller.connect({ baseUrl: f.baseUrl, token: 't'.repeat(24), expectedRevision: 1 });
    await vi.waitFor(() => expect(f.streamsOpened()).toBe(1));
    const reads = f.reads();
    f.emitRaw(
      [1, 2]
        .map((sequence) => {
          const event = {
            id: `epoch:${sequence}`,
            epoch: 'epoch',
            sequence,
            time: 1,
            kind: 'message',
            data: { messageId: `say-${sequence}`, role: 'assistant', inputId: null, taskId: null },
          };
          return `event: companion\nid: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`;
        })
        .join(''),
    );
    await vi.waitFor(() =>
      expect(observed.filter((event) => event.kind === 'event')).toHaveLength(2),
    );
    expect(
      observed.filter((event) => event.kind === 'event').map((event) => event.event.sequence),
    ).toEqual([1, 2]);
    expect(f.reads()).toBe(reads);
    f.emitRaw('event: companion\ndata: {bad JSON}\n\n');
    await vi.waitFor(() => expect(observed.some((event) => event.kind === 'invalid')).toBe(true));
    f.emitRaw(new Uint8Array([58, 32, 0xc3, 0x28, 10, 10]));
    await vi.waitFor(() =>
      expect(observed.filter((event) => event.kind === 'invalid')).toHaveLength(2),
    );
    await vi.waitFor(async () =>
      expect(await f.controller.getState()).toMatchObject({
        ok: true,
        value: { phase: 'live' },
      }),
    );
    expect(f.streamsOpened()).toBe(1);
  });
  it('retains the captured token borrow through the complete speech PCM callback and refuses retired sessions', async () => {
    const f = await fixture();
    let scopes = 0,
      gets = 0;
    const withToken = f.host.withToken;
    f.host.withToken = async (source, token, signal, operation, commit) => {
      scopes++;
      try {
        return await withToken(source, token, signal, operation, commit);
      } finally {
        scopes--;
      }
    };
    const connected = await f.controller.connect({
      baseUrl: f.baseUrl,
      token: 't'.repeat(24),
      expectedRevision: 1,
    });
    if (!connected.ok || !connected.value.connectionId) throw new Error('not connected');
    await vi.waitFor(() => expect(f.streamsOpened()).toBe(1));
    const session = f.controller.speechSession({ connectionId: connected.value.connectionId });
    const key: SpeechSegmentKey = {
      utteranceId: 'utterance',
      clientId: session.clientId,
      agentId: session.agentId,
      serviceEpoch: session.serviceEpoch,
      utteranceBindingId: 'whole',
      segmentIndex: 0,
      requestId: 'request',
    };
    const binding = { providerRef: 'pet.tts-magpie/magpie', bindingId: 'binding' };
    f.speechRoute((request, response) => {
      if (!request.url?.includes('/segments/0/audio')) return false;
      gets++;
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        [SPEECH_AUDIO_HEADER]: JSON.stringify({
          ...key,
          ...binding,
          version: 1,
          format: SPEECH_FORMAT,
        }),
      });
      response.end(new Uint8Array([1, 0, 2, 0]));
      return true;
    });
    let release = () => {},
      callbackEntered = false;
    const drained = new Promise<void>((resolve) => {
      release = resolve;
    });
    const before = scopes;
    const consumption = session.consumeAudio(
      key,
      binding,
      new AbortController().signal,
      async (_header, pcm) => {
        let bytes = 0;
        for await (const chunk of pcm) bytes += chunk.byteLength;
        expect(bytes).toBe(4);
        callbackEntered = true;
        await drained;
      },
    );
    await vi.waitFor(() => expect(callbackEntered).toBe(true));
    expect(scopes).toBe(before + 1);
    release();
    expect(await consumption).toEqual({ ok: true, value: null });
    expect(scopes).toBe(before);
    expect(gets).toBe(1);
    await f.controller.disconnect({ connectionId: connected.value.connectionId });
    expect(
      await session.consumeAudio(key, binding, new AbortController().signal, async () => {}),
    ).toMatchObject({ ok: false, error: { code: 'stale-owner' } });
    expect(gets).toBe(1);
  });
  it('preserves distinct text/voice command IDs and refuses the seventeenth entry with zero HTTP and no overwrite', async () => {
    const f = await fixture();
    const connected = await f.controller.connect({
      baseUrl: f.baseUrl,
      token: 't'.repeat(24),
      expectedRevision: 1,
    });
    if (!connected.ok || !connected.value.connectionId) throw new Error('connect failed');
    const target = { connectionId: connected.value.connectionId };
    let release = () => {};
    const gate = new Promise<void>((done) => {
      release = done;
    });
    f.holdReceipt(gate, false);
    const pending = Array.from({ length: 16 }, (_, index) =>
      f.controller.sendMessage({
        ...target,
        commandId: `command-${index}`,
        text: index === 1 ? 'distinct voice intent' : `text-${index}`,
      }),
    );
    try {
      await vi.waitFor(() => expect(f.admitted()).toBe(16));
      expect(
        await f.controller.sendMessage({ ...target, commandId: 'command-0', text: 'changed' }),
      ).toMatchObject({ ok: false, error: { code: 'conflict' } });
      expect(
        await f.controller.sendMessage({
          ...target,
          commandId: 'new-voice',
          text: 'retained locally',
        }),
      ).toMatchObject({ ok: false, error: { code: 'quota-exceeded' } });
      expect(f.admitted()).toBe(16);
      expect(f.messages).not.toContain('changed');
      expect(f.messages).not.toContain('retained locally');
      const state = await f.controller.getState();
      expect(state.ok && state.value.pending).toHaveLength(16);
    } finally {
      release();
      await Promise.all(pending);
    }
  });
  it('an already-aborted source returned after a gated admission never claims connecting or sends HTTP', async () => {
    const f = await fixture();
    let release = () => {};
    let entered = false;
    let calls = 0;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = f.host.readSource.bind(f.host);
    vi.spyOn(f.host, 'readSource').mockImplementation(async () => {
      const result = await original();
      if (++calls === 2) {
        entered = true;
        await gate;
      }
      return result;
    });
    const connect = f.controller.connect({
      baseUrl: f.baseUrl,
      token: 't'.repeat(24),
      expectedRevision: 1,
    });
    await vi.waitFor(() => expect(entered).toBe(true));
    f.abort.abort();
    release();
    expect(await connect).toMatchObject({
      ok: true,
      value: {
        phase: 'offline',
        source: 'unavailable',
        baseUrl: f.baseUrl,
        configRevision: 2,
        connectionId: null,
        snapshot: null,
      },
    });
    expect(f.reads()).toBe(0);
    expect(f.streamsOpened()).toBe(0);
  });
  it.each(['false', 'true', 'error'] as const)(
    'detached old SSE validity %s cannot retire or publish into a replacement',
    async (outcome) => {
      const f = await fixture();
      const connected = await f.controller.connect({
        baseUrl: f.baseUrl,
        token: 't'.repeat(24),
        expectedRevision: 1,
      });
      if (!connected.ok || !connected.value.connectionId) throw new Error('connect failed');
      await vi.waitFor(() => expect(f.streamsOpened()).toBe(1));
      let release = () => {};
      let entered = false;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const original = f.host.isCurrent.bind(f.host);
      vi.spyOn(f.host, 'isCurrent').mockImplementation(async (source) => {
        if (source.configRevision === connected.value.configRevision && !entered) {
          entered = true;
          await gate;
          if (outcome === 'error') throw new Error('old source check failed');
          return outcome === 'true';
        }
        return original(source);
      });
      f.emitRefresh();
      await vi.waitFor(() => expect(entered).toBe(true));
      const replacement = await f.controller.connect({
        baseUrl: f.baseUrl,
        token: 't'.repeat(24),
        expectedRevision: connected.value.configRevision,
      });
      if (!replacement.ok || !replacement.value.connectionId) throw new Error('replacement failed');
      expect(replacement.value.connectionId).not.toBe(connected.value.connectionId);
      release();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(await f.controller.getState()).toMatchObject({
        value: {
          connectionId: replacement.value.connectionId,
          phase: 'live',
          source: 'ready',
          error: null,
          revision: replacement.value.revision,
        },
      });
      expect(
        await f.controller.refresh({ connectionId: replacement.value.connectionId }),
      ).toMatchObject({ ok: true, value: { phase: 'live' } });
    },
  );
  it.each([
    { kind: 'message', drop: false },
    { kind: 'message', drop: true },
    { kind: 'stop', drop: false },
    { kind: 'stop', drop: true },
  ])('canonical confirmation wins over late $kind receipt (drop=$drop)', async ({ kind, drop }) => {
    const f = await fixture();
    const connected = await f.controller.connect({
      baseUrl: f.baseUrl,
      token: 't'.repeat(24),
      expectedRevision: 1,
    });
    if (!connected.ok || !connected.value.connectionId) throw new Error('connect failed');
    const target = { connectionId: connected.value.connectionId };
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.holdReceipt(gate, drop);
    const command =
      kind === 'message'
        ? f.controller.sendMessage({ ...target, commandId: 'cmd', text: 'hello' })
        : f.controller.stopTask({ ...target, commandId: 'cmd', taskId: 'task' });
    await vi.waitFor(() => expect(f.admitted()).toBe(1));
    const canonical: CompanionSnapshot =
      kind === 'message'
        ? {
            ...snapshot,
            cursor: 1,
            messages: [
              {
                id: 'm',
                role: 'user',
                audience: { kind: 'owner-private' },
                text: 'hello',
                createdAt: 1,
                inputId: 'cmd',
                taskId: null,
              },
            ],
          }
        : {
            ...snapshot,
            cursor: 1,
            tasks: [
              {
                id: 'task',
                origin: {
                  inputId: null,
                  principalId: 'owner',
                  audience: { kind: 'owner-private' },
                  route: { kind: 'owner-private' },
                  origins: [],
                  materialIds: [],
                },
                executionId: 'execution',
                title: 'work',
                status: 'completed',
                createdAt: 1,
                updatedAt: 2,
                exitCode: 0,
                stdout: '',
                stderr: '',
                logsTruncated: false,
                artifacts: [],
                error: null,
              },
            ],
          };
    f.setProjection(canonical);
    expect(await f.controller.refresh(target)).toMatchObject({
      ok: true,
      value: { pending: [], snapshot: { cursor: 1 } },
    });
    release();
    expect((await command).ok).toBe(!drop);
    expect(await f.controller.getState()).toMatchObject({
      value: { pending: [], snapshot: { cursor: 1 } },
    });
  });
  it('an uncertain receipt triggers one snapshot reconciliation without resending', async () => {
    const f = await fixture();
    const connected = await f.controller.connect({
      baseUrl: f.baseUrl,
      token: 't'.repeat(24),
      expectedRevision: 1,
    });
    if (!connected.ok || !connected.value.connectionId) throw new Error('connect failed');
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.holdReceipt(gate, true);
    const command = f.controller.sendMessage({
      connectionId: connected.value.connectionId,
      commandId: 'cmd',
      text: 'hello',
    });
    await vi.waitFor(() => expect(f.admitted()).toBe(1));
    f.setProjection({
      ...snapshot,
      cursor: 1,
      messages: [
        {
          id: 'm',
          role: 'user',
          audience: { kind: 'owner-private' },
          text: 'hello',
          createdAt: 1,
          inputId: 'cmd',
          taskId: null,
        },
      ],
    });
    const reads = f.reads();
    release();
    expect((await command).ok).toBe(false);
    await vi.waitFor(async () =>
      expect(await f.controller.getState()).toMatchObject({
        value: { pending: [], snapshot: { cursor: 1 } },
      }),
    );
    expect(f.reads()).toBe(reads + 1);
    expect(f.admitted()).toBe(1);
  });
  it('manual reconnect keeps one live SSE reader and an ordinary refresh cannot fake reconnection', async () => {
    const fixture_ = await fixture();
    const result = await fixture_.controller.connect({
      baseUrl: fixture_.baseUrl,
      expectedRevision: 1,
      token: 't'.repeat(24),
    });
    if (!result.ok || !result.value.connectionId) throw new Error('connect failed');
    const target = { connectionId: result.value.connectionId };
    await vi.waitFor(() => expect(fixture_.streamsOpened()).toBe(1));
    fixture_.failReads(true);
    expect(await fixture_.controller.refresh(target)).toMatchObject({
      ok: true,
      value: { phase: 'offline' },
    });
    fixture_.failReads(false);
    expect(await fixture_.controller.reconnect(target)).toMatchObject({
      ok: true,
      value: { phase: 'live' },
    });
    expect(fixture_.streamsOpened()).toBe(1);
    fixture_.endStreams();
    await vi.waitFor(async () =>
      expect(await fixture_.controller.getState()).toMatchObject({ value: { phase: 'offline' } }),
    );
    expect(await fixture_.controller.refresh(target)).toMatchObject({
      ok: false,
      error: { code: 'not-ready' },
    });
    expect(await fixture_.controller.reconnect(target)).toMatchObject({
      ok: true,
      value: { phase: 'live' },
    });
    await vi.waitFor(() => expect(fixture_.streamsOpened()).toBe(2));
  });
  it('carries a legal near64KiB wire snapshot in the separate80KiB Main aggregate', async () => {
    const messages = Array.from({ length: 9 }, (_, i) => ({
      id: `m-${i}`,
      role: 'assistant' as const,
      audience: { kind: 'owner-private' as const },
      text: '',
      createdAt: 1,
      inputId: null,
      taskId: null,
    }));
    const projected: CompanionSnapshot = { ...snapshot, messages };
    let remaining = 65490 - Buffer.byteLength(JSON.stringify({ ok: true, value: projected }));
    for (const message of messages) {
      const length = Math.min(8000, remaining);
      message.text = 'x'.repeat(length);
      remaining -= length;
    }
    expect(remaining).toBe(0);
    const { controller, baseUrl } = await fixture(projected);
    const result = await controller.connect({
      baseUrl,
      expectedRevision: 1,
      token: 't'.repeat(24),
    });
    expect(result).toMatchObject({ ok: true, value: { phase: 'live' } });
    const bytes = Buffer.byteLength(JSON.stringify(result));
    expect(bytes).toBeGreaterThan(65536);
    expect(bytes).toBeLessThanOrEqual(81920);
  });
  it('starts honest/unconnected and normalizes only explicit service roots', () => {
    expect(initialDesktopCompanionState()).toMatchObject({
      phase: 'idle',
      snapshot: null,
      connectionId: null,
    });
    expect(companionEndpoint('http://10.1.0.7:4120/')).toBe('http://10.1.0.7:4120');
    for (const input of [
      'file:///tmp/a',
      'https://u:p@example.test/',
      'http://localhost/api',
      'https://example.test/?token=t',
      'https://example.test/#x',
    ])
      expect(() => companionEndpoint(input)).toThrow();
  });
  it('preserves live auth on stale Config CAS and uses service UTF16 message bounds', async () => {
    const { controller, baseUrl, messages } = await fixture();
    const result = await controller.connect({
      baseUrl,
      expectedRevision: 1,
      token: 't'.repeat(24),
    });
    expect(result.ok).toBe(true);
    const state = result.ok ? result.value : null;
    if (!state?.connectionId) throw new Error('not connected');
    expect(state.phase).toBe('live');
    expect(
      await controller.connect({ baseUrl, expectedRevision: 1, token: 'x'.repeat(24) }),
    ).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(await controller.getState()).toMatchObject({
      value: { phase: 'live', connectionId: state.connectionId },
    });
    const target = { connectionId: state.connectionId };
    expect(
      await controller.sendMessage({ ...target, commandId: 'too-long', text: '😀'.repeat(4001) }),
    ).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
    expect(
      await controller.sendMessage({ ...target, commandId: 'boundary', text: '😀'.repeat(4000) }),
    ).toMatchObject({ ok: true });
    expect(messages).toHaveLength(1);
    await controller.disconnect(target);
    expect(await controller.getState()).toMatchObject({
      value: { phase: 'idle', connectionId: null, snapshot: { agent: { id: 'agent' } } },
    });
  });
  it('keeps QQ status on the one personal projection while excluding foreign or unknown messages and work', async () => {
    const ownerMessage = {
      id: 'owner',
      role: 'assistant' as const,
      text: 'personal',
      createdAt: 1,
      inputId: null,
      taskId: null,
      audience: { kind: 'owner-private' as const },
    };
    const account = {
      protocol: 'official' as const,
      sourcePluginId: 'pet.qq-official',
      instanceId: 'default' as const,
      accountId: 'app',
    };
    const audience = { kind: 'qq-group' as const, account, groupId: 'group-A' };
    const route = {
      kind: 'qq' as const,
      account,
      scene: 'group' as const,
      targetId: 'group-A',
      reference: { eventId: null, messageId: 'native-1', occurredAt: 1, displayReference: null },
    };
    const origin = {
      kind: 'qq' as const,
      inputId: 'qq-input',
      principalId: 'person-1',
      audience,
      route,
      policyRevision: 1,
      actor: { account, scene: 'group' as const, groupId: 'group-A', senderId: 'person-openid' },
      eventKey: 'normalized-1',
      messageId: 'native-1',
      trigger: 'mention' as const,
      quote: null,
    };
    const ownerTask = {
      id: 'owner-task',
      executionId: 'execution',
      title: 'personal',
      status: 'running' as const,
      createdAt: 1,
      updatedAt: 1,
      exitCode: null,
      stdout: '',
      stderr: '',
      logsTruncated: false,
      artifacts: [],
      error: null,
      origin: {
        inputId: null,
        principalId: 'owner',
        audience: { kind: 'owner-private' as const },
        route: { kind: 'owner-private' as const },
        origins: [],
        materialIds: [],
      },
    };
    const qq: NonNullable<CompanionSnapshot['qq']> = {
      version: 1,
      sources: [
        {
          protocol: 'official',
          sourcePluginId: 'pet.qq-official',
          desiredEnabled: false,
          source: 'disabled',
          phase: 'disabled',
          account: null,
          cleanup: 'settled',
          error: null,
        },
        {
          protocol: 'onebot-v11',
          sourcePluginId: 'pet.qq-onebot',
          desiredEnabled: true,
          source: 'unavailable',
          phase: 'retiring',
          account: null,
          cleanup: 'pending',
          error: null,
        },
      ],
    };
    const fact = { key: 'same-key', value: 'value', revision: 1, updatedAt: 1 };
    const incoming: CompanionSnapshot = {
      ...snapshot,
      qq,
      messages: [
        ownerMessage,
        {
          ...ownerMessage,
          id: 'qq-private',
          audience: { kind: 'person-private', principalId: 'person-1' },
        },
        { ...ownerMessage, id: 'group', audience },
        {
          id: 'unknown',
          role: 'assistant',
          text: 'unclassified',
          createdAt: 1,
          inputId: null,
          taskId: null,
        },
      ],
      tasks: [
        ownerTask,
        {
          ...ownerTask,
          id: 'qq-task',
          origin: {
            inputId: origin.inputId,
            principalId: origin.principalId,
            audience,
            route,
            origins: [origin],
            materialIds: [],
          },
        },
      ],
      facts: [
        { ...fact, audience: { kind: 'owner-private' } },
        { ...fact, audience: { kind: 'public' } },
        { ...fact, audience },
      ],
    };
    const projected = desktopPersonalSnapshot(incoming);
    expect(projected.messages.map((message) => message.id)).toEqual(['owner']);
    expect(projected.tasks.map((task) => task.id)).toEqual(['owner-task']);
    expect(projected.facts).toHaveLength(2);
    expect(projected.qq).toEqual(qq);
    const f = await fixture(incoming);
    const connected = await f.controller.connect({
      baseUrl: f.baseUrl,
      token: 't'.repeat(24),
      expectedRevision: 1,
    });
    expect(connected).toMatchObject({ ok: true, value: { snapshot: projected } });
    expect(await f.controller.getState()).toMatchObject({ value: { snapshot: projected } });
    const invalid = { ...snapshot, qq: { ...qq, policy: { secret: 'not-for-desktop' } } };
    expect(() => desktopPersonalSnapshot(invalid)).toThrow();
  });
  it('opens only the captured current Web root after exact trusted-frame and target validation', async () => {
    const opened = vi.fn(async (_url: string) => {});
    const f = await fixture(snapshot, opened);
    const connected = await f.controller.connect({
      baseUrl: f.baseUrl,
      token: 't'.repeat(24),
      expectedRevision: 1,
    });
    if (!connected.ok || !connected.value.connectionId) throw new Error('not connected');
    const target = { connectionId: connected.value.connectionId };
    const trusted = {
      role: 'console' as const,
      senderId: 1,
      expectedId: 1,
      mainFrame: true,
      frameUrl: 'file:///app/console.html',
      expectedUrl: 'file:///app/console.html',
    };
    expect(
      await handleDesktopCompanionRequest(
        { ...trusted, mainFrame: false },
        'openWeb',
        [target],
        f.controller,
      ),
    ).toMatchObject({ ok: false });
    expect(
      await handleDesktopCompanionRequest(
        trusted,
        'openWeb',
        [{ ...target, url: 'https://attacker.example/?token=private' }],
        f.controller,
      ),
    ).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
    expect(await f.controller.openWeb({ connectionId: 'old-target' })).toMatchObject({ ok: false });
    expect(opened).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(f.streamsOpened()).toBe(1));
    const reads = f.reads();
    expect(await handleDesktopCompanionRequest(trusted, 'openWeb', [target], f.controller)).toEqual(
      { ok: true, value: null },
    );
    expect(opened).toHaveBeenCalledExactlyOnceWith(f.baseUrl);
    expect(f.reads()).toBe(reads);
    expect(f.streamsOpened()).toBe(1);
    const invoke = vi.fn(async () => ({ ok: true, value: null }));
    const bridge = createDesktopCompanionBridge(invoke, () => () => {});
    expect(await bridge.openWeb(target)).toEqual({ ok: true, value: null });
    expect(invoke).toHaveBeenCalledExactlyOnceWith('companion:desktop:v1:openWeb', target);
    expect(await Reflect.apply(bridge.openWeb, bridge, [target, 'extra'])).toMatchObject({
      ok: false,
    });
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it('does not open a retired target after an asynchronous source-current check', async () => {
    const opened = vi.fn(async (_url: string) => {}),
      f = await fixture(snapshot, opened);
    const connected = await f.controller.connect({
      baseUrl: f.baseUrl,
      token: 't'.repeat(24),
      expectedRevision: 1,
    });
    if (!connected.ok || !connected.value.connectionId) throw new Error('not connected');
    const target = { connectionId: connected.value.connectionId };
    let release = (_value: boolean) => {};
    const gate = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    const current = vi.spyOn(f.host, 'isCurrent').mockImplementationOnce(() => gate);
    const opening = f.controller.openWeb(target);
    const retiring = f.controller.disconnect(target);
    release(true);
    expect(await opening).toMatchObject({ ok: false });
    await retiring;
    current.mockRestore();
    expect(opened).not.toHaveBeenCalled();
    expect(await f.controller.getState()).toMatchObject({ value: { phase: 'idle' } });
  });
  it('forwards explicit fact audience without deduplicating same-key scopes or adding an absent scope', async () => {
    const f = await fixture();
    const trusted = {
      role: 'console' as const,
      senderId: 1,
      expectedId: 1,
      mainFrame: true,
      frameUrl: 'file:///app/console.html',
      expectedUrl: 'file:///app/console.html',
    };
    const forget = vi
      .spyOn(f.controller, 'forgetFact')
      .mockResolvedValue({ ok: false, error: makeError('not-ready', false) });
    const command = {
      commandId: 'forget',
      expectedMemoryRevision: 1,
      expectedFactRevision: 1,
      key: 'same-key',
    };
    await handleDesktopCompanionRequest(
      trusted,
      'forgetFact',
      [{ connectionId: 'target', command }],
      f.controller,
    );
    expect(forget).toHaveBeenLastCalledWith({ connectionId: 'target', command });
    await handleDesktopCompanionRequest(
      trusted,
      'forgetFact',
      [{ connectionId: 'target', command: { ...command, audience: { kind: 'public' } } }],
      f.controller,
    );
    expect(forget).toHaveBeenLastCalledWith({
      connectionId: 'target',
      command: { ...command, audience: { kind: 'public' } },
    });
    forget.mockRestore();
  });
  it('frozen bridge validates arity, and pet cannot perform console credential management', async () => {
    let invokes = 0;
    const bridge = createDesktopCompanionBridge(
      async () => {
        invokes++;
        return { ok: true, value: null };
      },
      () => () => {},
    );
    expect(Object.isFrozen(bridge)).toBe(true);
    expect(
      await (bridge.getState as (...args: unknown[]) => Promise<Result<unknown>>)('extra'),
    ).toMatchObject({ ok: false });
    expect(invokes).toBe(0);
    const { controller } = await fixture();
    const source = {
      role: 'pet' as const,
      senderId: 1,
      expectedId: 1,
      mainFrame: true,
      frameUrl: 'file:///pet.html',
      expectedUrl: 'file:///pet.html',
    };
    expect(
      await handleDesktopCompanionRequest(
        source,
        'connect',
        [{ expectedRevision: 1, baseUrl: 'http://localhost', token: 'x'.repeat(24) }],
        controller,
      ),
    ).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    for (const action of ['saveProfile', 'upsertFact', 'forgetFact'] as const) {
      expect(
        await handleDesktopCompanionRequest(
          source,
          action,
          [{ connectionId: 'old', command: {} }],
          controller,
        ),
      ).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    }
    expect(
      await handleDesktopCompanionRequest(
        { ...source, frameUrl: 'file:///other.html' },
        'getState',
        [],
        controller,
      ),
    ).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
  });
});
