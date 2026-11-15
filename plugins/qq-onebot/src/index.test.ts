import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { makeError, type JsonObject, type JsonValue } from '@pet/contracts';
import { validateManifest } from '@pet/contracts/validation';
import type { PluginContext, PluginTask } from '@pet/plugin-sdk';
import plugin, { createOneBotQqPlugin, type OneBotQqDriver } from './index.js';

type Method = (task: PluginTask, input: JsonValue) => Promise<JsonValue>;
function context(config: JsonObject): {
  context: PluginContext;
  effects: (() => void | Promise<void>)[];
  methods: Map<string, Readonly<Record<string, Method>>>;
} {
  const effects: (() => void | Promise<void>)[] = [];
  const methods = new Map<string, Readonly<Record<string, Method>>>();
  const unavailable = async (): Promise<{ ok: false; error: ReturnType<typeof makeError> }> => ({
    ok: false,
    error: makeError('unavailable', false),
  });
  return {
    effects,
    methods,
    context: {
      owner: { pluginId: 'pet.qq-onebot', instanceId: 'default', generation: 1 },
      signal: new AbortController().signal,
      config,
      provide: (id, entries) => methods.set(id, entries),
      contribute: () => {},
      effect: (factory) => {
        effects.push(factory());
      },
      host: {
        version: 1,
        config: { get: unavailable },
        capabilities: { invoke: unavailable },
        media: { openInput: unavailable, openOutput: unavailable },
      },
    },
  };
}
const settings: JsonObject = {
  protocol: 'onebot-v11',
  accountId: '10001',
  mode: 'reverse-ws',
  channelMode: 'universal',
  mediaProfile: 'snowluma-v11',
  listenHost: '127.0.0.1',
  listenPort: 6199,
  path: '/ws',
};

test('OneBot manifest declares only the approved reverse Universal ordinary provider', () => {
  const result = validateManifest(
    JSON.parse(readFileSync(new URL('../plugin.json', import.meta.url), 'utf8')) as unknown,
  );
  assert.ok(result.ok);
  assert.equal(result.value.id, 'pet.qq-onebot');
  assert.equal(result.value.entries.runtime, 'dist/index.mjs');
  assert.deepEqual(
    result.value.provides?.map((item) => [item.id, item.capability]),
    [['onebot', 'companion.qq.protocol@1']],
  );
  assert.equal(
    result.value.permissions?.some((permission) => permission.kind === 'network'),
    false,
  );
});

test(
  'OneBot activation does not listen or start the driver and disposal joins IO',
  { timeout: 3000 },
  async (t) => {
    const fixture = context(settings);
    let bound: OneBotQqDriver | null = null;
    let accepts = 0;
    let closes = 0;
    let unbound = 0;
    let release: () => void = () => {};
    const closeGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const definition = createOneBotQqPlugin(() => ({
      authorizedOneBot: () => ({
        nextPeer: async () => {
          accepts++;
          throw new Error('activation must not listen');
        },
        close: async () => {
          closes++;
          await closeGate;
        },
      }),
      observer: { onStatus: () => {}, onEvent: async () => {} },
      bind: (driver) => {
        bound = driver;
        return async () => {
          unbound++;
        };
      },
    }));
    t.after(async () => {
      release();
      for (const dispose of fixture.effects.reverse()) await dispose();
    });
    await definition.activate(fixture.context);
    assert.ok(bound);
    assert.equal(accepts, 0);
    assert.equal(closes, 0);
    const describe = fixture.methods.get('onebot')?.['describe'];
    assert.ok(describe);
    assert.deepEqual(
      await describe({ taskId: 'describe', signal: new AbortController().signal }, null),
      {
        protocol: 'onebot-v11',
        accountId: '10001',
        configured: true,
        mode: 'reverse-ws',
        channelMode: 'universal',
        mediaProfile: 'snowluma-v11',
        nativeWire: true,
      },
    );
    const dispose = fixture.effects.pop();
    assert.ok(dispose);
    let done = false;
    const disposing = Promise.resolve(dispose()).then(() => {
      done = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(done, false);
    assert.equal(unbound, 1);
    release();
    await disposing;
    assert.equal(closes, 1);
    assert.equal(accepts, 0);
  },
);

test('OneBot missing native host ports, empty account and unselected modes do not start connections', async () => {
  const fixture = context({ ...settings, accountId: '' });
  const definition = createOneBotQqPlugin(() => {
    throw new Error('unconfigured source cannot bind');
  });
  await definition.activate(fixture.context);
  assert.equal(fixture.effects.length, 0);
  assert.throws(() => plugin.activate(fixture.context), /errors.not-ready/u);
  for (const changed of [
    { mode: 'forward-ws' },
    { channelMode: 'split' },
    { mediaProfile: 'generic' },
  ])
    assert.throws(
      () => definition.activate(context({ ...settings, ...changed }).context),
      /errors.invalid-input/u,
    );
});
