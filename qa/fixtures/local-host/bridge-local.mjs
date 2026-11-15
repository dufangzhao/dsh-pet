import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { once } from 'node:events';
import { createRequire } from 'node:module';
const { WebSocket } = createRequire(
  new URL('../../../packages/local-host/package.json', import.meta.url),
)('ws');
import {
  createLocalPluginKernel,
  connectAgentBridge,
  checkRemoteAuthority,
} from '../../../packages/local-host/src/index.ts';
import { KernelFault } from '../../../packages/host-kernel/src/index.ts';
import {
  LOCAL_HOST_PROTOCOL_VERSION,
  QQ_OFFICIAL_PLUGIN_ID,
  QQ_ONEBOT_PLUGIN_ID,
  isQQDeliveryView,
  makeError,
} from '../../../packages/contracts/src/index.ts';
import { createAuthorizedOfficialIo, createAuthorizedOneBotIo } from '../../../packages/local-host/src/qq-native/index.ts';
import { createQQDeliverySource } from '../../../packages/local-host/src/qq-delivery-transport.ts';
import { deferred, keyOf, noPrivate, ok, within } from './bridge-common.mjs';

const input = (await once(process, 'message'))[0];
assert.equal(input.kind, 'start');
const bootId = randomUUID(),
  sourceBindings = new Map(),
  sourceDrivers = new Map(),
  revisions = new Map();
const ready = new Map([
  [QQ_OFFICIAL_PLUGIN_ID, deferred()],
  [QQ_ONEBOT_PLUGIN_ID, deferred()],
]);
const listen = deferred(),
  records = new Map(),
  continuations = new Map(),
  liveTasks = new Map();
let kernel, bridge, officialSource, onebotPeer, closing;
const sourceStatuses = new Map();
const runs = [],
  controlErrors = [],
  observedJson = [];
const secret = 'CONTROLLED_QQ_SECRET_CANARY';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const officialConfig = { protocol: 'official', appId: 'qa-app', scenes: ['private'] };
const onebotConfig = {
  protocol: 'onebot-v11',
  accountId: '10001',
  mode: 'reverse-ws',
  channelMode: 'universal',
  mediaProfile: 'snowluma-v11',
  listenHost: '127.0.0.1',
  listenPort: 0,
  path: '/controlled-qq',
};
function capture(host, context, settings) {
  const identity = { pluginId: context.owner.pluginId, instanceId: context.owner.instanceId };
  const epoch = host.permissionControl.inspect(identity).epoch;
  const captured = {
    owner: context.owner,
    signal: context.signal,
    settings,
    configRevision: revisions.get(identity.pluginId),
    permissionEpoch: epoch,
    credential: secret,
    credentialVersion: 'immutable-controlled-key-v1',
    async check() {
      const policy = host.permissionControl.inspect(identity),
        config = await host.configs.get(identity);
      if (
        !host.manager.isActive(context.owner) ||
        context.signal.aborted ||
        !host.verifySource(identity.pluginId) ||
        policy?.epoch !== epoch ||
        policy.blocked ||
        policy.preset === 'deny' ||
        !config.ok ||
        config.value.revision !== captured.configRevision ||
        !isDeepStrictEqual(config.value.data, settings)
      )
        throw new KernelFault('stale-owner');
    },
  };
  sourceBindings.set(identity.pluginId, captured);
  return captured;
}
const specs = [];
for (const [pluginId, name, config] of [
  [QQ_OFFICIAL_PLUGIN_ID, 'qq-official', officialConfig],
  [QQ_ONEBOT_PLUGIN_ID, 'qq-onebot', onebotConfig],
]) {
  const directory = path.join(root, 'plugins', name);
  specs.push([
    name,
    {
      directory,
      manifest: JSON.parse(await readFile(path.join(directory, 'plugin.json'), 'utf8')),
      preset: 'allow',
      config,
      portsFor(context, host) {
        const observer = {
          onStatus(status) {
            sourceStatuses.set(pluginId, status);
            if (status.phase === 'ready') ready.get(pluginId).resolve(status);
          },
          onEvent: async () => {},
        };
        const bind = (driver) => {
          sourceDrivers.set(pluginId, driver);
          return async () => {
            sourceDrivers.delete(pluginId);
          };
        };
        if (pluginId === QQ_OFFICIAL_PLUGIN_ID)
          return {
            observer,
            bind,
            authorizedOfficial(settings) {
              return createAuthorizedOfficialIo(host, capture(host, context, settings), {
                fetch: (target, init) => {
                  const native = new URL(String(target));
                  if (native.origin !== 'https://api.bot.qq.com')
                    throw new Error('Unexpected official target');
                  return fetch(new URL(native.pathname + native.search, input.nativeUrl), init);
                },
                websocket: () => new WebSocket(input.nativeUrl.replace('http:', 'ws:')),
              });
            },
          };
        return {
          observer,
          bind,
          authorizedOneBot: (settings) =>
            createAuthorizedOneBotIo(host, capture(host, context, settings), {
              onListening: (address) => listen.resolve(address.port),
            }),
        };
      },
    },
  ]);
}

function publicOutcome(outcome) {
  const value = { ...outcome };
  delete value.uploaded;
  assert(noPrivate(value));
  return value;
}
function fail(error) {
  return { ok: false, error: error instanceof KernelFault ? error.error : makeError('internal') };
}
async function connect() {
  let current;
  current = await connectAgentBridge({
    baseUrl: input.baseUrl,
    token: input.token,
    hello: {
      type: 'hello',
      protocolVersion: LOCAL_HOST_PROTOCOL_VERSION,
      packageVersion: '0.1.0-g0',
      hostId: input.hostId,
      bootId,
      agentId: input.agentId,
      agentEpoch: input.agentEpoch,
    },
    channel(context) {
      return {
        live: () => !closing,
        signalFor(owner, taskId) {
          const operation = liveTasks.get(taskId);
          return operation &&
            operation.sessionId === context.sessionId &&
            isDeepStrictEqual(owner, context.owner) &&
            operation.handle.snapshot().workPending &&
            kernel.host.manager.isActive(operation.task.owner)
            ? operation.task.signal
            : null;
        },
        allowJson(value) {
          observedJson.push(value);
          return noPrivate(value);
        },
        handlers: {
          'delivery.execute': async (rpc, request) => {
            try {
              if (
                !isQQDeliveryView(request.delivery) ||
                request.wireTaskId !== rpc.taskId ||
                request.nativeConnectionId !== officialSource.connectionId
              )
                throw new KernelFault('invalid-input');
              const key = keyOf(request);
              if (records.has(key) || liveTasks.has(request.wireTaskId) || records.size >= 12)
                throw new KernelFault('conflict');
              const part = request.delivery.parts.find((value) => value.id === request.partId);
              const attempt = part?.[request.operation === 'send' ? 'send' : 'upload'];
              if (
                !part ||
                !attempt ||
                attempt.id !== request.attemptId ||
                attempt.phase !== 'claimed'
              )
                throw new KernelFault('invalid-input');
              const identity = {
                key,
                attemptId: attempt.id,
                content: part.content,
                route: request.delivery.route,
                nativeConnectionId: officialSource.connectionId,
              };
              if (!isDeepStrictEqual(identity, request.identity))
                throw new KernelFault('permission-denied');
              let uploaded;
              if (part.content.kind !== 'inline-text' && request.operation === 'send') {
                const previous = continuations.get(request.continuation);
                if (
                  !previous ||
                  previous.sessionId !== context.sessionId ||
                  previous.bootId !== bootId ||
                  previous.partId !== part.id ||
                  previous.deliveryId !== request.delivery.id ||
                  previous.nativeConnectionId !== request.nativeConnectionId ||
                  previous.sha256 !== part.content.material.sha256 ||
                  previous.parentAttemptId !== part.upload?.id ||
                  part.upload?.outcome !== 'accepted' ||
                  previous.nextAttemptId !== attempt.id
                )
                  throw new KernelFault('permission-denied');
                uploaded = previous.uploaded;
                continuations.delete(request.continuation);
              }
              let observed, operationFailure;
              let handle;
              handle = kernel.runFor(QQ_OFFICIAL_PLUGIN_ID, async (task) => {
                const operation = { task, handle, sessionId: context.sessionId };
                const check = async () => {
                  const source = sourceBindings.get(QQ_OFFICIAL_PLUGIN_ID);
                  ok(
                    await checkRemoteAuthority({
                      peer: current,
                      signal: task.signal,
                      checkLocal: async () => {
                        task.signal.throwIfAborted();
                        await officialSource.check();
                      },
                      request: {
                        kind: 'delivery',
                        binding: {
                          hostId: input.hostId,
                          hostBootId: bootId,
                          bridgeSessionId: context.sessionId,
                          sourceOwner: source.owner,
                          sourceConfigRevision: source.configRevision,
                          sourcePermissionEpoch: source.permissionEpoch,
                          sourceCredentialVersion: source.credentialVersion,
                          nativeConnectionId: officialSource.connectionId,
                        },
                        task: { owner: task.owner, taskId: task.taskId },
                        deliveryId: request.delivery.id,
                        partId: part.id,
                        attemptId: attempt.id,
                        contentHash:
                          part.content.kind === 'inline-text'
                            ? part.content.sha256
                            : part.content.material.sha256,
                      },
                    }),
                  );
                };
                try {
                  await check();
                  liveTasks.set(request.wireTaskId, operation);
                  let bytes;
                  if (request.operation === 'upload') {
                    if (
                      !request.stream ||
                      request.stream.taskId !== request.wireTaskId ||
                      !isDeepStrictEqual(request.stream.owner, context.owner)
                    )
                      throw new KernelFault('permission-denied');
                    bytes = ok(current.media.createReader(request.stream));
                    ok(current.media.grantInitial(request.stream));
                  }
                  const outcome = await officialSource.transport.execute(
                    {
                      delivery: request.delivery,
                      part,
                      operation: request.operation,
                      expectedConnectionId: request.nativeConnectionId,
                      attemptId: attempt.id,
                      check,
                      ...(bytes ? { bytes, material: part.content.material } : {}),
                      ...(uploaded ? { uploaded } : {}),
                    },
                    task.signal,
                    async () => {},
                  );
                  observed = publicOutcome(outcome);
                  if (outcome.uploaded) {
                    const continuation = randomUUID();
                    continuations.set(continuation, {
                      uploaded: outcome.uploaded,
                      bootId,
                      sessionId: context.sessionId,
                      partId: part.id,
                      deliveryId: request.delivery.id,
                      nativeConnectionId: request.nativeConnectionId,
                      sha256: part.content.material.sha256,
                      parentAttemptId: attempt.id,
                      nextAttemptId: `${part.id}-send`,
                    });
                    observed = { ...observed, continuation };
                  }
                  // Retain the actual outcome before a possibly lost RPC return; not an execution queue.
                  records.set(key, {
                    identity,
                    sessionId: context.sessionId,
                    bootId,
                    localTask: { owner: task.owner, taskId: task.taskId },
                    outcome: publicOutcome(outcome),
                    handle,
                  });
                } catch (error) {
                  operationFailure = error;
                } finally {
                  liveTasks.delete(request.wireTaskId);
                }
                return null;
              });
              await handle.result;
              await handle.settled;
              if (operationFailure) throw operationFailure;
              if (!observed) throw new KernelFault('unavailable');
              if (request.dropReply) {
                assert.equal(observed.outcome, 'accepted', JSON.stringify(observed));
                current.close();
                await current.settled;
              }
              return { ok: true, value: observed };
            } catch (error) {
              return fail(error);
            }
          },
          'delivery.inspect': async (_rpc, request) => {
            const record = records.get(request.key);
            if (
              !record ||
              request.originalSessionId !== record.sessionId ||
              request.attemptId !== record.identity.attemptId ||
              !isDeepStrictEqual(request.identity, record.identity) ||
              record.bootId !== bootId
            )
              return fail(new KernelFault('permission-denied'));
            return {
              ok: true,
              value: {
                outcome: record.outcome,
                originalSessionId: record.sessionId,
                bootId,
                localTask: record.localTask,
                workPending: record.handle.snapshot().workPending,
                cleanupFailed: record.handle.snapshot().cleanupFailed,
              },
            };
          },
        },
      };
    },
  });
  bridge = current;
  const sources = [QQ_OFFICIAL_PLUGIN_ID, QQ_ONEBOT_PLUGIN_ID].map((pluginId) => ({
    account: {
      protocol: pluginId === QQ_OFFICIAL_PLUGIN_ID ? 'official' : 'onebot-v11',
      sourcePluginId: pluginId,
      instanceId: 'default',
      accountId: pluginId === QQ_OFFICIAL_PLUGIN_ID ? 'qa-app' : '10001',
    },
    owner: kernel.host.owner(pluginId),
    connectionId: sourceDrivers.get(pluginId).status.connectionId,
    trusted: kernel.review(pluginId).trusted,
    configRevision: sourceBindings.get(pluginId).configRevision,
    permissionEpoch: sourceBindings.get(pluginId).permissionEpoch,
    credentialVersion: sourceBindings.get(pluginId).credentialVersion,
  }));
  ok(await current.rpc.request('source.offer', { hostId: input.hostId, bootId, sources }));
}

async function close() {
  if (closing) return closing;
  closing = (async () => {
    bridge?.close();
    await bridge?.settled;
    await kernel?.close();
    if (onebotPeer && onebotPeer.readyState !== WebSocket.CLOSED) {
      const ended = once(onebotPeer, 'close');
      onebotPeer.terminate();
      await ended;
    }
    await Promise.all(runs.map((handle) => handle.settled));
    const summary = {
      pendingWork: kernel.host.tasks.diagnostics().pendingWork,
      leases: kernel.host.permissions.diagnostics().leases,
      localPlugins: kernel.host.manager.list().map((entry) => entry.owner.pluginId),
      rootEntries: await readdir(input.directory),
      operations: records.size,
      privateWireLeaks: observedJson.filter((value) => !noPrivate(value)).length,
      errors: controlErrors,
    };
    assert.equal(summary.pendingWork, 0);
    assert.equal(summary.leases, 0);
    return summary;
  })();
  return closing;
}
try {
  kernel = await createLocalPluginKernel({
    dataDirectory: input.directory,
    official: specs[0][1],
    onebot: specs[1][1],
  });
  for (const pluginId of [QQ_OFFICIAL_PLUGIN_ID, QQ_ONEBOT_PLUGIN_ID]) {
    revisions.set(
      pluginId,
      ok(await kernel.host.configs.get({ pluginId, instanceId: 'default' })).revision,
    );
    const review = kernel.review(pluginId);
    assert.equal(review.trusted, false);
    kernel.confirmTrust(pluginId, review.digest);
    await kernel.setEnabled(pluginId, true);
    runs.push(
      kernel.runFor(pluginId, async (task) => {
        await sourceDrivers.get(pluginId).start(task.signal);
        return null;
      }),
    );
  }
  const port = await within(listen.promise, 'OneBot listener');
  onebotPeer = new WebSocket(`ws://127.0.0.1:${port}/controlled-qq`, {
    headers: {
      Authorization: `Bearer ${secret}`,
      'X-Self-ID': '10001',
      'X-Client-Role': 'Universal',
    },
  });
  await once(onebotPeer, 'open');
  await Promise.all([...ready.values()].map((entry) => within(entry.promise, 'real source ready')));
  const binding = sourceBindings.get(QQ_OFFICIAL_PLUGIN_ID),
    driver = sourceDrivers.get(QQ_OFFICIAL_PLUGIN_ID);
  officialSource = createQQDeliverySource({
    account: {
      protocol: 'official',
      sourcePluginId: QQ_OFFICIAL_PLUGIN_ID,
      instanceId: 'default',
      accountId: 'qa-app',
    },
    protocol: 'official',
    driver,
    connectionId: driver.status.connectionId,
    signal: binding.signal,
    check: binding.check,
  });
  await connect();
  process.send({ kind: 'ready', pid: process.pid, bootId });
  process.on('message', (message) => {
    void (async () => {
      if (message.kind === 'reconnect') {
        await bridge.settled;
        await connect();
        process.send({ kind: 'reconnected', id: message.id });
      } else if (message.kind === 'close') {
        const summary = await close();
        process.send({ kind: 'closed', id: message.id, summary }, () => process.disconnect());
      } else throw new Error('Unknown QA process control');
    })().catch((error) => {
      controlErrors.push(String(error));
      process.send({ kind: 'error', error: String(error) });
    });
  });
  process.on('disconnect', () => {
    void close().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  });
} catch (error) {
  process.send?.({
    kind: 'error',
    error: String(error),
    stack: `${error.stack}\nSource status: ${JSON.stringify([...sourceStatuses])}`,
  });
  if (kernel) await close();
  process.exitCode = 1;
  process.disconnect?.();
}
