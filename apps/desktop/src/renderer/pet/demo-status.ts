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

import { PET_COPY } from './copy.js';

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

/** 阶段的一句话说明，措辞与设置台一致，不给桌宠再造一套词。 */
const PHASE_LABEL: Readonly<Record<DemoPhase, string>> = {
  setup: '还没准备好',
  idle: '空闲',
  preparing: '正在准备',
  arming: '正在开启录音',
  recording: '正在录音',
  recognizing: '正在识别',
  thinking: '正在生成回复',
  responding: '正在回复',
  saving: '正在保存记录',
  stopping: '正在停止',
  error: '出错',
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
  /** 已经读到宿主快照，真实阶段与文本可以覆盖窗口原型的模拟。 */
  live: boolean;
  /** 角色状态；null 表示沿用窗口原型自己的状态。 */
  state: PetState | null;
  /** 气泡文案；null 表示沿用各状态的模拟文案。 */
  bubble: string | null;
  title: string;
  /** 面板里的说明行；未连上宿主时说清为什么还是模拟。 */
  lines: readonly string[];
  canStop: boolean;
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
function replyBubble(mode: DemoReplyMode | null, text: string): string {
  const clipped = clipBubbleText(text, 'head');
  return mode === 'demo' ? `${PET_COPY.demo.replyTag}${clipped}` : clipped;
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
    return `${PET_COPY.demo.errorPrefix}${errorMessage(snapshot.error)}`;
  }
  const transcript = snapshot.partialTranscript.trim();
  if (transcript !== '') return clipBubbleText(transcript, 'tail');
  const reply = snapshot.partialReply.trim();
  if (reply !== '') return replyBubble(snapshot.settings.replyMode, reply);
  const last = lastAssistantReply(snapshot);
  if (last !== null) return replyBubble(last.mode, last.text);
  return PET_COPY.demo.bubbles[phaseToPetState(snapshot.phase)];
}

export function replyModeLabel(mode: DemoReplyMode | null): string {
  if (mode === null) return PET_COPY.demo.sourceUnset;
  return PET_COPY.demo.replyModes[mode];
}

/** 阶段与回复来源各一句；宿主没启用角色形象时补一句，不冒充已启用。 */
export function demoStatusLines(snapshot: DemoSnapshot): readonly string[] {
  const lines = [
    `${PET_COPY.demo.phasePrefix}${PHASE_LABEL[snapshot.phase]}`,
    `${PET_COPY.demo.sourcePrefix}${replyModeLabel(snapshot.settings.replyMode)}`,
  ];
  if (!snapshot.avatarEnabled) lines.push(PET_COPY.demo.avatarOff);
  return lines;
}

/**
 * 快照是唯一事实来源。连不上或还没读到快照时继续显示窗口原型的模拟，
 * 但必须说明原因——不把模拟当成真实状态，也不编造录音、识别或回复。
 */
export function describeDemo(snapshot: DemoSnapshot | null, connected: boolean): DemoStatus {
  if (snapshot === null) {
    return {
      live: false,
      state: null,
      bubble: null,
      title: PET_COPY.panelTitle,
      lines: [connected ? PET_COPY.demo.reading : PET_COPY.demo.disconnected],
      canStop: false,
    };
  }
  return {
    live: true,
    state: phaseToPetState(snapshot.phase),
    bubble: demoBubbleText(snapshot),
    title: PET_COPY.demo.panelTitle,
    lines: demoStatusLines(snapshot),
    canStop: STOPPABLE.has(snapshot.phase),
  };
}
