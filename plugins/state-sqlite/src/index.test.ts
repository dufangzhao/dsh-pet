import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import type { JsonValue } from '@pet/contracts';
import { makeError } from '@pet/contracts';
import { jsonPreflight, validateManifest } from '@pet/contracts/validation';
import type { PluginContext, PluginTask } from '@pet/plugin-sdk';
import plugin, { SqliteState, STATE_METHODS } from './index.js';

type Method = (task: PluginTask, input: JsonValue) => Promise<JsonValue>;
const roots: string[] = [];
const disposers: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
  for (const directory of roots.splice(0)) {
    const target = realpathSync(directory);
    if (
      dirname(target) !== realpathSync(tmpdir()) ||
      !basename(target).startsWith('pet-state-sqlite-test-')
    )
      throw new Error('unexpected-test-directory');
    rmSync(target, { recursive: true });
  }
});

it('declares an ordinary manifest and returns payload Result under plugin lifecycle ownership', async () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../plugin.json', import.meta.url), 'utf8'),
  ) as unknown;
  const checked = validateManifest(manifest);
  expect(checked.ok).toBe(true);
  if (!checked.ok) throw new Error(checked.error.code);
  expect(checked.value.provides).toMatchObject([
    {
      id: 'sqlite',
      capability: 'companion.state@1',
      features: {
        methodPermissions: {
          getMessage: [{ kind: 'files', scope: 'plugin-data', access: 'read' }],
          getDeliveryExecution: [{ kind: 'files', scope: 'plugin-data', access: 'read' }],
          bindDeliveryTask: [{ kind: 'files', scope: 'plugin-data', access: 'read-write' }],
          settleDeliveryCleanup: [{ kind: 'files', scope: 'plugin-data', access: 'read-write' }],
          enrichDeliveryAttempt: [{ kind: 'files', scope: 'plugin-data', access: 'read-write' }],
          findMaterial: [{ kind: 'files', scope: 'plugin-data', access: 'read' }],
          inputNotices: [{ kind: 'files', scope: 'plugin-data', access: 'read' }],
          proactiveReadiness: [{ kind: 'files', scope: 'plugin-data', access: 'read' }],
          passiveReplyBudget: [{ kind: 'files', scope: 'plugin-data', access: 'read' }],
        },
      },
    },
  ]);
  const permissions = checked.value.provides?.[0]?.features?.['methodPermissions'];
  expect(permissions && typeof permissions === 'object' ? Object.keys(permissions) : []).toEqual(
    expect.arrayContaining([...STATE_METHODS]),
  );
  const directory = mkdtempSync(join(tmpdir(), 'pet-state-sqlite-test-'));
  roots.push(directory);
  let methods: Readonly<Record<string, Method>> = {};
  const effects: Array<() => () => void | Promise<void>> = [];
  const unavailable = async () => ({ ok: false as const, error: makeError('unavailable') });
  const context: PluginContext = {
    dataDirectory: directory,
    owner: { pluginId: 'pet.state-sqlite', instanceId: 'default', generation: 1 },
    signal: new AbortController().signal,
    config: {},
    host: {
      version: 1,
      config: { get: unavailable },
      capabilities: { invoke: unavailable },
      media: { openInput: unavailable, openOutput: unavailable },
    },
    provide(provider, value) {
      expect(provider).toBe('sqlite');
      methods = value;
    },
    contribute() {
      throw new Error('unexpected-contribution');
    },
    effect(factory) {
      effects.push(factory);
    },
  };
  await plugin.activate(context);
  expect(Object.keys(methods)).toEqual([...STATE_METHODS]);
  const snapshot = methods['snapshot'];
  const accept = methods['acceptMessage'];
  if (!snapshot || !accept) throw new Error('missing-method');
  const task: PluginTask = { taskId: 'test', signal: new AbortController().signal };
  expect(await snapshot(task, {})).toEqual({ ok: false, error: makeError('not-ready') });
  for (const effect of effects) disposers.push(effect());
  const first = await snapshot(task, {});
  expect(first).toMatchObject({ ok: true, value: { cursor: 0 } });
  expect(jsonPreflight(first).ok).toBe(true);
  expect(await accept(task, { commandId: 'bad', text: 'hello', privateField: true })).toEqual({
    ok: false,
    error: makeError('invalid-input'),
  });
  expect(await accept(task, { commandId: 'first', text: 'hello' })).toMatchObject({
    ok: true,
    value: { receipt: { status: 'accepted' } },
  });
  const cancelled = AbortSignal.abort();
  expect(
    await accept(
      { taskId: 'cancelled', signal: cancelled },
      { commandId: 'second', text: 'hello' },
    ),
  ).toEqual({ ok: false, error: makeError('cancelled') });
  const dispose = disposers.pop();
  if (!dispose) throw new Error('missing-disposer');
  await dispose();
  expect(await snapshot(task, {})).toEqual({ ok: false, error: makeError('not-ready') });
  const reopened = new SqliteState({ dataDirectory: directory });
  try {
    const result = reopened.snapshot();
    expect(result).toMatchObject({ ok: true, value: { cursor: 1 } });
  } finally {
    reopened.close();
  }
});
