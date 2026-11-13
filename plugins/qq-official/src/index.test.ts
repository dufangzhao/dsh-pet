import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { makeError, type JsonObject, type JsonValue } from '@pet/contracts';
import { validateManifest } from '@pet/contracts/validation';
import type { PluginContext, PluginTask } from '@pet/plugin-sdk';
import plugin, { createOfficialQqPlugin, type OfficialQqDriver } from './index.js';
import { unusedOfficialMedia } from './media-test-helpers.js';

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
      owner: { pluginId: 'pet.qq-official', instanceId: 'default', generation: 1 },
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

test('official manifest declares one ordinary native provider and no generic network permission', () => {
  const result = validateManifest(
    JSON.parse(readFileSync(new URL('../plugin.json', import.meta.url), 'utf8')) as unknown,
  );
  assert.ok(result.ok);
  assert.equal(result.value.id, 'pet.qq-official');
  assert.equal(result.value.entries.runtime, 'dist/index.mjs');
  assert.deepEqual(
    result.value.provides?.map((item) => [item.id, item.capability]),
    [['official', 'companion.qq.protocol@1']],
  );
  assert.equal(
    result.value.permissions?.some((permission) => permission.kind === 'network'),
    false,
  );
});

test(
  'official activation registers a dormant binding, and effect disposal awaits native close',
  { timeout: 3000 },
  async (t) => {
    const fixture = context({
      protocol: 'official',
      appId: 'fixture-app',
      scenes: ['private', 'group'],
    });
    let bound: OfficialQqDriver | null = null;
    let opens = 0;
    let closes = 0;
    let unbound = 0;
    let release: () => void = () => {};
    const closeGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const definition = createOfficialQqPlugin(() => ({
      authorizedOfficial: () => ({
        media: unusedOfficialMedia(),
        openGateway: async () => {
          opens++;
          throw new Error('activation must not open');
        },
        send: async () => {
          throw new Error('unexpected send');
        },
        upload: async () => {
          throw new Error('unexpected upload');
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
    assert.equal(opens, 0);
    assert.equal(closes, 0);
    const describe = fixture.methods.get('official')?.['describe'];
    assert.ok(describe);
    const description = await describe(
      { taskId: 'describe', signal: new AbortController().signal },
      null,
    );
    assert.deepEqual(description, {
      protocol: 'official',
      appId: 'fixture-app',
      scenes: ['private', 'group'],
      configured: true,
      transport: 'production-ws',
      nativeWire: true,
    });
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
    assert.equal(opens, 0);
  },
);

test('official unconfigured source exposes description without manufacturing an IO binding', async () => {
  const fixture = context({ protocol: 'official', appId: '', scenes: ['private'] });
  const definition = createOfficialQqPlugin(() => {
    throw new Error('must not bind an unconfigured source');
  });
  await definition.activate(fixture.context);
  assert.equal(fixture.effects.length, 0);
  assert.throws(() => plugin.activate(fixture.context), /errors.not-ready/u);
  assert.throws(
    () =>
      definition.activate(
        context({ protocol: 'official', appId: 'x', scenes: ['private'], sandbox: true }).context,
      ),
    /errors.invalid-input/u,
  );
});
