import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { once } from 'node:events';
import WebSocket from 'ws';
import { KernelFault } from '@pet/host-kernel';
import { LOCAL_HOST_PROTOCOL_VERSION, QQ_OFFICIAL_PLUGIN_ID, makeError } from '@pet/contracts';
import { createLocalPluginKernel, connectAgentBridge } from '@pet/local-host';
import { LocalQQSourceController } from '../../../packages/local-host/src/qq-source.ts';
import {
  LocalQQExecutionOwner,
  qqExecutionJson,
} from '../../../packages/local-host/src/qq-execution.ts';
import { openPrivateDirectory } from '../../../packages/local-host/src/rendezvous.ts';
import {
  captureCurrentOwnedProcess,
  ownedProcessIdentity,
  verifyCurrentOwnedProcess,
  verifyOriginalProcessGone,
} from '../../../packages/local-host/src/owned-process.ts';

const configured = once(process, 'message');
process.send({ bootstrapped: true });
const [config] = await configured;
const profile = await openPrivateDirectory(config.profile);
const provenance = await captureCurrentOwnedProcess(profile);
let forgedProof = false,
  wrongChallenge = false,
  dropReply = false;
const processOwner = {
  identity: () => ownedProcessIdentity(provenance),
  check: () => verifyCurrentOwnedProcess(provenance, profile),
  async gone(original) {
    if (forgedProof) {
      forgedProof = false;
      return { status: 'gone' };
    }
    return verifyOriginalProcessGone(original, profile);
  },
};
const bootId = randomUUID();
let source, kernel, execution, peer, closed;
let changed = Promise.withResolvers();
let executeCalls = 0,
  recoverCalls = 0;
const account = {
  protocol: 'official',
  sourcePluginId: QQ_OFFICIAL_PLUGIN_ID,
  instanceId: 'default',
  accountId: 'qa-app',
};
const close = () =>
  (closed ??= (async () => {
    peer?.close();
    await peer?.settled;
    await execution?.close();
    await source?.close();
    await kernel?.close();
    return {
      pendingWork: kernel.host.tasks.diagnostics().pendingWork,
      leases: kernel.host.permissions.diagnostics().leases,
      executeCalls,
      recoverCalls,
    };
  })());
const reply = async (work) => {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return { ok: false, error: error instanceof KernelFault ? error.error : makeError('internal') };
  }
};
async function connect() {
  peer?.close();
  await peer?.settled;
  let current;
  current = await connectAgentBridge({
    baseUrl: config.baseUrl,
    token: config.token,
    hello: {
      type: 'hello',
      protocolVersion: LOCAL_HOST_PROTOCOL_VERSION,
      packageVersion: '0.1.0-test',
      hostId: config.hostId,
      bootId,
      agentId: config.agentId,
      agentEpoch: config.agentEpoch,
    },
    channel: () => ({
      live: () => !closed,
      signalFor: (owner, taskId) => (current ? execution.signalFor(current, owner, taskId) : null),
      handlers: {
        'delivery.execute': (rpc, input) =>
          reply(async () => {
            executeCalls++;
            const result = await execution.execute(current, input, rpc.signal);
            if (dropReply) {
              dropReply = false;
              current.close();
              await current.settled;
            }
            return qqExecutionJson(result);
          }),
        'delivery.inspect': (_rpc, input) =>
          reply(async () => qqExecutionJson(execution.inspect(current, input))),
        'delivery.recover': (rpc, input) =>
          reply(async () => {
            recoverCalls++;
            const result = await execution.recover(current, input, rpc.signal);
            if (wrongChallenge) {
              wrongChallenge = false;
              return qqExecutionJson({ ...result, challenge: randomUUID() });
            }
            return qqExecutionJson(result);
          }),
      },
    }),
  });
  peer = current;
  const captured = source.captureSource(account);
  const binding = {
    hostId: config.hostId,
    hostBootId: bootId,
    bridgeSessionId: peer.context.sessionId,
    sourceOwner: captured.owner,
    sourceConfigRevision: captured.configRevision,
    sourcePermissionEpoch: captured.permissionEpoch,
    sourceCredentialVersion: captured.credentialVersion,
    nativeConnectionId: captured.connectionId,
  };
  const offered = await peer.rpc.request('source.offer', {
    account,
    binding,
    processIdentity: processOwner.identity(),
  });
  if (!offered.ok) throw new KernelFault(offered.error.code);
}
try {
  const official = path.join(config.project, 'plugins/qq-official'),
    onebot = path.join(config.project, 'plugins/qq-onebot');
  kernel = await createLocalPluginKernel({
    dataDirectory: profile.path,
    official: {
      directory: official,
      manifest: JSON.parse(await readFile(path.join(official, 'plugin.json'), 'utf8')),
      preset: 'allow',
      portsFor: (context) => source.officialPorts(context),
    },
    onebot: {
      directory: onebot,
      manifest: JSON.parse(await readFile(path.join(onebot, 'plugin.json'), 'utf8')),
      preset: 'allow',
      portsFor: (context) => source.onebotPorts(context),
    },
  });
  source = new LocalQQSourceController(kernel, {
    onOfficial: async () => {},
    onOneBot: async () => {},
    changed: () => changed.resolve(),
    officialTest: {
      fetch: (url, init) => {
        const target = new URL(String(url));
        if (target.origin !== 'https://api.bot.qq.com') throw new Error('Unexpected native target');
        return fetch(new URL(target.pathname, config.nativeUrl), init);
      },
      websocket: () => new WebSocket(config.nativeUrl.replace('http:', 'ws:')),
    },
  });
  kernel.confirmTrust(QQ_OFFICIAL_PLUGIN_ID, kernel.review(QQ_OFFICIAL_PLUGIN_ID).digest);
  await source.initialize();
  let current = (await source.view()).sources.find((item) => item.protocol === 'official');
  let saved = await source.saveSource({
    protocol: 'official',
    expectedRevision: current.configRevision,
    settings: { protocol: 'official', appId: 'qa-app', scenes: ['private'] },
  });
  if (saved.error) throw new KernelFault(saved.error.code);
  current = saved.view.sources.find((item) => item.protocol === 'official');
  saved = await source.credential({
    protocol: 'official',
    expectedRevision: current.configRevision,
    expectedCredentialVersion: current.credential.version,
    value: 'CONTROLLED_QQ_SECRET_CANARY',
  });
  if (saved.error) throw new KernelFault(saved.error.code);
  const enabled = await source.setEnabled('official', true, saved.view.revision);
  if (enabled.error) throw new KernelFault(enabled.error.code);
  const readyDeadline = performance.now() + 10000;
  while (true) {
    const state = (await source.view()).sources.find((item) => item.protocol === 'official');
    process.send({
      diagnostic: 'source-status',
      phase: state.phase,
      cleanup: state.cleanup,
      error: state.error,
    });
    if (state.phase === 'ready') break;
    if (state.error) throw new KernelFault(state.error.code);
    const remaining = readyDeadline - performance.now();
    if (remaining <= 0) throw new Error(`Child source not ready: ${state.phase}/${state.cleanup}`);
    const next = changed;
    changed = Promise.withResolvers();
    let timer;
    try {
      await Promise.race([
        next.promise,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Child source readiness stalled: ${state.phase}`)),
            remaining,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  execution = new LocalQQExecutionOwner({ kernel, sources: source, ownedProcess: processOwner });
  await connect();
  process.send({ ready: true });
  process.on('message', (message) => {
    void (async () => {
      if (message.action === 'dropReply') dropReply = true;
      else if (message.action === 'forgedProof') forgedProof = true;
      else if (message.action === 'wrongChallenge') wrongChallenge = true;
      else if (message.action === 'connect') await connect();
      else if (message.action === 'stats') {
        process.send({ id: message.id, value: { executeCalls, recoverCalls } });
        return;
      } else if (message.action === 'close') {
        const summary = await close();
        process.send({ id: message.id, value: summary }, () => process.disconnect());
        return;
      } else throw new Error('Unknown fixture control');
      process.send({ id: message.id, value: null });
    })().catch((error) => process.send({ id: message.id, error: String(error?.stack ?? error) }));
  });
} catch (error) {
  process.send?.({ error: String(error?.stack ?? error) });
  await close();
  process.exitCode = 1;
  process.disconnect?.();
}
