import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { afterEach, expect, it } from 'vitest';
import { QQ_ONEBOT_PLUGIN_ID, type QQAccountRef } from '@pet/contracts';
import type { RuntimeInputGrant } from '@pet/companion-runtime';
import type { ResponseClient } from '@pet/harness-cortico';
import { createCompanionService } from './service.js';

function latch(): { promise: Promise<void>; resolve(): void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

it('starts each committed ACL recheck while an older real grant check is gated', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'qq-policy-recheck-race-'));
  const modelEntered = latch();
  const modelAborted = latch();
  const modelRelease = latch();
  const firstCheck = latch();
  const releaseCheck = latch();
  let resolvePort: (port: number) => void = () => {};
  const port = new Promise<number>((resolve) => {
    resolvePort = resolve;
  });
  const client: ResponseClient = {
    async respond(_request, options) {
      const signal = options?.signal;
      if (!signal) throw new Error('model fixture requires abort signal');
      modelEntered.resolve();
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener('abort', () => resolve(), { once: true });
      });
      modelAborted.resolve();
      await modelRelease.promise;
      throw new DOMException('cancelled fixture work', 'AbortError');
    },
  };
  const owned: { service?: Awaited<ReturnType<typeof createCompanionService>>; peer?: WebSocket } =
    {};
  cleanups.push(async () => {
    releaseCheck.resolve();
    modelRelease.resolve();
    if (owned.peer && owned.peer.readyState !== WebSocket.CLOSED) {
      const closed = once(owned.peer, 'close');
      owned.peer.terminate();
      await closed;
    }
    await owned.service?.close();
    const target = await realpath(directory);
    if (
      path.dirname(target) !== (await realpath(tmpdir())) ||
      !path.basename(target).startsWith('qq-policy-recheck-race-')
    )
      throw new Error('wrong cleanup target');
    await rm(target, { recursive: true });
  });
  const current = await createCompanionService({
    dataDirectory: directory,
    token: 'qq-policy-race-synthetic-token-6d04',
    hostname: '127.0.0.1',
    port: 0,
    mode: 'model',
    client,
    qqController: { onebotTest: { onListening: (address) => resolvePort(address.port) } },
  });
  owned.service = current;
  let view = await current.qq.view();
  const initial = view.sources.find((source) => source.protocol === 'onebot-v11');
  if (!initial) throw new Error('missing onebot source');
  view = await current.qq.saveSource({
    protocol: 'onebot-v11',
    expectedRevision: initial.configRevision,
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
  view = await current.qq.savePolicy({
    expectedRevision: view.policy.revision,
    settings: { ...view.policy.settings, privateAllowlist: [actor] },
  });
  const configured = view.sources.find((source) => source.protocol === 'onebot-v11');
  if (!configured) throw new Error('missing configured source');
  await current.qq.credential({
    protocol: 'onebot-v11',
    expectedRevision: configured.configRevision,
    expectedCredentialVersion: configured.credential.version,
    value: 'qq-race-synthetic-key-14fd',
  });
  await current.qq.setPlugin(QQ_ONEBOT_PLUGIN_ID, true, randomUUID());
  const listenPort = await port;
  const peer = new WebSocket(`ws://127.0.0.1:${listenPort}/qq`, {
    headers: {
      Authorization: 'Bearer qq-race-synthetic-key-14fd',
      'X-Self-ID': '10001',
      'X-Client-Role': 'Universal',
    },
  });
  owned.peer = peer;
  peer.on('error', () => {});
  await once(peer, 'open');
  peer.send(
    JSON.stringify({
      post_type: 'message',
      self_id: 10001,
      time: Math.floor(Date.now() / 1000),
      message_type: 'private',
      sub_type: 'friend',
      message_id: -91,
      user_id: 30001,
      target_id: 10001,
      sender: { user_id: 30001 },
      message: [{ type: 'text', data: { text: 'controlled pending input' } }],
    }),
  );
  await modelEntered.promise;
  // Observe the actual admitted QQ grant; only its first recheck completion is held open.
  const active = Reflect.get(current.runtime, 'inputs') as Map<
    string,
    { grant: RuntimeInputGrant; controller: AbortController }
  >;
  const input = [...active.values()].find((item) => item.grant.origin.kind === 'qq');
  if (!input) throw new Error('missing live QQ input');
  const original = input.grant.check.bind(input.grant);
  let gate = true;
  input.grant.check = () => {
    const result = Promise.resolve(original());
    void result.catch(() => {});
    if (!gate) return result;
    gate = false;
    firstCheck.resolve();
    return releaseCheck.promise.then(() => result);
  };
  const before = current.qq.policy();
  const first = await current.qq.savePolicy({
    expectedRevision: before.revision,
    settings: { ...before.settings, administratorPrincipalIds: ['different-principal'] },
  });
  await firstCheck.promise;
  expect(input.grant.signal.aborted).toBe(false);
  const denied = await current.qq.savePolicy({
    expectedRevision: first.policy.revision,
    settings: { ...first.policy.settings, privateAllowlist: [] },
  });
  expect(input.grant.signal.aborted).toBe(true);
  await modelAborted.promise;
  const restored = await current.qq.savePolicy({
    expectedRevision: denied.policy.revision,
    settings: { ...denied.policy.settings, privateAllowlist: [actor] },
  });
  expect(restored.policy.settings.privateAllowlist).toEqual([actor]);
  expect(input.grant.signal.aborted).toBe(true);
  await expect(input.grant.check()).rejects.toMatchObject({ error: { code: 'permission-denied' } });
  let closeDone = false;
  const closing = current.qq.close().then(() => {
    closeDone = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(closeDone).toBe(false);
  releaseCheck.resolve();
  modelRelease.resolve();
  await closing;
  expect(closeDone).toBe(true);
});
