/**
 * 客户端状态机。
 *
 * 只保存服务端确认过的事实：snapshot 是最后一次成功读取的投影，断线后原样保留，
 * 但任何非终态都改标为「未知」，不把上次的 running 当成当前真相。
 * 本地只有两种未确认意图：待发消息与停止请求，它们都带着可复用的 commandId。
 */
import {
  errorMessage,
  type CompanionSnapshot,
  type CompanionTask,
  type CompanionTaskStatus,
  type KernelError,
} from '@pet/contracts';

export type ConnectionPhase = 'idle' | 'connecting' | 'live' | 'offline';

export interface OutgoingMessage {
  readonly commandId: string;
  readonly text: string;
  /** 结果不明：可能已被接受，重试必须复用同一个 commandId。 */
  readonly uncertain: boolean;
}

export interface StopIntent {
  readonly commandId: string;
  readonly uncertain: boolean;
}

export interface ClientState {
  readonly phase: ConnectionPhase;
  readonly error: KernelError | null;
  /** 服务端协议版本与本地不一致时记录它，用来给出可操作的说明。 */
  readonly protocolMismatch: number | null;
  readonly snapshot: CompanionSnapshot | null;
  readonly confirmedAt: number | null;
  readonly outbox: readonly OutgoingMessage[];
  readonly stops: Readonly<Record<string, StopIntent>>;
  readonly notice: string | null;
}

export const initialClientState: ClientState = {
  phase: 'idle',
  error: null,
  protocolMismatch: null,
  snapshot: null,
  confirmedAt: null,
  outbox: [],
  stops: {},
  notice: null,
};

export type ClientAction =
  | { type: 'connect' }
  | { type: 'snapshot'; snapshot: CompanionSnapshot; at: number }
  | { type: 'offline'; error: KernelError; protocolMismatch?: number | undefined }
  | { type: 'disconnect' }
  | { type: 'outbox-add'; entry: OutgoingMessage }
  | { type: 'outbox-accepted'; commandId: string }
  | { type: 'outbox-uncertain'; commandId: string }
  | { type: 'outbox-failed'; commandId: string; error: KernelError }
  | { type: 'stop-add'; taskId: string; intent: StopIntent }
  | { type: 'stop-accepted'; taskId: string }
  | { type: 'stop-uncertain'; taskId: string }
  | { type: 'stop-failed'; taskId: string; error: KernelError }
  | { type: 'notice'; notice: string | null };

export function reduce(state: ClientState, action: ClientAction): ClientState {
  switch (action.type) {
    case 'connect':
      return { ...state, phase: 'connecting', error: null, protocolMismatch: null, notice: null };
    case 'snapshot': {
      const snapshot = action.snapshot;
      const seen = new Set(
        snapshot.messages
          .map((message) => message.inputId)
          .filter((inputId): inputId is string => inputId !== null),
      );
      const stops: Record<string, StopIntent> = {};
      for (const [taskId, intent] of Object.entries(state.stops)) {
        const task = snapshot.tasks.find((candidate) => candidate.id === taskId);
        if (task === undefined || !isTerminal(task.status)) stops[taskId] = intent;
      }
      return {
        ...state,
        phase: 'live',
        error: null,
        snapshot,
        confirmedAt: action.at,
        outbox: state.outbox.filter((entry) => !seen.has(entry.commandId)),
        stops,
      };
    }
    case 'offline':
      return {
        ...state,
        phase: 'offline',
        error: action.error,
        protocolMismatch: action.protocolMismatch ?? null,
        outbox: state.outbox.map((entry) => ({ ...entry, uncertain: true })),
        stops: markStopsUncertain(state.stops),
      };
    case 'disconnect':
      return { ...initialClientState };
    case 'outbox-add':
      // 重试复用同一 commandId，所以替换而不是追加，界面上仍只有一条待确认消息。
      return {
        ...state,
        outbox: [
          ...state.outbox.filter((entry) => entry.commandId !== action.entry.commandId),
          action.entry,
        ],
        notice: null,
      };
    case 'outbox-accepted':
      return {
        ...state,
        outbox: state.outbox.filter((entry) => entry.commandId !== action.commandId),
        notice: null,
      };
    case 'outbox-uncertain':
      return {
        ...state,
        outbox: state.outbox.map((entry) =>
          entry.commandId === action.commandId ? { ...entry, uncertain: true } : entry,
        ),
        notice: '发送结果未知。重试会复用同一次提交，不会重复发送。',
      };
    case 'outbox-failed':
      return {
        ...state,
        outbox: state.outbox.filter((entry) => entry.commandId !== action.commandId),
        notice: `没有发送成功：${errorMessage(action.error)}`,
      };
    case 'stop-add':
      return {
        ...state,
        stops: { ...state.stops, [action.taskId]: action.intent },
        notice: null,
      };
    case 'stop-accepted':
      return {
        ...state,
        stops: setStop(state.stops, action.taskId, { uncertain: false }),
      };
    case 'stop-uncertain':
      return {
        ...state,
        stops: setStop(state.stops, action.taskId, { uncertain: true }),
        notice: '停止请求结果未知。任务实际状态以服务端为准。',
      };
    case 'stop-failed':
      return {
        ...state,
        stops: withoutStop(state.stops, action.taskId),
        notice: `停止请求没有送达：${errorMessage(action.error)}`,
      };
    case 'notice':
      return { ...state, notice: action.notice };
  }
}

function markStopsUncertain(
  stops: Readonly<Record<string, StopIntent>>,
): Record<string, StopIntent> {
  const next: Record<string, StopIntent> = {};
  for (const [taskId, intent] of Object.entries(stops))
    next[taskId] = { ...intent, uncertain: true };
  return next;
}

function setStop(
  stops: Readonly<Record<string, StopIntent>>,
  taskId: string,
  patch: { uncertain: boolean },
): Record<string, StopIntent> {
  const current = stops[taskId];
  if (current === undefined) return { ...stops };
  return { ...stops, [taskId]: { ...current, uncertain: patch.uncertain } };
}

function withoutStop(
  stops: Readonly<Record<string, StopIntent>>,
  taskId: string,
): Record<string, StopIntent> {
  const next = { ...stops };
  delete next[taskId];
  return next;
}

/** 复用未确认意图的 commandId；内容变了就是另一件事，必须换新 id。 */
export function reuseCommandId(outbox: readonly OutgoingMessage[], text: string): string | null {
  const entry = outbox.find((candidate) => candidate.uncertain && candidate.text === text);
  return entry?.commandId ?? null;
}

export function isTerminal(status: CompanionTaskStatus): boolean {
  return (
    status === 'completed' ||
    status === 'cancelled' ||
    status === 'failed' ||
    status === 'interrupted'
  );
}

export function isActive(status: CompanionTaskStatus): boolean {
  return status === 'accepted' || status === 'running' || status === 'cancel-requested';
}

export type StatusTone = 'neutral' | 'ok' | 'warn' | 'danger';

export interface TaskStatusView {
  readonly label: string;
  readonly tone: StatusTone;
  /** 断线后的非终态：只代表最后一次确认，不是当前真相。 */
  readonly stale: boolean;
}

const STATUS_LABELS: Readonly<Record<CompanionTaskStatus, string>> = {
  accepted: '已受理',
  running: '运行中',
  'cancel-requested': '停止请求已发送',
  completed: '已完成',
  cancelled: '已取消',
  failed: '失败',
  interrupted: '已中断',
  unknown: '状态未知',
};

const STATUS_TONES: Readonly<Record<CompanionTaskStatus, StatusTone>> = {
  accepted: 'neutral',
  running: 'neutral',
  'cancel-requested': 'warn',
  completed: 'ok',
  cancelled: 'neutral',
  failed: 'danger',
  interrupted: 'danger',
  unknown: 'warn',
};

/**
 * 停止请求先于服务端确认显示，但只有服务端真的进入终态才算结束。
 * 断线时不再显示运行中，改为「状态未知（上次：…）」。
 */
export function taskStatusView(task: CompanionTask, state: ClientState): TaskStatusView {
  if (state.phase !== 'live' && isActive(task.status)) {
    return {
      label: `状态未知（上次：${STATUS_LABELS[task.status]}）`,
      tone: 'warn',
      stale: true,
    };
  }
  if (state.phase === 'live' && isActive(task.status) && state.stops[task.id] !== undefined) {
    return { label: '停止请求已发送', tone: 'warn', stale: false };
  }
  return { label: STATUS_LABELS[task.status], tone: STATUS_TONES[task.status], stale: false };
}
