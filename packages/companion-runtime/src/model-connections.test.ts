import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { PluginManifest } from '@pet/contracts';
import { definePlugin, type PluginContext } from '@pet/plugin-sdk';
import { companionHostDefinition, companionHostManifest } from './core-plugin.js';
import { CompanionPluginHost } from './plugin-host.js';
import {
  createFixtureModelClient,
  createFixtureModelPlugin,
  describeFixtureModel,
  fixtureModelManifest,
  FIXTURE_MODEL_CONNECTION,
} from './fixture-model.js';
import { ModelConnections } from './model-connections.js';
import {
  MODEL_CONNECTION_CAPABILITY,
  type ModelConnectionRegistration,
  type ResponseClient,
} from './model-connection-types.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
const source = { pluginId: fixtureModelManifest.id, instanceId: 'default' };
const consumer = { pluginId: 'pet.model-consumer', instanceId: 'default' };
const judgmentSource = { pluginId: 'pet.judgment-fixture', instanceId: 'default' };
const judgmentKey = `${judgmentSource.pluginId}/fixture`;

async function fixture(
  client: ResponseClient = createFixtureModelClient(),
  judgment?: ResponseClient,
) {
  const directory = await mkdtemp(path.join(tmpdir(), 'companion-connection-test-'));
  let sourceContext: PluginContext | undefined;
  const manifest: PluginManifest = {
    ...fixtureModelManifest,
    config: {
      version: 1,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['label'],
        properties: { label: { type: 'string', default: 'initial', maxLength: 80 } },
      },
    },
  };
  const sourceDirectory = path.join(directory, source.pluginId);
  await mkdir(sourceDirectory);
  await writeFile(path.join(sourceDirectory, 'plugin.json'), JSON.stringify(manifest));
  const registration: ModelConnectionRegistration = {
    manifest,
    directory: sourceDirectory,
    enabled: false,
    preset: 'allow',
    definition: createFixtureModelPlugin((context) => {
      sourceContext = context;
      return connections.portsFor(context);
    }, client),
    connection: { providerId: 'fixture', describeConfig: describeFixtureModel },
  };
  const registrations: ModelConnectionRegistration[] = [registration];
  if (judgment) {
    const judgmentManifest: PluginManifest = { ...manifest, id: judgmentSource.pluginId };
    const judgmentDirectory = path.join(directory, judgmentSource.pluginId);
    await mkdir(judgmentDirectory);
    await writeFile(path.join(judgmentDirectory, 'plugin.json'), JSON.stringify(judgmentManifest));
    registrations.push({
      manifest: judgmentManifest,
      directory: judgmentDirectory,
      enabled: false,
      preset: 'allow',
      definition: createFixtureModelPlugin((context) => connections.portsFor(context), judgment),
      connection: {
        providerId: 'fixture',
        purpose: 'qq-participation',
        describeConfig: describeFixtureModel,
      },
    });
  }
  const consumerManifest: PluginManifest = {
    ...fixtureModelManifest,
    id: consumer.pluginId,
    provides: [],
    consumes: [{ capability: MODEL_CONNECTION_CAPABILITY, optional: true }],
    permissions: [{ kind: 'capability-use', capability: MODEL_CONNECTION_CAPABILITY }],
  };
  const hostDirectory = path.join(directory, companionHostManifest.id);
  const consumerDirectory = path.join(directory, consumer.pluginId);
  await mkdir(hostDirectory);
  await mkdir(consumerDirectory);
  await writeFile(path.join(hostDirectory, 'plugin.json'), JSON.stringify(companionHostManifest));
  await writeFile(path.join(consumerDirectory, 'plugin.json'), JSON.stringify(consumerManifest));
  const host = await CompanionPluginHost.create({
    dataDirectory: path.join(directory, 'data'),
    plugins: [
      {
        manifest: companionHostManifest,
        directory: hostDirectory,
        definition: companionHostDefinition,
        enabled: true,
        preset: 'allow',
      },
      {
        manifest: consumerManifest,
        directory: consumerDirectory,
        definition: definePlugin({ activate() {} }),
        enabled: true,
        preset: 'allow',
      },
      ...registrations,
    ],
  });
  const connections = new ModelConnections(host, registrations, () => {
    throw new Error('fixture requires no key');
  });
  connections.select(FIXTURE_MODEL_CONNECTION);
  await connections.enable(FIXTURE_MODEL_CONNECTION);
  if (judgment) {
    connections.select(judgmentKey, 'qq-participation');
    await connections.enable(judgmentKey);
  }
  const model = connections;
  cleanups.push(async () => {
    await host.close();
    const target = await realpath(directory);
    if (
      path.dirname(target) !== (await realpath(tmpdir())) ||
      !path.basename(target).startsWith('companion-connection-test-')
    )
      throw new Error('unexpected cleanup target');
    await rm(target, { recursive: true });
  });
  return {
    host,
    model,
    sourceDirectory,
    context: () => sourceContext,
    client: model.clientFor(host.owner(consumer.pluginId)),
    judgment: judgment ? model.clientFor(host.owner(consumer.pluginId), 'qq-participation') : null,
  };
}

const request = { model: 'connection-fixture', input: [] };
type ModelEvent = Parameters<
  NonNullable<NonNullable<Parameters<ResponseClient['respond']>[1]>['onEvent']>
>[0];
const modelEvent = (delta: string): ModelEvent =>
  ({
    type: 'response.output_text.delta',
    sequence_number: 0,
    output_index: 0,
    item_id: 'fixture',
    content_index: 0,
    delta,
    logprobs: [],
  }) as ModelEvent;

it('keeps participation selection and calls separate from the foreground purpose', async () => {
  const native = createFixtureModelClient();
  const calls: string[] = [];
  const f = await fixture(
    {
      respond(...args) {
        calls.push('foreground');
        return native.respond(...args);
      },
    },
    {
      respond(...args) {
        calls.push('judgment');
        return native.respond(...args);
      },
    },
  );
  if (!f.judgment) throw new Error('missing judgment fixture');
  expect(f.model.list('foreground').map(([key]) => key)).toEqual([FIXTURE_MODEL_CONNECTION]);
  expect(f.model.list('qq-participation').map(([key]) => key)).toEqual([judgmentKey]);
  expect(() => f.model.select(judgmentKey)).toThrow();
  expect(() => f.model.select(FIXTURE_MODEL_CONNECTION, 'qq-participation')).toThrow();
  await f.client.respond(request);
  await f.judgment.respond(request);
  await f.client.respond(request);
  expect(calls).toEqual(['foreground', 'judgment', 'foreground']);
  expect(f.model.binding()?.owner.pluginId).toBe(source.pluginId);
  expect(f.model.binding(judgmentKey)?.owner.pluginId).toBe(judgmentSource.pluginId);
  expect(f.host.permissions.diagnostics().leases).toBe(0);
});

it('fences and drains changed judgment work without retiring an in-flight foreground call', async () => {
  const generation = await createFixtureModelClient().respond(request);
  let foregroundOptions: Parameters<ResponseClient['respond']>[1];
  let judgmentOptions: Parameters<ResponseClient['respond']>[1];
  let foregroundStarted: () => void = () => {};
  let judgmentStarted: () => void = () => {};
  let finishForeground: () => void = () => {};
  let finishJudgment: (error: unknown) => void = () => {};
  const enteredForeground = new Promise<void>((resolve) => {
    foregroundStarted = resolve;
  });
  const enteredJudgment = new Promise<void>((resolve) => {
    judgmentStarted = resolve;
  });
  const f = await fixture(
    {
      respond(_request, options) {
        foregroundOptions = options;
        foregroundStarted();
        return new Promise((resolve) => {
          finishForeground = () => resolve(generation);
        });
      },
    },
    {
      respond(_request, options) {
        judgmentOptions = options;
        judgmentStarted();
        return new Promise((_resolve, reject) => {
          finishJudgment = reject;
        });
      },
    },
  );
  if (!f.judgment) throw new Error('missing judgment fixture');
  const foregroundEvents: unknown[] = [];
  const judgmentEvents: unknown[] = [];
  const foreground = f.client.respond(request, {
    onEvent: (event) => {
      foregroundEvents.push(event);
    },
  });
  const judgment = f.judgment
    .respond(request, {
      onEvent: (event) => {
        judgmentEvents.push(event);
      },
    })
    .catch((error: unknown) => error);
  await Promise.all([enteredForeground, enteredJudgment]);
  const original = new Error('judgment native cleanup');
  let stopping: Promise<void> | undefined;
  try {
    const saved = await f.host.configs.save(judgmentSource, { label: 'changed' }, 1);
    expect(saved.ok).toBe(true);
    expect(judgmentOptions?.signal?.aborted).toBe(true);
    expect(foregroundOptions?.signal?.aborted).toBe(false);
    expect(f.model.binding()).not.toBeNull();
    expect(f.model.binding(judgmentKey)).toBeNull();
    judgmentOptions?.onEvent?.(modelEvent('stale judgment'));
    foregroundOptions?.onEvent?.(modelEvent('current foreground'));
    expect(judgmentEvents).toHaveLength(0);
    expect(foregroundEvents).toHaveLength(1);
    let drained = false;
    stopping = f.model.disable(judgmentKey).then(() => {
      drained = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(drained).toBe(false);
    finishJudgment(original);
    expect(await judgment).toBe(original);
    await stopping;
    expect(foregroundOptions?.signal?.aborted).toBe(false);
    finishForeground();
    expect(await foreground).toBe(generation);
    expect(f.host.permissions.diagnostics().leases).toBe(0);
    expect(f.host.tasks.diagnostics().pendingWork).toBe(0);
  } finally {
    finishJudgment(original);
    finishForeground();
    await Promise.allSettled([foreground, judgment, ...(stopping ? [stopping] : [])]);
  }
});

it('uses both source leases and preserves private native options and result identity', async () => {
  const native = createFixtureModelClient();
  const generation = await native.respond(request);
  let received: Parameters<ResponseClient['respond']>[1];
  const event = {
    type: 'response.output_text.delta',
    sequence_number: 0,
    output_index: 0,
    item_id: 'fixture',
    content_index: 0,
    delta: 'opaque',
    logprobs: [],
  } as Parameters<NonNullable<NonNullable<Parameters<ResponseClient['respond']>[1]>['onEvent']>>[0];
  const events: unknown[] = [];
  const f = await fixture({
    async respond(_request, options) {
      received = options;
      options?.onEvent?.(event);
      return generation;
    },
  });
  const quote = () => ['opaque'];
  const onEvent = (event: unknown) => {
    events.push(event);
  };
  const returned = await f.client.respond(request, { quote, onEvent, diagnostic: true });
  expect(returned).toBe(generation);
  expect(received?.['quote']).toBe(quote);
  expect(events).toHaveLength(1);
  expect(events[0]).toBe(event);
  received?.onEvent?.(event);
  expect(events).toHaveLength(1);
  expect(f.model.binding()).not.toBeNull();
  expect(received?.diagnostic).toBe(true);
  expect(f.host.permissionControl.snapshotAudit().entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        owner: expect.objectContaining(consumer),
        kind: 'capability-use',
        event: 'approved',
      }),
      expect.objectContaining({
        owner: expect.objectContaining(source),
        kind: 'files',
        event: 'approved',
      }),
    ]),
  );
  expect(f.host.permissions.diagnostics().leases).toBe(0);
});

it.each(['consumer', 'connector', 'fingerprint'] as const)(
  'rejects %s authority before native work, even with no credential',
  async (mode) => {
    let calls = 0;
    const native = createFixtureModelClient();
    const f = await fixture({
      async respond(...args) {
        calls++;
        return native.respond(...args);
      },
    });
    if (mode === 'fingerprint')
      await writeFile(path.join(f.sourceDirectory, 'changed.txt'), 'changed');
    else f.host.permissionControl.setPreset(mode === 'consumer' ? consumer : source, 'deny');
    await expect(f.client.respond(request)).rejects.toBeInstanceOf(Error);
    expect(calls).toBe(0);
    expect(f.host.permissions.diagnostics().leases).toBe(0);
  },
);

it('unregisters immediately but waits for physical native failure and preserves the original error', async () => {
  let release: (reason: unknown) => void = () => {};
  let entered: () => void = () => {};
  const reached = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let signal: AbortSignal | undefined;
  const f = await fixture({
    respond(_request, options) {
      signal = options?.signal;
      entered();
      return new Promise((_resolve, reject) => {
        release = reject;
      });
    },
  });
  const error = Object.assign(new Error('native partial'), {
    partial: { secretless: Symbol('private') },
  });
  const running = f.client.respond(request).catch((cause: unknown) => cause);
  await reached;
  let disabled = false;
  const stopping = f.model.disable(FIXTURE_MODEL_CONNECTION).then(() => {
    disabled = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(signal?.aborted).toBe(true);
  expect(disabled).toBe(false);
  expect(f.model.binding()).toBeNull();
  release(error);
  expect(await running).toBe(error);
  await stopping;
  await f.model.enable(FIXTURE_MODEL_CONNECTION);
  await expect(f.client.respond(request)).rejects.toMatchObject({ error: { code: 'stale-owner' } });
  expect(f.host.tasks.diagnostics().pendingWork).toBe(0);
});

it.each(['source-revoke', 'consumer-revoke', 'sdk-save', 'host-save', 'fingerprint'] as const)(
  'fences noncooperative late callbacks and actual work at the %s boundary',
  async (mode) => {
    let release: (error: unknown) => void = () => {};
    let enter: () => void = () => {};
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    let options: Parameters<ResponseClient['respond']>[1];
    const events: unknown[] = [];
    const f = await fixture({
      respond(_request, received) {
        options = received;
        received?.onEvent?.(modelEvent('before'));
        enter();
        return new Promise((_resolve, reject) => {
          release = reject;
        });
      },
    });
    const nativeError = Object.assign(new Error('private cleanup partial'), {
      partial: Symbol('opaque'),
    });
    const running = f.client
      .respond(request, {
        onEvent: (event) => {
          events.push(event);
        },
      })
      .catch((error: unknown) => error);
    await entered;
    try {
      expect(events).toHaveLength(1);
      if (mode === 'source-revoke' || mode === 'consumer-revoke')
        f.host.permissionControl.revoke(mode === 'source-revoke' ? source : consumer);
      else if (mode === 'fingerprint') {
        await writeFile(path.join(f.sourceDirectory, 'changed.txt'), 'new disk bytes');
        expect(options?.signal?.aborted).toBe(false); // No fswatch claim: the next boundary observes it.
      } else if (mode === 'host-save') {
        const saved = await f.host.configs.save(source, { label: 'changed' }, 1);
        expect(saved.ok).toBe(true);
        expect(options?.signal?.aborted).toBe(true); // Committed save returns after exact fencing.
      } else {
        const save = f.context()?.host.config.save;
        if (!save) throw new Error('missing SDK config save');
        const task = f.host.runFor(source.pluginId, async (task) => {
          const saved = await save(
            { taskId: task.taskId, signal: task.signal },
            { label: 'changed' },
            1,
          );
          return { ok: saved.ok, revision: saved.ok ? saved.value.snapshot.revision : 0 };
        });
        expect(await task.result).toMatchObject({ ok: true, value: { ok: true, revision: 2 } });
        await task.settled;
        expect(options?.signal?.aborted).toBe(true);
      }
      options?.onEvent?.(modelEvent('late'));
      expect(events).toHaveLength(1);
      expect(options?.signal?.aborted).toBe(true);
      let drained = false;
      const stopping = f.model.disable(FIXTURE_MODEL_CONNECTION).then(() => {
        drained = true;
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(drained).toBe(false);
      release(nativeError);
      expect(await running).toBe(nativeError);
      await stopping;
      expect(f.host.configurationDiagnostics().observerFailures).toBe(0);
    } finally {
      release(nativeError);
      await running;
    }
  },
);

it.each(['caller', 'timeout', 'consumer'] as const)(
  'isolates %s cancellation and late events from another consumer and future calls',
  async (mode) => {
    const native = createFixtureModelClient();
    const generation = await native.respond(request);
    const flights: Array<{
      options: Parameters<ResponseClient['respond']>[1];
      resolve: (value: typeof generation) => void;
      reject: (reason: unknown) => void;
    }> = [];
    let enter: () => void = () => {};
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const f = await fixture({
      respond(request, options) {
        if (flights.length >= 2) return native.respond(request, options);
        return new Promise((resolve, reject) => {
          flights.push({ options, resolve, reject });
          if (flights.length === 2) enter();
        });
      },
    });
    const firstEvents: unknown[] = [];
    const otherEvents: unknown[] = [];
    const caller = new AbortController();
    const nativeError = new Error('request-only native partial');
    const first = f.client
      .respond(request, {
        signal: caller.signal,
        onEvent: (event) => {
          firstEvents.push(event);
        },
      })
      .catch((error: unknown) => error);
    const otherClient = f.model.clientFor(f.host.owner());
    const other = otherClient.respond(request, {
      onEvent: (event) => {
        otherEvents.push(event);
      },
    });
    await entered;
    const owner = f.model.binding()?.owner;
    const a = flights[0];
    const b = flights[1];
    if (!a || !b) throw new Error('missing concurrent native work');
    try {
      if (mode === 'consumer') f.host.permissionControl.revoke(consumer);
      else
        caller.abort(
          mode === 'timeout' ? new DOMException('controlled deadline', 'TimeoutError') : undefined,
        );
      a.options?.onEvent?.(modelEvent('late cancelled event'));
      expect(firstEvents).toHaveLength(0);
      expect(a.options?.signal?.aborted).toBe(true);
      expect(b.options?.signal?.aborted).toBe(false);
      expect(f.model.binding()?.owner).toEqual(owner);
      a.reject(nativeError);
      expect(await first).toBe(nativeError);
      const liveEvent = modelEvent('other consumer continues');
      b.options?.onEvent?.(liveEvent);
      expect(otherEvents[0]).toBe(liveEvent);
      b.resolve(generation);
      expect(await other).toBe(generation);
      expect((await otherClient.respond(request)).response.status).toBe('completed');
      expect(f.model.binding()?.owner).toEqual(owner);
    } finally {
      a.reject(nativeError);
      b.resolve(generation);
      await first;
      await other;
    }
  },
);

it('reports a committed config save truthfully even if a host observer throws', async () => {
  const f = await fixture();
  f.host.onConfigurationCommit(() => {
    throw new Error('faulty metadata observer');
  });
  const saved = await f.host.configs.save(source, { label: 'committed' }, 1);
  expect(saved.ok).toBe(true);
  expect(await f.host.configs.get(source)).toMatchObject({
    ok: true,
    value: { revision: 2, data: { label: 'committed' } },
  });
  expect(f.model.binding()).toBeNull();
  expect(f.host.configurationDiagnostics().observerFailures).toBe(1);
});

it('does not let a caller silently change the model of the captured binding', async () => {
  const f = await fixture();
  await expect(f.client.respond({ ...request, model: 'foreign' })).rejects.toMatchObject({
    error: { code: 'invalid-input' },
  });
});
