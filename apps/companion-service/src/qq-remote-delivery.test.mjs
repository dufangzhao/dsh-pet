import { createServer } from 'node:http';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { definePlugin } from '@pet/plugin-sdk';
import { KernelFault } from '@pet/host-kernel';
import {
  validateLocalHostSourceBinding,
  validateLocalHostProcessIdentity,
} from '@pet/contracts/validation';
import {
  CompanionPluginHost,
  CompanionRuntime,
  companionHostDefinition,
  companionHostManifest,
  withSourceAuthority,
} from '@pet/companion-runtime';
import stateDefinition from '@pet/state-sqlite';
import {
  LOCAL_HOST_BRIDGE_PLUGIN_ID,
  LOCAL_HOST_PROTOCOL_VERSION,
  QQ_FEATURE_PLUGIN_ID,
  QQ_OFFICIAL_PLUGIN_ID,
  QQ_ONEBOT_PLUGIN_ID,
  QQ_OFFICIAL_PASSIVE_WINDOW_MS,
  isQQDeliveryPartAccepted,
  makeError,
} from '@pet/contracts';
import {
  createLocalPluginKernel,
  connectAgentBridge,
  createAgentBridgeServer,
} from '@pet/local-host';
import { LocalQQSourceController } from '../../../packages/local-host/src/qq-source.js';
import { openPrivateDirectory } from '../../../packages/local-host/src/rendezvous.js';
import {
  captureCurrentOwnedProcess,
  ownedProcessIdentity,
  verifyCurrentOwnedProcess,
  verifyOriginalProcessGone,
} from '../../../packages/local-host/src/owned-process.js';
import {
  LocalQQExecutionOwner,
  qqExecutionJson,
} from '../../../packages/local-host/src/qq-execution.js';
import { HostMaterialStore } from './material-store.js';
import { QQRemoteDelivery } from './qq-remote-delivery.js';
import { createNativePeer } from '../../../qa/fixtures/local-host/bridge-native.mjs';
import {
  bridgeManifest,
  deferred,
  png,
  sha,
  within,
} from '../../../qa/fixtures/local-host/bridge-common.mjs';

const project = fileURLToPath(new URL('../../../', import.meta.url));
const closes = [];
let traceCount = 0;
function trace(stage, details = {}) {
  if (process.env['PET_G5_TRACE'] !== '1' || traceCount++ >= 512) return;
  process.stderr.write(
    `${JSON.stringify({ time: new Date().toISOString(), pid: process.pid, stage, ...details })}\n`,
  );
}
beforeEach((context) => {
  traceCount = 0;
  trace('case.start', { name: context.task.name });
});
afterEach(async (context) => {
  trace('case.cleanup.start', { name: context.task.name });
  for (const close of closes.splice(0).reverse()) await close();
  trace('case.cleanup.end', { name: context.task.name });
});
const scope = { kind: 'management' };

async function multipartNativePeer() {
  const base = await createNativePeer(),
    requests = [],
    parts = new Map(),
    finished = new Set(),
    errors = [];
  let inspect = async () => {
    throw new Error('Multipart native call without matching claim');
  };
  let prepared, revokeAfterFirstFinish, heldResponse;
  const block = 5 * 1024 * 1024;
  const handlers = new Map(),
    sockets = new Set();
  const proxy = createServer((request, response) => {
    const current = {
      method: request.method,
      path: new URL(request.url, 'http://fixture').pathname,
      phase: 'body',
      bytes: 0,
    };
    handlers.set(request, current);
    trace('native.http.start', current);
    void (async () => {
      const chunks = [];
      for await (const bytes of request) chunks.push(bytes);
      const bytes = Buffer.concat(chunks),
        url = request.url;
      current.bytes = bytes.length;
      current.phase = 'dispatch';
      trace('native.http.body', current);
      const multipart =
        url.endsWith('/upload_prepare') ||
        url.endsWith('/upload_part_finish') ||
        url.startsWith('/cos/') ||
        (url.endsWith('/files') && bytes.toString().includes('upload_id'));
      if (!multipart) {
        const forwarded = await fetch(new URL(url, base.url), {
          method: request.method,
          headers: request.headers,
          ...(bytes.length ? { body: bytes } : {}),
        });
        const reply = Buffer.from(await forwarded.arrayBuffer());
        response.writeHead(forwarded.status, { 'Content-Type': 'application/json' });
        if (heldResponse && url.endsWith('/messages')) {
          const held = heldResponse;
          heldResponse = null;
          response.write(reply.subarray(0, 1));
          current.phase = 'held-response';
          held.entered.resolve();
          await held.release.promise;
          response.end(reply.subarray(1));
        } else response.end(reply);
        return;
      }
      await inspect();
      requests.push(url);
      const body = url.startsWith('/cos/') ? null : JSON.parse(bytes.toString());
      response.setHeader('Content-Type', 'application/json');
      if (url.endsWith('/upload_prepare')) {
        prepared = body;
        const size = Number(body.file_size);
        response.end(
          JSON.stringify({
            upload_id: 'g5-real-upload',
            block_size: block,
            parts: Array.from({ length: Math.ceil(size / block) }, (_, index) => ({
              index,
              block_size: Math.min(block, size - index * block),
              presigned_url: `https://storage.qq.com/cos/${index}?PRIVATE_COS_CANARY=1`,
            })),
          }),
        );
        return;
      }
      if (url.startsWith('/cos/')) {
        expect(request.headers.authorization).toBeUndefined();
        const index = Number(new URL(url, 'http://fixture').pathname.split('/').at(-1));
        expect(parts.has(index)).toBe(false);
        parts.set(index, bytes);
        response.writeHead(204).end();
        return;
      }
      if (url.endsWith('/upload_part_finish')) {
        expect(body.upload_id).toBe('g5-real-upload');
        const part = parts.get(Number(body.part_index));
        expect(part).toBeDefined();
        expect(body.md5).toBe(createHash('md5').update(part).digest('hex'));
        expect(Number(body.block_size)).toBe(part.length);
        finished.add(Number(body.part_index));
        if (body.part_index === 0) revokeAfterFirstFinish?.();
        response.end('{}');
        return;
      }
      expect(body.upload_id).toBe('g5-real-upload');
      expect(body.srv_send_msg).toBe(false);
      expect(finished.size).toBe(Math.ceil(Number(prepared.file_size) / block));
      const uploaded = Buffer.concat(
        [...parts].sort(([left], [right]) => left - right).map(([, value]) => value),
      );
      expect(createHash('md5').update(uploaded).digest('hex')).toBe(prepared.md5);
      const fileInfo = 'PRIVATE_LOCAL_FILE_INFO_CANARY-multipart';
      base.uploads.push({ bytes: uploaded, sha256: sha(uploaded), fileInfo });
      response.end(
        JSON.stringify({ file_uuid: 'native-multipart-file', file_info: fileInfo, ttl: 600 }),
      );
    })()
      .catch((error) => {
        errors.push(error);
        trace('native.http.error', { ...current, message: String(error?.message).slice(0, 160) });
        response.destroy();
      })
      .finally(() => {
        handlers.delete(request);
        trace('native.http.end', current);
      });
  });
  proxy.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');
  const address = proxy.address();
  return {
    ...base,
    url: `http://127.0.0.1:${address.port}`,
    gatewayUrl: base.url,
    requests,
    parts,
    errors,
    diagnostics: () => ({
      handlers: [...handlers.values()],
      sockets: [...sockets].map((socket) => ({
        destroyed: socket.destroyed,
        readable: socket.readable,
        writable: socket.writable,
      })),
    }),
    expectClaim(check) {
      inspect = check;
      base.expectClaim(check);
    },
    revokeAfterFirstFinish(check) {
      revokeAfterFirstFinish = check;
    },
    holdNextResponse() {
      const entered = deferred(),
        release = deferred();
      heldResponse = { entered, release };
      return { entered: entered.promise, resolve: () => release.resolve() };
    },
    async close() {
      proxy.closeAllConnections();
      await new Promise((resolve) => proxy.close(resolve));
      await base.close();
      expect(errors).toEqual([]);
    },
  };
}

async function fixture(options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'remote-delivery-state4-'));
  trace('fixture.root', { root, options });
  const processProfile = await openPrivateDirectory(path.join(root, 'local'));
  const processProvenance = await captureCurrentOwnedProcess(processProfile);
  const ownedProcess = {
    identity: () => ownedProcessIdentity(processProvenance),
    check: () => verifyCurrentOwnedProcess(processProvenance, processProfile),
    gone: (original) => verifyOriginalProcessGone(original, processProfile),
  };
  const native =
    options.multipart || options.heldNative
      ? await multipartNativePeer()
      : await createNativePeer();
  let sources,
    local,
    execution,
    host,
    runtime,
    materials,
    manager,
    client,
    serverPeer,
    bridgeServer,
    http,
    onebotPeer;
  const onebotListening = deferred(),
    onebotPackets = [],
    onebotUploads = [],
    onebotErrors = [];
  const staged = new Map(),
    localResults = new Map(),
    childControls = new Map();
  let child,
    childExit,
    externalOffer,
    childIsReady = false;
  function childCall(action) {
    if (!child || child.exitCode !== null || child.signalCode !== null)
      throw new Error('Fixture child is not alive');
    const id = randomUUID(),
      result = Promise.withResolvers();
    childControls.set(id, result);
    child.send({ id, action });
    return within(result.promise, `child ${action}`, 40000);
  }
  async function stopChild() {
    if (!child) return;
    if (childIsReady && child.exitCode === null && child.signalCode === null) {
      const result = await childCall('close');
      expect(result.pendingWork).toBe(0);
      expect(result.leases).toBe(0);
    }
    const status = await within(childExit, 'actual child exit', 15000);
    expect(status).toEqual({ code: 0, signal: null });
    trace('fixture.child.exited', { pid: child.pid, ...status });
  }
  let inspectOnebotClaim = async () => {
    throw new Error('OneBot business action has no claimed attempt');
  };
  const maps = new Map(),
    connections = [],
    gates = [];
  let bootId = randomUUID(),
    hostId = randomUUID(),
    dropReply = false,
    denied = false,
    policy = true;
  let changed = deferred(),
    accepted = deferred(),
    authorityCalls = 0,
    observed;
  const account = {
    protocol: 'official',
    sourcePluginId: QQ_OFFICIAL_PLUGIN_ID,
    instanceId: 'default',
    accountId: 'qa-app',
  };
  const token = `remote-delivery-owned-token-${randomUUID()}`;
  const taskRefs = { server: new Map(), local: new Map() },
    nativeSockets = new Set();
  const watchTasks = (side, target) => {
    if (process.env['PET_G5_TRACE'] !== '1') return;
    target.tasks.subscribe((event) => {
      if (taskRefs[side].size < 512) taskRefs[side].set(event.taskId, event.owner);
    });
  };
  const taskState = (side, target) =>
    target
      ? {
          ...target.tasks.diagnostics(),
          live: [...taskRefs[side]]
            .map(([id, owner]) => target.tasks.get(id, owner))
            .filter((value) => value?.workPending),
          leases: target.permissions.diagnostics(),
        }
      : null;
  const diagnostics = () => ({
    root,
    manager: manager?.diagnostics(),
    execution: execution?.diagnostics(),
    server: taskState('server', host),
    local: taskState('local', local?.host),
    clientRpc: client?.rpc.diagnostics(),
    serverRpc: serverPeer?.rpc.diagnostics(),
    clientMedia: client?.media.snapshot(),
    serverMedia: serverPeer?.media.snapshot(),
    nativeSockets: [...nativeSockets].map((socket) => socket.readyState),
    native: native.diagnostics?.(),
    serverMappedTasks: [...maps.values()].map((handle) => handle.snapshot()),
  });
  const join = async (stage, work) => {
    trace(`${stage}.start`, diagnostics());
    const watcher = setTimeout(() => trace(`${stage}.pending5s`, diagnostics()), 5000);
    try {
      await work();
      trace(`${stage}.end`, diagnostics());
    } catch (error) {
      trace(`${stage}.error`, {
        code: error?.error?.code ?? error?.code,
        message: String(error?.message).slice(0, 160),
        ...diagnostics(),
      });
      throw error;
    } finally {
      clearTimeout(watcher);
    }
  };
  closes.push(async () => {
    for (const gate of gates) gate.resolve();
    await join('cleanup.manager', async () => manager?.close());
    await join('cleanup.child', stopChild);
    client?.close();
    await join('cleanup.client', async () => client?.settled);
    await join('cleanup.bridgeServer', async () => bridgeServer?.close());
    await join('cleanup.execution', async () => execution?.close());
    await join('cleanup.sources', async () => sources?.close());
    await join('cleanup.localKernel', async () => local?.close());
    if (onebotPeer && onebotPeer.readyState !== WebSocket.CLOSED) {
      const ended = once(onebotPeer, 'close');
      onebotPeer.terminate();
      await ended;
    }
    expect(onebotErrors).toEqual([]);
    await join('cleanup.materials', async () => materials?.close());
    await join('cleanup.runtime', async () => runtime?.close());
    await join('cleanup.serverHost', async () => host?.close());
    if (http?.listening) {
      http.closeAllConnections();
      await join('cleanup.http', async () => new Promise((resolve) => http.close(resolve)));
    }
    await join('cleanup.native', () => native.close());
    if (local) {
      expect(local.host.tasks.diagnostics().pendingWork).toBe(0);
      expect(local.host.permissions.diagnostics().leases).toBe(0);
    }
    if (host) expect(host.tasks.diagnostics().pendingWork).toBe(0);
    const target = await realpath(root);
    if (
      path.dirname(target) !== (await realpath(tmpdir())) ||
      !path.basename(target).startsWith('remote-delivery-state4-')
    )
      throw new Error('Unexpected owned test root');
    await rm(target, { recursive: true });
  });
  const registrations = [];
  const feature = {
    ...companionHostManifest,
    id: QQ_FEATURE_PLUGIN_ID,
    provides: [],
    consumes: [],
    permissions: [{ kind: 'files', scope: 'plugin-data', access: 'read-write' }],
    config: { version: 1, schema: { type: 'object', additionalProperties: false, properties: {} } },
  };
  const stateManifest = JSON.parse(
    await readFile(path.join(project, 'plugins/state-sqlite/plugin.json'), 'utf8'),
  );
  for (const manifest of [companionHostManifest, feature, stateManifest, bridgeManifest]) {
    const directory = path.join(root, 'packages', manifest.id);
    await mkdir(directory, { recursive: true });
    const definition =
      manifest.id === stateManifest.id
        ? stateDefinition
        : manifest.id === companionHostManifest.id
          ? companionHostDefinition
          : definePlugin({ activate() {} });
    registrations.push({ manifest, directory, definition, enabled: true, preset: 'allow' });
  }
  host = await CompanionPluginHost.create({
    dataDirectory: path.join(root, 'server'),
    plugins: registrations,
  });
  watchTasks('server', host);
  trace('fixture.serverHost');
  host.bind('companion.state@1', stateManifest.id, 'sqlite');
  runtime = new CompanionRuntime(host, {
    mode: 'scripted',
    statePluginId: stateManifest.id,
    stateProviderId: 'sqlite',
    executionPluginId: 'pet.cloud-exec',
    executionProviderId: 'docker',
    executionTimeoutMs: 30000,
  });
  const snapshot = await runtime.state('snapshot', {});
  materials = await HostMaterialStore.create({ directory: root, host, state: runtime });
  const officialDirectory = path.join(project, 'plugins/qq-official'),
    onebotDirectory = path.join(project, 'plugins/qq-onebot');
  const required = () => {
    if (!sources) throw new Error('No local source controller');
    return sources;
  };
  if (!options.remoteChild) {
    local = await createLocalPluginKernel({
      dataDirectory: path.join(root, 'local'),
      official: {
        directory: officialDirectory,
        manifest: JSON.parse(await readFile(path.join(officialDirectory, 'plugin.json'), 'utf8')),
        preset: 'allow',
        portsFor: (context) => required().officialPorts(context),
      },
      onebot: {
        directory: onebotDirectory,
        manifest: JSON.parse(await readFile(path.join(onebotDirectory, 'plugin.json'), 'utf8')),
        preset: 'allow',
        portsFor: (context) => required().onebotPorts(context),
      },
    });
    watchTasks('local', local.host);
    trace('fixture.localKernel');
    sources = new LocalQQSourceController(local, {
      onOfficial: async () => {},
      onOneBot: async () => {},
      onebotTest: { onListening: (address) => onebotListening.resolve(address.port) },
      changed: () => changed.resolve(),
      officialTest: {
        fetch: (url, init) => {
          const value = new URL(String(url));
          if (
            value.origin !== 'https://api.bot.qq.com' &&
            !(options.multipart && value.origin === 'https://storage.qq.com')
          )
            throw new Error('Unexpected native target');
          // The controlled reader deliberately ignores cancellation so physical drain remains observable.
          const settings =
            options.heldNative && value.pathname.endsWith('/messages')
              ? { ...init, signal: undefined }
              : init;
          return fetch(new URL(value.pathname + value.search, native.url), settings);
        },
        websocket: () => {
          const socket = new WebSocket((native.gatewayUrl ?? native.url).replace('http:', 'ws:'));
          nativeSockets.add(socket);
          socket.once('open', () => trace('native.gateway.open'));
          socket.once('close', (code, reason) => {
            trace('native.gateway.close', { code, reason: reason.toString() });
            nativeSockets.delete(socket);
          });
          return socket;
        },
      },
    });
    await sources.initialize();
    trace('fixture.sources.initialized');
    let view = await sources.view(),
      current = view.sources.find((value) => value.protocol === 'official');
    let mutation = await sources.saveSource({
      protocol: 'official',
      expectedRevision: current.configRevision,
      settings: { protocol: 'official', appId: 'qa-app', scenes: ['private'] },
    });
    current = mutation.view.sources.find((value) => value.protocol === 'official');
    mutation = await sources.credential({
      protocol: 'official',
      expectedRevision: current.configRevision,
      expectedCredentialVersion: current.credential.version,
      value: 'CONTROLLED_QQ_SECRET_CANARY',
    });
    local.confirmTrust(QQ_OFFICIAL_PLUGIN_ID, local.review(QQ_OFFICIAL_PLUGIN_ID).digest);
    mutation = await sources.setEnabled('official', true, mutation.view.revision);
    expect(mutation.error).toBeNull();
    trace('fixture.official.enabled');
    for (;;) {
      const next = changed;
      if (
        (await sources.view()).sources.find((value) => value.protocol === 'official').phase ===
        'ready'
      )
        break;
      await within(next.promise, 'official ready');
      if (changed === next) changed = deferred();
    }
    trace('fixture.official.ready');
    if (options.onebot) {
      let onebot = (await sources.view()).sources.find((value) => value.protocol === 'onebot-v11');
      let saved = await sources.saveSource({
        protocol: 'onebot-v11',
        expectedRevision: onebot.configRevision,
        settings: {
          protocol: 'onebot-v11',
          accountId: '10001',
          mode: 'reverse-ws',
          channelMode: 'universal',
          mediaProfile: 'snowluma-v11',
          listenHost: '127.0.0.1',
          listenPort: 0,
          path: '/g5-onebot',
        },
      });
      onebot = saved.view.sources.find((value) => value.protocol === 'onebot-v11');
      saved = await sources.credential({
        protocol: 'onebot-v11',
        expectedRevision: onebot.configRevision,
        expectedCredentialVersion: onebot.credential.version,
        value: 'g5-controlled-onebot-key',
      });
      local.confirmTrust(QQ_ONEBOT_PLUGIN_ID, local.review(QQ_ONEBOT_PLUGIN_ID).digest);
      expect((await sources.setEnabled('onebot-v11', true, saved.view.revision)).error).toBeNull();
      const port = await within(onebotListening.promise, 'real OneBot listener');
      onebotPeer = new WebSocket(`ws://127.0.0.1:${port}/g5-onebot`, {
        headers: {
          Authorization: 'Bearer g5-controlled-onebot-key',
          'X-Self-ID': '10001',
          'X-Client-Role': 'Universal',
        },
      });
      onebotPeer.on('message', (data) => {
        void (async () => {
          const packet = JSON.parse(data.toString());
          await inspectOnebotClaim();
          onebotPackets.push(packet);
          const respond = (body, stream = false) =>
            onebotPeer.send(
              JSON.stringify({
                status: 'ok',
                retcode: 0,
                echo: packet.echo,
                data: body,
                ...(stream ? { stream: 'stream-action' } : {}),
              }),
            );
          if (packet.action === 'send_private_msg') {
            respond({ message_id: 10000 + onebotPackets.length });
            return;
          }
          if (packet.action === 'upload_file_stream') {
            const params = packet.params,
              id = params.stream_id;
            const held = staged.get(id) ?? {
              chunks: [],
              name: params.filename,
              size: params.file_size,
              hash: params.expected_sha256,
            };
            staged.set(id, held);
            if (!params.is_complete) {
              expect(params.chunk_index).toBe(held.chunks.length);
              held.chunks.push(Buffer.from(params.chunk_data, 'base64'));
              respond(
                {
                  type: 'stream',
                  status: 'chunk_received',
                  stream_id: id,
                  received_chunks: held.chunks.length,
                  total_chunks: params.total_chunks,
                },
                true,
              );
              return;
            }
            const bytes = Buffer.concat(held.chunks);
            expect(bytes.length).toBe(held.size);
            expect(sha(bytes)).toBe(held.hash);
            const remotePath = `/PRIVATE_NATIVE_STAGING/${id}/${held.name}`;
            onebotUploads.push({ bytes, remotePath });
            respond(
              {
                type: 'response',
                status: 'file_complete',
                stream_id: id,
                received_chunks: held.chunks.length,
                total_chunks: params.total_chunks,
                file_path: remotePath,
                file_name: held.name,
                file_size: bytes.length,
                sha256: held.hash,
              },
              true,
            );
            return;
          }
          if (packet.action === 'upload_private_file') {
            expect(onebotUploads.some((upload) => upload.remotePath === packet.params.file)).toBe(
              true,
            );
            expect(packet.params.upload_file).toBe(true);
            respond({ file_id: 'real-controlled-onebot-file' });
            return;
          }
          throw new Error(`Unexpected OneBot action ${packet.action}`);
        })().catch((error) => {
          onebotErrors.push(error);
          onebotPeer.terminate();
        });
      });
      await once(onebotPeer, 'open');
      for (;;) {
        const next = changed;
        if (
          (await sources.view()).sources.find((value) => value.protocol === 'onebot-v11').phase ===
          'ready'
        )
          break;
        await within(next.promise, 'OneBot ready');
        if (changed === next) changed = deferred();
      }
    }
    execution = new LocalQQExecutionOwner({ kernel: local, sources, ownedProcess });
  }
  http = createServer((_request, response) => response.writeHead(404).end());
  const capture = (requestedAccount = account) => {
    const source = options.remoteChild ? null : sources.captureSource(requestedAccount),
      peer = serverPeer;
    const binding = options.remoteChild
      ? structuredClone(externalOffer.binding)
      : {
          hostId,
          hostBootId: peer.context.bootId,
          bridgeSessionId: peer.context.sessionId,
          sourceOwner: source.owner,
          sourceConfigRevision: source.configRevision,
          sourcePermissionEpoch: source.permissionEpoch,
          sourceCredentialVersion: source.credentialVersion,
          nativeConnectionId: source.connectionId,
        };
    return {
      kind: 'available',
      source: {
        peer,
        account: requestedAccount,
        binding,
        processIdentity: options.remoteChild
          ? externalOffer.processIdentity
          : ownedProcess.identity(),
        signal: peer.signal,
        check: async () => {
          await source?.check();
          if (peer !== serverPeer || peer.signal.aborted) throw new KernelFault('stale-owner');
        },
        registerMediaTask(handle) {
          expect(host.tasks.taskSignal(handle.taskId, handle.snapshot().owner)).toBe(handle.signal);
          maps.set(handle.taskId, handle);
          return () => maps.delete(handle.taskId);
        },
      },
    };
  };
  let pausedDeliveryRead,
    enrichCalls = 0;
  const managerRuntime = {
    state(method, input) {
      if (method === 'enrichDeliveryAttempt') enrichCalls++;
      return (async () => {
        const value = await runtime.state(method, input);
        const paused = pausedDeliveryRead;
        if (method === 'getDelivery' && paused && !paused.used && input.id === paused.id) {
          paused.used = true;
          paused.entered.resolve(value);
          await paused.release.promise;
        }
        return value;
      })();
    },
  };
  const managerOptions = { host, runtime: managerRuntime, capture };
  manager = new QQRemoteDelivery(managerOptions);
  const reply = async (work) => {
    try {
      return { ok: true, value: await work() };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof KernelFault ? error.error : makeError('internal'),
      };
    }
  };
  bridgeServer = createAgentBridgeServer({
    server: http,
    token,
    agentId: snapshot.assistantId,
    agentEpoch: snapshot.epoch,
    hostId,
    owner: host.owner(LOCAL_HOST_BRIDGE_PLUGIN_ID),
    channel: () => ({
      live: () => true,
      signalFor: (_owner, taskId) => maps.get(taskId)?.signal ?? null,
      handlers: {
        'source.offer': (_rpc, input) =>
          reply(async () => {
            const binding = validateLocalHostSourceBinding(input.binding),
              processIdentity = validateLocalHostProcessIdentity(input.processIdentity);
            expect(binding.ok && processIdentity.ok).toBe(true);
            expect(input.account).toEqual(account);
            expect(binding.value).toMatchObject({
              hostId,
              hostBootId: serverPeer.context.bootId,
              bridgeSessionId: serverPeer.context.sessionId,
            });
            externalOffer = Object.freeze({
              account: structuredClone(input.account),
              binding: Object.freeze(binding.value),
              processIdentity: Object.freeze(processIdentity.value),
            });
            return null;
          }),
        'authority.check': (_rpc, input) =>
          reply(async () => {
            authorityCalls++;
            trace('authority.check', { attemptId: input.attemptId, count: authorityCalls, denied });
            if (denied) throw new KernelFault('permission-denied');
            return manager.authority(serverPeer, input);
          }),
        'delivery.report': (_rpc, input) => reply(() => manager.report(serverPeer, input)),
      },
    }),
    onPeer(peer) {
      serverPeer = peer;
      connections.push(peer);
      accepted.resolve(peer);
    },
  });
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  const address = http.address();
  const connect = async (nextBoot = bootId) => {
    if (options.remoteChild) {
      accepted = deferred();
      if (child && child.exitCode === null && child.signalCode === null) {
        await childCall('connect');
        await accepted.promise;
        return;
      }
      const ready = Promise.withResolvers(),
        exited = Promise.withResolvers();
      child = fork(new URL('./qq-remote-delivery.child-fixture.mjs', import.meta.url), [], {
        execArgv: ['--import', 'tsx'],
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      });
      childIsReady = false;
      trace('fixture.child.spawned', { pid: child.pid });
      childExit = exited.promise;
      let stderr = '';
      child.stderr.on('data', (data) => {
        stderr = (stderr + data.toString()).slice(-8192);
      });
      child.once('error', ready.reject);
      child.once('exit', (code, signal) => {
        exited.resolve({ code, signal });
        ready.reject(new Error(`Child exited ${code}/${signal}: ${stderr}`));
        for (const pending of childControls.values()) pending.reject(new Error('Child exited'));
        childControls.clear();
      });
      child.on('message', (message) => {
        if (message.diagnostic) {
          trace(`child.${message.diagnostic}`, {
            pid: child.pid,
            phase: message.phase,
            cleanup: message.cleanup,
            error: message.error,
          });
          return;
        }
        if (message.bootstrapped) {
          child.send({
            project,
            profile: processProfile.path,
            baseUrl: `http://127.0.0.1:${address.port}`,
            nativeUrl: native.url,
            token,
            hostId,
            agentId: snapshot.assistantId,
            agentEpoch: snapshot.epoch,
          });
          return;
        }
        if (message.ready) {
          childIsReady = true;
          ready.resolve();
          return;
        }
        const pending = childControls.get(message.id);
        if (pending) {
          childControls.delete(message.id);
          if (message.error) pending.reject(new Error(message.error));
          else pending.resolve(message.value);
        } else if (message.error) ready.reject(new Error(message.error));
      });
      await within(ready.promise, 'actual child ready', 30000);
      await accepted.promise;
      trace('fixture.child.ready', { pid: child.pid });
      return;
    }
    if (client) {
      client.close();
      await client.settled;
      await serverPeer.settled;
    }
    bootId = nextBoot;
    accepted = deferred();
    let localPeer;
    localPeer = await connectAgentBridge({
      baseUrl: `http://127.0.0.1:${address.port}`,
      token,
      hello: {
        type: 'hello',
        protocolVersion: LOCAL_HOST_PROTOCOL_VERSION,
        packageVersion: '0.1.0-test',
        hostId,
        bootId,
        agentId: snapshot.assistantId,
        agentEpoch: snapshot.epoch,
      },
      channel: () => ({
        live: () => true,
        signalFor: (owner, taskId) =>
          localPeer ? execution.signalFor(localPeer, owner, taskId) : null,
        handlers: {
          'delivery.execute': (rpc, input) =>
            reply(async () => {
              trace('local.execute.start', {
                attemptId: input.attemptId,
                operation: input.operation,
              });
              const result = await execution.execute(localPeer, input, rpc.signal);
              trace('local.execute.end', {
                attemptId: input.attemptId,
                outcome: result.fact.outcome.outcome,
                cleanup: result.fact.outcome.cleanup,
              });
              observed = result;
              localResults.get(input.attemptId)?.resolve();
              if (dropReply) {
                dropReply = false;
                localPeer.close();
                await localPeer.settled;
              }
              return qqExecutionJson(result);
            }),
          'delivery.inspect': (_rpc, input) =>
            reply(async () => qqExecutionJson(execution.inspect(localPeer, input))),
          'delivery.recover': (rpc, input) =>
            reply(async () =>
              qqExecutionJson(await execution.recover(localPeer, input, rpc.signal)),
            ),
        },
      }),
    });
    client = localPeer;
    await accepted.promise;
  };
  await connect();
  trace('fixture.bridge.ready');
  const own = (work) =>
    withSourceAuthority(
      host,
      QQ_FEATURE_PLUGIN_ID,
      [{ kind: 'files', scope: 'plugin-data', access: 'read-write' }],
      async (signal) =>
        work({
          scope,
          signal,
          check: async () => {
            signal.throwIfAborted();
            if (!policy) throw new KernelFault('permission-denied');
          },
        }),
    );
  let serial = 0;
  const seed = (text, bytes, protocol = 'official') =>
    own(async (access) => {
      const seededAccount =
        protocol === 'official'
          ? account
          : {
              protocol: 'onebot-v11',
              sourcePluginId: QQ_ONEBOT_PLUGIN_ID,
              instanceId: 'default',
              accountId: '10001',
            };
      const recipient = protocol === 'official' ? 'qa-recipient' : '30001';
      const id = `remote-input-${++serial}`,
        materialId = `${id}-material`,
        now = Date.now();
      const route = {
        kind: 'qq',
        account: seededAccount,
        scene: 'private',
        targetId: recipient,
        reference: {
          eventId: null,
          messageId: `${id}-native-basis`,
          occurredAt: now,
          displayReference: null,
        },
      };
      const origin = {
        kind: 'qq',
        inputId: id,
        principalId: 'owned-test-person',
        audience: { kind: 'person-private', principalId: 'owned-test-person' },
        route,
        policyRevision: 1,
        actor: { account: seededAccount, scene: 'private', senderId: recipient },
        eventKey: `${id}-event`,
        messageId: route.reference.messageId,
        trigger: 'direct',
        quote: null,
      };
      await runtime.state('createInput', {
        id,
        commandId: `${id}-command`,
        origin,
        evidence: { fixture: 'explicit operator seed; no participant facade assertion' },
        materialIds: bytes ? [materialId] : [],
      });
      let material;
      if (bytes)
        material = await materials.put(
          {
            id: materialId,
            inputId: id,
            kind: protocol === 'official' && !options.multipart ? 'image' : 'file',
            name: protocol === 'official' && !options.multipart ? 'remote.png' : 'remote.bin',
          },
          (async function* () {
            yield bytes;
          })(),
          access,
        );
      await runtime.state('commitInput', {
        id,
        text: 'Operator seeded input',
        materials: material ? [material] : [],
        content: { kind: 'inline-text' },
      });
      const message = await runtime.state('appendMessage', {
        id: `${id}-reply`,
        role: 'assistant',
        text,
        inputId: id,
        audience: origin.audience,
        origins: [origin],
        materials: material ? [material] : [],
        content: { kind: 'inline-text' },
      });
      const chosen = await manager.executionFor(seededAccount);
      if (chosen.kind !== 'available') return { chosen };
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
      const delivery = await runtime.state('createDelivery', {
        execution: chosen.execution,
        delivery: {
          id: `${id}-delivery`,
          messageIds: [message.id],
          origins: [origin],
          audience: origin.audience,
          route,
          mode: protocol === 'official' ? 'official-passive' : 'onebot',
          textRepresentation: 'inline',
          eligibilityExpiresAt:
            protocol === 'official' ? now + QQ_OFFICIAL_PASSIVE_WINDOW_MS : null,
          allowedMessageParts: parts.length,
          phase: 'prepared',
          outcome: 'pending',
          parts,
          createdAt: now,
          updatedAt: now,
          error: null,
        },
      });
      return { chosen, delivery };
    });
  const run = (plan, index, operation, uploaded) =>
    own(async (access) => {
      const partId = plan.delivery.parts[index].id;
      const claim = await runtime.state('claimDeliveryAttempt', {
        id: plan.delivery.id,
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
      });
      expect(claim.claimed).toBe(true);
      const part = claim.delivery.parts[index];
      const inspectClaim = async () => {
        const actual = await runtime.state('getDeliveryExecution', { id: plan.delivery.id, scope });
        const entry = actual.attempts.find((value) => value.attemptId === `${partId}-${operation}`);
        expect(entry.task).not.toBeNull();
      };
      native.expectClaim(inspectClaim);
      inspectOnebotClaim = inspectClaim;
      const request = {
        delivery: claim.delivery,
        part,
        operation,
        attemptId: `${partId}-${operation}`,
        expectedConnectionId: plan.chosen.source.connectionId,
        executionBinding: plan.chosen.execution.binding,
        check: async () => {
          await access.check();
          await plan.chosen.source.check();
        },
        ...(uploaded ? { uploaded } : {}),
      };
      let outcome;
      trace('server.execute.start', { partId, operation });
      if (operation !== 'send')
        await materials.withMaterial(part.content.material.id, access, async (material, bytes) => {
          outcome = await plan.chosen.source.transport.execute(
            { ...request, material, bytes },
            access.signal,
            async () => {},
          );
        });
      else
        outcome = await plan.chosen.source.transport.execute(
          request,
          access.signal,
          async () => {},
        );
      trace('server.execute.end', {
        partId,
        operation,
        outcome: outcome.outcome,
        cleanup: outcome.cleanup,
      });
      const current = await runtime.state('getDelivery', { id: plan.delivery.id, scope });
      const slot = operation === 'send' ? 'send' : 'upload';
      const parts = current.parts.map((item) =>
        item.id !== partId
          ? item
          : {
              ...item,
              [slot]: {
                ...item[slot],
                phase: 'settled',
                outcome: outcome.outcome,
                correlationId: outcome.correlationId ?? null,
                receipt: outcome.receipt,
                cleanup: outcome.cleanup,
                error: outcome.error,
                settledAt: Date.now(),
              },
            },
      );
      const done = parts.every(isQQDeliveryPartAccepted),
        uncertain = outcome.cleanup !== 'settled' || outcome.outcome === 'unknown';
      await runtime.state('updateDelivery', {
        delivery: {
          ...current,
          parts,
          updatedAt: Date.now(),
          ...(done || uncertain
            ? { phase: 'terminal', outcome: uncertain ? 'unknown' : 'accepted' }
            : {}),
        },
      });
      trace('server.attempt.recorded', { partId, operation });
      return outcome;
    });
  return {
    root,
    native,
    onebotPackets,
    onebotUploads,
    runtime,
    host,
    local,
    sources,
    execution,
    manager,
    account,
    seed,
    run,
    connect,
    get peer() {
      return serverPeer;
    },
    get client() {
      return client;
    },
    get observed() {
      return observed;
    },
    get bootId() {
      return bootId;
    },
    dropNext() {
      if (options.remoteChild) return childCall('dropReply');
      dropReply = true;
    },
    childCall,
    stopChild,
    get childPid() {
      return child?.pid;
    },
    denyChecks(value) {
      denied = value;
    },
    revoke() {
      policy = false;
    },
    holdNativeResponse() {
      const held = native.holdNextResponse();
      gates.push(held);
      return held;
    },
    localResult(attemptId) {
      const done = deferred();
      localResults.set(attemptId, done);
      return done.promise;
    },
    checks: () => authorityCalls,
    enrichCalls: () => enrichCalls,
    pauseInitialization(id) {
      const entered = deferred(),
        release = deferred();
      pausedDeliveryRead = { id, entered, release, used: false };
      gates.push(release);
      return { entered: entered.promise, release: () => release.resolve() };
    },
    async restartManager() {
      await manager.close();
      manager = new QQRemoteDelivery(managerOptions);
      return manager;
    },
  };
}

it('binds a real local task before native I/O, retains lost-ack facts, restores a hold and enriches only the same terminal attempt', async () => {
  const f = await fixture();
  const plan = await f.seed('one actual native effect');
  f.dropNext();
  const outcome = await f.run(plan, 0, 'send');
  expect(outcome).toMatchObject({ outcome: 'unknown', cleanup: 'unknown' });
  expect(f.native.messages).toHaveLength(1);
  expect(f.manager.diagnostics().holds).toBe(1);
  const actual = f.observed.fact;
  expect(actual.outcome).toMatchObject({ outcome: 'accepted', cleanup: 'settled' });
  expect(actual.task.owner.pluginId).toBe(QQ_OFFICIAL_PLUGIN_ID);
  const manager = await f.restartManager();
  await f.connect(randomUUID());
  expect((await manager.executionFor(f.account)).kind).toBe('unavailable');
  await expect(manager.report(f.peer, actual)).rejects.toMatchObject({
    error: { code: 'permission-denied' },
  });
  await f.connect(actual.binding.hostBootId);
  const identity = { ...actual };
  delete identity.outcome;
  const enriched = await manager.reconcile(f.peer, identity);
  expect(enriched).toMatchObject({ phase: 'terminal', outcome: 'accepted' });
  expect(manager.diagnostics().holds).toBe(0);
  expect(f.native.messages).toHaveLength(1);
  const again = await f.seed('new independent claim after actual settled evidence');
  expect((await f.run(again, 0, 'send')).outcome).toBe('accepted');
  expect(f.native.messages).toHaveLength(2);
  expect(f.native.claimObservations).toBe(2);
});

it('keeps the exact remote hold while a real native response reader is still draining', async () => {
  const f = await fixture({ heldNative: true });
  const plan = await f.seed('held original native effect');
  const held = f.holdNativeResponse();
  const attemptId = `${plan.delivery.parts[0].id}-send`;
  const drained = f.localResult(attemptId);
  const sending = f.run(plan, 0, 'send');
  await within(held.entered, 'actual native response body held');
  expect(f.native.messages).toHaveLength(1);
  f.client.close();
  await f.client.settled;
  expect(
    await within(sending, 'server-owned dispatch joins without remote drain', 3000),
  ).toMatchObject({ outcome: 'unknown', cleanup: 'unknown' });
  expect(f.execution.diagnostics().active).toBe(1);
  expect(f.manager.diagnostics().holds).toBe(1);
  await within(f.manager.close(), 'server close must not wait for remote native reader', 3000);
  expect(f.execution.diagnostics().active).toBe(1);
  await f.connect();
  const manager = await f.restartManager();
  expect((await manager.executionFor(f.account)).kind).toBe('unavailable');
  const original = await f.runtime.state('getDeliveryExecution', { id: plan.delivery.id, scope });
  const attempt = original.attempts[0];
  const identity = {
    binding: original.target.binding,
    task: attempt.task,
    deliveryId: plan.delivery.id,
    partId: attempt.partId,
    attemptId: attempt.attemptId,
    operation: attempt.operation,
    contentHash: attempt.contentHash,
  };
  expect(await manager.reconcile(f.peer, identity)).toBeNull();
  expect(manager.diagnostics().holds).toBe(1);
  held.resolve();
  await within(drained, 'actual local native reader and task settlement');
  expect(f.execution.diagnostics().active).toBe(0);
  expect((await manager.reconcile(f.peer, identity)).parts[0].send).toMatchObject({
    outcome: 'accepted',
    cleanup: 'settled',
    receipt: { messageId: 'native-message-1' },
  });
  expect(manager.diagnostics().holds).toBe(0);
  expect(f.native.messages).toHaveLength(1);
  expect(
    (await f.sources.view()).sources.find((source) => source.protocol === 'official'),
  ).toMatchObject({
    phase: 'failed',
    cleanup: 'settled',
    error: { code: 'stale-owner' },
  });
}, 30000);

it('recovers only cleanup after the original native child process actually exits', async () => {
  const f = await fixture({ remoteChild: true });
  const plan = await f.seed('native effect owned by the original child');
  const originalPid = f.childPid;
  await f.dropNext();
  expect((await f.run(plan, 0, 'send')).outcome).toBe('unknown');
  expect(f.native.messages).toHaveLength(1);
  const stored = await f.runtime.state('getDeliveryExecution', { id: plan.delivery.id, scope });
  expect(stored.processIdentity.pid).toBe(originalPid);
  expect(stored.attempts[0].task.owner.pluginId).toBe(QQ_OFFICIAL_PLUGIN_ID);
  const reference = {
    deliveryId: plan.delivery.id,
    partId: stored.attempts[0].partId,
    attemptId: stored.attempts[0].attemptId,
  };
  const before = await f.runtime.state('getDelivery', { id: plan.delivery.id, scope });
  await f.connect();
  await expect(f.manager.recover(f.peer, reference)).rejects.toMatchObject({
    error: { code: 'not-ready' },
  });
  expect(f.manager.diagnostics().holds).toBe(1);
  await f.stopChild();
  await f.connect();
  expect(f.childPid).not.toBe(originalPid);
  expect(f.peer.context.bootId).not.toBe(stored.target.binding.hostBootId);
  expect((await f.manager.executionFor(f.account)).kind).toBe('unavailable');
  await f.childCall('forgedProof');
  await expect(f.manager.recover(f.peer, reference)).rejects.toMatchObject({
    error: { code: 'permission-denied' },
  });
  await f.childCall('wrongChallenge');
  await expect(f.manager.recover(f.peer, reference)).rejects.toMatchObject({
    error: { code: 'permission-denied' },
  });
  expect(await f.runtime.state('getDelivery', { id: plan.delivery.id, scope })).toEqual(before);
  const recovered = await f.manager.recover(f.peer, reference);
  const expected = structuredClone(before);
  expected.parts[0].send.cleanup = 'settled';
  expect(recovered.updatedAt).toBeGreaterThanOrEqual(before.updatedAt);
  expected.updatedAt = recovered.updatedAt;
  expect(recovered).toEqual(expected);
  expect(f.manager.diagnostics().holds).toBe(0);
  expect(f.native.messages).toHaveLength(1);
  expect((await f.childCall('stats')).executeCalls).toBe(0);
  expect(await f.manager.recover(f.peer, reference)).toEqual(expected);
  const fresh = await f.seed('independent effect after actual death proof');
  expect((await f.run(fresh, 0, 'send')).outcome).toBe('accepted');
  expect(f.native.messages).toHaveLength(2);
  expect(
    f.native.messages.filter(
      (message) => message.body.content === 'native effect owned by the original child',
    ),
  ).toHaveLength(1);
  expect(
    (await f.runtime.state('getDeliveryExecution', { id: fresh.delivery.id, scope }))
      .processIdentity.pid,
  ).toBe(f.childPid);
}, 30000);

it('serializes a late settled fact after the pending startup hold snapshot', async () => {
  const f = await fixture();
  const plan = await f.seed('original native effect before restart');
  f.dropNext();
  expect((await f.run(plan, 0, 'send')).cleanup).toBe('unknown');
  const fact = f.observed.fact;
  await f.connect();
  const manager = await f.restartManager();
  const paused = f.pauseInitialization(plan.delivery.id);
  const selection = manager.executionFor(f.account);
  const old = await paused.entered;
  expect(old.parts[0].send.cleanup).toBe('unknown');
  const priorCalls = f.enrichCalls();
  const report = manager.report(f.peer, fact);
  expect(f.enrichCalls()).toBe(priorCalls);
  paused.release();
  await Promise.all([selection, report]);
  expect(manager.diagnostics().holds).toBe(0);
  expect(
    (await f.runtime.state('getDelivery', { id: plan.delivery.id, scope })).parts[0].send.cleanup,
  ).toBe('settled');
  expect(f.native.messages).toHaveLength(1);
  const fresh = await f.seed('new input after serialized fact');
  expect((await f.run(fresh, 0, 'send')).outcome).toBe('accepted');
  expect(f.native.messages).toHaveLength(2);
  expect(
    f.native.messages.filter(
      (message) => message.body.content === 'original native effect before restart',
    ),
  ).toHaveLength(1);
});

it('moves checked image bytes and redeems only the same-epoch once-only upload continuation through production owners', async () => {
  const f = await fixture();
  const bytes = png(96 * 1024);
  const plan = await f.seed('text before required image', bytes);
  expect((await f.run(plan, 0, 'send')).outcome).toBe('accepted');
  const uploaded = await f.run(plan, 1, 'upload');
  expect(uploaded).toMatchObject({ outcome: 'accepted', receipt: { fileId: 'native-file-1' } });
  expect(typeof uploaded.uploaded).toBe('string');
  expect(JSON.stringify(uploaded)).not.toContain('PRIVATE_LOCAL_FILE_INFO_CANARY');
  expect(f.native.uploads[0].bytes).toEqual(bytes);
  expect((await f.run(plan, 1, 'send', uploaded.uploaded)).outcome).toBe('accepted');
  expect(f.native.messages.at(-1).body.media.file_info).toBe(f.native.uploads[0].fileInfo);
  expect(f.execution.diagnostics().continuations).toBe(0);
  expect(f.checks()).toBe(6); // task admission plus one physical business request for each of three attempts
});

it('publishes real OneBot file bytes through one compound claim with a fresh check at each native action', async () => {
  const f = await fixture({ onebot: true });
  const bytes = Buffer.from(Array.from({ length: 32768 }, (_, index) => index % 256));
  const plan = await f.seed('OneBot compound file follows this text.', bytes, 'onebot-v11');
  expect((await f.run(plan, 0, 'send')).outcome).toBe('accepted');
  const outcome = await f.run(plan, 1, 'upload-and-send');
  expect(outcome).toMatchObject({
    outcome: 'accepted',
    cleanup: 'settled',
    receipt: { fileId: 'real-controlled-onebot-file' },
  });
  expect(outcome.uploaded).toBeUndefined();
  expect(f.onebotUploads).toHaveLength(1);
  expect(f.onebotUploads[0].bytes).toEqual(bytes);
  expect(f.onebotPackets.filter((packet) => packet.action === 'upload_private_file')).toHaveLength(
    1,
  );
  expect(f.onebotPackets.filter((packet) => packet.action === 'send_private_msg')).toHaveLength(1);
  expect(f.checks()).toBe(f.onebotPackets.length + 2);
  expect(JSON.stringify(f.observed)).not.toContain('PRIVATE_NATIVE_STAGING');
  expect(f.execution.diagnostics().continuations).toBe(0);
  expect(
    (await f.runtime.state('getDelivery', { id: plan.delivery.id, scope })).parts[1].send,
  ).toBeNull();
});

it.each([false, true])(
  'checks actual official multipart requests separately and stops after a later deny (deny=%s)',
  async (deny) => {
    const f = await fixture({ multipart: true });
    const bytes = Buffer.alloc(6 * 1024 * 1024, 0x9d);
    const plan = await f.seed('multipart attachment after text', bytes);
    expect((await f.run(plan, 0, 'send')).outcome).toBe('accepted');
    if (deny) f.native.revokeAfterFirstFinish(() => f.denyChecks(true));
    trace('case.multipart.upload.start', { deny });
    const uploaded = await f.run(plan, 1, 'upload');
    trace('case.multipart.upload.return', { deny, outcome: uploaded.outcome });
    if (deny) {
      expect(uploaded.outcome).not.toBe('accepted');
      expect(f.native.requests).toEqual([
        '/v2/users/qa-recipient/upload_prepare',
        '/cos/0?PRIVATE_COS_CANARY=1',
        '/v2/users/qa-recipient/upload_part_finish',
      ]);
      expect(f.native.uploads).toHaveLength(0);
      expect(f.native.messages).toHaveLength(1);
    } else {
      expect(uploaded).toMatchObject({
        outcome: 'accepted',
        receipt: { fileId: 'native-multipart-file' },
      });
      trace('case.multipart.bytes.compare.start', {
        actual: f.native.uploads[0].bytes.length,
        expected: bytes.length,
      });
      expect(f.native.uploads[0].bytes.byteLength).toBe(bytes.byteLength);
      expect(Buffer.from(f.native.uploads[0].bytes).equals(bytes)).toBe(true);
      expect(sha(f.native.uploads[0].bytes)).toBe(sha(bytes));
      trace('case.multipart.bytes.compare.end');
      expect(f.native.requests).toHaveLength(6);
      expect((await f.run(plan, 1, 'send', uploaded.uploaded)).outcome).toBe('accepted');
      expect(f.checks()).toBe(11);
      expect(JSON.stringify(f.observed)).not.toContain('PRIVATE_COS_CANARY');
      expect(JSON.stringify(f.observed)).not.toContain('PRIVATE_LOCAL_FILE_INFO_CANARY');
    }
    trace('case.multipart.body.end', { deny });
  },
  30000,
);

it('a denied fresh server check cannot start native publication or create a wire-authorized media reader', async () => {
  const f = await fixture();
  const plan = await f.seed('must not publish');
  f.denyChecks(true);
  expect((await f.run(plan, 0, 'send')).outcome).not.toBe('accepted');
  expect(f.native.messages).toHaveLength(0);
  expect(
    f.client.media.createReader({
      owner: f.client.context.owner,
      taskId: randomUUID(),
      streamId: randomUUID(),
    }).ok,
  ).toBe(false);
  expect(f.execution.diagnostics().active).toBe(0);
});
