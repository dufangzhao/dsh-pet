import type {
  CapabilityCallContext,
  CapabilityMethods,
  PluginModule,
  PluginRuntimeContext,
} from '@pet/host-kernel';
import type { JsonValue } from '@pet/contracts';

import { PROVIDER_ACTIVATE, PROVIDER_DISPOSE } from './markers.js';
import type { FixtureHandle } from './plugins.js';

/**
 * M1-08 脚本化 ASR 参考插件（fixture-only）。
 *
 * 目的：给「宿主通用内核」提供一条可控的识别链路，用来验证任务取消、晚到结果
 * 丢弃、提供方停用与世代失效。它**不是** M3 生产 ASR 协议，也不冻结任何生产
 * 字段；能力名刻意留在 `test.` 域下。
 *
 * 约束（与 doc22「测试夹具接口」一致）：
 * - 只依赖 `@pet/host-kernel` 的纯类型与 `@pet/contracts` 的 JSON 类型；
 *   运行时不导入 Cordis、Electron、Node I/O、worker 或网络模块；
 * - 不碰麦克风、模型、文件、真实定时器、网络与 worker：等待点一律由调用方
 *   显式放行的 `ScriptedAsrGate` 表达；
 * - 输入/输出只走公开 JSON：调用方给 `{ utteranceId }`，夹具回
 *   `{ transcript, events, utteranceId? }`；夹具不读调用方的其他字段，也不
 *   改写调用方传入的对象；
 * - 事件与异常只含本文件里的固定标记，绝不回显调用方数据。
 */

/** Fixture-only 能力名；不进入 `MVP_CAPABILITIES`，也不代表生产 ASR 契约。 */
export const SCRIPTED_ASR_CAPABILITY = 'test.scriptedAsr@1';

/** 提供方本地 id，与宿主 `provides[].id` 对应。 */
export const SCRIPTED_ASR_PROVIDER_ID = 'main';

/** 唯一方法名；与 `speech.asr@1` 的草案方法名保持一致，但语义只属于本夹具。 */
export const SCRIPTED_ASR_METHOD = 'recognize';

/** 脚本进度标记（固定公开字面量，不含调用方内容）。 */
export const SCRIPTED_ASR_CALL_BEGIN = 'asr:call:begin';
export const SCRIPTED_ASR_STEP_PARTIAL = 'asr:step:partial';
export const SCRIPTED_ASR_STEP_FINAL = 'asr:step:final';
export const SCRIPTED_ASR_GATE_WAIT = 'asr:gate:wait';
export const SCRIPTED_ASR_GATE_SETTLED = 'asr:gate:settled';
export const SCRIPTED_ASR_CALL_ABORTED = 'asr:call:aborted';
export const SCRIPTED_ASR_CALL_RETURN = 'asr:call:return';
export const SCRIPTED_ASR_CALL_LATE_RETURN = 'asr:call:late-return';
export const SCRIPTED_ASR_CALL_FAIL = 'asr:call:fail';
export const SCRIPTED_ASR_CANCEL_IGNORED = 'asr:cancel:ignored';

/** 合法输入被拒绝时的固定异常消息（不含任何输入内容）。 */
export const SCRIPTED_ASR_ERROR_INPUT = 'contract-tests fixture: scripted ASR input rejected';

/** 正常模式观察到取消时的固定异常消息（不含任何输入内容）。 */
export const SCRIPTED_ASR_ERROR_CANCELLED = 'contract-tests fixture: scripted ASR cancelled';

/**
 * 可控 deferred gate：夹具唯一的等待点。
 *
 * 它只是一个未 settle 的 Promise，没有定时器、没有轮询；由测试调用
 * `settle()` 放行，用来把「取消后工作仍然挂着」和「gate 真正结束」分开观察。
 */
export interface ScriptedAsrGate {
  readonly label: string;
  readonly promise: Promise<void>;
  readonly settled: boolean;
  /** 放行当前 gate；可重复调用，后续调用为空操作。 */
  settle(): void;
}

/** 新建一个未放行的 gate。 */
export function makeScriptedAsrGate(label: string): ScriptedAsrGate {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  let done = false;
  return {
    label,
    promise,
    get settled(): boolean {
      return done;
    },
    settle(): void {
      if (done) return;
      done = true;
      release();
    },
  };
}

/** 一条脚本步骤：临时文本、最终文本，或一个由测试放行的 gate。 */
export type ScriptedAsrStep =
  | { kind: 'partial'; text: string }
  | { kind: 'final'; text: string }
  | { kind: 'gate'; gate: ScriptedAsrGate };

/** 夹具剧本。 */
export type ScriptedAsrScript = {
  steps: ScriptedAsrStep[];
  /**
   * 坏模式开关：为 `true` 时完全忽略 `task.signal`，把整段剧本跑完并返回固定
   * 脚本文本。用于验证宿主（而不是夹具）丢弃晚到结果。
   */
  ignoreCancellation?: boolean;
  /** 固定脚本文本；缺省取最后一条文本步骤的文本。 */
  finalText?: string;
};

/** 输出里的一条转录事件；这是夹具自己的 JSON 信封，不是生产 TranscriptEvent。 */
export type ScriptedAsrTranscriptEvent = {
  type: 'partial' | 'final';
  text: string;
};

/** 夹具输出：公开 JSON，可被宿主 preflight 复制。 */
export type ScriptedAsrOutput = {
  transcript: string;
  events: ScriptedAsrTranscriptEvent[];
  utteranceId?: string;
};

/** 单次调用的可观测记录（只在内存里，不跨 JSON 边界）。 */
export type ScriptedAsrCall = {
  taskId: string;
  utteranceId: string | null;
  /** 夹具实际产出的转录事件，按顺序。 */
  emitted: ScriptedAsrTranscriptEvent[];
  /** 调用退出时 `task.signal` 的状态。 */
  abortedAtExit: boolean;
  /** 返回的固定脚本文本；抛错时为 `null`。 */
  returnedTranscript: string | null;
  /** 抛错时的固定公开标记；成功时为 `null`。 */
  failure: string | null;
};

/** 夹具句柄：模块本体 + 事件日志 + 调用记录。 */
export interface ScriptedAsrHandle extends FixtureHandle {
  readonly script: Readonly<ScriptedAsrScript>;
  readonly calls: readonly ScriptedAsrCall[];
}

/** 合法输入的最小读取结果。 */
type ScriptedAsrInput = { utteranceId: string | null };

/**
 * 只读取公开 JSON 输入里的 `utteranceId`。
 *
 * 不是对象、是数组或 `utteranceId` 不是字符串时返回 `null`（由调用方按固定
 * 异常拒绝）；其余字段一概不读，也不会被复制进输出。
 */
function readScriptedAsrInput(input: JsonValue): ScriptedAsrInput | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = input['utteranceId'];
  if (value === undefined) return { utteranceId: null };
  return typeof value === 'string' ? { utteranceId: value } : null;
}

/** 固定脚本文本：显式配置优先，否则取最后一条文本步骤。 */
function resolveFinalText(script: ScriptedAsrScript): string {
  if (script.finalText !== undefined) return script.finalText;
  let text = '';
  for (const step of script.steps) if (step.kind !== 'gate') text = step.text;
  return text;
}

/**
 * 构造脚本化 ASR 参考插件。
 *
 * 正常模式（`ignoreCancellation` 不为 `true`）：在每个步骤边界和 gate 结束后
 * 检查 `task.signal`；已取消就抛出固定异常，不再产出任何文本。注意它**不会**
 * 提前放弃一个已经进入的 gate——gate 代表不可撤回的在途等待，所以宿主的
 * `workPending` 会一直保持到 gate 真正 settle。
 *
 * 坏模式：忽略 signal，跑完整段剧本并返回固定脚本文本；晚到值是否交付由宿主
 * 决定，夹具只负责如实记录自己确实返回了。
 */
export function makeScriptedAsrPlugin(script: ScriptedAsrScript): ScriptedAsrHandle {
  const events: string[] = [];
  const calls: ScriptedAsrCall[] = [];
  const finalText = resolveFinalText(script);

  const recognize = async (call: CapabilityCallContext, input: JsonValue): Promise<JsonValue> => {
    events.push(SCRIPTED_ASR_CALL_BEGIN);
    const parsed = readScriptedAsrInput(input);
    const record: ScriptedAsrCall = {
      taskId: call.taskId,
      utteranceId: parsed === null ? null : parsed.utteranceId,
      emitted: [],
      abortedAtExit: false,
      returnedTranscript: null,
      failure: null,
    };
    calls.push(record);

    if (parsed === null) {
      record.failure = SCRIPTED_ASR_ERROR_INPUT;
      events.push(SCRIPTED_ASR_CALL_FAIL);
      throw new Error(SCRIPTED_ASR_ERROR_INPUT);
    }

    const observeAbort = (): void => {
      if (script.ignoreCancellation === true || !call.signal.aborted) return;
      record.abortedAtExit = true;
      record.failure = SCRIPTED_ASR_ERROR_CANCELLED;
      events.push(SCRIPTED_ASR_CALL_ABORTED);
      events.push(SCRIPTED_ASR_CALL_FAIL);
      throw new Error(SCRIPTED_ASR_ERROR_CANCELLED);
    };

    for (const step of script.steps) {
      observeAbort();
      if (step.kind === 'gate') {
        events.push(SCRIPTED_ASR_GATE_WAIT);
        await step.gate.promise;
        events.push(SCRIPTED_ASR_GATE_SETTLED);
        observeAbort();
        continue;
      }
      record.emitted.push({ type: step.kind, text: step.text });
      events.push(step.kind === 'partial' ? SCRIPTED_ASR_STEP_PARTIAL : SCRIPTED_ASR_STEP_FINAL);
    }

    record.abortedAtExit = call.signal.aborted;
    if (script.ignoreCancellation === true && call.signal.aborted)
      events.push(SCRIPTED_ASR_CANCEL_IGNORED);
    record.returnedTranscript = finalText;
    events.push(call.signal.aborted ? SCRIPTED_ASR_CALL_LATE_RETURN : SCRIPTED_ASR_CALL_RETURN);

    const output: ScriptedAsrOutput = {
      transcript: finalText,
      events: record.emitted.map((event) => ({ type: event.type, text: event.text })),
      ...(parsed.utteranceId === null ? {} : { utteranceId: parsed.utteranceId }),
    };
    return output;
  };

  const methods: CapabilityMethods = { [SCRIPTED_ASR_METHOD]: recognize };
  const module: PluginModule = {
    activate(context: PluginRuntimeContext): void {
      context.provide(SCRIPTED_ASR_PROVIDER_ID, methods);
      context.effect(() => {
        events.push(PROVIDER_ACTIVATE);
        return () => {
          events.push(PROVIDER_DISPOSE);
        };
      });
    },
  };

  return { module, events, calls, script };
}
