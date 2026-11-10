/**
 * 语音输入的 owner 规则（纯函数，不依赖 React，web 与桌面共用）。
 *
 * 这里只决定「现在处于什么状态、能不能开始、结束之后要做什么」，
 * 不碰设备、不碰 HTTP：那些在采样器与调用方手里。
 *
 * 三条不变量：
 * - 一次采集只有一个 intent，取消之后它的转写结果不能再提交；
 * - `finish` 与 `cancel` 是两件事，任何一边失败都不能变成另一边成功；
 * - 转写结果按票据里的 `finishMode` 决定直接发送还是进预览。
 */
import {
  errorMessage,
  type KernelError,
  type VoiceCaptureResult,
  type VoiceFinishMode,
  type VoiceFinal,
  type VoiceReason,
  type VoiceView,
} from '@pet/contracts';

/** 界面能看到的阶段。它比 Main 的 phase 多出「本地的预览与提交」。 */
export type VoicePhase =
  | 'idle'
  | 'arming'
  | 'recording'
  | 'finishing'
  | 'transcribing'
  | 'review'
  | 'submitting'
  /** 设备还没有确认放开：不能再开始，也不算干净。 */
  | 'retiring'
  | 'error';

/** 这次采集的 intent：一开始就固定，中途不改。 */
export interface VoiceIntent {
  readonly captureId: string;
  readonly clientId: string;
  readonly agentId: string;
  readonly serviceEpoch: string;
  readonly finishMode: VoiceFinishMode;
  /**
   * 发起这一帧渲染时捕获的目标（web 是 Agent，桌面是 connectionId）。
   * 它只用于本地换代判定：换目标后旧 intent 不再属于当前界面。
   */
  readonly targetKey: string;
}

export interface VoiceState {
  readonly phase: VoicePhase;
  /** 当前 intent；没有采集时是 null。 */
  readonly intent: VoiceIntent | null;
  /** 预览里的可编辑转写；只有 review 模式会用到。 */
  readonly preview: string | null;
  /** 已经提交、等待回执的那条消息的 commandId。 */
  readonly submitting: string | null;
  readonly error: KernelError | null;
  /** 一次性的说明（例如「没有识别到语音」）。 */
  readonly notice: string | null;
  /**
   * 设备是否已经**确认**放开。
   *
   * 它是独立于 phase 的事实：取消之后 phase 可能已经回到 idle，但宿主还没确认
   * 释放时不允许开始下一次采集。失败也不伪装成 settled。
   */
  readonly release: 'settled' | 'pending' | 'failed';
}

export const emptyVoiceState: VoiceState = {
  phase: 'idle',
  intent: null,
  preview: null,
  submitting: null,
  error: null,
  notice: null,
  release: 'settled',
};

/** 能不能开始一次新的采集：没有在途的采集、服务可用。 */
export function canStart(
  state: VoiceState,
  view: VoiceView | null,
  live: boolean,
): { readonly ok: boolean; readonly reason: string | null } {
  if (!live) return { ok: false, reason: '当前未连接服务。' };
  if (state.phase !== 'idle' && state.phase !== 'error')
    return { ok: false, reason: '这一次还没结束。' };
  // 释放没确认就不开第二次：宁可说清楚，也不让两路设备叠在一起。
  if (state.release !== 'settled')
    return {
      ok: false,
      reason:
        state.release === 'pending'
          ? '上一次采集还没有确认释放。'
          : '上一次采集的设备没有确认放开，请重试或重启。',
    };
  if (view === null) return { ok: false, reason: '正在读取语音设置。' };
  if (view.feature.source !== 'ready')
    return { ok: false, reason: readinessReason(view) ?? '语音输入当前不可用。' };
  const provider = view.providers.find((item) => item.providerRef === view.feature.providerRef);
  if (provider === undefined) return { ok: false, reason: '还没有选择转写提供者。' };
  if (provider.readiness === 'configured') return { ok: true, reason: null };
  return { ok: false, reason: readinessReason(view) ?? '转写提供者还没有配置好。' };
}

/** 提供者/功能的可读原因。unsupported 与未配置必须区分。 */
export function readinessReason(view: VoiceView): string | null {
  const provider = view.providers.find((item) => item.providerRef === view.feature.providerRef);
  const reason: VoiceReason | null = provider?.reason ?? null;
  switch (reason) {
    case 'feature-disabled':
      return '语音输入已停用。';
    case 'provider-disabled':
      return '这个转写提供者已停用。';
    case 'source-unavailable':
      return '语音组件当前不可用。';
    case 'model-unconfigured':
      return '还没有选择转写模型。';
    case 'key-required':
      return '这个转写提供者需要密钥。';
    case 'unsupported-protocol':
      return '这个模型不支持语音协议。';
    case 'cleanup-pending':
      return '上一次采集还在收尾。';
    default:
      return null;
  }
}

/** 开始采集：进入 arming，intent 固定下来。 */
export function beginIntent(state: VoiceState, intent: VoiceIntent): VoiceState {
  return {
    ...state,
    phase: 'arming',
    intent,
    preview: null,
    submitting: null,
    error: null,
    notice: null,
  };
}

/** 设备就绪、开始出帧。 */
export function markRecording(state: VoiceState): VoiceState {
  if (state.phase !== 'arming') return state;
  return { ...state, phase: 'recording' };
}

/** 开始收尾（停设备、冲刷尾巴、等转写）。 */
export function markFinishing(state: VoiceState): VoiceState {
  if (state.intent === null) return state;
  return { ...state, phase: 'finishing' };
}

/** 转写中。 */
export function markTranscribing(state: VoiceState): VoiceState {
  if (state.intent === null) return state;
  return { ...state, phase: 'transcribing' };
}

/** 取消：回到 idle，不留任何 intent 或预览。调用方只在释放确认后用它。 */
export function markCancelled(): VoiceState {
  return { ...emptyVoiceState, notice: null };
}

/**
 * 正在等设备真的放开。
 *
 * 这个阶段既不是 idle 也不是 error：取消已经发生，但释放还没结算。让它停在
 * `retiring` 而不是立刻回到 idle，`canStart` 才不会在设备仍活着时放行第二次采集。
 */
export function markRetiring(state: VoiceState, notice: string | null): VoiceState {
  return { ...state, phase: 'retiring', intent: null, notice, error: null, release: 'pending' };
}

/** 宿主确认释放：此后才允许下一次采集。 */
export function markReleased(): VoiceState {
  return { ...emptyVoiceState, release: 'settled' };
}

/** 释放没有被确认：保留真实状态，不冒充干净，也不放行新采集。 */
export function markReleaseFailed(
  state: VoiceState,
  error: KernelError | null,
  text: string,
): VoiceState {
  return { ...state, phase: 'error', intent: null, error, notice: text, release: 'failed' };
}

/** 采集失败：保留原因，允许重来。 */
export function markFailed(state: VoiceState, error: KernelError | null, text: string): VoiceState {
  return { ...state, phase: 'error', intent: null, error, notice: text };
}

export interface FinishPlan {
  /** `send` 直接提交，`review` 进预览。 */
  readonly mode: VoiceFinishMode;
  /** 最终文本；`no-speech` 时为 null。 */
  readonly text: string | null;
  readonly notice: string | null;
}

/**
 * 转写结果怎么落地。
 *
 * 空结果不是「发一条空消息」：它是 `no-speech`，必须如实说出来。
 * 有文本时按票据里的模式走，模式在开始时已经固定，不在这里改。
 */
export function planFinish(result: VoiceCaptureResult): FinishPlan {
  const mode = result.ticket.finishMode;
  if (result.phase === 'failed')
    return { mode, text: null, notice: errorText(result.error) ?? '转写失败了。' };
  if (result.phase === 'cancelled') return { mode, text: null, notice: '这次语音输入已取消。' };
  const final: VoiceFinal | null = result.outcome;
  if (final === null) {
    // 没有结论（例如还在 transcribing）：不提交，也不假装完成。
    return { mode, text: null, notice: '还没有转写结果。' };
  }
  if (final.kind === 'no-speech') {
    return { mode, text: null, notice: '没有识别到语音。' };
  }
  const text = final.text.trim();
  if (text === '') return { mode, text: null, notice: '没有识别到语音。' };
  return { mode, text, notice: null };
}

/** 进预览：文本可编辑，尚未提交。 */
export function showPreview(state: VoiceState, text: string): VoiceState {
  return { ...state, phase: 'review', preview: text, intent: state.intent, error: null };
}

/** 预览被编辑：只改本地文本，不推进任何版本。 */
export function editPreview(state: VoiceState, text: string): VoiceState {
  if (state.phase !== 'review') return state;
  return { ...state, preview: text, submitting: null };
}

/** 开始提交（已有一个固定的 commandId）。 */
export function markSubmitting(state: VoiceState, commandId: string): VoiceState {
  return { ...state, phase: 'submitting', submitting: commandId, error: null };
}

/** 提交成功：回到 idle，清掉 intent 与预览。 */
export function markSubmitted(): VoiceState {
  return { ...emptyVoiceState };
}

/** 提交结果未知：保留文本与同一个 commandId，供原样重试。 */
export function markUncertain(state: VoiceState, text: string): VoiceState {
  return {
    ...state,
    phase: 'review',
    preview: text,
    error: null,
    notice: '结果未知。重试会复用同一次提交，不会重复发送。',
  };
}

/**
 * 真正的准入被挡住（离线/目标过期/待确认已满）：一个字节都没发出去。
 *
 * 这里不是「未知」：文本留在预览里，同一 commandId 可以原样再发，
 * 不排队、不自动重试，也不覆盖别处的草稿。
 */
export function markRetained(
  state: VoiceState,
  text: string,
  commandId: string | null,
  notice: string,
): VoiceState {
  return {
    ...state,
    phase: 'review',
    preview: text,
    submitting: commandId,
    error: null,
    notice,
  };
}

/** 一次采集是否还属于当前目标与当前 intent。 */
export function stillOurs(state: VoiceState, targetKey: string | null): boolean {
  if (state.intent === null) return false;
  if (targetKey === null) return false;
  return state.intent.targetKey === targetKey;
}

/** 界面上那句「这次会发送还是先看一遍」。 */
export function finishModeLabel(mode: VoiceFinishMode): string {
  return mode === 'send' ? '结束后直接发送' : '结束后先预览';
}

/** 20 秒上限的明示文案：必须在录音开始前就能读到。 */
export function captureLimitHint(mode: VoiceFinishMode): string {
  return mode === 'send'
    ? '最多录 20 秒，到时自动结束并发送。'
    : '最多录 20 秒，到时自动结束并进入预览。';
}

/** 失败时的可读文案。 */
export function errorText(error: KernelError | null): string | null {
  return error === null ? null : errorMessage(error);
}
