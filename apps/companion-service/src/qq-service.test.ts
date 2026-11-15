import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { afterEach, expect, it } from 'vitest';
import {
  isQQView,
  isQQDeliveryPage,
  QQ_FEATURE_PLUGIN_ID,
  QQ_ONEBOT_PLUGIN_ID,
  type QQAccountRef,
  type QQInputReceipt,
  type QQView,
} from '@pet/contracts';
import type { RuntimeInputTerminal } from '@pet/companion-runtime';
import { createCompanionService } from './service.js';
import { seedMaterialView } from '../../../qa/fixtures/companion-qq/seed-material-view.js';

const token = 'qq-service-owned-loopback-fixture-token';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function bounded<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('controlled QQ flow did not settle')), 10000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), 'qq-service-composition-'));
  const listening = deferred<number>();
  const receipts: QQInputReceipt[] = [];
  const receiptListeners = new Set<(receipt: QQInputReceipt) => void>();
  cleanups.push(async () => {
    const target = await realpath(directory);
    if (
      path.dirname(target) !== (await realpath(tmpdir())) ||
      !path.basename(target).startsWith('qq-service-composition-')
    )
      throw new Error('wrong cleanup target');
    await rm(target, { recursive: true });
  });
  const service = await createCompanionService({
    dataDirectory: directory,
    token,
    hostname: '127.0.0.1',
    port: 0,
    mode: 'scripted',
    qqController: { onebotTest: { onListening: (address) => listening.resolve(address.port) } },
    onQQInputReceipt: (receipt) => {
      receipts.push(receipt);
      for (const listener of receiptListeners) listener(receipt);
    },
  });
  cleanups.push(() => service.close());
  const current = service;
  const request = (
    route: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<Response> =>
    new Promise((resolve, reject) => {
      const outgoing = httpRequest(
        new URL(route, current.url),
        {
          method: body === undefined ? 'GET' : 'POST',
          signal: AbortSignal.timeout(10000),
          headers: {
            Authorization: `Bearer ${token}`,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...headers,
          },
        },
        (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
          incoming.on('error', reject);
          incoming.on('end', () =>
            resolve(new Response(Buffer.concat(chunks), { status: incoming.statusCode ?? 500 })),
          );
        },
      );
      outgoing.on('error', reject);
      outgoing.end(body === undefined ? undefined : JSON.stringify(body));
    });
  const view = async (route = '/api/qq', body?: unknown): Promise<QQView> => {
    const response = await request(route, body);
    const payload: unknown = await response.json();
    if (
      !response.ok ||
      !payload ||
      typeof payload !== 'object' ||
      !('ok' in payload) ||
      payload.ok !== true ||
      !('value' in payload) ||
      !isQQView(payload.value)
    )
      throw new Error(`invalid QQ owner response ${response.status}`);
    return payload.value;
  };
  const waitReceipt = (
    predicate: (receipt: QQInputReceipt) => boolean,
  ): Promise<QQInputReceipt> => {
    const known = receipts.find(predicate);
    if (known) return Promise.resolve(known);
    return new Promise((resolve) => {
      const listener = (value: QQInputReceipt): void => {
        if (predicate(value)) {
          receiptListeners.delete(listener);
          resolve(value);
        }
      };
      receiptListeners.add(listener);
    });
  };
  const terminal = (messageId: string): Promise<RuntimeInputTerminal> =>
    new Promise((resolve) => {
      const off = current.runtime.onInputTerminal((event) => {
        if (
          event.admission.origin.kind === 'qq' &&
          event.admission.origin.messageId === messageId
        ) {
          off();
          resolve(event);
        }
      });
    });
  return { service: current, request, view, listening, receipts, waitReceipt, terminal };
}

it('boots the actual service with QQ off and keeps owner APIs usable when the feature is disabled', async () => {
  const f = await setup();
  const snapshot = await f.service.runtime.snapshot();
  expect(snapshot.agent.status).toBe('ready');
  expect(snapshot.qq?.sources.map((source) => source.phase)).toEqual(['disabled', 'disabled']);
  const view = await f.view();
  expect(
    view.sources.every((source) => !source.desiredEnabled && !source.credential.available),
  ).toBe(true);
  expect((await fetch(new URL('/api/qq', f.service.url))).status).toBe(401);
  expect(
    (
      await f.request(`/api/plugins/${QQ_FEATURE_PLUGIN_ID}`, {
        commandId: randomUUID(),
        enabled: false,
      })
    ).status,
  ).toBe(200);
  expect((await f.service.runtime.snapshot()).agent.status).toBe('ready');
  expect((await f.view()).sources.every((source) => source.source !== 'ready')).toBe(true);
  expect((await f.request('/api/qq/status')).status).toBe(200);
});

it('takes a real authenticated OneBot frame through policy, State, Core and terminal without trusting sender rank', async () => {
  const f = await setup();
  let view = await f.view();
  const source = view.sources.find((item) => item.protocol === 'onebot-v11');
  if (!source) throw new Error('missing source');
  view = await f.view('/api/qq/source', {
    protocol: 'onebot-v11',
    expectedRevision: source.configRevision,
    settings: {
      protocol: 'onebot-v11',
      accountId: '10001',
      mode: 'reverse-ws',
      channelMode: 'universal',
      mediaProfile: 'snowluma-v11',
      listenHost: '127.0.0.1',
      listenPort: 0,
      path: '/qq',
    },
  });
  const account: QQAccountRef = {
    protocol: 'onebot-v11',
    sourcePluginId: QQ_ONEBOT_PLUGIN_ID,
    instanceId: 'default',
    accountId: '10001',
  };
  const actor = { account, scene: 'private' as const, senderId: '30001' };
  view = await f.view('/api/qq/policy', {
    expectedRevision: view.policy.revision,
    settings: { ...view.policy.settings, privateAllowlist: [actor] },
  });
  const configured = view.sources.find((item) => item.protocol === 'onebot-v11');
  if (!configured) throw new Error('missing configured source');
  const key = 'onebot-test-key-private-new-slot';
  view = await f.view('/api/qq/credential', {
    protocol: 'onebot-v11',
    expectedRevision: configured.configRevision,
    expectedCredentialVersion: configured.credential.version,
    value: key,
  });
  expect(JSON.stringify(view)).not.toContain(key);
  expect(
    (
      await f.request(`/api/plugins/${QQ_ONEBOT_PLUGIN_ID}`, {
        commandId: randomUUID(),
        enabled: true,
      })
    ).status,
  ).toBe(200);
  const port = await bounded(f.listening.promise);
  const peer = new WebSocket(`ws://127.0.0.1:${port}/qq`, {
    headers: { Authorization: `Bearer ${key}`, 'X-Self-ID': '10001', 'X-Client-Role': 'Universal' },
  });
  const sent: Array<{ action: string; params: Record<string, unknown>; echo: string }> = [];
  peer.on('message', (bytes) => {
    const packet = JSON.parse(bytes.toString()) as {
      action: string;
      params: Record<string, unknown>;
      echo: string;
    };
    sent.push(packet);
    peer.send(
      JSON.stringify({
        status: 'ok',
        retcode: 0,
        data: { message_id: 9000 + sent.length },
        echo: packet.echo,
      }),
    );
  });
  cleanups.push(async () => {
    if (peer.readyState !== WebSocket.CLOSED) {
      const ended = once(peer, 'close');
      peer.terminate();
      await ended;
    }
  });
  await bounded(once(peer, 'open'));
  const first = f.terminal('-71');
  const frame = {
    post_type: 'message',
    self_id: 10001,
    time: Math.floor(Date.now() / 1000),
    message_type: 'private',
    sub_type: 'friend',
    message_id: -71,
    user_id: 30001,
    target_id: 10001,
    sender: { user_id: 30001, nickname: 'owner', role: 'owner' },
    message: [{ type: 'text', data: { text: 'hello from a whitelisted member' } }],
  };
  peer.send(JSON.stringify(frame));
  const terminal = await bounded(first);
  expect(terminal.grant.role).toBe('member');
  expect(terminal.admission.origin.audience.kind).toBe('person-private');
  expect(terminal.outputs.length).toBeGreaterThan(0);
  const delivered = await bounded(f.service.delivery.onTerminal(terminal));
  expect(delivered).toMatchObject({ phase: 'terminal', outcome: 'accepted' });
  expect(delivered?.parts[0]?.send?.receipt).toMatchObject({
    messageId: '9001',
    sequence: null,
    sequenceAuthoritative: null,
  });
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({
    action: 'send_private_msg',
    params: { user_id: '30001' },
  });
  await bounded(f.service.delivery.onTerminal(terminal));
  expect(sent).toHaveLength(1);
  expect(JSON.stringify(sent)).not.toContain(key);
  expect(JSON.stringify(sent)).not.toContain(token);
  expect(terminal.outputs.every((message) => message.audience?.kind === 'person-private')).toBe(
    true,
  );
  expect(
    (await f.service.runtime.snapshot()).messages.some(
      (message) =>
        message.inputId === terminal.admission.id || message.id === terminal.admission.id,
    ),
  ).toBe(false);
  const saved = await f.view();
  await f.view('/api/qq/policy', {
    expectedRevision: saved.policy.revision,
    settings: {
      ...saved.policy.settings,
      principalAliases: [{ actor, principalId: 'owner' }],
    },
  });
  peer.send(JSON.stringify(frame));
  const duplicate = await bounded(
    f.waitReceipt((item) => item.state === 'duplicate' && item.inputId === terminal.admission.id),
  );
  expect(duplicate.messageId).toBe(terminal.admission.messageId);
  expect(
    (
      await f.service.runtime.state('getInput', {
        id: terminal.admission.id,
        scope: { kind: 'management' },
      })
    ).origin.principalId,
  ).not.toBe('owner');
  const second = f.terminal('-72');
  peer.send(
    JSON.stringify({
      ...frame,
      message_id: -72,
      message: [{ type: 'text', data: { text: 'new owner-bound input' } }],
    }),
  );
  const owner = await bounded(second);
  expect(owner.grant.role).toBe('owner');
  expect((await bounded(f.service.delivery.onTerminal(owner)))?.outcome).toBe('accepted');
  expect(sent).toHaveLength(2);
  expect(owner.admission.origin.audience).toEqual({ kind: 'owner-private' });
  const page = (await (await f.request('/api/qq/deliveries?limit=1')).json()) as {
    ok: boolean;
    value: unknown;
  };
  if (!page.ok || !isQQDeliveryPage(page.value)) throw new Error('invalid delivery page');
  expect(page.value.next).not.toBeNull();
  const next = (await (
    await f.request(`/api/qq/deliveries?limit=1&after=${encodeURIComponent(page.value.next ?? '')}`)
  ).json()) as { ok: boolean; value: unknown };
  if (!next.ok || !isQQDeliveryPage(next.value)) throw new Error('invalid next delivery page');
  expect(next.value.deliveries[0]?.id).not.toBe(page.value.deliveries[0]?.id);
  expect(
    (await f.service.runtime.snapshot()).messages.some(
      (message) => message.id === owner.admission.id,
    ),
  ).toBe(true);
}, 20000);

it('serves verified material bytes through the owner HTTP gate instead of the notice stub', async () => {
  const f = await setup();
  const fixture = await seedMaterialView(f.service);
  const text = fixture.fullText;
  const material = fixture.document;
  const url = new URL(`/api/materials/${material.id}`, f.service.url);
  expect((await fetch(url)).status).toBe(401);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-length')).toBe(String(material.sizeBytes));
  expect(response.headers.get('content-disposition')).toContain('attachment;');
  expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
  expect(await response.text()).toBe(text);
});

it('keeps credential writes closed on a remote-named entry and validates source/CAS HTTP bodies', async () => {
  const f = await setup();
  const response = await f.request('/api/qq', undefined, { Host: '10.1.0.99:4120' });
  const payload = (await response.json()) as { ok: boolean; value: QQView };
  expect(isQQView(payload.value)).toBe(true);
  expect(payload.value.sources.every((source) => !source.credential.writable)).toBe(true);
  expect(payload.value.judge.credential.writable).toBe(false);
  const source = payload.value.sources[0];
  if (!source) throw new Error('missing source');
  expect(
    (
      await f.request(
        '/api/qq/credential',
        {
          protocol: source.protocol,
          expectedRevision: source.configRevision,
          expectedCredentialVersion: source.credential.version,
          value: 'not-to-be-applied',
        },
        { Host: '10.1.0.99:4120' },
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await f.request('/api/qq/policy', {
        expectedRevision: -1,
        settings: payload.value.policy.settings,
      })
    ).status,
  ).toBe(400);
  expect((await f.request('/api/qq/deliveries?limit=33')).status).toBe(400);
});
