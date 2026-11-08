/**
 * 服务连接与本地呈现的纯推导：只有事实，没有状态机。
 *
 * 界面能看到的每个词都由这里从 DesktopCompanionState 推出来，渲染层不再各算一遍。
 * 断线时非终态一律降级成「未知（上次：…）」——沿用文字客户端 taskStatusView 的判定，
 * 不把上次的 running 当成现在还在跑。
 */
import {
  errorMessage,
  type CompanionMessage,
  type CompanionTask,
  type CompanionTaskStatus,
  type DesktopCompanionPending,
  type DesktopCompanionState,
  type PetState,
} from '@pet/contracts';

export type StatusTone = 'ok' | 'warn' | 'danger' | 'muted' | 'off';

const TERMINAL: ReadonlySet<CompanionTaskStatus> = new Set([
  'completed',
  'cancelled',
  'failed',
  'interrupted',
]);

export function isTerminal(status: CompanionTaskStatus): boolean {
  return TERMINAL.has(status);
}

export function isActive(status: CompanionTaskStatus): boolean {
  return status === 'accepted' || status === 'running' || status === 'cancel-requested';
}

/**
 * 能不能显式提交一次连接目标（新地址 / 同地址换令牌）。
 *
 * 在线时也要允许：服务端连接控制本来就支持在线 retire→newbind，
 * 一刀禁掉 live 会让「换一台服务」只能先断开再连，也挡住了 CAS 那条真实入口。
 * 只排除正在过渡的两个相位，避免和进行中的切换打架。
 */
export function canConnect(state: DesktopCompanionState): boolean {
  return state.source === 'ready' && state.phase !== 'connecting' && state.phase !== 'retiring';
}

/** 已有连接时，这次提交是「更新」而不是「新建」：措辞与按钮据此区分。 */
export function updatesConnection(state: DesktopCompanionState): boolean {
  return state.connectionId !== null;
}

export function canReconnect(state: DesktopCompanionState): boolean {
  return state.connectionId !== null && state.phase === 'offline';
}

export function canDisconnect(state: DesktopCompanionState): boolean {
  return state.connectionId !== null && state.phase !== 'retiring';
}

export function canSend(state: DesktopCompanionState): boolean {
  return state.phase === 'live';
}

export function canStopTask(state: DesktopCompanionState, task: CompanionTask): boolean {
  // 断线时任务状态未知，不提供停止：那会暗示我们知道它还在跑。
  return state.phase === 'live' && isActive(task.status) && pendingStop(state, task.id) === null;
}

export function pendingStop(
  state: DesktopCompanionState,
  taskId: string,
): DesktopCompanionPending | null {
  return state.pending.find((entry) => entry.kind === 'stop' && entry.taskId === taskId) ?? null;
}

/** 连接本身的一行事实：语气、短句、以及需要补一句的说明。 */
export interface ConnectionView {
  readonly tone: StatusTone;
  readonly label: string;
  readonly detail: string | null;
}

const PHASE_LABEL: Readonly<Record<DesktopCompanionState['phase'], string>> = {
  idle: '未连接',
  connecting: '正在连接',
  live: '已连接',
  offline: '连接已断开',
  retiring: '正在断开',
};

export function connectionView(state: DesktopCompanionState): ConnectionView {
  if (state.source === 'disabled')
    return {
      tone: 'off',
      label: '连接组件已停用',
      detail: '在插件页恢复后才能重新连接；服务里的对话与任务不受影响。',
    };
  if (state.source === 'unavailable')
    return { tone: 'danger', label: '连接组件不可用', detail: '这台机器上的连接组件没有就绪。' };
  const tone: StatusTone =
    state.phase === 'live'
      ? 'ok'
      : state.phase === 'offline'
        ? 'danger'
        : state.phase === 'idle'
          ? 'muted'
          : 'warn';
  const detail =
    state.phase === 'offline'
      ? '当前状态未知，下面是上次确认的内容。'
      : state.phase === 'connecting'
        ? `正在连接 ${hostOf(state.baseUrl)}…`
        : null;
  return { tone, label: PHASE_LABEL[state.phase], detail };
}

export function hostOf(baseUrl: string): string {
  if (baseUrl === '') return '服务';
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

/** 最后确认时间；没有确认过就是 null，界面据此不写「刚刚」。 */
export function confirmedLabel(state: DesktopCompanionState): string | null {
  return state.confirmedAt === null ? null : clockTime(state.confirmedAt);
}

const timeFormat = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function clockTime(timestamp: number): string {
  return timeFormat.format(timestamp);
}

export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const STATUS_LABEL: Readonly<Record<CompanionTaskStatus, string>> = {
  accepted: '已受理',
  running: '运行中',
  'cancel-requested': '停止请求已发送',
  completed: '已完成',
  cancelled: '已取消',
  failed: '失败',
  interrupted: '已中断',
  unknown: '状态未知',
};

const STATUS_TONE: Readonly<Record<CompanionTaskStatus, StatusTone>> = {
  accepted: 'muted',
  running: 'muted',
  'cancel-requested': 'warn',
  completed: 'ok',
  cancelled: 'off',
  failed: 'danger',
  interrupted: 'danger',
  unknown: 'warn',
};

export interface TaskView {
  readonly label: string;
  readonly tone: StatusTone;
  /** 断线后的非终态：只代表最后一次确认，不是当前真相。 */
  readonly stale: boolean;
}

export function taskView(task: CompanionTask, state: DesktopCompanionState): TaskView {
  if (state.phase !== 'live' && isActive(task.status))
    return { label: `状态未知（上次：${STATUS_LABEL[task.status]}）`, tone: 'warn', stale: true };
  const stop = pendingStop(state, task.id);
  if (state.phase === 'live' && isActive(task.status) && stop !== null)
    return { label: '停止请求已发送', tone: 'warn', stale: false };
  return { label: STATUS_LABEL[task.status], tone: STATUS_TONE[task.status], stale: false };
}

/** 角色此刻在做什么：只从服务事实推，推不出来就是待机。 */
export function petStateOf(state: DesktopCompanionState): PetState {
  if (state.phase === 'connecting' || state.phase === 'retiring') return 'thinking';
  const snapshot = state.snapshot;
  if (snapshot === null) return state.error === null ? 'idle' : 'error';
  if (state.pending.some((entry) => entry.status !== 'accepted')) return 'thinking';
  if (snapshot.agent.status === 'busy') return 'thinking';
  if (lastAssistant(snapshot.messages) !== null && state.phase === 'live') return 'replying';
  if (state.phase === 'offline') return 'error';
  return 'idle';
}

export function lastAssistant(messages: readonly CompanionMessage[]): CompanionMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message !== undefined && message.role === 'assistant') return message;
  }
  return null;
}

/** 模式与可用性合成一句：脚本演示必须标出来，模型不可用不许说成插件没装。 */
export function agentModeLabel(agent: {
  mode: 'scripted' | 'model';
  status: 'ready' | 'busy' | 'unavailable';
}): string {
  if (agent.mode === 'scripted') return '脚本演示，未调用模型';
  if (agent.status === 'unavailable') return '模型回复 · 当前不可用';
  return '模型回复';
}

/** 发送被拒或结果未知时给用户的一句话。 */
export function sendBlockedReason(state: DesktopCompanionState): string | null {
  if (state.phase === 'live') {
    const snapshot = state.snapshot;
    if (
      snapshot !== null &&
      snapshot.agent.mode === 'model' &&
      snapshot.agent.status === 'unavailable'
    )
      return '模型当前不可用，检查连接后再发。';
    return null;
  }
  return state.phase === 'connecting'
    ? '正在连接，先等这一步完成。'
    : '连接断开时不能发送，先重新连接。';
}

/**
 * 一次动作的结果还算不算数：只认同一个已采用状态里的最新 connectionId。
 *
 * `latest` 是「已采用的最高 revision」，不是刚读到的那一份。确认读取失败、
 * 返回 null、或返回更旧的 revision 都不会让它前进，所以「没读到」不能当成
 * 「目标没变」放行——那正是旧结果污染新目标的入口。
 */
export type TargetSettlement = 'current' | 'stale';

/**
 * 一次动作的结果还算不算数：只认同一个已采纳状态里的最新 connectionId。
 *
 * 这是**栅栏**，不是调度器：它只回答「这次结果属于当前目标吗」，
 * 从不把一次旧渲染发起的动作改投到新目标上——那是调用方的事。
 *
 * 已采纳状态里目标已知不同 → stale（旧读、失败、抛错都一样）。
 * 目标相同 → current：回执是否成功由调用方看 `ok`；不会因为多一次
 * getState 抖动就把确知受理的提交改判成「可能没送达」。
 */
export function settleTarget(
  latest: DesktopCompanionState | null,
  target: string | null,
): TargetSettlement {
  // 连接类动作（connect）没有既有目标：只要没被换代打断就算数。
  if (target === null) return 'current';
  if (latest === null) return 'stale';
  return latest.connectionId === target ? 'current' : 'stale';
}

export function endpointBaseline(draftBaseline: number | null, latest: number): number {
  return draftBaseline ?? latest;
}

/**
 * 一次成功写入之后，草稿基线该前进到哪里。
 *
 * 只认这次 connect 真正落下的版本。猜「旧版本+1」会在并发写入时算错，
 * 拿「最新视图」则会把别人同时做的更新一起抹掉——两者都会让下一次
 * 提交悄悄覆盖掉那次更新。
 */
export function rebaseOnConnect(
  writtenRevision: number | null,
  previous: number | null,
): number | null {
  return writtenRevision ?? previous;
}

/**
 * 草稿基线落后于当前 Config：别处改过，草稿不再是最新那一版的输入。
 *
 * `selfPending` 是自己这次提交还在途。Main 会先把新 Config publish 出来，
 * 那时基线落后是本次写入的中间态，报成「别处改过」是假提示。
 * settle 之后基线已跟到 committed 版本，这时再比，外部改动照旧被识别。
 */
export function endpointMoved(
  draftBaseline: number | null,
  latest: number,
  selfPending: boolean,
): boolean {
  return !selfPending && draftBaseline !== null && draftBaseline !== latest;
}

export function errorText(error: { code: string; messageKey: string } | null): string | null {
  return error === null ? null : errorMessage(error as Parameters<typeof errorMessage>[0]);
}

/** 气泡最多显示这么多字：窗口大小与命中区不变，只能截断长文本。 */
export const BUBBLE_TEXT_LIMIT = 56;

export function clipBubbleText(text: string): string {
  return text.length <= BUBBLE_TEXT_LIMIT ? text : `${text.slice(0, BUBBLE_TEXT_LIMIT)}…`;
}
