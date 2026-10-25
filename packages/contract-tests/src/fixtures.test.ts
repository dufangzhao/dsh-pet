import { readFileSync } from 'node:fs';

import type {
  CapabilityCallContext,
  CapabilityMethods,
  Disposer,
  PluginRuntimeContext,
} from '@pet/host-kernel';
import { describe, expect, it } from 'vitest';

import {
  FAST_CLEANUP_BEGIN,
  FAST_CLEANUP_END,
  FAST_EFFECT_START,
  FIXTURE_ERROR_ACTIVATION,
  PRIMARY_EFFECT_START,
  PRIMARY_EFFECT_STOP,
  PROVIDER_ACTIVATE,
  PROVIDER_DISPOSE,
  SECONDARY_EFFECT_START,
  SECONDARY_EFFECT_STOP,
  SLOW_ACTIVATE_BEGIN,
  SLOW_ACTIVATE_END,
  STUCK_CLEANUP_BEGIN,
  STUCK_CLEANUP_END,
  STUCK_EFFECT_START,
} from './fixtures/markers.js';
import {
  makeFailingPlugin,
  makeProviderPlugin,
  makeRecordingPlugin,
  makeSlowPlugin,
  makeStuckCleanupPlugin,
} from './fixtures/plugins.js';

/**
 * 夹具自身的最小宿主替身。
 *
 * 它不是产品宿主，只按 `PluginRuntimeContext` 的冻结签名同步登记 effect、
 * 记录 provide/contribute，并按 LIFO 逆序清理——足以验证夹具真的能触发
 * 慢激活、激活失败、卡住清理与记录行为。
 */
interface Harness {
  readonly context: PluginRuntimeContext;
  readonly effects: { dispose: Disposer }[];
  readonly provided: { providerId: string; methods: CapabilityMethods }[];
  readonly contributions: string[];
  readonly controller: AbortController;
  /** 按登记逆序清理一个 effect；没有剩余 effect 时抛错。 */
  disposeNext(): Promise<void>;
  /** 按登记逆序清理全部 effect。 */
  disposeAll(): Promise<void>;
}

function makeHarness(): Harness {
  const controller = new AbortController();
  const effects: { dispose: Disposer }[] = [];
  const provided: { providerId: string; methods: CapabilityMethods }[] = [];
  const contributions: string[] = [];
  const context: PluginRuntimeContext = {
    owner: Object.freeze({
      pluginId: 'pet.contract-tests.fixture',
      instanceId: 'fixture-1',
      generation: 1,
    }),
    signal: controller.signal,
    config: Object.freeze({}),
    provide(providerId, methods) {
      provided.push({ providerId, methods });
    },
    contribute(id) {
      contributions.push(id);
    },
    effect(create) {
      effects.push({ dispose: create() });
    },
  };
  const disposeNext = async (): Promise<void> => {
    const entry = effects.pop();
    if (!entry) throw new Error('fixture harness: no registered effect left');
    await entry.dispose();
  };
  const disposeAll = async (): Promise<void> => {
    while (effects.length > 0) await disposeNext();
  };
  return { context, effects, provided, contributions, controller, disposeNext, disposeAll };
}

/** 只推进微任务，不用真实定时器等待。 */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

describe('makeRecordingPlugin', () => {
  it('records effect start on activation and stops in reverse order', async () => {
    const harness = makeHarness();
    const { module, events } = makeRecordingPlugin();

    expect(module.activate(harness.context)).toBeUndefined();
    expect(events).toEqual([PRIMARY_EFFECT_START, SECONDARY_EFFECT_START]);
    expect(harness.effects).toHaveLength(2);

    await harness.disposeAll();
    expect(events).toEqual([
      PRIMARY_EFFECT_START,
      SECONDARY_EFFECT_START,
      SECONDARY_EFFECT_STOP,
      PRIMARY_EFFECT_STOP,
    ]);
  });

  it('gives every call an independent event log', () => {
    const first = makeRecordingPlugin();
    const second = makeRecordingPlugin();
    first.module.activate(makeHarness().context);
    expect(second.events).toEqual([]);
  });
});

describe('makeFailingPlugin', () => {
  it('registers effects, then throws the fixed fixture error', async () => {
    const harness = makeHarness();
    const { module, events } = makeFailingPlugin();

    expect(() => module.activate(harness.context)).toThrow(FIXTURE_ERROR_ACTIVATION);
    expect(events).toEqual([PRIMARY_EFFECT_START, SECONDARY_EFFECT_START]);
    expect(harness.effects).toHaveLength(2);

    await harness.disposeAll();
    expect(events).toEqual([
      PRIMARY_EFFECT_START,
      SECONDARY_EFFECT_START,
      SECONDARY_EFFECT_STOP,
      PRIMARY_EFFECT_STOP,
    ]);
  });

  it('exposes only the fixed public marker, never caller data', async () => {
    const harness = makeHarness();
    const { module } = makeFailingPlugin();
    let failure: unknown;
    try {
      await module.activate(harness.context);
    } catch (error: unknown) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(FIXTURE_ERROR_ACTIVATION);
    expect((failure as Error).message).not.toContain('fixture-1');
  });
});

describe('makeSlowPlugin', () => {
  it('keeps activation pending until release, then finishes', async () => {
    const harness = makeHarness();
    const { module, events, release } = makeSlowPlugin();

    let settled = false;
    const activation = Promise.resolve(module.activate(harness.context)).then(() => {
      settled = true;
    });
    await flushMicrotasks();

    expect(settled).toBe(false);
    expect(events).toEqual([SLOW_ACTIVATE_BEGIN, PRIMARY_EFFECT_START]);

    release();
    await activation;
    expect(settled).toBe(true);
    expect(events).toEqual([SLOW_ACTIVATE_BEGIN, PRIMARY_EFFECT_START, SLOW_ACTIVATE_END]);

    await harness.disposeAll();
    expect(events).toEqual([
      SLOW_ACTIVATE_BEGIN,
      PRIMARY_EFFECT_START,
      SLOW_ACTIVATE_END,
      PRIMARY_EFFECT_STOP,
    ]);
  });

  it('completes immediately when released before activation', async () => {
    const harness = makeHarness();
    const { module, events, release } = makeSlowPlugin();

    release();
    release();
    await module.activate(harness.context);
    expect(events).toEqual([SLOW_ACTIVATE_BEGIN, PRIMARY_EFFECT_START, SLOW_ACTIVATE_END]);
  });
});

describe('makeStuckCleanupPlugin', () => {
  it('blocks cleanup at the last-registered effect until release', async () => {
    const harness = makeHarness();
    const { module, events, release } = makeStuckCleanupPlugin();

    module.activate(harness.context);
    expect(events).toEqual([FAST_EFFECT_START, STUCK_EFFECT_START]);
    expect(harness.effects).toHaveLength(2);

    let settled = false;
    const cleanup = harness.disposeAll().then(() => {
      settled = true;
    });
    await flushMicrotasks();

    expect(settled).toBe(false);
    expect(events).toEqual([FAST_EFFECT_START, STUCK_EFFECT_START, STUCK_CLEANUP_BEGIN]);

    release();
    await cleanup;
    expect(settled).toBe(true);
    expect(events).toEqual([
      FAST_EFFECT_START,
      STUCK_EFFECT_START,
      STUCK_CLEANUP_BEGIN,
      STUCK_CLEANUP_END,
      FAST_CLEANUP_BEGIN,
      FAST_CLEANUP_END,
    ]);
  });

  it('does not hang when released before cleanup starts', async () => {
    const harness = makeHarness();
    const { module, events, release } = makeStuckCleanupPlugin();

    module.activate(harness.context);
    release();
    await harness.disposeAll();
    expect(events.slice(2)).toEqual([
      STUCK_CLEANUP_BEGIN,
      STUCK_CLEANUP_END,
      FAST_CLEANUP_BEGIN,
      FAST_CLEANUP_END,
    ]);
  });
});

describe('makeProviderPlugin', () => {
  it('registers the given provider id and methods unchanged', async () => {
    const harness = makeHarness();
    const methods: CapabilityMethods = {
      'asr.transcribe': async (_context: CapabilityCallContext, _input) => 'fixture-result',
    };
    const { module, events } = makeProviderPlugin('pet.fixture.asr', methods);

    module.activate(harness.context);
    const [registered] = harness.provided;
    if (!registered) throw new Error('provider fixture did not register a provider');
    expect(harness.provided).toHaveLength(1);
    expect(registered.providerId).toBe('pet.fixture.asr');
    expect(registered.methods).toBe(methods);
    expect(events).toEqual([PROVIDER_ACTIVATE]);

    const method = registered.methods['asr.transcribe'];
    if (!method) throw new Error('provider fixture did not expose the given method');
    await expect(
      method({ taskId: 'task-1', signal: harness.controller.signal }, null),
    ).resolves.toBe('fixture-result');

    await harness.disposeAll();
    expect(events).toEqual([PROVIDER_ACTIVATE, PROVIDER_DISPOSE]);
  });

  it('registers nothing else: no contributions and exactly one effect', () => {
    const harness = makeHarness();
    const { module } = makeProviderPlugin('pet.fixture.asr', {});
    module.activate(harness.context);
    expect(harness.provided).toHaveLength(1);
    expect(harness.contributions).toEqual([]);
    expect(harness.effects).toHaveLength(1);
  });
});

describe('fixture source constraints', () => {
  const sources = ['markers.ts', 'plugins.ts'].map(
    (name) => new URL('./fixtures/' + name, import.meta.url),
  );

  it('does not import Cordis, Electron, Node I/O or network modules', () => {
    for (const url of sources) {
      const text = readFileSync(url, 'utf8');
      for (const forbidden of [
        '@deepseek-ai/cordis',
        'electron',
        'node:child_process',
        'node:fs',
        'node:net',
        'node:http',
        'node:worker_threads',
      ])
        expect(text).not.toContain(forbidden);
    }
  });

  it('does not install real timers or intervals', () => {
    for (const url of sources) {
      const text = readFileSync(url, 'utf8');
      expect(text).not.toMatch(/\bsetTimeout\b/);
      expect(text).not.toMatch(/\bsetInterval\b/);
      expect(text).not.toMatch(/\bsetImmediate\b/);
    }
  });
});
