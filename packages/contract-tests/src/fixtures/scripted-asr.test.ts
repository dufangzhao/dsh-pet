import { readFileSync } from 'node:fs';

import type {
  CapabilityCallContext,
  CapabilityMethods,
  Disposer,
  PluginRuntimeContext,
} from '@pet/host-kernel';
import { MVP_CAPABILITIES, type JsonValue } from '@pet/contracts';
import { describe, expect, it } from 'vitest';

import {
  makeScriptedAsrGate,
  makeScriptedAsrPlugin,
  SCRIPTED_ASR_CALL_ABORTED,
  SCRIPTED_ASR_CALL_BEGIN,
  SCRIPTED_ASR_CALL_FAIL,
  SCRIPTED_ASR_CALL_LATE_RETURN,
  SCRIPTED_ASR_CALL_RETURN,
  SCRIPTED_ASR_CANCEL_IGNORED,
  SCRIPTED_ASR_CAPABILITY,
  SCRIPTED_ASR_ERROR_CANCELLED,
  SCRIPTED_ASR_ERROR_INPUT,
  SCRIPTED_ASR_GATE_SETTLED,
  SCRIPTED_ASR_GATE_WAIT,
  SCRIPTED_ASR_METHOD,
  SCRIPTED_ASR_PROVIDER_ID,
  SCRIPTED_ASR_STEP_FINAL,
  SCRIPTED_ASR_STEP_PARTIAL,
} from './scripted-asr.js';
import { PROVIDER_ACTIVATE, PROVIDER_DISPOSE } from './markers.js';

/**
 * 夹具自身的最小宿主替身（与 `fixtures.test.ts` 同形，但不共享实现）：
 * 只按冻结的 `PluginRuntimeContext` 同步登记 provide/effect，并按 LIFO 逆序清理。
 * 它不启动 Cordis、不加载模块、不安装定时器——真实内核集成在
 * `scripted-asr-integration.test.ts`。
 */
interface Harness {
  readonly context: PluginRuntimeContext;
  readonly provided: { providerId: string; methods: CapabilityMethods }[];
  readonly effects: Disposer[];
  readonly controller: AbortController;
  disposeAll(): Promise<void>;
}

function makeHarness(): Harness {
  const controller = new AbortController();
  const provided: Harness['provided'] = [];
  const effects: Disposer[] = [];
  const context: PluginRuntimeContext = {
    owner: Object.freeze({
      pluginId: 'pet.contract-tests.scripted-asr',
      instanceId: 'fixture-1',
      generation: 1,
    }),
    signal: controller.signal,
    config: Object.freeze({}),
    provide(providerId, methods) {
      provided.push({ providerId, methods });
    },
    contribute() {
      throw new Error('scripted ASR fixture must not register contributions');
    },
    effect(create) {
      effects.push(create());
    },
  };
  return {
    context,
    provided,
    effects,
    controller,
    async disposeAll() {
      while (effects.length > 0) await effects.pop()!();
    },
  };
}

/** 推进微任务，不用真实定时器等待。 */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

/** 装配一个已激活的夹具，返回可调用的 `recognize` 与句柄。 */
function activate(script: Parameters<typeof makeScriptedAsrPlugin>[0]) {
  const harness = makeHarness();
  const handle = makeScriptedAsrPlugin(script);
  handle.module.activate(harness.context);
  const registered = harness.provided[0];
  if (!registered) throw new Error('scripted ASR fixture registered no provider');
  const method = registered.methods[SCRIPTED_ASR_METHOD];
  if (!method) throw new Error('scripted ASR fixture registered no recognize method');
  const call = (input: JsonValue, signal: AbortSignal = harness.controller.signal) =>
    method({ taskId: 'task-1', signal } satisfies CapabilityCallContext, input);
  return { harness, handle, registered, call };
}

describe('makeScriptedAsrPlugin registration', () => {
  it('registers exactly the fixture-only capability id and provider id', async () => {
    const { harness, registered, handle } = activate({ steps: [] });

    expect(harness.provided).toHaveLength(1);
    expect(registered.providerId).toBe(SCRIPTED_ASR_PROVIDER_ID);
    expect(SCRIPTED_ASR_PROVIDER_ID).toBe('main');
    expect(SCRIPTED_ASR_METHOD).toBe('recognize');
    expect(Object.keys(registered.methods)).toEqual([SCRIPTED_ASR_METHOD]);
    expect(handle.events).toEqual([PROVIDER_ACTIVATE]);

    await harness.disposeAll();
    expect(handle.events).toEqual([PROVIDER_ACTIVATE, PROVIDER_DISPOSE]);
  });

  it('keeps the capability in the test domain, outside the M1 capability set', () => {
    expect(SCRIPTED_ASR_CAPABILITY).toBe('test.scriptedAsr@1');
    expect(SCRIPTED_ASR_CAPABILITY.startsWith('test.')).toBe(true);
    expect([...MVP_CAPABILITIES]).not.toContain(SCRIPTED_ASR_CAPABILITY);
    expect([...MVP_CAPABILITIES]).toContain('speech.asr@1');
  });

  it('gives every call an independent event log and call list', () => {
    const first = makeScriptedAsrPlugin({ steps: [] });
    const second = makeScriptedAsrPlugin({ steps: [] });
    first.module.activate(makeHarness().context);
    expect(first.events).toEqual([PROVIDER_ACTIVATE]);
    expect(second.events).toEqual([]);
    expect(second.calls).toEqual([]);
  });
});

describe('makeScriptedAsrPlugin normal mode', () => {
  it('emits partial then final text and returns the scripted transcript', async () => {
    const { handle, call } = activate({
      steps: [
        { kind: 'partial', text: '你好' },
        { kind: 'final', text: '你好世界' },
      ],
    });

    await expect(call({ utteranceId: 'u-1' })).resolves.toEqual({
      transcript: '你好世界',
      events: [
        { type: 'partial', text: '你好' },
        { type: 'final', text: '你好世界' },
      ],
      utteranceId: 'u-1',
    });
    expect(handle.events).toEqual([
      PROVIDER_ACTIVATE,
      SCRIPTED_ASR_CALL_BEGIN,
      SCRIPTED_ASR_STEP_PARTIAL,
      SCRIPTED_ASR_STEP_FINAL,
      SCRIPTED_ASR_CALL_RETURN,
    ]);
    expect(handle.calls).toHaveLength(1);
    expect(handle.calls[0]).toMatchObject({
      taskId: 'task-1',
      utteranceId: 'u-1',
      abortedAtExit: false,
      returnedTranscript: '你好世界',
      failure: null,
    });
  });

  it('prefers an explicit finalText over the last text step', async () => {
    const { call } = activate({
      steps: [{ kind: 'final', text: 'from-step' }],
      finalText: 'from-script',
    });
    await expect(call({})).resolves.toMatchObject({ transcript: 'from-script' });
  });

  it('returns an empty transcript and empty event list for an empty script', async () => {
    const { handle, call } = activate({ steps: [] });
    await expect(call({ utteranceId: 'u-empty' })).resolves.toEqual({
      transcript: '',
      events: [],
      utteranceId: 'u-empty',
    });
    expect(handle.events).toEqual([
      PROVIDER_ACTIVATE,
      SCRIPTED_ASR_CALL_BEGIN,
      SCRIPTED_ASR_CALL_RETURN,
    ]);
  });

  it('holds the call at a gate until the test settles it', async () => {
    const gate = makeScriptedAsrGate('mid');
    const { handle, call } = activate({
      steps: [
        { kind: 'partial', text: 'a' },
        { kind: 'gate', gate },
        { kind: 'final', text: 'b' },
      ],
    });

    let settled = false;
    const pending = call({ utteranceId: 'u-2' }).then((value) => {
      settled = true;
      return value;
    });
    await flushMicrotasks();

    expect(settled).toBe(false);
    expect(gate.settled).toBe(false);
    expect(handle.events).toEqual([
      PROVIDER_ACTIVATE,
      SCRIPTED_ASR_CALL_BEGIN,
      SCRIPTED_ASR_STEP_PARTIAL,
      SCRIPTED_ASR_GATE_WAIT,
    ]);

    gate.settle();
    await expect(pending).resolves.toMatchObject({ transcript: 'b' });
    expect(handle.events.slice(-3)).toEqual([
      SCRIPTED_ASR_GATE_SETTLED,
      SCRIPTED_ASR_STEP_FINAL,
      SCRIPTED_ASR_CALL_RETURN,
    ]);
  });

  it('stops at the next step boundary after the task signal aborts', async () => {
    const gate = makeScriptedAsrGate('mid');
    const { handle, call, harness } = activate({
      steps: [
        { kind: 'gate', gate },
        { kind: 'final', text: 'must-not-appear' },
      ],
    });

    const pending = call({ utteranceId: 'u-3' });
    await flushMicrotasks();
    harness.controller.abort();
    gate.settle();

    await expect(pending).rejects.toThrow(SCRIPTED_ASR_ERROR_CANCELLED);
    expect(handle.events).toEqual([
      PROVIDER_ACTIVATE,
      SCRIPTED_ASR_CALL_BEGIN,
      SCRIPTED_ASR_GATE_WAIT,
      SCRIPTED_ASR_GATE_SETTLED,
      SCRIPTED_ASR_CALL_ABORTED,
      SCRIPTED_ASR_CALL_FAIL,
    ]);
    expect(handle.calls[0]).toMatchObject({
      abortedAtExit: true,
      returnedTranscript: null,
      failure: SCRIPTED_ASR_ERROR_CANCELLED,
      emitted: [],
    });
    expect(JSON.stringify(handle.events)).not.toContain('must-not-appear');
  });

  it('refuses to start work when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { handle, call } = activate({ steps: [{ kind: 'final', text: 'never' }] });

    await expect(call({ utteranceId: 'u-4' }, controller.signal)).rejects.toThrow(
      SCRIPTED_ASR_ERROR_CANCELLED,
    );
    expect(handle.events).toEqual([
      PROVIDER_ACTIVATE,
      SCRIPTED_ASR_CALL_BEGIN,
      SCRIPTED_ASR_CALL_ABORTED,
      SCRIPTED_ASR_CALL_FAIL,
    ]);
  });

  it('does not abandon an entered gate early: the call stays pending until settle', async () => {
    const gate = makeScriptedAsrGate('stuck');
    const { handle, call, harness } = activate({ steps: [{ kind: 'gate', gate }] });

    let settled = false;
    const pending = call({ utteranceId: 'u-5' }).finally(() => {
      settled = true;
    });
    await flushMicrotasks();
    harness.controller.abort();
    await flushMicrotasks();

    expect(settled).toBe(false);
    expect(handle.events).not.toContain(SCRIPTED_ASR_CALL_ABORTED);

    gate.settle();
    await expect(pending).rejects.toThrow(SCRIPTED_ASR_ERROR_CANCELLED);
    expect(settled).toBe(true);
  });
});

describe('makeScriptedAsrPlugin ignoreCancellation bad mode', () => {
  it('runs the whole script and returns fixed text even after cancellation', async () => {
    const gate = makeScriptedAsrGate('mid');
    const { handle, call, harness } = activate({
      steps: [
        { kind: 'gate', gate },
        { kind: 'final', text: 'late-fixed' },
      ],
      ignoreCancellation: true,
    });

    const pending = call({ utteranceId: 'u-6' });
    await flushMicrotasks();
    harness.controller.abort();
    gate.settle();

    await expect(pending).resolves.toEqual({
      transcript: 'late-fixed',
      events: [{ type: 'final', text: 'late-fixed' }],
      utteranceId: 'u-6',
    });
    expect(handle.events).toEqual([
      PROVIDER_ACTIVATE,
      SCRIPTED_ASR_CALL_BEGIN,
      SCRIPTED_ASR_GATE_WAIT,
      SCRIPTED_ASR_GATE_SETTLED,
      SCRIPTED_ASR_STEP_FINAL,
      SCRIPTED_ASR_CANCEL_IGNORED,
      SCRIPTED_ASR_CALL_LATE_RETURN,
    ]);
    expect(handle.calls[0]).toMatchObject({
      abortedAtExit: true,
      returnedTranscript: 'late-fixed',
      failure: null,
    });
  });

  it('reports a normal return when the signal never aborted', async () => {
    const { handle, call } = activate({
      steps: [{ kind: 'final', text: 'prompt' }],
      ignoreCancellation: true,
    });
    await call({});
    expect(handle.events).not.toContain(SCRIPTED_ASR_CANCEL_IGNORED);
    expect(handle.events).toContain(SCRIPTED_ASR_CALL_RETURN);
    expect(handle.events).not.toContain(SCRIPTED_ASR_CALL_LATE_RETURN);
  });
});

describe('makeScriptedAsrPlugin JSON boundary', () => {
  it('reads only utteranceId and never echoes other input fields', async () => {
    const { call } = activate({ steps: [{ kind: 'final', text: 'ok' }] });
    const input = { utteranceId: 'u-7', secret: 'private-content', nested: { a: 1 } };

    const output = await call(input);
    expect(output).toEqual({
      transcript: 'ok',
      events: [{ type: 'final', text: 'ok' }],
      utteranceId: 'u-7',
    });
    expect(JSON.stringify(output)).not.toContain('private-content');
    expect(JSON.stringify(output)).not.toContain('nested');
  });

  it('never mutates the caller input, including a deep-frozen one', async () => {
    const { call } = activate({ steps: [{ kind: 'final', text: 'ok' }] });
    const input = Object.freeze({ utteranceId: 'u-8', extra: Object.freeze({ n: 1 }) });
    await expect(call(input)).resolves.toMatchObject({ utteranceId: 'u-8' });
    expect(input).toEqual({ utteranceId: 'u-8', extra: { n: 1 } });
  });

  it('omits utteranceId when the caller did not supply one', async () => {
    const { call } = activate({ steps: [{ kind: 'final', text: 'ok' }] });
    const output = await call({});
    expect(output).toEqual({ transcript: 'ok', events: [{ type: 'final', text: 'ok' }] });
    expect(Object.keys(output as object)).toEqual(['transcript', 'events']);
  });

  it.each([
    ['null', null],
    ['a string', 'utterance'],
    ['a number', 1],
    ['an array', [{ utteranceId: 'u' }]],
    ['a non-string utteranceId', { utteranceId: 7 }],
  ])('rejects %s with the fixed fixture error', async (_label, input) => {
    const { handle, call } = activate({ steps: [{ kind: 'final', text: 'ok' }] });
    await expect(call(input as JsonValue)).rejects.toThrow(SCRIPTED_ASR_ERROR_INPUT);
    expect(handle.events).toEqual([
      PROVIDER_ACTIVATE,
      SCRIPTED_ASR_CALL_BEGIN,
      SCRIPTED_ASR_CALL_FAIL,
    ]);
    expect(handle.calls[0]).toMatchObject({ failure: SCRIPTED_ASR_ERROR_INPUT });
  });

  it('never leaks caller data or an original exception through the failure record', async () => {
    const { handle, call } = activate({ steps: [{ kind: 'final', text: 'ok' }] });
    let failure: unknown;
    try {
      await call({ utteranceId: 42, secret: 'secret-utterance-value' });
    } catch (error: unknown) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(SCRIPTED_ASR_ERROR_INPUT);
    expect(JSON.stringify(handle.calls)).not.toContain('secret-utterance-value');
    expect(JSON.stringify(handle.calls)).not.toContain('42');
  });
});

describe('scripted ASR fixture source constraints', () => {
  const source = readFileSync(new URL('./scripted-asr.ts', import.meta.url), 'utf8');

  it('does not import Cordis, Electron, Node I/O, workers or network modules', () => {
    for (const forbidden of [
      '@deepseek-ai/cordis',
      'electron',
      'node:child_process',
      'node:fs',
      'node:net',
      'node:http',
      'node:worker_threads',
      'node:crypto',
    ])
      expect(source).not.toContain(forbidden);
  });

  it('installs no real timer and no microphone/model/file access', () => {
    expect(source).not.toMatch(/\bsetTimeout\b/);
    expect(source).not.toMatch(/\bsetInterval\b/);
    expect(source).not.toMatch(/\bsetImmediate\b/);
    expect(source).not.toMatch(/\bDate\.now\b/);
    expect(source).not.toMatch(/navigator\.mediaDevices/);
    expect(source).not.toMatch(/\bWebSocket\b/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
  });
});
