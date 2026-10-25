import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import {
  CordisRuntimeDriver,
  PluginManager,
  TaskSupervisor,
  type PluginModule,
} from '@pet/host-kernel';
import type { PluginManifest, Result } from '@pet/contracts';
import {
  makeFailingPlugin,
  makeRecordingPlugin,
  makeSlowPlugin,
  makeStuckCleanupPlugin,
} from './fixtures/plugins.js';
import {
  PRIMARY_EFFECT_START,
  PROVIDER_DISPOSE,
  SECONDARY_EFFECT_START,
  SLOW_ACTIVATE_BEGIN,
  STUCK_CLEANUP_BEGIN,
} from './fixtures/markers.js';
import {
  makeScriptedAsrGate,
  makeScriptedAsrPlugin,
  SCRIPTED_ASR_CALL_ABORTED,
  SCRIPTED_ASR_CALL_FAIL,
  SCRIPTED_ASR_CALL_LATE_RETURN,
  SCRIPTED_ASR_CALL_RETURN,
  SCRIPTED_ASR_CANCEL_IGNORED,
  SCRIPTED_ASR_CAPABILITY,
  SCRIPTED_ASR_GATE_SETTLED,
  SCRIPTED_ASR_GATE_WAIT,
  SCRIPTED_ASR_METHOD,
  SCRIPTED_ASR_PROVIDER_ID,
  SCRIPTED_ASR_STEP_FINAL,
  SCRIPTED_ASR_STEP_PARTIAL,
  type ScriptedAsrHandle,
} from './fixtures/scripted-asr.js';

/**
 * 脚本化 ASR 夹具 × 真实宿主内核。
 *
 * 这里只验证「通用内核」行为：任务取消立即 terminal、晚到值不交付、
 * workPending 保持到实际 settle、提供方停用后旧世代失效、合法输入不被改写、
 * 原始异常不外泄。不验证 M3 生产 ASR 协议——能力名仍是 `test.scriptedAsr@1`。
 */

const unwrap = <T>(result: Result<T>): T => {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
};

const manifest = (id: string, extra: Partial<PluginManifest> = {}): PluginManifest => ({
  schemaVersion: 1,
  id,
  version: '1.0.0',
  displayName: { 'zh-CN': '测试' },
  description: { 'zh-CN': '脚本化 ASR 参考插件' },
  license: 'MIT',
  host: '^1.0.0',
  platforms: ['win32-x64'],
  entries: { runtime: 'index.js' },
  ...extra,
});

const PROVIDER = { pluginId: 'test.scripted-asr', instanceId: 'default' } as const;
const CONSUMER = { pluginId: 'test.asr-consumer', instanceId: 'default' } as const;
const directory = path.resolve('.fixture-not-loaded');

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

/** 真实 CordisRuntimeDriver + PluginManager + TaskSupervisor 装配。 */
async function setup(handle: ScriptedAsrHandle, module: PluginModule = handle.module) {
  const driver = new CordisRuntimeDriver(async (activation) => {
    if (activation.owner.pluginId === PROVIDER.pluginId) return module;
    return makeRecordingPlugin().module;
  });
  const manager = new PluginManager({
    driver,
    hostApiVersion: '1.0.0',
    platform: 'win32-x64',
    trust: async () => true,
    activationTimeoutMs: 1000,
    cleanupTimeoutMs: 500,
  });
  unwrap(
    manager.install(
      manifest(PROVIDER.pluginId, {
        provides: [{ id: SCRIPTED_ASR_PROVIDER_ID, capability: SCRIPTED_ASR_CAPABILITY }],
      }),
      { directory, origin: 'user' },
    ),
  );
  const provider = unwrap(await manager.enable(PROVIDER));
  unwrap(
    manager.install(
      manifest(CONSUMER.pluginId, {
        consumes: [{ capability: SCRIPTED_ASR_CAPABILITY, optional: false }],
      }),
      { directory, origin: 'user' },
    ),
  );
  unwrap(
    manager.select(CONSUMER, SCRIPTED_ASR_CAPABILITY, {
      ...PROVIDER,
      providerId: SCRIPTED_ASR_PROVIDER_ID,
    }),
  );
  const consumer = unwrap(await manager.enable(CONSUMER));
  const tasks = new TaskSupervisor(manager);
  cleanup.push(async () => {
    tasks.shutdown();
    await manager.shutdown();
    await driver.dispose();
  });
  const invoke = (
    input: unknown,
    options: Parameters<TaskSupervisor['invokeCapability']>[6] = {},
    authorize?: Parameters<TaskSupervisor['invokeCapability']>[5],
  ) =>
    unwrap(
      tasks.invokeCapability(
        manager,
        consumer.owner,
        SCRIPTED_ASR_CAPABILITY,
        SCRIPTED_ASR_METHOD,
        input,
        authorize ?? (async () => ({ isValid: () => true, close() {} })),
        options,
      ),
    );
  return { driver, manager, tasks, provider, consumer, invoke };
}

describe('scripted ASR through the real host kernel', () => {
  it('returns the scripted transcript for a normal authorized call', async () => {
    const handle = makeScriptedAsrPlugin({
      steps: [
        { kind: 'partial', text: 'hello' },
        { kind: 'final', text: 'hello world' },
      ],
    });
    const f = await setup(handle);

    const task = f.invoke({ utteranceId: 'u-1' });
    expect(await task.result).toEqual({
      ok: true,
      value: {
        transcript: 'hello world',
        events: [
          { type: 'partial', text: 'hello' },
          { type: 'final', text: 'hello world' },
        ],
        utteranceId: 'u-1',
      },
    });
    await task.settled;
    expect(task.snapshot().state).toBe('completed');
    expect(task.snapshot().workPending).toBe(false);
    expect(handle.calls).toHaveLength(1);
    expect(handle.calls[0]?.taskId).toBe(task.taskId);
    expect(handle.events).toContain(SCRIPTED_ASR_CALL_RETURN);
  });

  it('cancels immediately as terminal while workPending stays true until the gate settles', async () => {
    const gate = makeScriptedAsrGate('mid-flight');
    const handle = makeScriptedAsrPlugin({
      steps: [
        { kind: 'partial', text: 'draft' },
        { kind: 'gate', gate },
        { kind: 'final', text: 'done' },
      ],
    });
    const f = await setup(handle);

    const task = f.invoke({ utteranceId: 'u-2' });
    await vi.waitFor(() => expect(handle.events).toContain(SCRIPTED_ASR_GATE_WAIT));

    expect(task.cancel()).toBe(true);
    expect(await task.result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'cancelled' }),
    });
    expect(task.snapshot().state).toBe('cancelled');
    // 立即 terminal，但夹具仍卡在 gate 上：宿主必须如实保留 workPending。
    expect(task.snapshot().workPending).toBe(true);
    expect(f.tasks.diagnostics().pendingWork).toBe(1);
    expect(gate.settled).toBe(false);

    gate.settle();
    await task.settled;
    expect(task.snapshot().workPending).toBe(false);
    expect(f.tasks.diagnostics().pendingWork).toBe(0);
    // 取消之后夹具观察到 signal 并停止，不再产出 final 文本。
    expect(handle.events).toContain(SCRIPTED_ASR_STEP_PARTIAL);
    expect(handle.events).toContain(SCRIPTED_ASR_GATE_SETTLED);
    expect(handle.events).toContain(SCRIPTED_ASR_CALL_ABORTED);
    expect(handle.events).toContain(SCRIPTED_ASR_CALL_FAIL);
    expect(handle.events).not.toContain(SCRIPTED_ASR_STEP_FINAL);
    expect(handle.calls[0]?.emitted).toEqual([{ type: 'partial', text: 'draft' }]);
    // 结果保持取消，晚到的失败不会覆盖它。
    expect(await task.result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'cancelled' }),
    });
  });

  it('does not deliver a late value from the ignoreCancellation bad mode', async () => {
    const gate = makeScriptedAsrGate('bad-mode');
    const handle = makeScriptedAsrPlugin({
      steps: [
        { kind: 'gate', gate },
        { kind: 'final', text: 'late-fixed' },
      ],
      ignoreCancellation: true,
    });
    const f = await setup(handle);

    const task = f.invoke({ utteranceId: 'u-3' });
    await vi.waitFor(() => expect(handle.events).toContain(SCRIPTED_ASR_GATE_WAIT));

    task.cancel();
    expect(await task.result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'cancelled' }),
    });
    expect(task.snapshot().workPending).toBe(true);

    gate.settle();
    await task.settled;

    // 夹具确实返回了固定脚本文本（坏模式忽略取消），宿主不得交付它。
    expect(handle.events).toContain(SCRIPTED_ASR_CANCEL_IGNORED);
    expect(handle.events).toContain(SCRIPTED_ASR_CALL_LATE_RETURN);
    expect(handle.calls[0]?.returnedTranscript).toBe('late-fixed');
    expect(await task.result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'cancelled' }),
    });
    expect(JSON.stringify(await task.result)).not.toContain('late-fixed');
    expect(task.snapshot().state).toBe('cancelled');
    expect(task.snapshot().workPending).toBe(false);
  });

  it('keeps workPending when a bad-mode provider ignores the disable of its own generation', async () => {
    const gate = makeScriptedAsrGate('provider-stop');
    const handle = makeScriptedAsrPlugin({
      steps: [
        { kind: 'gate', gate },
        { kind: 'final', text: 'stale-late' },
      ],
      ignoreCancellation: true,
    });
    const f = await setup(handle);

    const task = f.invoke({ utteranceId: 'u-4' });
    await vi.waitFor(() => expect(handle.events).toContain(SCRIPTED_ASR_GATE_WAIT));

    const disabled = unwrap(await f.manager.disable(PROVIDER));
    expect(disabled.state).toBe('disabled');
    expect(handle.events).toContain(PROVIDER_DISPOSE);

    // 停用通过提供方 signal 取消在途任务：结果立即 terminal，但夹具仍未 settle。
    // 观测：这条路径的错误码是 cancelled（combined provider signal 以 'user'
    // 原因挂载），而不是 stale-owner；stale-owner 留给「已失效绑定再解析」。
    expect(await task.result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'cancelled' }),
    });
    expect(task.snapshot().state).toBe('cancelled');
    expect(task.snapshot().workPending).toBe(true);

    gate.settle();
    await task.settled;
    expect(handle.calls[0]?.returnedTranscript).toBe('stale-late');
    expect(await task.result).toMatchObject({ ok: false });
    expect(JSON.stringify(await task.result)).not.toContain('stale-late');
    expect(task.snapshot().workPending).toBe(false);
  });

  it('invalidates the old generation binding after re-enabling the provider', async () => {
    const handle = makeScriptedAsrPlugin({
      steps: [{ kind: 'final', text: 'first-generation' }],
    });
    const f = await setup(handle);

    const oldBinding = unwrap(
      f.manager.capabilities.bind(f.consumer.owner, SCRIPTED_ASR_CAPABILITY),
    );
    expect(oldBinding.provider.generation).toBe(f.provider.owner.generation);

    const first = f.invoke({ utteranceId: 'u-5' });
    expect(await first.result).toMatchObject({ ok: true });
    await first.settled;

    unwrap(await f.manager.disable(PROVIDER));
    // 旧绑定在停用后立刻不可解析，也不能再签发新任务。
    expect(f.manager.capabilities.resolveBound(oldBinding, SCRIPTED_ASR_METHOD)).toMatchObject({
      ok: false,
      error: { code: 'stale-owner' },
    });
    // 提供方停用后消费方降级为 unready，旧世代不能再签发新任务。
    expect(f.manager.get(CONSUMER)?.state).toBe('unready');
    expect(
      f.tasks.invokeCapability(
        f.manager,
        f.consumer.owner,
        SCRIPTED_ASR_CAPABILITY,
        SCRIPTED_ASR_METHOD,
        { utteranceId: 'u-stale' },
        async () => ({ isValid: () => true, close() {} }),
      ),
    ).toMatchObject({ ok: false, error: { code: 'stale-owner' } });

    const second = unwrap(await f.manager.enable(PROVIDER));
    expect(second.owner.generation).toBeGreaterThan(f.provider.owner.generation);

    const fresh = unwrap(f.manager.capabilities.bind(f.consumer.owner, SCRIPTED_ASR_CAPABILITY));
    expect(fresh.provider.generation).toBe(second.owner.generation);
    expect(f.manager.capabilities.resolveBound(oldBinding, SCRIPTED_ASR_METHOD)).toMatchObject({
      ok: false,
      error: { code: 'stale-owner' },
    });
  });

  it('does not mutate a legal JSON input and never echoes its extra fields', async () => {
    const handle = makeScriptedAsrPlugin({
      steps: [{ kind: 'final', text: 'echo-check' }],
      finalText: 'echo-check',
    });
    const f = await setup(handle);
    const input = { utteranceId: 'u-6', hints: ['alpha'], nested: { depth: 2 } };
    const snapshot = structuredClone(input);

    const task = f.invoke(input);
    expect(await task.result).toMatchObject({ ok: true });
    await task.settled;

    // 调用方对象未被夹具改写。
    expect(input).toEqual(snapshot);
    // 输出只含夹具自己的公开字段，不回显输入的额外字段。
    expect(JSON.stringify(await task.result)).not.toContain('alpha');
    expect(JSON.stringify(await task.result)).not.toContain('depth');
    expect(handle.calls[0]?.utteranceId).toBe('u-6');
  });

  it('rejects malformed input without echoing it or the original exception', async () => {
    const handle = makeScriptedAsrPlugin({ steps: [{ kind: 'final', text: 'never' }] });
    const f = await setup(handle);

    const task = f.invoke({ utteranceId: 42, privateValue: 'do-not-echo' });
    const result = await task.result;
    await task.settled;

    // 夹具抛出的固定异常被宿主收敛为 internal，绝不回显原始消息或输入。
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'internal' }) });
    expect(task.snapshot().state).toBe('failed');
    expect(JSON.stringify(result)).not.toContain('do-not-echo');
    expect(JSON.stringify(result)).not.toContain('fixture:');
    expect(JSON.stringify(result)).not.toContain('contract-tests fixture');
    expect(handle.calls[0]?.failure).toContain('input rejected');
    expect(handle.events).toContain(SCRIPTED_ASR_CALL_FAIL);
  });

  it('reports a cancelled call as a cancelled task, not as an internal error', async () => {
    const gate = makeScriptedAsrGate('cancel-before-start');
    const handle = makeScriptedAsrPlugin({ steps: [{ kind: 'gate', gate }] });
    const f = await setup(handle);

    const abort = new AbortController();
    abort.abort();
    const task = f.invoke({ utteranceId: 'u-7' }, { signal: abort.signal });

    expect(await task.result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'cancelled' }),
    });
    await task.settled;
    expect(handle.calls).toHaveLength(0);
    expect(task.snapshot().state).toBe('cancelled');
  });

  it('releases the provider runtime cleanly with the fixture event log intact', async () => {
    const handle = makeScriptedAsrPlugin({ steps: [{ kind: 'final', text: 'cleanup' }] });
    const f = await setup(handle);

    const task = f.invoke({ utteranceId: 'u-8' });
    expect(await task.result).toMatchObject({ ok: true });
    await task.settled;

    expect(unwrap(await f.manager.disable(PROVIDER)).state).toBe('disabled');
    expect(handle.events).toContain('provider:dispose');
    expect(f.driver.diagnostics().sessions).toBeGreaterThanOrEqual(1);
    expect(handle.events).toContain(SCRIPTED_ASR_CALL_RETURN);
  });
});

describe('scripted ASR coexists with the existing fixtures', () => {
  it('reuses makeRecordingPlugin as a sibling plugin without duplicating it', async () => {
    const handle = makeScriptedAsrPlugin({ steps: [{ kind: 'final', text: 'ok' }] });
    const f = await setup(handle);

    // 复用现有记录型夹具，不另写一个记录实现。
    const recording = makeRecordingPlugin();
    const siblingDriver = new CordisRuntimeDriver(async () => recording.module);
    const sibling = new PluginManager({
      driver: siblingDriver,
      hostApiVersion: '1.0.0',
      platform: 'win32-x64',
      trust: async () => true,
    });
    cleanup.push(async () => {
      await sibling.shutdown();
      await siblingDriver.dispose();
    });
    unwrap(sibling.install(manifest('test.recording'), { directory, origin: 'user' }));
    const enabled = unwrap(
      await sibling.enable({ pluginId: 'test.recording', instanceId: 'default' }),
    );
    expect(enabled.state).toBe('active');
    expect(recording.events).toEqual([PRIMARY_EFFECT_START, SECONDARY_EFFECT_START]);

    const task = f.invoke({ utteranceId: 'u-9' });
    expect(await task.result).toMatchObject({ ok: true });
    await task.settled;
    // 兄弟插件的记录日志不受 ASR 调用影响。
    expect(recording.events).toEqual([PRIMARY_EFFECT_START, SECONDARY_EFFECT_START]);
  });

  it('keeps the ASR path intact when a sibling plugin fails to activate', async () => {
    const handle = makeScriptedAsrPlugin({ steps: [{ kind: 'final', text: 'still-works' }] });
    const f = await setup(handle);

    // 复用现有「会崩溃」夹具作为兄弟插件：激活失败必须被隔离，不影响已启用的 ASR。
    const failing = makeFailingPlugin();
    const failingDriver = new CordisRuntimeDriver(async () => failing.module);
    const sibling = new PluginManager({
      driver: failingDriver,
      hostApiVersion: '1.0.0',
      platform: 'win32-x64',
      trust: async () => true,
    });
    cleanup.push(async () => {
      await sibling.shutdown();
      await failingDriver.dispose();
    });
    unwrap(sibling.install(manifest('test.failing'), { directory, origin: 'user' }));
    const failed = await sibling.enable({ pluginId: 'test.failing', instanceId: 'default' });
    expect(failed).toEqual({ ok: false, error: expect.objectContaining({ code: 'internal' }) });
    expect(JSON.stringify(failed)).not.toContain('contract-tests fixture');

    const task = f.invoke({ utteranceId: 'u-11' });
    expect(await task.result).toMatchObject({
      ok: true,
      value: { transcript: 'still-works' },
    });
    await task.settled;
    expect(f.manager.get(PROVIDER)?.state).toBe('active');
  });

  it('completes an ASR task while a sibling plugin activation is still pending', async () => {
    const handle = makeScriptedAsrPlugin({ steps: [{ kind: 'final', text: 'not-blocked' }] });
    const f = await setup(handle);

    // 复用现有「慢插件」夹具：它的激活挂起不应阻塞 ASR 调用。
    const slow = makeSlowPlugin();
    const slowDriver = new CordisRuntimeDriver(async () => slow.module);
    const sibling = new PluginManager({
      driver: slowDriver,
      hostApiVersion: '1.0.0',
      platform: 'win32-x64',
      trust: async () => true,
    });
    cleanup.push(async () => {
      slow.release();
      await sibling.shutdown();
      await slowDriver.dispose();
    });
    unwrap(sibling.install(manifest('test.slow'), { directory, origin: 'user' }));
    const enabling = sibling.enable({ pluginId: 'test.slow', instanceId: 'default' });
    await vi.waitFor(() => expect(slow.events).toContain(SLOW_ACTIVATE_BEGIN));

    const task = f.invoke({ utteranceId: 'u-12' });
    expect(await task.result).toMatchObject({ ok: true, value: { transcript: 'not-blocked' } });
    await task.settled;

    slow.release();
    expect(unwrap(await enabling).state).toBe('active');
  });

  it('reports pending_restart instead of a clean disable when the reused stuck fixture blocks cleanup', async () => {
    // 组合既有「卡清理」夹具：同一个模块既提供脚本化 ASR，又登记一个永不 settle 的清理。
    const stuck = makeStuckCleanupPlugin();
    const handle = makeScriptedAsrPlugin({
      steps: [{ kind: 'final', text: 'before-stuck' }],
    });
    const combined: PluginModule = {
      activate(ctx) {
        handle.module.activate(ctx);
        stuck.module.activate(ctx);
      },
    };
    const f = await setup(handle, combined);
    cleanup.push(async () => {
      stuck.release();
    });

    const task = f.invoke({ utteranceId: 'u-10' });
    expect(await task.result).toMatchObject({ ok: true });
    await task.settled;

    const disabled = unwrap(await f.manager.disable(PROVIDER));
    // 清理卡住时宿主必须如实报 pending_restart，不能谎报 disabled。
    expect(disabled.state).toBe('pending_restart');
    expect(stuck.events).toContain(STUCK_CLEANUP_BEGIN);
    expect(await f.manager.uninstall(PROVIDER)).toMatchObject({ ok: false });
    expect(f.manager.get(PROVIDER)?.state).toBe('pending_restart');
  });
});
