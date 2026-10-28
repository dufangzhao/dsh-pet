/**
 * 把宿主 Demo 快照翻译成桌宠显示的事实。
 *
 * 只翻译，不推测：宿主说 responding 就是正在回复，桌宠不替它算进度，也不补任何文本。
 * 桌宠侧不录音、不申请麦克风、不读写 Key，所以快照里那些字段在这里都不出现。
 */
import {
  errorMessage,
  type DemoMessage,
  type DemoPhase,
  type DemoReplyMode,
  type DemoSnapshot,
  type PetState,
} from '@pet/contracts';

import { PET_COPY, stateBubble } from './copy.js';

/** 阶段 → 角色状态：录音是倾听，准备/识别/思考是思考，回复是回答，出错是出错，其余待机。 */
const PHASE_STATE: Readonly<Record<DemoPhase, PetState>> = {
  setup: 'idle',
  idle: 'idle',
  preparing: 'thinking',
  arming: 'thinking',
  recording: 'listening',
  recognizing: 'thinking',
  thinking: 'thinking',
  responding: 'replying',
  saving: 'idle',
  stopping: 'idle',
  error: 'error',
};

/** 还能被停止打断的阶段：空闲、收尾与出错时没有可停的事情。 */
const STOPPABLE: ReadonlySet<DemoPhase> = new Set([
  'preparing',
  'arming',
  'recording',
  'recognizing',
  'thinking',
  'responding',
  'saving',
]);

/**
 * 气泡最多显示这么多字：窗口大小、命中区与拖拽都不变，只能截断长文本。
 * 正在识别的文本看最新的尾巴，回复看开头，两种都标注省略号。
 */
export const BUBBLE_TEXT_LIMIT = 56;

export interface DemoStatus {
  /** 已经读到宿主快照，真实阶段与文本可以覆盖窗口原型自己的状态。 */
  live: boolean;
  /** 角色状态；null 表示沿用窗口原型自己的状态。 */
  state: PetState | null;
  /** 气泡文案；null 表示还没有可读内容，按状态给一句话。 */
  bubble: string | null;
  canStop: boolean;
  /** 宿主此刻是否接受 sendText；没读到快照就是 false，不猜。 */
  canSend: boolean;
}

export function phaseToPetState(phase: DemoPhase): PetState {
  return PHASE_STATE[phase];
}

export function clipBubbleText(text: string, keep: 'head' | 'tail'): string {
  if (text.length <= BUBBLE_TEXT_LIMIT) return text;
  return keep === 'tail'
    ? `…${text.slice(text.length - BUBBLE_TEXT_LIMIT)}`
    : `${text.slice(0, BUBBLE_TEXT_LIMIT)}…`;
}

/** 演示脚本给出的回复必须带着标签，不能让人误以为是 AI 说的。 */
export function replyBubble(mode: DemoReplyMode | null, text: string): string {
  const clipped = clipBubbleText(text, 'head');
  return mode === 'demo' ? `${PET_COPY.replyTag}${clipped}` : clipped;
}

function lastAssistantReply(snapshot: DemoSnapshot): DemoMessage | null {
  for (let index = snapshot.messages.length - 1; index >= 0; index -= 1) {
    const message = snapshot.messages[index];
    if (message !== undefined && message.role === 'assistant') return message;
  }
  return null;
}

/** 气泡：明确错误优先，其次是宿主正在流的文本，再是最近一条回复，最后按状态给一句话。 */
export function demoBubbleText(snapshot: DemoSnapshot): string {
  if (snapshot.error !== null) {
    return `${PET_COPY.errorPrefix}${errorMessage(snapshot.error)}`;
  }
  const transcript = snapshot.partialTranscript.trim();
  if (transcript !== '') return clipBubbleText(transcript, 'tail');
  const reply = snapshot.partialReply.trim();
  if (reply !== '') return replyBubble(snapshot.settings.replyMode, reply);
  const last = lastAssistantReply(snapshot);
  if (last !== null) return replyBubble(last.mode, last.text);
  return stateBubble(phaseToPetState(snapshot.phase));
}

/**
 * 快照是唯一事实来源。没读到快照时不给任何“宿主状态”：
 * 角色回到窗口原型自己的待机，气泡交给状态兜底文案，不伪造录音或回复。
 */
export function describeDemo(snapshot: DemoSnapshot | null): DemoStatus {
  if (snapshot === null) {
    return { live: false, state: null, bubble: null, canStop: false, canSend: false };
  }
  return {
    live: true,
    state: phaseToPetState(snapshot.phase),
    bubble: demoBubbleText(snapshot),
    canStop: STOPPABLE.has(snapshot.phase),
    canSend: snapshot.canSend,
  };
}
