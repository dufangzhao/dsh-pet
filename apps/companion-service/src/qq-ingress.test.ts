import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  makeError,
  QQ_FEATURE_PLUGIN_ID,
  QQ_ONEBOT_PLUGIN_ID,
  type QQAccountRef,
  type QQInputReceipt,
  type QQPolicySettings,
} from '@pet/contracts';
import {
  createFixtureModelClient,
  checkInputGrant,
  type RuntimeInputGrant,
} from '@pet/companion-runtime';
import { KernelFault, type TaskHandle } from '@pet/host-kernel';
import { decodeOneBotFrame } from '@pet/qq-onebot';
import { createCompanionService } from './service.js';
import { QQIngress, type QQIngressOptions, type QQInputPreparation } from './qq-ingress.js';
import { mapOneBotInput } from './qq-input.js';
import type { CapturedQqSourceBase } from './qq-controller.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});
function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const account: QQAccountRef = {
  protocol: 'onebot-v11',
  sourcePluginId: QQ_ONEBOT_PLUGIN_ID,
  instanceId: 'default',
  accountId: '10001',
};
const feature = { pluginId: QQ_FEATURE_PLUGIN_ID, instanceId: 'default' };
const management = { kind: 'management' as const };
function message(id: number, media = false, group = false) {
  const decoded = decodeOneBotFrame(
    JSON.stringify({
      self_id: 10001,
      time: Math.floor(Date.now() / 1000),
      post_type: 'message',
      message_type: group ? 'group' : 'private',
      sub_type: group ? 'normal' : 'friend',
      message_id: id,
      user_id: 10002,
      sender: { user_id: 10002, nickname: 'controlled-member' },
      ...(group ? { group_id: 201 } : {}),
      message: [
        { type: 'text', data: { text: 'An authenticated fixture input.' } },
        ...(media
          ? [{ type: 'file', data: { file: 'native-file-id', name: 'fixture.bin', file_size: 4 } }]
          : []),
      ],
    }),
    10001,
  );
  if (!decoded.ok || decoded.value.kind !== 'message') throw new Error('invalid fixture frame');
  const mapped = mapOneBotInput(account, decoded.value);
  if (!mapped) throw new Error('fixture frame did not map');
  return { event: decoded.value, id: mapped.observationId, mapped };
}
async function setup(options: Partial<Pick<QQIngressOptions, 'prepareMedia' | 'judge'>> = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'qq-ingress-owned-'));
  const client = createFixtureModelClient();
  const respond = client.respond.bind(client);
  const native = vi.spyOn(client, 'respond').mockImplementation(async (request, options) => {
    const generation = await respond(request, options);
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
  const releases: Array<() => void> = [];
  cleanups.push(async () => {
    const target = await realpath(directory);
    if (
      path.dirname(target) !== (await realpath(tmpdir())) ||
      !path.basename(target).startsWith('qq-ingress-owned-')
    )
      throw new Error('wrong fixture cleanup target');
    await rm(target, { recursive: true });
  });
  const active = await createCompanionService({
    dataDirectory: directory,
    hostname: '127.0.0.1',
    port: 0,
    token: 'controlled-ingress-fixture-token',
    mode: 'model',
    model: 'ingress-fixture',
    client,
  });
  cleanups.push(() => active.close());
  const receipts: QQInputReceipt[] = [];
  const sourceController = new AbortController();
  const source: CapturedQqSourceBase = {
    account,
    connectionId: 'controlled-authenticated-peer',
    selfId: '10001',
    signal: sourceController.signal,
    check: async () => {
      if (sourceController.signal.aborted) throw new KernelFault('stale-owner');
    },
  };
  const savePolicy = async (settings: QQPolicySettings): Promise<void> => {
    const result = await active.host.configs.save(
      feature,
      JSON.parse(JSON.stringify(settings)),
      active.qq.policy().revision,
    );
    if (!result.ok) throw new KernelFault(result.error.code);
  };
  const policy: QQPolicySettings = {
    ...active.qq.policy().settings,
    privateAllowlist: [{ account, scene: 'private', senderId: '10002' }],
    groupAllowlist: [{ account, groupId: '201' }],
  };
  await savePolicy(policy);
  await active.qq.captureParticipantAuthority(); // The existing feature lease is not an admission task.
  const ingress = new QQIngress(active.host, active.runtime, active.qq, {
    judge: options.judge ?? {
      judge: async () => {
        throw new Error('unexpected model judge');
      },
    },
    ...(options.prepareMedia ? { prepareMedia: options.prepareMedia } : {}),
    random: () => 0,
    onReceipt: (value) => receipts.push(value),
  });
  cleanups.push(async () => {
    for (const release of releases) release();
    await ingress.close();
  });
  const gate = () => {
    const value = deferred();
    releases.push(value.resolve);
    return value;
  };
  const sourceTasks: TaskHandle[] = [];
  const policySignals: Array<AbortSignal | undefined> = [];
  const run = active.host.runFor.bind(active.host);
  const tasks = vi.spyOn(active.host, 'runFor').mockImplementation((id, work, config) => {
    const task = run(id, work, config);
    if (id === QQ_FEATURE_PLUGIN_ID) {
      sourceTasks.push(task);
      policySignals.push(config?.signal);
    }
    return task;
  });
  return {
    service: active,
    ingress,
    source,
    sourceController,
    native,
    receipts,
    policy,
    savePolicy,
    gate,
    sourceTasks,
    policySignals,
    tasks,
    run,
  };
}

it('tracks the original grant before createInput can await and permanently fences deny then restore', async () => {
  const f = await setup();
  const input = message(-101);
  const written = f.gate(),
    release = f.gate();
  const state = f.service.runtime.state.bind(f.service.runtime);
  const proxy: typeof state = async (method, args, signal) => {
    const value = await state(method, args, signal);
    if (method === 'createInput') {
      written.resolve();
      await release.promise;
    }
    return value;
  };
  vi.spyOn(f.service.runtime, 'state').mockImplementation(proxy);
  const dispatch = vi.spyOn(f.service.runtime, 'dispatchReadyInput');
  const receiving = f.ingress.onebot(input.event, f.source);
  await written.promise;
  expect((await state('getInput', { id: input.id, scope: management })).phase).toBe('preparing');
  expect(f.ingress.diagnostics().pending).toBe(1);
  await f.savePolicy({ ...f.policy, privateAllowlist: [] });
  expect(f.sourceTasks[0]?.signal.aborted).toBe(true);
  await f.savePolicy(f.policy);
  expect(f.sourceTasks[0]?.signal.aborted).toBe(true);
  release.resolve();
  const result = await receiving;
  expect(result).toMatchObject({ state: 'rejected', inputId: input.id });
  expect(await state('getInput', { id: input.id, scope: management })).toMatchObject({
    phase: 'failed',
    cleanup: 'settled',
  });
  expect(dispatch).not.toHaveBeenCalled();
  expect(f.native).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(f.ingress.diagnostics().pending).toBe(0));
});

it.each(['owner', 'source'] as const)(
  'rejects %s loss before the admission callback without leaving a preparing row',
  async (kind) => {
    const f = await setup();
    const input = message(-102);
    const dispatch = vi.spyOn(f.service.runtime, 'dispatchReadyInput');
    let callbacks = 0;
    f.tasks.mockImplementation((id, work, config) => {
      const task = f.run(
        id,
        async (context) => {
          if (id === QQ_FEATURE_PLUGIN_ID) callbacks++;
          return work(context);
        },
        config,
      );
      if (id === QQ_FEATURE_PLUGIN_ID) {
        f.sourceTasks.push(task);
        if (kind === 'owner') f.service.host.permissionControl.setPreset(feature, 'deny');
        else f.sourceController.abort();
      }
      return task;
    });
    try {
      expect(await f.ingress.onebot(input.event, f.source)).toMatchObject({
        state: 'rejected',
        inputId: null,
      });
      expect(
        await f.service.runtime.state('findInput', { id: input.id, scope: management }),
      ).toBeNull();
      if (kind === 'owner') expect(callbacks).toBe(0);
      expect(dispatch).not.toHaveBeenCalled();
      expect(f.native).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(f.ingress.diagnostics().pending).toBe(0));
    } finally {
      f.tasks.mockRestore();
      f.service.host.permissionControl.setPreset(feature, 'allow');
    }
  },
);

it('returns a real preparing receipt without blocking heartbeat and close joins the original media task', async () => {
  const prepare = vi.fn<NonNullable<QQIngressOptions['prepareMedia']>>();
  const f = await setup({ prepareMedia: prepare });
  const entered = f.gate(),
    release = f.gate();
  let exited = false;
  prepare.mockImplementation(async (_input, _mapped, _source, access) => {
    entered.resolve();
    await release.promise;
    exited = true;
    return {
      ok: false,
      error: makeError(access.signal.aborted ? 'cancelled' : 'unavailable'),
      cleanup: 'settled',
    };
  });
  const input = message(-103, true);
  const result = await f.ingress.onebot(input.event, f.source);
  expect(result).toMatchObject({ state: 'preparing', inputId: input.id });
  await entered.promise;
  expect(f.sourceTasks).toHaveLength(1);
  expect(f.ingress.diagnostics().pending).toBe(1);
  const heartbeat = decodeOneBotFrame(
    JSON.stringify({
      self_id: 10001,
      time: Math.floor(Date.now() / 1000),
      post_type: 'meta_event',
      meta_event_type: 'heartbeat',
      status: { online: true, good: true },
      interval: 5000,
    }),
    10001,
  );
  if (!heartbeat.ok || heartbeat.value.kind !== 'meta')
    throw new Error('invalid heartbeat fixture');
  expect(await f.ingress.onebot(heartbeat.value, f.source)).toBeNull();
  let closed = false;
  const closing = f.ingress.close().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  expect(exited).toBe(false);
  expect(f.sourceTasks[0]?.signal.aborted).toBe(true);
  release.resolve();
  await closing;
  expect(exited).toBe(true);
  expect(
    await f.service.runtime.state('getInput', { id: input.id, scope: management }),
  ).toMatchObject({ phase: 'failed', cleanup: 'settled' });
  expect(f.receipts.at(-1)).toMatchObject({ state: 'rejected', inputId: input.id });
  expect(f.native).not.toHaveBeenCalled();
  expect(f.ingress.diagnostics().pending).toBe(0);
});

it('hands complete material bytes to Runtime after socket loss and retains a live policy grant after task settlement', async () => {
  const prepare = vi.fn<NonNullable<QQIngressOptions['prepareMedia']>>();
  const f = await setup({ prepareMedia: prepare });
  const release = f.gate();
  prepare.mockImplementation(
    async (input, _mapped, _source, access): Promise<QQInputPreparation> => {
      await release.promise;
      const id = input.materialIds[0];
      if (!id) throw new Error('missing material id');
      const reference = await f.service.materials.put(
        {
          id,
          inputId: input.id,
          kind: 'file',
          name: 'fixture.bin',
          mediaType: 'application/octet-stream',
        },
        {
          async *[Symbol.asyncIterator]() {
            yield new Uint8Array([0, 255, 3, 4]);
          },
        },
        access,
      );
      // Authenticated bytes are complete. There is no further socket operation to perform.
      f.sourceController.abort();
      return { ok: true, materials: [reference], transcript: '' };
    },
  );
  const dispatch = vi.spyOn(f.service.runtime, 'dispatchReadyInput');
  const input = message(-104, true);
  expect(await f.ingress.onebot(input.event, f.source)).toMatchObject({ state: 'preparing' });
  release.resolve();
  await vi.waitFor(() =>
    expect(
      f.receipts.some((value) => value.state === 'accepted' && value.inputId === input.id),
    ).toBe(true),
  );
  await vi.waitFor(() => expect(f.ingress.diagnostics().pending).toBe(0));
  expect(f.sourceTasks).toHaveLength(1);
  expect(dispatch).toHaveBeenCalledTimes(1);
  const captured: RuntimeInputGrant | undefined = dispatch.mock.calls[0]?.[1];
  if (!captured) throw new Error('missing captured Runtime grant');
  expect(captured.signal).toBe(f.policySignals[0]);
  expect(captured.signal).not.toBe(f.sourceTasks[0]?.signal);
  expect(captured.signal.aborted).toBe(false);
  await checkInputGrant(captured);
  f.sourceTasks[0]?.cancel();
  expect(captured.signal.aborted).toBe(false);
  await vi.waitFor(() => expect(f.native).toHaveBeenCalledTimes(1));
  await vi.waitFor(async () =>
    expect(
      (await f.service.runtime.state('getInput', { id: input.id, scope: management })).phase,
    ).toBe('completed'),
  );
  const ready = await f.service.runtime.state('getInput', { id: input.id, scope: management });
  expect(ready.messageId).toBe(input.id);
  const materialId = ready.materialIds[0];
  if (!materialId) throw new Error('missing actual material');
  const chunks: Uint8Array[] = [];
  await f.service.materials.withMaterial(
    materialId,
    {
      signal: captured.signal,
      scope: {
        kind: 'conversation',
        audience: captured.origin.audience,
        principalId: captured.origin.principalId,
      },
      check: () => checkInputGrant(captured),
    },
    async (_reference, bytes) => {
      for await (const bytes_ of bytes) chunks.push(Buffer.from(bytes_));
    },
  );
  expect(Buffer.concat(chunks)).toEqual(Buffer.from([0, 255, 3, 4]));
});

it('keeps proactive judgment creation and media preparation in the same tracked feature task', async () => {
  const prepare = vi.fn<NonNullable<QQIngressOptions['prepareMedia']>>();
  const judge: QQIngressOptions['judge'] = {
    judge: vi.fn(async (context, signal) => {
      signal.throwIfAborted();
      await context.check();
      return { decision: true, attempt: null, reason: 'decided' as const, error: null };
    }),
  };
  const f = await setup({ prepareMedia: prepare, judge });
  const release = f.gate();
  await f.savePolicy({
    ...f.policy,
    groupDefaults: {
      ...f.policy.groupDefaults,
      proactive: {
        ...f.policy.groupDefaults.proactive,
        enabled: true,
        mode: 'model-assisted',
        probability: 1,
      },
    },
  });
  prepare.mockImplementation(async (input, _mapped, _source, access) => {
    await release.promise;
    const id = input.materialIds[0];
    if (!id) throw new Error('missing material id');
    const reference = await f.service.materials.put(
      {
        id,
        inputId: input.id,
        kind: 'file',
        name: 'fixture.bin',
        mediaType: 'application/octet-stream',
      },
      {
        async *[Symbol.asyncIterator]() {
          yield new Uint8Array([0, 255, 3, 4]);
        },
      },
      access,
    );
    return { ok: true, materials: [reference], transcript: '' };
  });
  const input = message(-105, true, true);
  expect(await f.ingress.onebot(input.event, f.source)).toMatchObject({
    state: 'observed',
    inputId: null,
  });
  await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
  expect(judge.judge).toHaveBeenCalledTimes(1);
  expect(f.sourceTasks).toHaveLength(1);
  expect(f.ingress.diagnostics().pending).toBe(1);
  release.resolve();
  await vi.waitFor(() => expect(f.receipts.some((value) => value.state === 'accepted')).toBe(true));
  await vi.waitFor(() => expect(f.ingress.diagnostics().pending).toBe(0));
  expect(f.sourceTasks).toHaveLength(1);
});
