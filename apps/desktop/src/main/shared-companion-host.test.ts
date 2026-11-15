import { afterEach, expect, it, vi } from 'vitest';
import { build } from 'esbuild';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import type * as FsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DesktopHost } from './desktop-host.js';
import { DesktopCompanionHostAdapter } from './companion-client-host.js';
import { presentationOnlyChange } from './shared-composition-policy.js';
import type { PluginManifest, CompanionSnapshot } from '@pet/contracts';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { DesktopCompanionController } from './companion-client-controller.js';
const renameGate = vi.hoisted(() => ({ target: '', wait: null as (() => Promise<void>) | null }));
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof FsPromises>();
  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (String(args[1]) === renameGate.target && renameGate.wait) await renameGate.wait();
      return actual.rename(...args);
    },
  };
});
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  renameGate.wait = null;
  renameGate.target = '';
  for (const close of cleanups.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});
async function fixture(stopFor: () => Promise<void> = async () => {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'shared-desktop-host-'));
  cleanups.push(async () => {
    if (path.dirname(root) !== tmpdir() || !path.basename(root).startsWith('shared-desktop-host-'))
      throw new Error('Unexpected temp root');
    await rm(root, { recursive: true });
  });
  const builtins = path.join(root, 'builtin');
  const users = path.join(root, 'profile/plugins');
  await mkdir(builtins);
  await mkdir(users, { recursive: true });
  const manifest = JSON.parse(
    await readFile(
      new URL('../../../../plugins/companion-client/plugin.json', import.meta.url),
      'utf8',
    ),
  ) as PluginManifest;
  const directory = path.join(builtins, 'client');
  await mkdir(directory);
  await writeFile(
    path.join(directory, 'plugin.json'),
    JSON.stringify({ ...manifest, entries: { runtime: 'entry.mjs' } }),
  );
  await writeFile(
    path.join(directory, 'entry.mjs'),
    'export default {activate(ctx){ctx.provide("client",{describe:async()=>null});}};',
  );
  // Controlled policy fixture on the actual platform; it must never execute its forbidden role.
  const legacy = path.join(builtins, 'legacy');
  await mkdir(legacy);
  await writeFile(
    path.join(legacy, 'plugin.json'),
    JSON.stringify({
      schemaVersion: 1,
      id: 'pet.agent-cortico',
      version: '0.1.0',
      host: '^1.0.0',
      platforms: [`${process.platform}-${process.arch}`],
      displayName: { en: 'Forbidden role fixture' },
      description: { en: 'Policy test only' },
      license: 'MIT',
      entries: { runtime: 'entry.mjs' },
    }),
  );
  await writeFile(
    path.join(legacy, 'entry.mjs'),
    'export default {activate(){throw new Error("forbidden activation reached");}};',
  );
  const worker = path.join(root, 'worker.cjs');
  await build({
    entryPoints: [fileURLToPath(new URL('../runtime/worker.ts', import.meta.url))],
    outfile: worker,
    platform: 'node',
    format: 'cjs',
    bundle: true,
    target: 'node24',
    external: ['electron'],
  });
  const host = await DesktopHost.create({
    executable: process.execPath,
    workerEntry: worker,
    builtinDirectory: builtins,
    userDirectory: users,
    sharedCompanion: true,
    adapters: { permission: (permission) => permission.kind === 'files' },
    companionLifecycle: { sourcePluginId: 'pet.companion-client', stopFor },
  });
  cleanups.push(() => host.shutdown());
  for (const entry of host.manager.list()) {
    const trust = host.describeTrust(entry.owner);
    if (!trust) throw new Error('No trust');
    host.permissionControl.confirmTrust(
      { pluginId: entry.owner.pluginId, instanceId: 'default' },
      trust.digest,
      true,
    );
  }
  const id = { pluginId: 'pet.companion-client', instanceId: 'default' };
  const config = await host.configs.get(id);
  if (!config.ok) throw new Error('No config');
  expect((await host.manager.enable(id, config.value.data)).ok).toBe(true);
  expect(host.manager.get(id)?.state).toBe('active');
  return { host, id, root, port: new DesktopCompanionHostAdapter(host) };
}
it('actual-platform source stop joins Main drain; forbidden role never activates', async () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let draining = false;
  const { host, id } = await fixture(async () => {
    draining = true;
    await gate;
  });
  const disabled = host.manager.disable(id);
  await vi.waitFor(() => expect(draining).toBe(true));
  expect(host.manager.get(id)?.state).toBe('deactivating');
  release();
  await disabled;
  expect(host.manager.get(id)?.state).toBe('disabled');
  const legacy = await host.manager.enable({
    pluginId: 'pet.agent-cortico',
    instanceId: 'default',
  });
  expect(legacy.ok && legacy.value.state).toBe('unready');
  expect(
    host.manager.get({ pluginId: 'pet.agent-cortico', instanceId: 'default' })?.reason?.code,
  ).toBe('not-ready');
}, 30000);
it('unconfirmed Main cleanup remains pending_restart and cannot be reenabled', async () => {
  const { host, id } = await fixture(async () => {
    throw new Error('controlled drain failure');
  });
  await host.manager.disable(id);
  expect(host.manager.get(id)?.state).toBe('pending_restart');
  expect((await host.manager.enable(id)).ok).toBe(false);
}, 30000);
it('revoked source credentials await actual native settlement and cannot publish a value', async () => {
  const { host, id, port } = await fixture();
  const source = await port.readSource();
  if (!source.ok) throw new Error('source unavailable');
  let began = false;
  let aborted = false;
  let finished = false;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const work = port
    .withToken(
      source.value,
      'isolated-token-that-is-not-persisted',
      new AbortController().signal,
      async (_token, signal) => {
        began = true;
        await new Promise<void>((resolve) =>
          signal.addEventListener(
            'abort',
            () => {
              aborted = true;
              resolve();
            },
            { once: true },
          ),
        );
        await gate;
        return { shouldNotPublish: true };
      },
    )
    .then(
      () => {
        finished = true;
        return true;
      },
      () => {
        finished = true;
        return false;
      },
    );
  await vi.waitFor(() => expect(began).toBe(true));
  host.permissionControl.revoke(id);
  await vi.waitFor(() => expect(aborted).toBe(true));
  expect(finished).toBe(false);
  release();
  expect(await work).toBe(false);
}, 30000);
it('presentation allowlist preserves archived persona and rejects generic identity changes', () => {
  const old = { petName: 'old', personaPrompt: 'old persona', figure: 'minimal', visible: true };
  expect(presentationOnlyChange(old, { ...old, visible: false })).toBe(true);
  expect(presentationOnlyChange(old, { ...old, personaPrompt: 'new' })).toBe(false);
  expect(presentationOnlyChange(old, { ...old, petName: 'new' })).toBe(false);
  expect(presentationOnlyChange(old, { visible: true })).toBe(false);
});

async function connectedFixture(token = 'native-source-operator-token-1234') {
  const f = await fixture();
  let echoSnapshot = false;
  let echoProfile = false;
  const snapshot: CompanionSnapshot = {
    protocolVersion: 1,
    epoch: 'epoch',
    cursor: 0,
    now: 1,
    agent: {
      id: 'agent',
      name: 'Agent',
      profileRevision: 1,
      harness: 'fixture',
      mode: 'scripted',
      status: 'ready',
      error: null,
    },
    messages: [],
    facts: [],
    plugins: [],
    tasks: [
      {
        id: 'task',
        executionId: 'execution',
        origin: {
          inputId: null,
          principalId: 'owner',
          audience: { kind: 'owner-private' },
          route: { kind: 'owner-private' },
          origins: [],
          materialIds: [],
        },
        title: 'file',
        status: 'completed',
        createdAt: 1,
        updatedAt: 1,
        exitCode: 0,
        stdout: '',
        stderr: '',
        logsTruncated: false,
        error: null,
        artifacts: [
          {
            id: 'artifact',
            taskId: 'task',
            name: 'result.txt',
            mediaType: 'text/plain',
            sizeBytes: 6,
          },
        ],
      },
    ],
  };
  const server = createServer((request, response) => {
    expect(request.headers.authorization).toBe(`Bearer ${token}`);
    if (request.url?.startsWith('/api/events')) {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(': keepalive\n\n');
      return;
    }
    if (request.url === '/api/snapshot') {
      response.end(
        JSON.stringify({
          ok: true,
          value: {
            ...snapshot,
            messages: echoSnapshot
              ? [
                  {
                    id: 'echo',
                    role: 'assistant',
                    text: token,
                    createdAt: 1,
                    inputId: null,
                    taskId: null,
                  },
                ]
              : [],
          },
        }),
      );
      return;
    }
    if (request.url === '/api/profile') {
      response.end(
        JSON.stringify({
          ok: true,
          value: {
            agentId: 'agent',
            name: 'Agent',
            revision: 1,
            persona: echoProfile ? token : 'persona',
          },
        }),
      );
      return;
    }
    if (request.url === '/api/artifacts/artifact') {
      response.writeHead(200, { 'content-length': '6' });
      response.end('abcdef');
      return;
    }
    response.writeHead(404).end('{}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let target = path.join(f.root, 'result.txt');
  const controller = new DesktopCompanionController(
    f.port,
    { choose: async () => target },
    () => {},
  );
  cleanups.push(() => controller.close());
  await controller.initialize();
  return {
    ...f,
    controller,
    baseUrl,
    token,
    snapshot,
    setTarget: (value: string) => {
      target = value;
    },
    echoSnapshot: () => {
      echoSnapshot = true;
    },
    echoProfile: () => {
      echoProfile = true;
    },
  };
}
it.each([false, true])(
  'entered native rename preserves actual outcome while replacement drains (failure=%s)',
  async (failure) => {
    const f = await connectedFixture();
    const connected = await f.controller.connect({
      baseUrl: f.baseUrl,
      token: f.token,
      expectedRevision: 1,
    });
    if (!connected.ok || !connected.value.connectionId) throw new Error('connect failed');
    const target = path.join(f.root, failure ? 'existing-directory' : 'result.txt');
    if (failure) await mkdir(target);
    f.setTarget(target);
    const entered = deferred();
    const release = deferred();
    renameGate.target = target;
    renameGate.wait = async () => {
      entered.resolve();
      await release.promise;
    };
    const save = f.controller.saveArtifact(
      { connectionId: connected.value.connectionId, artifactId: 'artifact' },
      1,
    );
    await Promise.race([
      entered.promise,
      save.then(() => {
        throw new Error('Artifact save completed before the controlled rename');
      }),
    ]);
    let replaced = false;
    const replacement = f.controller
      .connect({
        baseUrl: f.baseUrl,
        token: f.token,
        expectedRevision: connected.value.configRevision,
      })
      .then((result) => {
        replaced = true;
        return result;
      });
    try {
      await vi.waitFor(async () =>
        expect(await f.controller.getState()).toMatchObject({ value: { phase: 'retiring' } }),
      );
      expect(replaced).toBe(false);
    } finally {
      release.resolve();
    }
    const saved = await save;
    const next = await replacement;
    if (failure) {
      expect(saved).toMatchObject({ ok: false, error: { code: 'unavailable' } });
      expect(await readFile(target).catch(() => null)).toBe(null);
    } else {
      expect(saved).toEqual({
        ok: true,
        value: { status: 'saved', name: 'result.txt', sizeBytes: 6 },
      });
      expect(await readFile(target, 'utf8')).toBe('abcdef');
    }
    expect(next).toMatchObject({ ok: true, value: { phase: 'live', pending: [] } });
    if (next.ok) expect(next.value.connectionId).not.toBe(connected.value.connectionId);
  },
  30000,
);
it.each(['saved-shaped', 'undefined'] as const)(
  'unrecorded %s value cannot bypass a retired credential/source fence',
  async (kind) => {
    const f = await fixture();
    const source = await f.port.readSource();
    if (!source.ok) throw new Error('no source');
    const entered = deferred();
    const release = deferred();
    const abort = new AbortController();
    const result = f.port
      .withToken(
        source.value,
        'source-token-that-is-not-saved',
        abort.signal,
        async () => {
          entered.resolve();
          await release.promise;
          return kind === 'undefined'
            ? undefined
            : { ok: true, value: { status: 'saved', name: 'forged.txt', sizeBytes: 1 } };
        },
        { source: source.value, connectionId: 'forged' },
      )
      .catch((error: unknown) => error);
    await entered.promise;
    abort.abort();
    release.resolve();
    expect(await result).toMatchObject({
      error: expect.objectContaining({ code: expect.any(String) }),
    });
  },
  30000,
);
it('quoted/backslash bearer echoes cannot reach snapshot/profile public state', async () => {
  const token = 'operator-quoted-"token\\-canary-12345';
  expect(JSON.stringify({ text: token }).includes(token)).toBe(false); // old serialized check missed this
  const f = await connectedFixture(token);
  const connected = await f.controller.connect({ baseUrl: f.baseUrl, token, expectedRevision: 1 });
  if (!connected.ok || !connected.value.connectionId) throw new Error('connect failed');
  f.echoProfile();
  expect(
    await f.controller.readProfile({ connectionId: connected.value.connectionId }),
  ).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
  f.echoSnapshot();
  expect(await f.controller.refresh({ connectionId: connected.value.connectionId })).toMatchObject({
    ok: true,
    value: { phase: 'offline', error: { code: 'permission-denied' } },
  });
  const state = await f.controller.getState();
  expect(JSON.stringify(state)).not.toContain(JSON.stringify(token).slice(1, -1));
}, 30000);
it('readSource rechecks a source disabled while trust verification was pending', async () => {
  const f = await fixture();
  const entered = deferred();
  const release = deferred();
  const original = f.host.verifyTrust;
  vi.spyOn(f.host, 'verifyTrust').mockImplementationOnce(async (...args) => {
    entered.resolve();
    await release.promise;
    return original(...args);
  });
  const read = f.port.readSource();
  await entered.promise;
  await f.host.manager.disable(f.id);
  release.resolve();
  expect(await read).toMatchObject({ ok: false, error: { code: 'stale-owner' } });
}, 30000);
it.each(['disable', 'revoke', 'throw'] as const)(
  'post-CAS %s preserves saved endpoint/revision without unauthorized HTTP',
  async (loss) => {
    const f = await fixture();
    const entered = deferred();
    const release = deferred();
    let committed = false;
    let blocked = false;
    f.host.onConfigurationCommit(f.id.pluginId, () => {
      committed = true;
    });
    const original = f.port.readSource.bind(f.port);
    vi.spyOn(f.port, 'readSource').mockImplementation(async () => {
      if (committed && !blocked) {
        blocked = true;
        entered.resolve();
        await release.promise;
        if (loss === 'throw') throw new Error('post-save read failure');
      }
      return original();
    });
    const fetch_ = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('unexpected unauthorized request'));
    const controller = new DesktopCompanionController(
      f.port,
      { choose: async () => null },
      () => {},
    );
    cleanups.push(() => controller.close());
    await controller.initialize();
    const result = controller.connect({
      baseUrl: 'http://127.0.0.1:41234',
      token: 'new-operator-token-123456789',
      expectedRevision: 1,
    });
    await entered.promise;
    if (loss === 'disable') await f.host.manager.disable(f.id);
    if (loss === 'revoke') f.host.permissionControl.revoke(f.id);
    release.resolve();
    expect(await result).toMatchObject({
      ok: true,
      value: {
        baseUrl: 'http://127.0.0.1:41234',
        configRevision: 2,
        source: 'unavailable',
        phase: 'offline',
        connectionId: null,
        snapshot: null,
      },
    });
    expect(await f.port.readEndpoint()).toEqual({
      ok: true,
      value: { baseUrl: 'http://127.0.0.1:41234', revision: 2 },
    });
    expect(fetch_).not.toHaveBeenCalled();
  },
  30000,
);
