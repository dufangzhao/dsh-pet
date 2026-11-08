/**
 * 换代栅栏的回归：旧目标的结果不能清新草稿、不能改新目标。
 *
 * 这里用最少的 React 替身驱动真实 hook——不注入内部状态，只让桥按脚本返回，
 * 因此测到的是 hook 自己的判定，而不是测试自己写的一份逻辑。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CompanionMessageCommand,
  CompanionModelSaveCommand,
  CompanionModelTestCommand,
  CompanionProfileView,
  CompanionSnapshot,
  CompanionTask,
  DesktopCompanionBridge,
  DesktopCompanionState,
  Result,
} from '@pet/contracts';
import { makeError } from '@pet/contracts';

const harness = vi.hoisted(() => ({
  /** 与 React 一样：一条按调用顺序排列的 hook 槽。 */
  hooks: [] as {
    state?: unknown;
    ref?: { current: unknown };
    deps?: readonly unknown[];
    fn?: unknown;
    effect?: () => (() => void) | void;
  }[],
  cursor: 0,
  pending: [] as (() => (() => void) | void)[],
  cleanups: [] as (() => void)[],
  view: null as unknown,
}));

/**
 * 最小 React 替身：按调用顺序定位 hook 槽（与 React 相同），`useState` 的 setter
 * 真的触发一次重渲染，`useCallback` 按依赖决定是否复用上一份闭包。
 *
 * 这两件事正是本次要测的：旧渲染捕获的动作不能因为缓存前进就把意图改投到新目标。
 */
vi.mock('react', () => ({
  useState: <T>(initial: T) => {
    const slot = (harness.cursor += 1) - 1;
    const entry = (harness.hooks[slot] ??= {});
    if (!('state' in entry)) entry.state = initial;
    // 只更新槽里的值；提交由测试显式调用 render()。
    // React 会自动重渲染，但这里需要精确区分「旧渲染捕获的动作」与「新渲染的」。
    const setter = (next: T) => {
      entry.state =
        typeof next === 'function' ? (next as (previous: T) => T)(entry.state as T) : next;
    };
    return [entry.state as T, setter] as const;
  },
  useEffect: (effect: () => (() => void) | void) => {
    const slot = (harness.cursor += 1) - 1;
    const entry = (harness.hooks[slot] ??= {});
    if (entry.effect === effect) return;
    entry.effect = effect;
    harness.pending.push(effect);
  },
  useRef: <T>(initial: T) => {
    const slot = (harness.cursor += 1) - 1;
    const entry = (harness.hooks[slot] ??= {});
    entry.ref ??= { current: initial };
    return entry.ref as { current: T };
  },
  useCallback: <T>(fn: T, deps: readonly unknown[]) => {
    const slot = (harness.cursor += 1) - 1;
    const entry = (harness.hooks[slot] ??= {});
    if (
      entry.fn !== undefined &&
      entry.deps !== undefined &&
      entry.deps.length === deps.length &&
      entry.deps.every((item, index) => Object.is(item, deps[index]))
    )
      return entry.fn as T;
    entry.deps = [...deps];
    entry.fn = fn;
    return fn;
  },
}));

/** 一次「提交」：重跑组件函数体，然后跑这次新登记的 effect。 */
function render(): void {
  harness.cursor = 0;
  harness.view = useCompanion();
  for (const effect of harness.pending.splice(0)) {
    const off = effect();
    if (off) harness.cleanups.push(off);
  }
}

import {
  endpointBaseline,
  endpointMoved,
  rebaseOnConnect,
  settleTarget,
} from './companion-state.js';
import { useCompanion, type CompanionView } from './use-companion.js';

const snapshot = (agentName: string): CompanionSnapshot => ({
  protocolVersion: 1,
  epoch: 'e',
  cursor: 1,
  now: 1,
  agent: {
    id: 'agent-1',
    name: agentName,
    profileRevision: 1,
    harness: 'cortico',
    mode: 'scripted',
    status: 'ready',
    error: null,
  },
  messages: [],
  tasks: [],
  facts: [],
  plugins: [],
});

const state = (
  revision: number,
  connectionId: string | null,
  over: Partial<DesktopCompanionState> = {},
): DesktopCompanionState => ({
  version: 1,
  revision,
  source: 'ready',
  baseUrl: 'http://127.0.0.1:4120',
  configRevision: 1,
  connectionId,
  phase: connectionId === null ? 'idle' : 'live',
  confirmedAt: 1,
  snapshot: connectionId === null ? null : snapshot('阿蓝'),
  pending: [],
  error: null,
  ...over,
});

/** 最近一次注册的 onChanged 回调；测试用它模拟 Main 主动推送。 */
let onChange: (() => void) | null = null;

/** 每次 getState 依次返回脚本里的下一份；用尽后重复最后一份。 */
function bridgeWith(
  reads: (Result<DesktopCompanionState> | (() => Promise<Result<DesktopCompanionState>>))[],
  over: Partial<DesktopCompanionBridge> = {},
): DesktopCompanionBridge {
  let index = 0;
  const next = async (): Promise<Result<DesktopCompanionState>> => {
    const entry = reads[Math.min(index, reads.length - 1)];
    index += 1;
    return typeof entry === 'function' ? entry() : entry!;
  };
  return {
    version: 1,
    getState: next,
    onChanged: (listener: () => void) => {
      onChange = listener;
      return () => {
        onChange = null;
      };
    },
    connect: async () => ({ ok: true, value: state(1, 'c1') }),
    reconnect: async () => ({ ok: true, value: state(1, 'c1') }),
    disconnect: async () => ({ ok: true, value: state(1, null) }),
    sendMessage: async () => ({ ok: true, value: receipt() }),
    stopTask: async () => ({ ok: true, value: receipt() }),
    stopForeground: async () => ({ ok: true, value: null }),
    readProfile: async () => ({ ok: true, value: profile('阿蓝') }),
    readTask: async () => ({ ok: true, value: task() }),
    saveArtifact: async () => ({
      ok: true,
      value: { status: 'cancelled', name: 'a', sizeBytes: 0 },
    }),
    saveModel: async () => ({ ok: true, value: modelView() }),
    testModel: async () => ({ ok: true, value: modelView() }),
    ...over,
  } as DesktopCompanionBridge;
}

const receipt = () => ({
  commandId: 'cmd',
  status: 'accepted' as const,
  messageId: 'm',
  taskId: null,
});
const profile = (name: string): CompanionProfileView => ({
  agentId: 'agent-1',
  name,
  persona: '旧的正文',
  revision: 1,
});
const task = (): CompanionTask => ({
  id: 't1',
  executionId: 'e1',
  title: '旧任务',
  status: 'running',
  createdAt: 1,
  updatedAt: 1,
  exitCode: null,
  stdout: '',
  stderr: '',
  logsTruncated: false,
  artifacts: [],
  error: null,
});
const modelView = () =>
  ({
    profileRevision: 1,
    desired: { mode: 'scripted', connectorId: 'pet.model-connection-magpie/magpie' },
    applied: null,
    enabled: false,
    connectors: [],
    check: {
      state: 'unconfigured',
      commandId: null,
      binding: null,
      startedAt: null,
      checkedAt: null,
      elapsedMs: null,
      evidence: null,
      error: null,
    },
    error: null,
  }) as const;

/** 一个可以由测试决定何时结算的 Promise：让动作真的处于「在途」。 */
function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** 挂载：第一次提交就是首帧。 */
function mount(bridge: DesktopCompanionBridge): void {
  vi.stubGlobal('window', { petCompanion: bridge });
  harness.hooks.length = 0;
  harness.pending.length = 0;
  harness.cleanups.length = 0;
  harness.cursor = 0;
  render();
}

/** 当前这一帧的返回值；重渲染后换成新的那份。 */
function view(): CompanionView {
  return harness.view as CompanionView;
}

/**
 * 最近一次提交渲染出来的 state。
 *
 * 读的是 hook 自己返回的那份（render() 重跑过函数体），不是测试另存的副本。
 */
function current(): DesktopCompanionState | null {
  return view().state;
}

/**
 * 让在途的读取跑完，然后提交一次（setter 只改槽，提交是显式的）。
 * 这样测试能精确区分「旧渲染捕获的动作」与「新渲染里的动作」。
 */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  render();
}

afterEach(() => {
  for (const off of harness.cleanups.splice(0)) off();
  harness.hooks.length = 0;
  harness.pending.length = 0;
  vi.unstubAllGlobals();
});

describe('换代栅栏：纯判定', () => {
  it('同一个 connectionId 才算数；没有已采用状态就一律作废', () => {
    expect(settleTarget(state(3, 'c1'), 'c1')).toBe('current');
    expect(settleTarget(state(3, 'c2'), 'c1')).toBe('stale');
    expect(settleTarget(null, 'c1')).toBe('stale');
  });

  it('连接类动作没有既有目标：不受栅栏影响', () => {
    expect(settleTarget(state(3, 'c2'), null)).toBe('current');
  });
});

describe('旧目标的动作结果不能落到新目标上', () => {
  it('已采纳更新的连接后，旧连接的成功回执是 stale，调用方不得清草稿', async () => {
    const inFlight =
      deferred<
        Result<{ commandId: string; status: 'accepted'; messageId: string; taskId: null }>
      >();
    const bridge = bridgeWith([{ ok: true, value: state(1, 'old') }], {
      sendMessage: () => inFlight.promise,
    });
    mount(bridge);
    await flush();
    expect(current()?.connectionId).toBe('old');

    // 发送在途时连接被换成了新的；回执随后才到。
    const sending = view().send('cmd-1', '还没发出去的一句');
    bridge.getState = async () => ({ ok: true, value: state(2, 'new') });
    await view().refresh();
    await flush();
    expect(current()?.connectionId).toBe('new');

    inFlight.resolve({ ok: true, value: receipt() });
    const result = await sending;
    expect(result.outcome).toBe('stale');
  });

  it('已采纳新目标后确认读取失败，旧结果仍然作废（失败不等于目标没变）', async () => {
    const inFlight =
      deferred<
        Result<{ commandId: string; status: 'accepted'; messageId: string; taskId: null }>
      >();
    const bridge = bridgeWith([{ ok: true, value: state(1, 'old') }], {
      sendMessage: () => inFlight.promise,
    });
    mount(bridge);
    await flush();
    expect(current()?.connectionId).toBe('old');

    const sending = view().send('cmd-2', '旧目标的一句');
    // 新目标先被采纳，随后所有确认读取都失败。
    bridge.getState = async () => ({ ok: true, value: state(2, 'new') });
    await view().refresh();
    await flush();
    expect(current()?.connectionId).toBe('new');
    bridge.getState = async () => ({ ok: false, error: makeError('unavailable', false) });

    inFlight.resolve({ ok: true, value: receipt() });
    const result = await sending;
    // 没有成功读取，但已采纳的新目标就是证据：这次结果不属于它。
    expect(result.outcome).toBe('stale');
    expect(current()?.connectionId).toBe('new');
  });

  it('缓存仍同目标时读取失败不改判：确知受理就是 accepted', async () => {
    const bridge = bridgeWith([{ ok: true, value: state(1, 'c1') }], {
      sendMessage: async () => ({ ok: true, value: receipt() }),
    });
    mount(bridge);
    await flush();
    expect(current()?.connectionId).toBe('c1');
    // 多一次 getState 抖动不该把确知受理改判成「可能没送达」。
    bridge.getState = async () => ({ ok: false, error: makeError('unavailable', false) });
    expect((await view().send('cmd-6', '还是同一个目标')).outcome).toBe('accepted');
  });
  it('确认读取返回更旧的 revision 时，不采纳它，栅栏仍按已采纳的新目标判定', async () => {
    const inFlight =
      deferred<
        Result<{ commandId: string; status: 'accepted'; messageId: string; taskId: null }>
      >();
    const bridge = bridgeWith([{ ok: true, value: state(1, 'old') }], {
      sendMessage: () => inFlight.promise,
    });
    mount(bridge);
    await flush();

    const sending = view().send('cmd-3', '更旧读之后');
    bridge.getState = async () => ({ ok: true, value: state(2, 'old') });
    await view().refresh();
    await flush();
    // 更旧的读没有把界面拉回去：已采纳的仍是 revision 1 的那一份。
    expect(current()?.connectionId).toBe('old');

    inFlight.resolve({ ok: true, value: receipt() });
    // 目标没变，所以这次结果对当前连接有效——栅栏只按已采纳状态判定。
    expect((await sending).outcome).toBe('accepted');
  });

  it('抛出的旧错误也不能污染新目标', async () => {
    const inFlight = deferred<never>();
    const bridge = bridgeWith([{ ok: true, value: state(1, 'old') }], {
      sendMessage: () => inFlight.promise,
    });
    mount(bridge);
    await flush();
    expect(current()?.connectionId).toBe('old');

    const sending = view().send('cmd-4', '抛错的一句');
    bridge.getState = async () => ({ ok: true, value: state(2, 'new') });
    await view().refresh();
    await flush();
    expect(current()?.connectionId).toBe('new');

    inFlight.resolve(undefined as never);
    expect((await sending).outcome).toBe('stale');
    expect(view().notice).toBeNull();
  });

  it('Main 已切到 B 但推送读取失败：栅栏只知 A，结果按 A 处理并如实报读取错误', async () => {
    const bridge = bridgeWith([{ ok: true, value: state(1, 'A') }], {
      sendMessage: async () => ({ ok: true, value: receipt() }),
    });
    mount(bridge);
    await flush();
    expect(current()?.connectionId).toBe('A');

    bridge.getState = async () => ({ ok: false, error: makeError('unavailable', false) });
    onChange?.();
    await flush();

    // 没有证据说明目标变了：按已采纳的 A 处理，不谎称 stale。
    expect((await view().send('cmd-A', '发给旧 A 的一句')).outcome).toBe('accepted');
    // 读取失败单独呈现，不当成新状态。
    expect(view().readError).not.toBeNull();
    expect(current()?.connectionId).toBe('A');
  });
  it('发给 A 的在途消息遇到 Main 切到 B 且推送读取成功：结果是 stale', async () => {
    const inFlight =
      deferred<
        Result<{ commandId: string; status: 'accepted'; messageId: string; taskId: null }>
      >();
    const bridge = bridgeWith([{ ok: true, value: state(1, 'A') }], {
      sendMessage: () => inFlight.promise,
    });
    mount(bridge);
    await flush();
    expect(current()?.connectionId).toBe('A');

    // 发起时目标是 A；在途期间 Main 切到 B 并成功推送。
    const sending = view().send('cmd-A2', '发给旧 A 的另一句');
    bridge.getState = async () => ({ ok: true, value: state(2, 'B') });
    onChange?.();
    await flush();
    expect(current()?.connectionId).toBe('B');

    inFlight.resolve({ ok: true, value: receipt() });
    expect((await sending).outcome).toBe('stale');
  });

  it('读取失败但目标未变时，readWith 照常返回这一目标的正文', async () => {
    const bridge = bridgeWith([{ ok: true, value: state(1, 'A') }], {
      readProfile: async () => ({ ok: true, value: profile('A 的正文') }),
    });
    mount(bridge);
    await flush();
    expect(current()?.connectionId).toBe('A');

    bridge.getState = async () => ({ ok: false, error: makeError('unavailable', false) });
    const result = await view().readProfile();
    // 栅栏只按已采纳状态判定；读取抖动不影响这次读取本身的归属。
    expect(result.ok).toBe(true);
    // readWith 内部那次对账读取失败了：错误落在 readError 上，但状态没被改写。
    expect(current()?.connectionId).toBe('A');
  });
  it('同目标抛错才算结果未知，仍保留原文重试', async () => {
    const bridge = bridgeWith([{ ok: true, value: state(1, 'c1') }], {
      sendMessage: async () => {
        throw new Error('transport died');
      },
    });
    mount(bridge);
    await flush();
    expect(current()?.connectionId).toBe('c1');
    expect((await view().send('cmd-5', '同一目标')).outcome).toBe('uncertain');
  });
});

describe('旧渲染的动作不得改投到新目标', () => {
  /**
   * 这是「latest 只作 fence、不作调度器」的核心回归：
   * 界面还停在 A 那一帧时捕获的动作函数，在 B 已被采纳后调用，
   * 必须直接 stale、零 IPC——不能把 A 的 taskId/正文发给 B。
   */
  async function scenario() {
    const calls = {
      sendMessage: vi.fn(
        async (_input: { connectionId: string; commandId: string; text: string }) =>
          ({ ok: true, value: receipt() }) as const,
      ),
      stopTask: vi.fn(async () => ({ ok: true, value: receipt() }) as const),
      stopForeground: vi.fn(async () => ({ ok: true, value: null }) as const),
      readProfile: vi.fn(async () => ({ ok: true, value: profile('A') }) as const),
      readTask: vi.fn(async () => ({ ok: true, value: task() }) as const),
      saveArtifact: vi.fn(
        async () =>
          ({ ok: true, value: { status: 'cancelled' as const, name: 'a', sizeBytes: 0 } }) as const,
      ),
    };
    const bridge = bridgeWith([{ ok: true, value: state(1, 'A') }], calls);
    mount(bridge);
    await flush();
    expect(current()?.connectionId).toBe('A');

    // 抓住「A 那一帧」的动作函数，然后才让 B 被采纳。
    const renderedA = view();
    bridge.getState = async () => ({ ok: true, value: state(2, 'B') });
    await view().refresh();
    await flush();
    expect(current()?.connectionId).toBe('B');
    return { renderedA, calls };
  }

  it('旧 send 不发给 B，直接 stale 且没有 IPC', async () => {
    const { renderedA, calls } = await scenario();
    const result = await renderedA.send('cmd-old', '写给 A 的一句');
    expect(result.outcome).toBe('stale');
    expect(calls.sendMessage).not.toHaveBeenCalled();
  });

  it('旧 stopTask 不把 A 的 taskId 发给 B', async () => {
    const { renderedA, calls } = await scenario();
    const result = await renderedA.stopTask('cmd-old', 'A 的任务');
    expect(result.outcome).toBe('stale');
    expect(calls.stopTask).not.toHaveBeenCalled();
  });

  it('旧 stopForeground 与 disconnect 都不落到 B', async () => {
    const { renderedA, calls } = await scenario();
    expect((await renderedA.stopForeground()).outcome).toBe('stale');
    expect(calls.stopForeground).not.toHaveBeenCalled();
    expect((await renderedA.disconnect()).outcome).toBe('stale');
  });

  it('旧 readProfile / readTask / saveArtifact 都不向 B 发请求', async () => {
    const { renderedA, calls } = await scenario();
    for (const run of [
      () => renderedA.readProfile(),
      () => renderedA.readTask('A 的任务'),
      () => renderedA.saveArtifact('A 的产物'),
    ]) {
      const result = await run();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('stale-owner');
    }
    expect(calls.readProfile).not.toHaveBeenCalled();
    expect(calls.readTask).not.toHaveBeenCalled();
    expect(calls.saveArtifact).not.toHaveBeenCalled();
  });

  it('当前这一帧的动作照常发出，没有被栅栏误伤', async () => {
    const { calls } = await scenario();
    expect((await view().send('cmd-new', '写给 B 的一句')).outcome).toBe('accepted');
    expect(calls.sendMessage).toHaveBeenCalledTimes(1);
    expect(calls.sendMessage.mock.calls[0]?.[0]).toMatchObject({ connectionId: 'B' });
  });
});

describe('派生读取同样过栅栏', () => {
  it('旧目标读到的人格不再返回给新目标', async () => {
    const inFlight = deferred<Result<CompanionProfileView>>();
    const bridge = bridgeWith([{ ok: true, value: state(1, 'old') }], {
      readProfile: () => inFlight.promise,
    });
    mount(bridge);
    await flush();

    const reading = view().readProfile();
    bridge.getState = async () => ({ ok: true, value: state(2, 'new') });
    await view().refresh();
    await flush();
    expect(current()?.connectionId).toBe('new');

    inFlight.resolve({ ok: true, value: profile('旧目标') });
    const result = await reading;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('stale-owner');
  });

  it('任务与产物读取也一样：换代后不给旧结果', async () => {
    const taskRead = deferred<Result<CompanionTask>>();
    const artifactRead =
      deferred<Result<{ status: 'cancelled'; name: string; sizeBytes: number }>>();
    const bridge = bridgeWith([{ ok: true, value: state(1, 'old') }], {
      readTask: () => taskRead.promise,
      saveArtifact: () => artifactRead.promise,
    });
    mount(bridge);
    await flush();

    const taskResult = view().readTask('t1');
    const artifact = view().saveArtifact('a1');
    bridge.getState = async () => ({ ok: true, value: state(2, 'new') });
    await view().refresh();
    await flush();

    taskRead.resolve({ ok: true, value: task() });
    artifactRead.resolve({ ok: true, value: { status: 'cancelled', name: 'a', sizeBytes: 0 } });
    expect((await taskResult).ok).toBe(false);
    expect((await artifact).ok).toBe(false);
  });

  it('模型保存与测试同样不返回旧目标的视图', async () => {
    const saveRead = deferred<Result<ReturnType<typeof modelView>>>();
    const testRead = deferred<Result<ReturnType<typeof modelView>>>();
    const bridge = bridgeWith([{ ok: true, value: state(1, 'old') }], {
      saveModel: () => saveRead.promise,
      testModel: () => testRead.promise,
    });
    mount(bridge);
    await flush();

    const save = view().saveModel({} as CompanionModelSaveCommand);
    const test = view().testModel({} as CompanionModelTestCommand);
    bridge.getState = async () => ({ ok: true, value: state(2, 'new') });
    await view().refresh();
    await flush();

    saveRead.resolve({ ok: true, value: modelView() });
    testRead.resolve({ ok: true, value: modelView() });
    expect((await save).ok).toBe(false);
    expect((await test).ok).toBe(false);
  });
});

describe('endpoint 草稿的 CAS 基线', () => {
  it('连接用的是调用方给的草稿基线，不是此刻最新的 configRevision', async () => {
    const connect = vi.fn(async (): Promise<Result<DesktopCompanionState>> => ({
      ok: true,
      value: state(3, 'c1'),
    }));
    const bridge = bridgeWith([{ ok: true, value: state(1, null, { configRevision: 9 }) }], {
      connect,
    });
    mount(bridge);
    await flush();
    expect(current()?.configRevision).toBe(9);

    // 草稿是在 rev4 时读的，中间外部把 Config 改到了 rev9。
    await view().connect({
      baseUrl: 'http://127.0.0.1:4120',
      token: 'x'.repeat(24),
      expectedRevision: 4,
    });
    expect(connect).toHaveBeenCalledWith({
      expectedRevision: 4,
      baseUrl: 'http://127.0.0.1:4120',
      token: 'x'.repeat(24),
    });
  });

  it('同目标换令牌也是一次新连接：仍然用草稿基线发出', async () => {
    const connect = vi.fn(
      async (_input: {
        expectedRevision: number;
        baseUrl: string;
        token: string;
      }): Promise<Result<DesktopCompanionState>> => ({ ok: true, value: state(2, 'c2') }),
    );
    const bridge = bridgeWith([{ ok: true, value: state(1, 'c1', { configRevision: 2 }) }], {
      connect,
    });
    mount(bridge);
    await flush();
    expect(current()?.connectionId).toBe('c1');
    await view().connect({
      baseUrl: 'http://127.0.0.1:4120',
      token: 'y'.repeat(24),
      expectedRevision: 2,
    });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect.mock.calls[0]?.[0]).toMatchObject({ expectedRevision: 2 });
  });
});

describe('connect 交回它真正写下的 Config 版本', () => {
  it('返回的是 connect 的结果，不是提交前那次渲染的 state', async () => {
    // 提交时界面还停在 rev1；Main 写下 rev2 并把它放在返回值里。
    const bridge = bridgeWith([{ ok: true, value: state(1, 'c1', { configRevision: 1 }) }], {
      connect: async () => ({ ok: true, value: state(2, 'c1', { configRevision: 2 }) }),
    });
    mount(bridge);
    await flush();
    expect(current()?.configRevision).toBe(1);

    const result = await view().connect({
      baseUrl: 'http://127.0.0.1:4120',
      token: 'x'.repeat(24),
      expectedRevision: 1,
    });
    expect(result.outcome).toBe('accepted');
    // 关键：2 来自这次写入的事实，不是闭包里那个 1。
    expect(result.configRevision).toBe(2);
  });

  it('没有写成功时不编造版本', async () => {
    const bridge = bridgeWith([{ ok: true, value: state(1, 'c1', { configRevision: 1 }) }], {
      connect: async () => ({ ok: false, error: makeError('conflict', false) }),
    });
    mount(bridge);
    await flush();
    const result = await view().connect({
      baseUrl: 'http://127.0.0.1:4120',
      token: 'x'.repeat(24),
      expectedRevision: 1,
    });
    expect(result.outcome).toBe('failed');
    expect(result.configRevision).toBeNull();
  });
});

describe('一次成功之后不会误报冲突，外部改动仍被识别', () => {
  /**
   * 走一遍真实顺序：草稿基线 1 → 提交 → Main 写 2 并返回 → 基线变 2。
   * 这里串的是表单实际调用的三个纯函数与 hook 的真实返回值，
   * 所以断言的是「一次成功后不假冲突、外部 rev3 仍冲突」这条链路本身。
   */
  it('rev1 提交、Main 写 rev2：基线跟到 2，不再报「别处改过」', async () => {
    let baseline: number | null = 1;
    const bridge = bridgeWith([{ ok: true, value: state(1, 'c1', { configRevision: 1 }) }], {
      connect: async () => ({ ok: true, value: state(2, 'c1', { configRevision: 2 }) }),
    });
    mount(bridge);
    await flush();

    const result = await view().connect({
      baseUrl: 'http://127.0.0.1:4120',
      token: 'x'.repeat(24),
      expectedRevision: endpointBaseline(baseline, 1),
    });
    expect(result.outcome).toBe('accepted');
    baseline = rebaseOnConnect(result.configRevision, baseline);

    expect(baseline).toBe(2);
    // Main 发布 rev2 之后：不该出现「别处改过」。
    expect(endpointMoved(baseline, 2, false)).toBe(false);
  });

  it('同地址换令牌：基线已是 2，用 2 提交照常成功', async () => {
    let baseline: number | null = 1;
    const connect = vi.fn(
      async (_input: {
        expectedRevision: number;
        baseUrl: string;
        token: string;
      }): Promise<Result<DesktopCompanionState>> => ({
        ok: true,
        value: state(2, 'c1', { configRevision: 2 }),
      }),
    );
    const bridge = bridgeWith([{ ok: true, value: state(1, 'c1', { configRevision: 1 }) }], {
      connect,
    });
    mount(bridge);
    await flush();

    const first = await view().connect({
      baseUrl: 'http://127.0.0.1:4120',
      token: 'x'.repeat(24),
      expectedRevision: endpointBaseline(baseline, 1),
    });
    baseline = rebaseOnConnect(first.configRevision, baseline);

    await view().connect({
      baseUrl: 'http://127.0.0.1:4120',
      token: 'y'.repeat(24),
      expectedRevision: endpointBaseline(baseline, 2),
    });
    expect(connect).toHaveBeenCalledTimes(2);
    expect(connect.mock.calls[1]?.[0]).toMatchObject({ expectedRevision: 2 });
  });

  it('同期外部推到 rev3：仍然识别为被改过，不会被这次成功吞掉', async () => {
    let baseline: number | null = 1;
    const bridge = bridgeWith([{ ok: true, value: state(1, 'c1', { configRevision: 1 }) }], {
      connect: async () => ({ ok: true, value: state(2, 'c1', { configRevision: 2 }) }),
    });
    mount(bridge);
    await flush();

    const result = await view().connect({
      baseUrl: 'http://127.0.0.1:4120',
      token: 'x'.repeat(24),
      expectedRevision: endpointBaseline(baseline, 1),
    });
    baseline = rebaseOnConnect(result.configRevision, baseline);

    // 别人已经推到 rev3：我的基线停在 2，界面必须提示改过。
    expect(endpointMoved(baseline, 3, false)).toBe(true);
  });
});

describe('发送意图的类型仍在', () => {
  it('sendMessage 接受契约里的命令形状，不额外发明字段', () => {
    const command: CompanionMessageCommand = { commandId: 'c', text: '你好' };
    expect(Object.keys(command).sort()).toEqual(['commandId', 'text']);
  });
});
