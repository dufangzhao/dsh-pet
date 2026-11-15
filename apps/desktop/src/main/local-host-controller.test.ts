import { beforeEach, expect, it, vi } from 'vitest';
import {
  isLocalHostConsoleView,
  isLocalHostConsoleTarget,
  makeError,
  type LocalHostConsoleView,
  type LocalHostConsoleMutation,
  type QQSourceView,
  type Result,
} from '@pet/contracts';
import type { LocalManagementClient } from '@pet/local-host';
import type * as TextClientProtocol from '@pet/text-client/protocol';
import { KernelFault } from '@pet/host-kernel';
import { DesktopLocalHostController } from './local-host-controller.js';
import { handleDesktopLocalHostRequest } from './local-host-request.js';
import type { DemoRequestSource } from './demo-request.js';

const network = vi.hoisted(() => ({
  getSnapshot: vi.fn(),
  getLocalHostSelection: vi.fn(),
  selectLocalHost: vi.fn(),
}));
vi.mock('@pet/text-client/protocol', async (original) => ({
  ...(await original<typeof TextClientProtocol>()),
  ...network,
}));
beforeEach(() => {
  network.getSnapshot
    .mockReset()
    .mockResolvedValue({ ok: true, value: { agent: { id: 'agent' }, epoch: 'epoch' } });
  network.getLocalHostSelection.mockReset().mockResolvedValue({
    ok: true,
    value: {
      revision: 1,
      selection: { mode: 'service-local', hostId: null },
      phase: 'disabled',
      error: null,
    },
  });
  network.selectLocalHost.mockReset().mockResolvedValue({
    ok: true,
    value: {
      revision: 2,
      selection: { mode: 'remote-host', hostId: 'host-a' },
      phase: 'waiting',
      error: null,
    },
  });
});
const unavailable = (): Result<never> => ({ ok: false, error: makeError('unavailable', false) });
const companion = { handoffCurrentAgent: async () => unavailable() };
function deferred<T>() {
  let resolve = (_value: T): void => {
    throw new Error('Uninitialized');
  };
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
const target = { hostId: 'host-a', bootId: 'boot-a' };
const source = (protocol: 'official' | 'onebot-v11'): QQSourceView => ({
  protocol,
  sourcePluginId: protocol === 'official' ? 'pet.qq-official' : 'pet.qq-onebot',
  instanceId: 'default',
  desiredEnabled: false,
  source: 'disabled',
  configRevision: 1,
  appliedRevision: null,
  settings:
    protocol === 'official'
      ? { protocol, appId: 'app', scenes: ['private'] }
      : {
          protocol,
          accountId: '123',
          mode: 'reverse-ws',
          channelMode: 'universal',
          mediaProfile: 'snowluma-v11',
          listenHost: '127.0.0.1',
          listenPort: 18999,
          path: '/onebot',
        },
  account: null,
  bindingId: null,
  phase: 'disabled',
  credential: { available: false, writable: true, version: 'source-key-1', source: 'none' },
  installedVersion: '0.1.0',
  media: { text: 'unverified', image: 'unverified', voice: 'unverified', file: 'unverified' },
  cleanup: 'settled',
  error: null,
});
function view(): LocalHostConsoleView {
  return {
    identity: { ...target, protocolVersion: 1, packageVersion: '0.1.0' },
    sourcesRevision: 1,
    sources: [source('official'), source('onebot-v11')],
    agentLink: {
      revision: 1,
      target: { baseUrl: '', agentId: '', agentEpoch: '' },
      credentialVersion: 'agent-key-1',
      hasCredential: false,
      phase: 'disabled',
      sessionId: null,
      error: null,
    },
  };
}
function fixture(stop = async (): Promise<Result<null>> => ({ ok: true, value: null })) {
  const lifetime = new AbortController();
  let closes = 0,
    stops = 0;
  const failure = async () => unavailable();
  const client: LocalManagementClient = {
    identity: { protocolVersion: 1, packageVersion: '0.1.0', hostId: 'host-a', bootId: 'boot-a' },
    signal: lifetime.signal,
    onChanged: () => () => {},
    view: async () => ({ ok: true, value: view() }),
    reviewSource: failure,
    confirmSourceTrust: failure,
    setSourcePreset: failure,
    saveSource: failure,
    setSourceEnabled: failure,
    saveAgentSettings: failure,
    setAgentEnabled: failure,
    clearCredential: failure,
    setCredential: failure,
    status: failure,
    stop: async () => {
      stops++;
      return stop();
    },
    close: async () => {
      closes++;
      lifetime.abort();
    },
  };
  const controller = new DesktopLocalHostController({
    attach: async () => client,
    start: async () => client,
    companion,
    changed: () => {},
  });
  return { client, controller, counts: () => ({ closes, stops }) };
}
it('GUI disposal only detaches an authenticated management client', async () => {
  const setup = fixture();
  await setup.controller.start();
  await setup.controller.close();
  expect(setup.counts()).toEqual({ closes: 1, stops: 0 });
});
it('an absent existing host does not start another daemon during initialization', async () => {
  let starts = 0;
  const setup = fixture();
  const controller = new DesktopLocalHostController({
    attach: async () => {
      throw new KernelFault('not-ready');
    },
    start: async () => {
      starts++;
      return setup.client;
    },
    companion,
    changed: () => {},
  });
  await controller.initialize();
  expect(starts).toBe(0);
  const state = await controller.getState();
  expect(state.ok && state.value.phase).toBe('stopped');
  await controller.close();
});
it('stale boot cannot stop the new host and a valid stop waits actual local cleanup', async () => {
  const release = deferred<Result<null>>();
  const setup = fixture(() => release.promise);
  await setup.controller.start();
  const stale = await setup.controller.stop({ hostId: 'host-a', bootId: 'other-boot' });
  expect(stale.ok).toBe(false);
  expect(setup.counts().stops).toBe(0);
  const unchanged = await setup.controller.getState();
  expect(unchanged.ok && unchanged.value.phase).toBe('running');
  let finished = false;
  const stopping = setup.controller.stop({ hostId: 'host-a', bootId: 'boot-a' }).then((value) => {
    finished = true;
    return value;
  });
  await Promise.resolve();
  expect(finished).toBe(false);
  expect(setup.counts().stops).toBe(1);
  release.resolve({ ok: true, value: null });
  const stopped = await stopping;
  expect(stopped.ok && stopped.value.phase).toBe('stopped');
  expect(setup.counts().closes).toBe(1);
  await setup.controller.close();
});
it('does not reattach or mutate a host while its actual stop is pending', async () => {
  const release = deferred<Result<null>>();
  const setup = fixture(() => release.promise);
  const enabled = vi.spyOn(setup.client, 'setAgentEnabled');
  await setup.controller.start();
  const stopping = setup.controller.stop(target);
  const duplicate = await setup.controller.stop(target);
  expect(duplicate.ok).toBe(false);
  const mutation = await setup.controller.setAgentEnabled({
    ...target,
    expectedRevision: 1,
    expectedCredentialVersion: 'agent-key-1',
    enabled: true,
  });
  expect(mutation.ok).toBe(false);
  expect(enabled).not.toHaveBeenCalled();
  expect(setup.counts().stops).toBe(1);
  const state = await setup.controller.getState();
  expect(state.ok && state.value.phase).toBe('stopping');
  release.resolve({ ok: true, value: null });
  await stopping;
  await setup.controller.close();
});
it('detachment waits for an in-flight attach and closes only its management connection', async () => {
  const setup = fixture();
  const attached = deferred<LocalManagementClient>();
  const controller = new DesktopLocalHostController({
    attach: () => attached.promise,
    start: () => attached.promise,
    companion,
    changed: () => {},
  });
  const opening = controller.start();
  let closed = false;
  const closing = controller.close().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  attached.resolve(setup.client);
  await closing;
  expect((await opening).ok).toBe(false);
  expect(setup.counts()).toEqual({ closes: 1, stops: 0 });
});
it('preserves a local target commit when its GUI token lease retires before key handoff', async () => {
  const setup = fixture();
  const lifetime = new AbortController();
  const savedView = view();
  const agent = {
    baseUrl: 'http://127.0.0.1:9999',
    agentId: 'agent',
    agentEpoch: 'epoch',
    token: 't'.repeat(24),
  };
  const saved: LocalHostConsoleMutation = {
    view: {
      ...savedView,
      agentLink: {
        ...savedView.agentLink,
        revision: 2,
        credentialVersion: 'commit-key-2',
        target: { baseUrl: agent.baseUrl, agentId: agent.agentId, agentEpoch: agent.agentEpoch },
      },
    },
    error: null,
  };
  vi.spyOn(setup.client, 'saveAgentSettings').mockImplementation(async () => {
    lifetime.abort();
    return { ok: true, value: saved };
  });
  const credential = vi.spyOn(setup.client, 'setCredential');
  const controller = new DesktopLocalHostController({
    attach: async () => setup.client,
    start: async () => setup.client,
    companion: {
      handoffCurrentAgent: async (_target, receive) => {
        await receive(agent, lifetime.signal);
        return { ok: false, error: makeError('stale-owner', false) };
      },
    },
    changed: () => {},
  });
  expect(isLocalHostConsoleView(view())).toBe(true);
  await controller.start();
  const result = await controller.linkCurrentAgent({
    ...target,
    connectionId: 'gui-a',
    expectedRevision: 1,
    expectedCredentialVersion: 'agent-key-1',
  });
  expect(result.ok && result.value.view.agentLink.revision).toBe(2);
  expect(result.ok && result.value.error?.code).toBe('stale-owner');
  expect(credential).not.toHaveBeenCalled();
  await controller.close();
});
it.each([false, true])(
  'same-target handoff uses the original key CAS and refuses a borrowed fresh slot (changed=%s)',
  async (changed) => {
    const setup = fixture();
    const agent = {
      baseUrl: 'http://127.0.0.1:9999',
      agentId: 'agent',
      agentEpoch: 'epoch',
      token: 't'.repeat(24),
    };
    const current = view();
    const selected = {
      ...current,
      agentLink: {
        ...current.agentLink,
        target: { baseUrl: agent.baseUrl, agentId: agent.agentId, agentEpoch: agent.agentEpoch },
      },
    };
    vi.spyOn(setup.client, 'view').mockResolvedValue({ ok: true, value: selected });
    const saved: LocalHostConsoleMutation = {
      view: {
        ...selected,
        agentLink: {
          ...selected.agentLink,
          credentialVersion: changed ? 'unrelated-new-slot' : 'agent-key-1',
        },
      },
      error: null,
    };
    vi.spyOn(setup.client, 'saveAgentSettings').mockResolvedValue({ ok: true, value: saved });
    const credential = vi
      .spyOn(setup.client, 'setCredential')
      .mockResolvedValue({ ok: true, value: saved });
    const lifetime = new AbortController();
    const controller = new DesktopLocalHostController({
      attach: async () => setup.client,
      start: async () => setup.client,
      companion: {
        handoffCurrentAgent: async (_target, receive) => receive(agent, lifetime.signal),
      },
      changed: () => {},
    });
    await controller.start();
    const result = await controller.linkCurrentAgent({
      ...target,
      connectionId: 'gui-a',
      expectedRevision: 1,
      expectedCredentialVersion: 'agent-key-1',
    });
    if (changed) {
      expect(credential).not.toHaveBeenCalled();
      expect(result.ok && result.value.error?.code).toBe('conflict');
    } else {
      expect(credential).toHaveBeenCalledWith(
        {
          ...target,
          purpose: 'agent-link',
          expectedRevision: 1,
          expectedCredentialVersion: 'agent-key-1',
        },
        agent.token,
        lifetime.signal,
      );
      expect(result.ok && result.value.error).toBe(null);
    }
    await controller.close();
  },
);
it.each([
  'fresh',
  'same-host',
  'different-host',
  'changed-host',
  'conflict',
  'changed-Agent',
] as const)(
  'explicit link selects the server only under the captured intent (%s)',
  async (scenario) => {
    const setup = fixture();
    const agent = {
      baseUrl: 'http://127.0.0.1:9999',
      agentId: 'agent',
      agentEpoch: 'epoch',
      token: 't'.repeat(24),
    };
    let current = view();
    vi.spyOn(setup.client, 'view').mockImplementation(async (requested) =>
      isLocalHostConsoleTarget(requested)
        ? { ok: true, value: current }
        : { ok: false, error: makeError('invalid-input', false) },
    );
    vi.spyOn(setup.client, 'saveAgentSettings').mockImplementation(async () => {
      current = {
        ...current,
        agentLink: {
          ...current.agentLink,
          revision: 2,
          credentialVersion: 'target-key-2',
          target: { baseUrl: agent.baseUrl, agentId: agent.agentId, agentEpoch: agent.agentEpoch },
        },
      };
      return { ok: true, value: { view: current, error: null } };
    });
    vi.spyOn(setup.client, 'setCredential').mockImplementation(async () => {
      current = {
        ...current,
        agentLink: { ...current.agentLink, credentialVersion: 'stored-key-3', hasCredential: true },
      };
      return { ok: true, value: { view: current, error: null } };
    });
    const selected = (hostId: string, revision: number) => ({
      ok: true,
      value: {
        revision,
        selection: { mode: 'remote-host', hostId },
        phase: 'waiting',
        error: null,
      },
    });
    if (scenario === 'same-host')
      network.getLocalHostSelection.mockResolvedValue(selected('host-a', 4));
    if (scenario === 'different-host' || scenario === 'conflict') {
      network.getLocalHostSelection.mockResolvedValue(selected('host-b', 4));
      network.selectLocalHost.mockResolvedValue(selected('host-a', 5));
    }
    if (scenario === 'changed-host')
      network.getLocalHostSelection
        .mockResolvedValueOnce(selected('host-a', 4))
        .mockResolvedValue(selected('host-b', 5));
    if (scenario === 'conflict')
      network.selectLocalHost.mockResolvedValue({ ok: false, error: makeError('conflict', false) });
    if (scenario === 'changed-Agent')
      network.getSnapshot
        .mockResolvedValueOnce({ ok: true, value: { agent: { id: 'agent' }, epoch: 'epoch' } })
        .mockResolvedValue({
          ok: true,
          value: { agent: { id: 'agent' }, epoch: 'replacement-epoch' },
        });
    const lifetime = new AbortController();
    const controller = new DesktopLocalHostController({
      attach: async () => setup.client,
      start: async () => setup.client,
      companion: {
        handoffCurrentAgent: async (_target, receive) => receive(agent, lifetime.signal),
      },
      changed: () => {},
    });
    await controller.start();
    const result = await controller.linkCurrentAgent({
      ...target,
      connectionId: 'gui-a',
      expectedRevision: 1,
      expectedCredentialVersion: 'agent-key-1',
    });
    expect(result.ok && result.value.view.agentLink.hasCredential).toBe(true);
    if (['same-host', 'changed-host', 'changed-Agent'].includes(scenario))
      expect(network.selectLocalHost).not.toHaveBeenCalled();
    else {
      expect(network.selectLocalHost).toHaveBeenCalledTimes(1);
      expect(network.selectLocalHost).toHaveBeenCalledWith(
        { baseUrl: agent.baseUrl, token: agent.token },
        {
          expectedRevision: scenario === 'fresh' ? 1 : 4,
          selection: { mode: 'remote-host', hostId: 'host-a' },
        },
        lifetime.signal,
      );
    }
    expect(result.ok && result.value.error?.code).toBe(
      scenario === 'changed-Agent'
        ? 'stale-owner'
        : ['conflict', 'changed-host'].includes(scenario)
          ? 'conflict'
          : undefined,
    );
    if (scenario === 'conflict') expect(network.getLocalHostSelection).toHaveBeenCalledTimes(1);
    await controller.close();
  },
);
it('requires the captured credential version for Agent enable and rejects renderer-supplied Agent identity', async () => {
  const setup = fixture();
  const enabled = vi.spyOn(setup.controller, 'setAgentEnabled');
  const linked = vi.spyOn(setup.controller, 'linkCurrentAgent');
  const sourceFrame: DemoRequestSource = {
    role: 'console',
    senderId: 1,
    expectedId: 1,
    mainFrame: true,
    frameUrl: 'file:///console/index.html',
    expectedUrl: 'file:///console/index.html',
  };
  for (const input of [
    { ...target, expectedRevision: 1, enabled: true },
    { ...target, expectedRevision: 1, expectedCredentialVersion: '', enabled: true },
    {
      ...target,
      expectedRevision: 1,
      expectedCredentialVersion: 'key',
      enabled: true,
      agentId: 'other',
    },
  ])
    expect(
      (
        await handleDesktopLocalHostRequest(
          sourceFrame,
          'setAgentEnabled',
          [input],
          setup.controller,
        )
      ).ok,
    ).toBe(false);
  expect(enabled).not.toHaveBeenCalled();
  expect(
    (
      await handleDesktopLocalHostRequest(
        sourceFrame,
        'linkCurrentAgent',
        [
          {
            ...target,
            expectedRevision: 1,
            expectedCredentialVersion: 'key',
            connectionId: 'gui',
            token: 'injected-token',
          },
        ],
        setup.controller,
      )
    ).ok,
  ).toBe(false);
  expect(linked).not.toHaveBeenCalled();
  await setup.controller.close();
});
it('the fixed IPC boundary rejects other frames, roles and invented process parameters', async () => {
  const setup = fixture();
  const source: DemoRequestSource = {
    role: 'console',
    senderId: 1,
    expectedId: 1,
    mainFrame: true,
    frameUrl: 'file:///console/index.html',
    expectedUrl: 'file:///console/index.html',
  };
  for (const rejected of [
    { ...source, role: 'pet' as const },
    { ...source, mainFrame: false },
    { ...source, senderId: 2 },
    { ...source, frameUrl: 'file:///console/index.html#other' },
  ]) {
    expect((await handleDesktopLocalHostRequest(rejected, 'start', [], setup.controller)).ok).toBe(
      false,
    );
  }
  expect(
    (
      await handleDesktopLocalHostRequest(
        source,
        'start',
        [{ command: 'another-process' }],
        setup.controller,
      )
    ).ok,
  ).toBe(false);
  expect(
    (
      await handleDesktopLocalHostRequest(
        source,
        'stop',
        [{ hostId: 'host-a', bootId: 'boot-a', pid: 123 }],
        setup.controller,
      )
    ).ok,
  ).toBe(false);
  const state = await setup.controller.getState();
  expect(state.ok && state.value.phase).toBe('stopped');
  expect(setup.counts()).toEqual({ closes: 0, stops: 0 });
  await setup.controller.close();
});
