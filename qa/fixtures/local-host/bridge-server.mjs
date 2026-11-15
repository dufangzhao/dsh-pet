import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { definePlugin } from '../../../packages/plugin-sdk/src/index.ts';
import { CompanionPluginHost } from '../../../packages/companion-runtime/src/plugin-host.ts';
import {
  companionHostManifest,
  companionHostDefinition,
  STATE_CAPABILITY,
} from '../../../packages/companion-runtime/src/core-plugin.ts';
import stateDefinition from '../../../plugins/state-sqlite/src/index.ts';
import { createMaterialStore } from '../../../apps/companion-service/src/material-store.ts';
import { createAgentBridgeServer } from '../../../packages/local-host/src/index.ts';
import {
  LOCAL_HOST_BRIDGE_PLUGIN_ID,
  QQ_OFFICIAL_PLUGIN_ID,
  QQ_OFFICIAL_PASSIVE_WINDOW_MS,
  isQQDeliveryPartAccepted,
  makeError,
} from '../../../packages/contracts/src/index.ts';
import { KernelFault } from '../../../packages/host-kernel/src/index.ts';
import { bridgeManifest, deferred, keyOf, noPrivate, ok, sha, within } from './bridge-common.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const scope = { kind: 'management' };

/** G0 owner-managed seeds/claims, not a replacement remote participant/ingress controller. */
export async function createServerFixture(directory) {
  await mkdir(directory, { recursive: true });
  const stateDirectory = path.join(root, 'plugins/state-sqlite');
  const stateManifest = JSON.parse(
    await readFile(path.join(stateDirectory, 'plugin.json'), 'utf8'),
  );
  const host = await CompanionPluginHost.create({
    dataDirectory: directory,
    plugins: [
      {
        manifest: companionHostManifest,
        directory: path.join(root, 'packages/companion-runtime'),
        definition: companionHostDefinition,
        preset: 'allow',
        enabled: true,
        protected: true,
      },
      {
        manifest: stateManifest,
        directory: stateDirectory,
        definition: stateDefinition,
        preset: 'allow',
        enabled: true,
      },
      {
        manifest: bridgeManifest,
        directory: path.dirname(fileURLToPath(import.meta.url)),
        definition: definePlugin({ activate() {} }),
        preset: 'allow',
        enabled: true,
      },
    ],
  });
  const initializationCleanup = [() => host.close()];
  try {
    host.bind(STATE_CAPABILITY, 'pet.state-sqlite', 'sqlite');
    const state = async (method, input) => {
      const result = await host.call(STATE_CAPABILITY, method, input);
      if (!result.ok) throw new KernelFault(result.error.code);
      return result.value;
    };
    const initial = await state('snapshot', {});
    const materialRoot = path.join(directory, 'canonical-bytes');
    await mkdir(materialRoot);
    const materials = await createMaterialStore({
      directory: materialRoot,
      host,
      state: { state },
    });
    initializationCleanup.push(() => materials.close());
    const active = new Map(),
      offers = [],
      peers = [],
      wireValues = [],
      checks = [];
    let peer,
      sourceOffer,
      sourceReady = deferred(),
      peerReady = deferred(),
      seedNumber = 0;
    const token = `controlled-bridge-token-${randomUUID()}`,
      hostId = randomUUID();
    const server = createServer((_request, response) => {
      response.writeHead(404).end();
    });
    const bridge = createAgentBridgeServer({
      server,
      token,
      hostId,
      agentId: initial.assistantId,
      agentEpoch: initial.epoch,
      owner: host.owner(LOCAL_HOST_BRIDGE_PLUGIN_ID),
      channel(_hello, context) {
        return {
          live: () =>
            host.manager.isActive(context.owner) && host.verifySource(LOCAL_HOST_BRIDGE_PLUGIN_ID),
          signalFor(owner, taskId) {
            const operation = active.get(taskId);
            return operation &&
              isDeepStrictEqual(owner, context.owner) &&
              operation.sessionId === context.sessionId &&
              operation.handle.snapshot().workPending &&
              operation.lease.isValid()
              ? operation.task.signal
              : null;
          },
          allowJson(value) {
            wireValues.push(value);
            return noPrivate(value);
          },
          handlers: {
            'source.offer': async (_rpc, offer) => {
              assert.equal(offer.hostId, hostId);
              assert.equal(offer.bootId, _hello.bootId);
              assert.equal(offer.sources.length, 2);
              for (const source of offer.sources) {
                assert(source.connectionId);
                assert.equal(source.trusted, true);
                assert.equal(source.owner.pluginId, source.account.sourcePluginId);
              }
              sourceOffer = offer;
              offers.push(offer);
              sourceReady.resolve(offer);
              return { ok: true, value: null };
            },
            'authority.check': async (rpc, request) => {
              const operation = [...active.values()].find(
                (value) =>
                  value.delivery.id === request.deliveryId &&
                  value.partId === request.partId &&
                  value.attempt.id === request.attemptId,
              );
              try {
                if (
                  !operation ||
                  operation.sessionId !== context.sessionId ||
                  request.kind !== 'delivery' ||
                  rpc.taskId !== request.task?.taskId ||
                  request.binding?.hostId !== context.hostId ||
                  request.binding.hostBootId !== context.bootId ||
                  request.binding.bridgeSessionId !== context.sessionId
                )
                  throw new KernelFault('permission-denied');
                await operation.check();
                const contentHash =
                  operation.identity.content.kind === 'inline-text'
                    ? operation.identity.content.sha256
                    : operation.identity.content.material.sha256;
                if (request.contentHash !== contentHash) throw new KernelFault('permission-denied');
                const source = sourceOffer?.sources.find(
                  (entry) => entry.account.protocol === 'official',
                );
                if (
                  !source ||
                  !isDeepStrictEqual(request.task.owner, source.owner) ||
                  !isDeepStrictEqual(request.binding.sourceOwner, source.owner) ||
                  request.binding.sourceConfigRevision !== source.configRevision ||
                  request.binding.sourcePermissionEpoch !== source.permissionEpoch ||
                  request.binding.sourceCredentialVersion !== source.credentialVersion ||
                  request.binding.nativeConnectionId !== source.connectionId
                )
                  throw new KernelFault('stale-owner');
                if (!operation.localTask) operation.localTask = structuredClone(request.task);
                else if (!isDeepStrictEqual(operation.localTask, request.task))
                  throw new KernelFault('conflict');
                const delivery = await state('getDelivery', { id: operation.delivery.id, scope });
                const part = delivery.parts.find((entry) => entry.id === operation.partId);
                const attempt = part?.[operation.operation === 'send' ? 'send' : 'upload'];
                if (
                  !attempt ||
                  attempt.id !== operation.attempt.id ||
                  attempt.phase === 'settled' ||
                  delivery.phase !== 'sending' ||
                  !isDeepStrictEqual(part.content, operation.identity.content) ||
                  !isDeepStrictEqual(delivery.route, operation.identity.route)
                )
                  throw new KernelFault('permission-denied');
                checks.push({
                  attemptId: attempt.id,
                  localTask: request.task,
                  serverTask: operation.task.taskId,
                });
                return {
                  ok: true,
                  value: {
                    validForMs: Math.min(5000, delivery.eligibilityExpiresAt - Date.now()),
                  },
                };
              } catch (error) {
                return {
                  ok: false,
                  error: error instanceof KernelFault ? error.error : makeError('internal'),
                };
              }
            },
          },
        };
      },
      onPeer(value) {
        peer = value;
        peers.push(value);
        peerReady.resolve(value);
      },
    });
    initializationCleanup.push(() => bridge.close());
    initializationCleanup.push(async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No bridge server address');

    function owned(work) {
      const ready = deferred();
      let handle;
      handle = host.runFor(LOCAL_HOST_BRIDGE_PLUGIN_ID, async (task) => {
        const lease = ok(
          await host.permissions.authorize(
            task.owner,
            task.taskId,
            { kind: 'files', scope: 'plugin-data', access: 'read-write' },
            task.signal,
          ),
        );
        const abort = () => handle.cancel('permission-revoked');
        lease.signal.addEventListener('abort', abort, { once: true });
        const operation = {
          handle,
          task,
          lease,
          async check() {
            task.signal.throwIfAborted();
            if (!lease.isValid() || !host.verifySource(LOCAL_HOST_BRIDGE_PLUGIN_ID))
              throw new KernelFault('permission-denied');
          },
        };
        ready.resolve(operation);
        try {
          await operation.check();
          return await work(operation);
        } finally {
          lease.signal.removeEventListener('abort', abort);
          lease.close();
        }
      });
      return { handle, ready: ready.promise };
    }
    async function manage(work) {
      let observed, failure;
      const current = owned(async (operation) => {
        try {
          observed = await work(operation);
        } catch (error) {
          failure = error;
        }
        return null;
      });
      const result = await current.handle.result;
      await current.handle.settled;
      if (failure) throw failure;
      ok(result);
      return observed;
    }
    async function seed(text, image) {
      return manage(async (operation) => {
        const id = `bridge-input-${++seedNumber}`,
          materialId = `${id}-image`,
          now = Date.now();
        const account = {
          protocol: 'official',
          sourcePluginId: QQ_OFFICIAL_PLUGIN_ID,
          instanceId: 'default',
          accountId: 'qa-app',
        };
        const route = {
          kind: 'qq',
          account,
          scene: 'private',
          targetId: 'qa-recipient',
          reference: {
            eventId: null,
            messageId: `native-basis-${seedNumber}`,
            occurredAt: now,
            displayReference: null,
          },
        };
        // Durable synthetic provenance is fixture data. Authority here is the real QA owner's kernel task.
        const origin = {
          kind: 'qq',
          inputId: id,
          principalId: 'qa-person',
          audience: { kind: 'person-private', principalId: 'qa-person' },
          route,
          policyRevision: 1,
          actor: { account, scene: 'private', senderId: 'qa-recipient' },
          eventKey: `${id}-event`,
          messageId: route.reference.messageId,
          trigger: 'direct',
          quote: null,
        };
        await state('createInput', {
          id,
          commandId: `${id}-command`,
          origin,
          evidence: { fixture: 'owner-managed G0 seed; no participant admission' },
          materialIds: image ? [materialId] : [],
        });
        const access = { scope, signal: operation.task.signal, check: operation.check };
        let material;
        if (image)
          material = await materials.put(
            { id: materialId, inputId: id, kind: 'image', name: 'actual.png' },
            (async function* () {
              yield image;
            })(),
            access,
          );
        await state('commitInput', {
          id,
          text: 'Controlled operator seed',
          materials: material ? [material] : [],
          content: { kind: 'inline-text' },
        });
        const message = await state('appendMessage', {
          id: `${id}-answer`,
          inputId: id,
          role: 'assistant',
          text,
          audience: origin.audience,
          origins: [origin],
          materials: material ? [material] : [],
          content: { kind: 'inline-text' },
        });
        const part = (index, requirement, content) => ({
          id: `${id}-part-${index}`,
          index,
          requirement,
          content,
          preparation: 'ready',
          error: null,
          msgSeq: null,
          upload: null,
          send: null,
        });
        const parts = [part(0, 'mandatory-text', { kind: 'inline-text', text, sha256: sha(text) })];
        if (material) parts.push(part(1, 'required-media', { kind: 'material', material }));
        const delivery = await state('createDelivery', {
          delivery: {
            id: `${id}-delivery`,
            messageIds: [message.id],
            origins: [origin],
            audience: origin.audience,
            route,
            textRepresentation: 'inline',
            mode: 'official-passive',
            eligibilityExpiresAt: now + QQ_OFFICIAL_PASSIVE_WINDOW_MS,
            allowedMessageParts: parts.length,
            phase: 'prepared',
            outcome: 'pending',
            parts,
            createdAt: now,
            updatedAt: now,
            error: null,
          },
        });
        return delivery;
      });
    }
    async function claim(deliveryId, partId, operation) {
      return manage(async () =>
        state('claimDeliveryAttempt', {
          id: deliveryId,
          partId,
          attempt: {
            id: `${partId}-${operation}`,
            operation,
            phase: 'claimed',
            outcome: 'pending',
            correlationId: null,
            receipt: null,
            cleanup: 'pending',
            error: null,
            startedAt: Date.now(),
            settledAt: null,
          },
        }),
      );
    }
    async function execute(claimed, partId, operation, options = {}) {
      assert.equal(claimed.claimed, true, 'a duplicate claim never reaches native execute');
      const connected = peer;
      if (!connected || connected.signal.aborted) throw new Error('No bridge');
      const source = sourceOffer.sources.find((entry) => entry.account.protocol === 'official');
      assert(source);
      let observed, failure;
      const done = owned(async (ownedOperation) => {
        const delivery = claimed.delivery,
          part = delivery.parts.find((entry) => entry.id === partId);
        const attempt = part[operation === 'send' ? 'send' : 'upload'];
        const request = {
          delivery,
          partId,
          operation,
          attemptId: attempt.id,
          wireTaskId: ownedOperation.task.taskId,
          nativeConnectionId: source.connectionId,
          ...(options.continuation ? { continuation: options.continuation } : {}),
          ...(options.dropReply ? { dropReply: true } : {}),
        };
        const identity = {
          key: keyOf(request),
          attemptId: attempt.id,
          content: part.content,
          route: delivery.route,
          nativeConnectionId: source.connectionId,
        };
        const record = {
          ...ownedOperation,
          ...request,
          attempt,
          identity,
          sessionId: connected.context.sessionId,
        };
        active.set(request.wireTaskId, record);
        try {
          let writer;
          if (operation === 'upload') {
            request.stream = {
              owner: connected.context.owner,
              taskId: request.wireTaskId,
              streamId: randomUUID(),
            };
            writer = ok(connected.media.createWriter(request.stream));
          }
          const returned = connected.rpc.request(
            'delivery.execute',
            { ...request, identity },
            { taskId: request.wireTaskId, budgetMs: 15000 },
          );
          let sending = Promise.resolve();
          if (writer)
            sending = materials.withMaterial(
              part.content.material.id,
              { scope, signal: ownedOperation.task.signal, check: ownedOperation.check },
              async (_material, bytes) => {
                for await (const chunk of bytes) ok(await writer.write(chunk));
                ok(await writer.end());
              },
            );
          observed = {
            result: await returned,
            request,
            identity,
            context: connected.context,
            localTask: record.localTask,
          };
          await sending;
        } catch (error) {
          failure = error;
        } finally {
          active.delete(request.wireTaskId);
        }
        return null;
      });
      const result = await done.handle.result;
      await done.handle.settled;
      if (failure) throw failure;
      ok(result);
      return observed;
    }
    async function settle(deliveryId, partId, operation, outcome) {
      return manage(async () => {
        const delivery = await state('getDelivery', { id: deliveryId, scope });
        const slot = operation === 'send' ? 'send' : 'upload';
        const parts = delivery.parts.map((part) =>
          part.id !== partId
            ? part
            : {
                ...part,
                [slot]: {
                  ...part[slot],
                  phase: 'settled',
                  outcome: outcome.outcome,
                  correlationId: outcome.correlationId ?? part[slot].correlationId,
                  receipt: outcome.receipt,
                  cleanup: outcome.cleanup,
                  error: outcome.error ?? null,
                  settledAt: part[slot].settledAt ?? Math.max(Date.now(), part[slot].startedAt),
                },
              },
        );
        const finished = parts.every(isQQDeliveryPartAccepted),
          uncertain = parts.some((part) =>
            [part.upload, part.send].some((attempt) => attempt?.outcome === 'unknown'),
          );
        return state('updateDelivery', {
          delivery: {
            ...delivery,
            parts,
            updatedAt: Date.now(),
            ...(finished || uncertain
              ? { phase: 'terminal', outcome: uncertain ? 'unknown' : 'accepted' }
              : {}),
          },
        });
      });
    }
    return {
      directory,
      host,
      state,
      materials,
      initial,
      token,
      hostId,
      checks,
      wireValues,
      offers,
      seed,
      claim,
      execute,
      settle,
      baseUrl: `http://127.0.0.1:${address.port}`,
      async ready() {
        await within(peerReady.promise, 'bridge hello');
        return within(sourceReady.promise, 'two actual source offers');
      },
      get peer() {
        return peer;
      },
      async prepareReconnect() {
        if (peer) await peer.settled;
        sourceReady = deferred();
        peerReady = deferred();
      },
      async inspect(original) {
        return ok(
          await peer.rpc.request('delivery.inspect', {
            key: keyOf(original.request),
            originalSessionId: original.context.sessionId,
            attemptId: original.request.attemptId,
            identity: original.identity,
          }),
        );
      },
      async close() {
        for (const operation of active.values()) operation.handle.cancel('shutdown');
        await bridge.close();
        await materials.close();
        await host.close();
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
        assert.equal(host.tasks.diagnostics().pendingWork, 0);
        assert.equal(host.permissions.diagnostics().leases, 0);
      },
    };
  } catch (error) {
    const cleanup = await Promise.allSettled(
      initializationCleanup.reverse().map((close) => close()),
    );
    const failed = cleanup.filter((value) => value.status === 'rejected');
    if (failed.length)
      throw new AggregateError(
        [error, ...failed.map((value) => value.reason)],
        'Fixture initialization cleanup failed',
        { cause: error },
      );
    throw error;
  }
}
