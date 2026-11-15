import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { register } from 'tsx/esm/api';
register();
const {
  CompanionPluginHost, companionHostManifest, companionHostDefinition,
  ModelConnections, MODEL_CONNECTION_CAPABILITY, createFixtureModelClient,
} = await import('../../packages/companion-runtime/src/index.ts');
const { definePlugin } = await import('../../packages/plugin-sdk/src/index.ts');

// Kept outside provider package roots so adding this focused probe does not invalidate a live preview.
test('a directly held unbound authorized transport loses its exact revision token on committed config save', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'companion-raw-transport-'));
  const source = { pluginId: 'pet.transport-probe', instanceId: 'default' };
  const key = `${source.pluginId}/fixture`;
  const manifest = {
    schemaVersion: 1, id: source.pluginId, version: '0.1.0',
    displayName: { en: 'Unbound transport probe' }, description: { en: 'Synthetic revision-token verification' },
    license: 'MIT', host: '^1.0.0', platforms: ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64'],
    entries: { runtime: 'probe.mjs' },
    provides: [{ id: 'fixture', capability: MODEL_CONNECTION_CAPABILITY, features: {
      nativeResponses: 1, methodPermissions: { describe: [{ kind: 'files', scope: 'plugin-data', access: 'read' }] },
    } }],
    permissions: [{ kind: 'files', scope: 'plugin-data', access: 'read-write' }],
    config: { version: 1, schema: { type: 'object', additionalProperties: false, required: ['label'],
      properties: { label: { type: 'string', default: 'initial', maxLength: 80 } } } },
  };
  const rootDirectory = path.join(directory, companionHostManifest.id);
  const sourceDirectory = path.join(directory, source.pluginId);
  await mkdir(rootDirectory);
  await mkdir(sourceDirectory);
  await writeFile(path.join(rootDirectory, 'plugin.json'), JSON.stringify(companionHostManifest));
  await writeFile(path.join(sourceDirectory, 'plugin.json'), JSON.stringify(manifest));
  let registry;
  let held;
  let rawSignal;
  let rawCalls = 0;
  let release = () => {};
  let enter = () => {};
  const actual = new Promise((resolve) => { release = resolve; });
  const entered = new Promise((resolve) => { enter = resolve; });
  const request = { model: 'connection-fixture', input: [] };
  const generation = await createFixtureModelClient().respond(request);
  const registration = {
    manifest, directory: sourceDirectory, enabled: false, preset: 'allow',
    connection: { providerId: 'fixture', describeConfig: () => ({
      label: 'Unbound fixture', synthetic: true, settings: null, model: 'connection-fixture',
      credentialRequired: false, credentialWritable: false,
    }) },
    definition: definePlugin({ activate(context) {
      held = registry.portsFor(context).authorizedResponses('https://fixture.invalid/v1');
      const transport = held;
      context.effect(() => () => transport.close());
      context.provide('fixture', { describe: async () => ({ synthetic: true }) });
      // Deliberately no bind(): the activation token must protect the transport itself.
    } }),
  };
  let host;
  let observed;
  try {
    host = await CompanionPluginHost.create({ dataDirectory: path.join(directory, 'data'), plugins: [
      { manifest: companionHostManifest, directory: rootDirectory, definition: companionHostDefinition, enabled: true, preset: 'allow' },
      registration,
    ] });
    registry = new ModelConnections(host, [registration], () => ({
      client: { async respond(_request, options) {
        rawCalls++;
        rawSignal = options.signal;
        enter();
        await actual;
        return generation;
      } },
      async close() { await actual; },
    }));
    registry.select(key);
    await registry.enable(key);
    assert(held);
    assert.equal(registry.binding(), null, 'the probe must not be protected merely by a bound fixture');
    const owner = host.owner(source.pluginId);
    let settled = false;
    observed = held.client.respond(request).then(
      (value) => { settled = true; return value; },
      (error) => { settled = true; return error; },
    );
    await entered;
    assert.equal(rawSignal.aborted, false);
    const saved = await host.configs.save(source, { label: 'next revision' }, 1);
    assert.equal(saved.ok, true);
    assert.equal(saved.value.snapshot.revision, 2);
    assert.equal(rawSignal.aborted, true, 'save must return after fencing the old transport token');
    assert.deepEqual(host.owner(source.pluginId), owner, 'this is a revision fence, not owner replacement');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false, 'logical cancellation cannot fabricate physical native settlement');
    await assert.rejects(held.client.respond(request), (error) => error.error?.code === 'stale-owner');
    assert.equal(rawCalls, 1, 'a retained old port must not start another native operation');
    release();
    assert.equal((await observed).error?.code, 'stale-owner', 'old-generation native success is withheld');
    assert.equal(host.configurationDiagnostics().observerFailures, 0);
  } finally {
    release();
    if (observed) await observed;
    await host?.close();
    const target = await realpath(directory);
    assert.equal(path.dirname(target), await realpath(tmpdir()));
    assert(path.basename(target).startsWith('companion-raw-transport-'));
    await rm(target, { recursive: true });
  }
});
