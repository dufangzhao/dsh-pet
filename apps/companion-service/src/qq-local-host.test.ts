import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { readdirSync, lstatSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { packageFingerprint } from '@pet/companion-runtime/plugin-host';
import {
  LOCAL_AGENT_LINK_PLUGIN_ID,
  QQ_FEATURE_PLUGIN_ID,
  QQ_OFFICIAL_PLUGIN_ID,
  QQ_ONEBOT_PLUGIN_ID,
  type PluginManifest,
  type QQAccountRef,
  type QQInputReceipt,
} from '@pet/contracts';
import {
  createFixtureModelClient,
  type RuntimeInputAccess,
  type RuntimeInputGrant,
  type RuntimeInputTerminal,
} from '@pet/companion-runtime';
import { KernelFault, ControlEndpoint, TaskMediaPeer } from '@pet/host-kernel';
import {
  createLocalPluginKernel,
  LocalQQSourceController,
  QQAgentLink,
  LocalQQExecutionOwner,
  openPrivateDirectory,
  type LocalPluginKernel,
} from '@pet/local-host';
import {
  captureCurrentOwnedProcess,
  ownedProcessIdentity,
  verifyCurrentOwnedProcess,
  verifyOriginalProcessGone,
  type OwnedProcessProvider,
} from '../../../packages/local-host/src/owned-process.js';
import { decodeOneBotFrame } from '@pet/qq-onebot';
import { mapOneBotInput } from '@pet/local-host/qq-input';
import { createAuthorizedOneBotIo } from '@pet/local-host/qq-native';
import { createCompanionService, type CompanionService } from './service.js';
import { createQQMediaTransfer } from './qq-media-transfer.js';

const sourceDirectories = [
  'packages/local-host',
  'packages/contracts',
  'packages/host-kernel',
  'packages/companion-runtime',
  'packages/plugin-sdk',
  'plugins/qq-official',
  'plugins/qq-onebot',
  'plugins/local-host-bridge',
  'plugins/local-agent-link',
  'apps/companion-service',
];
const sourcePins = () =>
  Object.fromEntries(
    sourceDirectories.map((relative) => [
      relative,
      packageFingerprint(fileURLToPath(new URL(`../../../${relative}`, import.meta.url))),
    ]),
  );
function serviceFilePins(): Record<string, string> {
  const root = fileURLToPath(new URL('./..', import.meta.url)),
    files: Record<string, string> = {};
  const walk = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      if (['node_modules', '.git', 'coverage'].includes(name)) continue;
      const file = path.join(directory, name),
        stat = lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error('Unexpected service source symlink');
      if (stat.isDirectory()) walk(file);
      else if (stat.isFile())
        files[path.relative(root, file)] = createHash('sha256')
          .update(readFileSync(file))
          .digest('hex');
    }
  };
  walk(root);
  return files;
}
let beforePins: ReturnType<typeof sourcePins>,
  beforeServiceFiles: ReturnType<typeof serviceFilePins>;
beforeAll(() => {
  beforePins = sourcePins();
  beforeServiceFiles = serviceFilePins();
});
afterAll(() => {
  const after = sourcePins(),
    afterFiles = serviceFilePins();
  const changed = [...new Set([...Object.keys(beforeServiceFiles), ...Object.keys(afterFiles)])]
    .filter((file) => beforeServiceFiles[file] !== afterFiles[file])
    .map((file) => ({
      file,
      before: beforeServiceFiles[file] ?? null,
      after: afterFiles[file] ?? null,
    }));
  console.info(
    'G3 source fingerprints',
    JSON.stringify({
      before: beforePins,
      after,
      serviceFiles: { before: beforeServiceFiles, after: afterFiles, changed },
    }),
  );
  expect(after).toEqual(beforePins);
});
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});
const account: QQAccountRef = {
  protocol: 'onebot-v11',
  sourcePluginId: QQ_ONEBOT_PLUGIN_ID,
  instanceId: 'default',
  accountId: '10001',
};
const token = 'g3-controlled-agent-bearer-12345678';
const nativeToken = 'g3-local-only-platform-secret';
const digest = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
function deferred<T>() {
  let resolve = (_value: T) => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function nativeMessage(id: number, media = false, group = false) {
  return {
    post_type: 'message',
    self_id: 10001,
    time: Math.floor(Date.now() / 1000),
    message_type: group ? 'group' : 'private',
    sub_type: group ? 'normal' : 'friend',
    message_id: id,
    user_id: 10002,
    sender: { user_id: 10002, nickname: 'owner', role: 'owner' },
    ...(group ? { group_id: 201 } : {}),
    message: [
      ...(group ? [{ type: 'at', data: { qq: '10001' } }] : []),
      { type: 'text', data: { text: `Controlled remote input ${id}` } },
      ...(media ? [{ type: 'file', data: { file_id: 'g3-file', name: 'fixture.bin' } }] : []),
    ],
  };
}
function mappedMessage(raw: ReturnType<typeof nativeMessage>) {
  const decoded = decodeOneBotFrame(JSON.stringify(raw), 10001);
  if (!decoded.ok || decoded.value.kind !== 'message') throw new Error('Invalid native fixture');
  const mapped = mapOneBotInput(account, decoded.value);
  if (!mapped) throw new Error('No mapped input');
  return mapped;
}
function installDiagnostics() {
  const rpc: string[] = [],
    readers: Array<{
      id: string;
      bytes: number;
      eof: boolean;
      cancelled: boolean;
      error: boolean;
    }> = [],
    writers: Array<{
      id: string;
      bytes: number;
      ending: boolean;
      ended: boolean;
      cancelled: boolean;
    }> = [];
  const request = ControlEndpoint.prototype.request;
  vi.spyOn(ControlEndpoint.prototype, 'request').mockImplementation(function (
    this: ControlEndpoint,
    method,
    input,
    options,
  ) {
    const tracked = [
      'source.offer',
      'input.offer',
      'material.read',
      'material.offer',
      'authority.check',
    ].includes(method);
    if (tracked && rpc.length < 192) rpc.push(`${method}:start`);
    const result = request.call(this, method, input, options);
    if (tracked)
      void result.then((value) => {
        if (rpc.length < 192) rpc.push(`${method}:${value.ok ? 'ok' : value.error.code}`);
      });
    return result;
  });
  const createReader = TaskMediaPeer.prototype.createReader;
  vi.spyOn(TaskMediaPeer.prototype, 'createReader').mockImplementation(function (
    this: TaskMediaPeer,
    input,
  ) {
    const result = createReader.call(this, input);
    if (!result.ok) return result;
    const original = result.value,
      state = {
        id: original.reference.streamId,
        bytes: 0,
        eof: false,
        cancelled: false,
        error: false,
      };
    readers.push(state);
    return {
      ok: true,
      value: {
        reference: original.reference,
        cancel: () => {
          state.cancelled = true;
          original.cancel();
        },
        async *[Symbol.asyncIterator]() {
          try {
            for await (const bytes of original) {
              state.bytes += bytes.byteLength;
              yield bytes;
            }
            state.eof = true;
          } catch (error) {
            state.error = true;
            throw error;
          }
        },
      },
    };
  });
  const createWriter = TaskMediaPeer.prototype.createWriter;
  vi.spyOn(TaskMediaPeer.prototype, 'createWriter').mockImplementation(function (
    this: TaskMediaPeer,
    input,
  ) {
    const result = createWriter.call(this, input);
    if (!result.ok) return result;
    const original = result.value,
      state = {
        id: original.reference.streamId,
        bytes: 0,
        ending: false,
        ended: false,
        cancelled: false,
      };
    writers.push(state);
    return {
      ok: true,
      value: {
        reference: original.reference,
        write: async (bytes) => {
          const value = await original.write(bytes);
          if (value.ok) state.bytes += bytes.byteLength;
          return value;
        },
        end: async () => {
          state.ending = true;
          const value = await original.end();
          state.ended = value.ok;
          return value;
        },
        cancel: () => {
          state.cancelled = true;
          original.cancel();
        },
      },
    };
  });
  return { rpc, readers, writers };
}
async function fixture() {
  const diagnostic = installDiagnostics();
  const ioTrace: string[] = [],
    nativeStop = new AbortController(),
    nativePumps = new Set<Promise<void>>();
  const consumed = new Map<string, number>(),
    waiters = new Map<string, { count: number; resolve(): void; reject(): void }>();
  const echoHash = (echo: string) => digest(Buffer.from(echo)).slice(0, 12);
  const consumedFrame = (echo: string) => {
    const count = (consumed.get(echo) ?? 0) + 1;
    consumed.set(echo, count);
    const wait = waiters.get(echo);
    if (wait && count >= wait.count) {
      waiters.delete(echo);
      wait.resolve();
    }
  };
  const waitConsumed = (echo: string, count: number): Promise<void> => {
    if (nativeStop.signal.aborted) return Promise.reject(new Error('fixture stopped'));
    if ((consumed.get(echo) ?? 0) >= count) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      waiters.set(echo, { count, resolve, reject: () => reject(new Error('fixture stopped')) });
    });
  };
  nativeStop.signal.addEventListener(
    'abort',
    () => {
      for (const waiter of waiters.values()) waiter.reject();
      waiters.clear();
    },
    { once: true },
  );
  const root = await mkdtemp(path.join(tmpdir(), 'pet-g3-production-'));
  // Cleanup runs even when a later stage fails, so it reads this box; each resource binds once.
  const owned: {
    service?: CompanionService;
    kernel?: LocalPluginKernel;
    sources?: LocalQQSourceController;
    agent?: QQAgentLink;
    peer?: WebSocket;
  } = {};
  cleanups.push(async () => {
    nativeStop.abort();
    let stage = 'agent';
    const errors: unknown[] = [];
    const timer = setTimeout(
      () => console.error(`G3 cleanup waiting at ${stage}; root=${root}`),
      5000,
    );
    timer.unref();
    try {
      const stages: Array<[string, () => Promise<unknown>]> = [
        ['agent', async () => owned.agent?.close()],
        ['sources', async () => owned.sources?.close()],
        ['kernel', async () => owned.kernel?.close()],
        [
          'native-peer',
          async () => {
            const current = owned.peer;
            if (current && current.readyState !== WebSocket.CLOSED) {
              const closed = once(current, 'close');
              current.terminate();
              await closed;
            }
          },
        ],
        [
          'native-pumps',
          async () => {
            await Promise.allSettled([...nativePumps]);
          },
        ],
        ['service', async () => owned.service?.close()],
      ];
      for (const [name, close] of stages) {
        stage = name;
        try {
          await close();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) throw new AggregateError(errors, `G3 fixture cleanup failed: ${root}`);
      const resolved = await realpath(root);
      if (
        path.dirname(resolved) !== (await realpath(tmpdir())) ||
        !path.basename(resolved).startsWith('pet-g3-production-')
      )
        throw new Error('Wrong fixture root');
      await rm(resolved, { recursive: true });
    } finally {
      clearTimeout(timer);
    }
  });
  const client = createFixtureModelClient(),
    original = client.respond.bind(client);
  const nativeModel = vi.spyOn(client, 'respond').mockImplementation(async (request, options) => {
    const generation = await original(request, options);
    return {
      ...generation,
      attempts: [
        {
          id: `attempt-${generation.response.id}`,
          generationId: generation.response.id,
          ordinal: 1,
          origin: generation.origin,
          startedAt: new Date().toISOString(),
          elapsedMs: 0,
          requestId: null,
          responseId: generation.response.id,
          outcome: 'completed',
          status: 200,
          serviceTier: null,
          meters: {
            input: null,
            output: null,
            total: null,
            cachedInput: null,
            uncachedInput: null,
            reasoning: null,
            native: null,
          },
          charges: [],
        },
      ],
    };
  });
  const service: CompanionService = (owned.service = await createCompanionService({
    dataDirectory: path.join(root, 'server'),
    hostname: '127.0.0.1',
    port: 0,
    token,
    mode: 'model',
    model: 'g3-fixture',
    client,
  }));
  const serverVerify = service.host.verifySource.bind(service.host);
  vi.spyOn(service.host, 'verifySource').mockImplementation((pluginId) => {
    const started = performance.now();
    try {
      return serverVerify(pluginId);
    } finally {
      const elapsed = Math.round(performance.now() - started);
      if (elapsed >= 20) ioTrace.push(`server-verify:${pluginId}:${elapsed}`);
    }
  });
  const grants = new Map<string, RuntimeInputGrant>();
  const offTerminal = service.runtime.onInputTerminal((event) => {
    grants.set(event.admission.id, event.grant);
  });
  cleanups.push(async () => {
    offTerminal();
    grants.clear();
  });
  const policy = await service.host.configs.save(
    { pluginId: QQ_FEATURE_PLUGIN_ID, instanceId: 'default' },
    {
      ...service.qq.policy().settings,
      privateAllowlist: [{ account, scene: 'private', senderId: '10002' }],
      groupAllowlist: [{ account, groupId: '201' }],
    },
    service.qq.policy().revision,
  );
  if (!policy.ok) throw new KernelFault(policy.error.code);
  const hostId = 'g3-local-host';
  const before = await service.localHost.view();
  const selected = await fetch(`${service.url}/api/local-host`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      expectedRevision: before.revision,
      selection: { mode: 'remote-host', hostId },
    }),
  });
  expect(selected.status).toBe(200);
  const paths = Object.fromEntries(
    await Promise.all(
      ['qq-official', 'qq-onebot', 'local-agent-link'].map(async (name) => {
        const directory = await realpath(new URL(`../../../plugins/${name}`, import.meta.url));
        return [
          name,
          {
            directory,
            manifest: JSON.parse(
              await readFile(path.join(directory, 'plugin.json'), 'utf8'),
            ) as PluginManifest,
          },
        ];
      }),
    ),
  );
  const requiredSources = () => {
    if (!sources) throw new Error('No sources');
    return sources;
  };
  const requiredAgent = () => {
    if (!agent) throw new Error('No AgentLink');
    return agent;
  };
  const official = paths['qq-official'],
    onebot = paths['qq-onebot'],
    link = paths['local-agent-link'];
  if (!official || !onebot || !link) throw new Error('Missing plugin package');
  const kernel: LocalPluginKernel = (owned.kernel = await createLocalPluginKernel({
    dataDirectory: path.join(root, 'local'),
    official: {
      ...official,
      preset: 'allow',
      portsFor: (context) => requiredSources().officialPorts(context),
    },
    onebot: {
      ...onebot,
      preset: 'allow',
      portsFor: (context) => requiredSources().onebotPorts(context),
    },
    agentLink: {
      ...link,
      preset: 'allow',
      portsFor: (context) => requiredAgent().featurePorts(context),
    },
  }));
  const configGet = kernel.host.configs.get.bind(kernel.host.configs);
  let configChecks = 0;
  vi.spyOn(kernel.host.configs, 'get').mockImplementation(async (identity) => {
    if (identity.pluginId !== QQ_ONEBOT_PLUGIN_ID) return configGet(identity);
    const id = ++configChecks,
      started = performance.now();
    ioTrace.push(`config-start:${id}:${Math.round(started)}`);
    try {
      return await configGet(identity);
    } finally {
      ioTrace.push(`config-return:${id}:${Math.round(performance.now())}`);
    }
  });
  const verifySource = kernel.host.verifySource.bind(kernel.host);
  vi.spyOn(kernel.host, 'verifySource').mockImplementation((pluginId) => {
    const started = performance.now();
    try {
      return verifySource(pluginId);
    } finally {
      const elapsed = Math.round(performance.now() - started);
      if (elapsed >= 20) ioTrace.push(`verify:${pluginId}:${elapsed}`);
    }
  });
  const listening = deferred<number>(),
    receipts: QQInputReceipt[] = [],
    receiptWaiters = new Set<{
      match(receipt: QQInputReceipt): boolean;
      resolve(receipt: QQInputReceipt): void;
    }>(),
    nativeEvents: string[] = [];
  const sources: LocalQQSourceController = (owned.sources = new LocalQQSourceController(kernel, {
    onebotFactory: (host, binding) => {
      let checks = 0;
      const io = createAuthorizedOneBotIo(
        host,
        {
          ...binding,
          check: async () => {
            const id = ++checks;
            ioTrace.push(`binding-check-start:${id}`);
            try {
              await binding.check();
              ioTrace.push(`binding-check-return:${id}`);
            } catch (error) {
              ioTrace.push(`binding-check-error:${id}`);
              throw error;
            }
          },
        },
        {
          onListening: (address) => listening.resolve(address.port),
        },
      );
      return {
        ...io,
        nextPeer: async (signal) => {
          const native = await io.nextPeer(signal);
          return {
            ...native,
            frames: {
              async *[Symbol.asyncIterator]() {
                for await (const text of native.frames) {
                  const decoded = decodeOneBotFrame(text, binding.settings.accountId);
                  const label = decoded.ok
                    ? decoded.value.kind === 'response'
                      ? `response:${echoHash(decoded.value.echo)}`
                      : decoded.value.kind
                    : decoded.error.code;
                  ioTrace.push(`read:${native.id}:${label}`);
                  yield text;
                  let pending = -1;
                  try {
                    const current = sources?.captureSource(account);
                    if (current?.protocol === 'onebot-v11') pending = current.driver.pendingCount;
                  } catch {
                    /* retired diagnostic */
                  }
                  ioTrace.push(`reader-next:${label}:pending=${pending}`);
                }
              },
            },
            send: async (frame, caller) => {
              const label = `${frame.action}:${echoHash(frame.echo)}`;
              ioTrace.push(`write-start:${native.id}:${label}`);
              const result = await native.send(frame, caller);
              ioTrace.push(`write-return:${label}:${result.ok ? 'ok' : result.error.code}`);
              return result;
            },
            openMedia: (request, caller) => {
              ioTrace.push(`media-open:${request.action}:${echoHash(request.echo)}`);
              const exchange = native.openMedia(request, caller);
              return {
                ...exchange,
                frames: {
                  async *[Symbol.asyncIterator]() {
                    for await (const frame of exchange.frames) {
                      yield frame;
                      consumedFrame(request.echo);
                    }
                  },
                },
              };
            },
          };
        },
      };
    },
    onOfficial: (event, captured) => {
      nativeEvents.push(event.t);
      return requiredAgent().official(event, captured);
    },
    onOneBot: (event, captured) => {
      nativeEvents.push(event.kind);
      return requiredAgent().onebot(event, captured);
    },
    onebotTest: { onListening: (address) => listening.resolve(address.port) },
    changed: () => {
      void agent?.syncSources();
    },
  }));
  await sources.initialize();
  const profile = await openPrivateDirectory(path.join(root, 'local'));
  const process = await captureCurrentOwnedProcess(profile);
  const ownedProcess: OwnedProcessProvider = {
    identity: () => ownedProcessIdentity(process),
    check: () => verifyCurrentOwnedProcess(process, profile),
    gone: (original) => verifyOriginalProcessGone(original, profile),
  };
  const execution = new LocalQQExecutionOwner({ kernel, sources, ownedProcess });
  const agent: QQAgentLink = (owned.agent = new QQAgentLink({
    kernel,
    sources,
    execution,
    ownedProcess,
    identity: { protocolVersion: 1, packageVersion: '0.1.0', hostId, bootId: 'g3-boot' },
    onReceipt: (receipt) => {
      receipts.push(receipt);
      for (const waiter of [...receiptWaiters]) {
        if (waiter.match(receipt)) {
          receiptWaiters.delete(waiter);
          waiter.resolve(receipt);
        }
      }
    },
  }));
  await agent.initialize();
  for (const id of [
    QQ_OFFICIAL_PLUGIN_ID,
    QQ_ONEBOT_PLUGIN_ID,
    LOCAL_AGENT_LINK_PLUGIN_ID,
  ] as const)
    kernel.confirmTrust(id, kernel.review(id).digest);
  const snapshot = await service.runtime.snapshot();
  const target = await agent.saveTarget({
    expectedRevision: (await agent.view()).revision,
    baseUrl: service.url,
    agentId: snapshot.agent.id,
    agentEpoch: snapshot.epoch,
  });
  await agent.saveCredential({
    expectedRevision: target.revision,
    expectedCredentialVersion: target.credentialVersion,
    value: token,
  });
  const keyed = await agent.view();
  await agent.connect(keyed.revision, keyed.credentialVersion);
  const view = await sources.view();
  let row = view.sources.find((source) => source.protocol === 'onebot-v11');
  if (!row) throw new Error('No OneBot source');
  let mutation = await sources.saveSource({
    protocol: 'onebot-v11',
    expectedRevision: row.configRevision,
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
  if (mutation.error) throw new KernelFault(mutation.error.code);
  row = mutation.view.sources.find((source) => source.protocol === 'onebot-v11');
  if (!row) throw new Error('No OneBot source');
  mutation = await sources.credential({
    protocol: 'onebot-v11',
    expectedRevision: row.configRevision,
    expectedCredentialVersion: row.credential.version,
    value: nativeToken,
  });
  if (mutation.error) throw new KernelFault(mutation.error.code);
  mutation = await sources.setEnabled('onebot-v11', true, mutation.view.revision);
  if (mutation.error) throw new KernelFault(mutation.error.code);
  const peer: WebSocket = (owned.peer = new WebSocket(
    `ws://127.0.0.1:${await listening.promise}/qq`,
    {
      headers: {
        Authorization: `Bearer ${nativeToken}`,
        'X-Self-ID': '10001',
        'X-Client-Role': 'Universal',
      },
    },
  ));
  const payload = Buffer.alloc(2 * 1024 * 1024 + 19, 37);
  const calls: Array<{ action: string; params: Record<string, unknown> }> = [];
  let nativeSends = 0;
  const capturedPeer = peer;
  peer.on('message', (bytes) => {
    const request = JSON.parse(String(bytes)) as {
      action: string;
      params: Record<string, unknown>;
      echo: string;
    };
    calls.push(request);
    const response = (data: Record<string, unknown>, stream = false): Promise<void> =>
      new Promise((resolve, reject) => {
        ioTrace.push(`fixture-response:${request.action}:${echoHash(request.echo)}`);
        capturedPeer.send(
          JSON.stringify({
            status: 'ok',
            retcode: 0,
            echo: request.echo,
            ...(stream ? { stream: 'stream-action' } : {}),
            data,
          }),
          (error) => {
            ioTrace.push(
              `fixture-response-written:${request.action}:${echoHash(request.echo)}:${error ? 'error' : 'ok'}`,
            );
            if (error) reject(error);
            else resolve();
          },
        );
      });
    const pumping = (async () => {
      if (request.action === 'get_private_file_url' || request.action === 'get_group_file_url')
        await response({ url: 'https://files.qq.com/local-private-g3-signed-reference' });
      else if (request.action === 'download_file_stream') {
        const chunkSize = request.params['chunk_size'];
        if (
          typeof chunkSize !== 'number' ||
          !Number.isSafeInteger(chunkSize) ||
          chunkSize < 1 ||
          chunkSize > 262144
        )
          throw new Error('Invalid requested chunk size');
        await response(
          {
            type: 'stream',
            data_type: 'file_info',
            file_name: 'fixture.bin',
            file_size: payload.length,
            chunk_size: chunkSize,
          },
          true,
        );
        await waitConsumed(request.echo, 1);
        let index = 0;
        for (let at = 0; at < payload.length; at += chunkSize) {
          nativeStop.signal.throwIfAborted();
          const part = payload.subarray(at, at + chunkSize),
            base64 = part.toString('base64');
          await response(
            {
              type: 'stream',
              data_type: 'file_chunk',
              index: index++,
              data: base64,
              size: part.length,
              base64_size: base64.length,
              progress: 0,
            },
            true,
          );
          await waitConsumed(request.echo, index + 1);
        }
        await response(
          {
            type: 'response',
            data_type: 'file_complete',
            file_name: 'fixture.bin',
            total_chunks: index,
            total_bytes: payload.length,
          },
          true,
        );
      } else if (request.action === 'send_private_msg' || request.action === 'send_group_msg')
        await response({ message_id: ++nativeSends + 80000 });
      else await response({});
    })();
    nativePumps.add(pumping);
    void pumping.then(
      () => nativePumps.delete(pumping),
      () => {
        nativePumps.delete(pumping);
        ioTrace.push(`fixture-pump-failed:${request.action}`);
      },
    );
  });
  await once(peer, 'open');
  await vi.waitFor(
    async () =>
      expect(
        (await sources?.view())?.sources.find((row) => row.protocol === 'onebot-v11')?.phase,
      ).toBe('ready'),
    { timeout: 5000 },
  );
  await agent.syncSources();
  await vi.waitFor(async () => expect((await service?.localHost.view())?.sources).toHaveLength(1), {
    timeout: 5000,
  });
  return {
    service,
    kernel,
    sources,
    agent,
    peer,
    payload,
    calls,
    receipts,
    waitReceipt: (match: (receipt: QQInputReceipt) => boolean, timeoutMs = 15000) =>
      new Promise<QQInputReceipt>((resolve, reject) => {
        const existing = receipts.find(match);
        if (existing) return resolve(existing);
        const waiter = {
          match,
          resolve: (receipt: QQInputReceipt) => {
            clearTimeout(timer);
            resolve(receipt);
          },
        };
        const timer = setTimeout(() => {
          receiptWaiters.delete(waiter);
          reject(new Error('Receipt did not arrive'));
        }, timeoutMs);
        receiptWaiters.add(waiter);
      }),
    nativeModel,
    nativeSends: () => nativeSends,
    diagnostics: async () => ({
      ...diagnostic,
      ioTrace: ioTrace.slice(-160),
      nativeEvents,
      actions: calls.map((call) => call.action),
      receipts,
      link: await agent?.view(),
      sources: (await sources?.view())?.sources.map((source) => ({
        protocol: source.protocol,
        phase: source.phase,
        error: source.error,
      })),
      localTasks: kernel?.host.tasks.diagnostics(),
      serverTasks: service?.host.tasks.diagnostics(),
      bridge: await service?.localHost.view(),
    }),
    grants,
    root,
    ownedProcess,
  };
}
async function completed(
  f: Awaited<ReturnType<typeof fixture>>,
  raw: ReturnType<typeof nativeMessage>,
) {
  const mapped = mappedMessage(raw);
  // Wait on the real terminal event for this exact admission instead of re-entering State
  // through the host on every poll: each getInput is a full capability/task round trip.
  const terminal = new Promise<RuntimeInputTerminal>((resolve, reject) => {
    let off = () => {};
    const timer = setTimeout(() => {
      off();
      reject(new Error(`Input ${mapped.observationId} did not settle within 15000ms`));
    }, 15000);
    off = f.service.runtime.onInputTerminal((event) => {
      if (event.admission.id !== mapped.observationId) return;
      clearTimeout(timer);
      off();
      resolve(event);
    });
  });
  try {
    f.peer.send(JSON.stringify(raw));
    const settled = await terminal;
    expect(settled.admission.phase).toBe('completed');
  } catch (error) {
    console.error('G3 input stage', JSON.stringify(await f.diagnostics()));
    throw error;
  }
  // Read the committed record once through the real State capability.
  return f.service.runtime.state('getInput', {
    id: mapped.observationId,
    scope: { kind: 'management' },
  });
}
async function accessFor(
  f: Awaited<ReturnType<typeof fixture>>,
  input: Awaited<ReturnType<typeof completed>>,
): Promise<RuntimeInputAccess> {
  await vi.waitFor(() => expect(f.grants.has(input.id)).toBe(true), { timeout: 5000 });
  const grant = f.grants.get(input.id);
  if (!grant) throw new Error('Missing original server terminal grant');
  expect(grant.origin).toEqual(input.origin);
  expect(grant.role).toBe('member');
  await grant.check();
  return {
    signal: grant.signal,
    scope: {
      kind: 'conversation',
      audience: grant.origin.audience,
      principalId: grant.origin.principalId,
    },
    check: async () => {
      await grant.check();
    },
  };
}

it('authenticates the actual local source and reaches real Core once across a bridge reconnect', async () => {
  const f = await fixture();
  const raw = nativeMessage(501),
    input = await completed(f, raw);
  expect(input.origin.audience.kind).toBe('person-private');
  expect(f.nativeModel).toHaveBeenCalled();
  const access = await accessFor(f, input);
  await vi.waitFor(() => expect(f.nativeSends()).toBe(1), { timeout: 5000 });
  const calls = f.nativeModel.mock.calls.length;
  const before = await f.agent.view();
  await f.agent.disconnect(before.revision, before.credentialVersion);
  await access.check();
  await f.agent.connect(before.revision, before.credentialVersion);
  await f.agent.syncSources();
  f.peer.send(JSON.stringify(raw));
  await vi.waitFor(() =>
    expect(f.receipts.filter((item) => item.inputId === input.id).length).toBeGreaterThan(1),
  );
  expect(f.nativeModel.mock.calls.length).toBe(calls);
  expect(f.nativeSends()).toBe(1);
  const snapshot = await fetch(`${f.service.url}/api/snapshot`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((response) => response.json());
  expect(snapshot).toMatchObject({
    ok: true,
    value: { agent: { id: (await f.service.runtime.snapshot()).agent.id } },
  });
  expect(
    f.kernel.host.manager
      .list()
      .some((plugin) => /state-sqlite|agent-cortico|harness/.test(plugin.owner.pluginId)),
  ).toBe(false);
  expect((await f.service.localHost.view()).sources[0]?.processIdentity).toEqual(
    f.ownedProcess.identity(),
  );
}, 30000);

it('moves real native file bytes through the task byteplane without exporting the private locator', async () => {
  const f = await fixture(),
    input = await completed(f, nativeMessage(502, true));
  expect(input.materialIds).toHaveLength(1);
  const id = input.materialIds[0];
  if (!id) throw new Error('Missing material');
  const access = await accessFor(f, input);
  const chunks: Buffer[] = [];
  await f.service.materials.withMaterial(id, access, async (reference, bytes) => {
    expect(reference.sha256).toBe(digest(f.payload));
    for await (const chunk of bytes) chunks.push(Buffer.from(chunk));
  });
  const received = Buffer.concat(chunks);
  expect(received.byteLength).toBe(f.payload.byteLength);
  expect(received.equals(f.payload)).toBe(true);
  expect(digest(received)).toBe(digest(f.payload));
  expect(f.calls.filter((call) => call.action === 'download_file_stream')).toHaveLength(1);
  expect(JSON.stringify(input)).not.toContain('local-private-g3-signed-reference');
  expect(JSON.stringify(await f.service.localHost.view())).not.toContain(nativeToken);
}, 30000);

it('loads a real context-only file notice through the scoped work producer and reuses server custody', async () => {
  const f = await fixture();
  const raw = {
    post_type: 'notice',
    notice_type: 'group_upload',
    self_id: 10001,
    time: Math.floor(Date.now() / 1000),
    user_id: 10002,
    group_id: 201,
    file: { id: 'g3-observed-file', name: 'evidence.bin', size: f.payload.length, busid: 0 },
  };
  const decoded = decodeOneBotFrame(JSON.stringify(raw), 10001);
  if (!decoded.ok || decoded.value.kind !== 'group-upload') throw new Error('Invalid notice');
  const mapped = mapOneBotInput(account, decoded.value);
  if (!mapped) throw new Error('No notice');
  // Wait for the real admission receipt for this exact event instead of re-entering State.
  // A context-only notice carries no admission id by design; match its own event key/state.
  const observed = f.waitReceipt(
    (receipt) =>
      receipt.state === 'observed' &&
      receipt.inputId === null &&
      receipt.eventKey === mapped.eventKey,
    5000,
  );
  f.peer.send(JSON.stringify(raw));
  try {
    await observed;
    expect(
      (
        await f.service.runtime.state('getObservation', {
          id: mapped.observationId,
          scope: { kind: 'management' },
        })
      ).fileEvidence?.fileId,
    ).toBe('g3-observed-file');
  } catch (error) {
    console.error(
      'G3 notice stage',
      JSON.stringify({
        native: { contextOnly: mapped.contextOnly, fileEvidence: mapped.fileEvidence },
        ...(await f.diagnostics()),
      }),
    );
    throw error;
  }
  const input = await completed(f, nativeMessage(503, false, true)),
    access = await accessFor(f, input);
  const transfer = createQQMediaTransfer({
    host: f.service.host,
    runtime: f.service.runtime,
    qq: f.service.qq,
    materials: f.service.materials,
    audio: f.service.audio,
    producerForObservedFile: f.service.localHost.observedFileProducer,
  });
  cleanups.push(() => transfer.close());
  const request = {
    title: 'Read visible file',
    code: 'controlled',
    materials: [{ materialId: mapped.observationId, inputName: 'evidence.bin' }],
  };
  const result = await transfer.prepareWork(input, request, access);
  const id = result.materials?.[0]?.materialId;
  if (!id) throw new Error('No canonical work material');
  expect(
    (await f.service.runtime.state('getMaterial', { id, scope: access.scope })).reference?.sha256,
  ).toBe(digest(f.payload));
  const before = await f.agent.view();
  await f.agent.disconnect(before.revision, before.credentialVersion);
  expect(await transfer.prepareWork(input, request, access)).toEqual(result);
  expect(f.calls.filter((call) => call.action === 'get_group_file_url')).toHaveLength(1);
}, 30000);

it('returns its own target/key receipt and preserves the baseline for a Config no-op', async () => {
  const f = await fixture(),
    baseline = await f.agent.view();
  expect(
    await f.agent.saveTarget({ expectedRevision: baseline.revision, ...baseline.target }),
  ).toEqual(baseline);
  const abort = new AbortController();
  const off = f.kernel.host.onConfigurationCommit((commit) => {
    if (commit.pluginId === LOCAL_AGENT_LINK_PLUGIN_ID && commit.revision === baseline.revision + 1)
      abort.abort();
  });
  let saved;
  try {
    saved = await f.agent.saveTarget(
      { expectedRevision: baseline.revision, ...baseline.target, agentId: 'next-agent' },
      abort.signal,
    );
  } finally {
    off();
  }
  expect(saved).toMatchObject({
    revision: baseline.revision + 1,
    target: { agentId: 'next-agent' },
    hasCredential: false,
  });
  expect(saved.credentialVersion).not.toBe(baseline.credentialVersion);
  const keyed = await f.agent.saveCredential({
    expectedRevision: saved.revision,
    expectedCredentialVersion: saved.credentialVersion,
    value: 'different-owner-key-123456789',
  });
  expect(keyed.credentialVersion).not.toBe(saved.credentialVersion);
  await expect(
    f.agent.saveCredential({
      expectedRevision: saved.revision,
      expectedCredentialVersion: saved.credentialVersion,
      value: token,
    }),
  ).rejects.toMatchObject({ error: { code: 'conflict' } });
}, 30000);

it('rejects a wrong Agent bearer without hanging readiness or creating an input', async () => {
  const f = await fixture(),
    before = await f.agent.view();
  const changed = await f.agent.saveCredential({
    expectedRevision: before.revision,
    expectedCredentialVersion: before.credentialVersion,
    value: 'invalid-agent-bearer-123456789',
  });
  await expect(f.agent.connect(changed.revision, changed.credentialVersion)).rejects.toBeDefined();
  expect((await f.agent.view()).phase).toBe('failed');
  expect((await f.service.localHost.view()).sources).toHaveLength(0);
  expect(f.nativeModel).not.toHaveBeenCalled();
  expect(f.nativeSends()).toBe(0);
}, 30000);
