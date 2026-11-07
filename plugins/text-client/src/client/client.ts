/**
 * 连接控制器：一次连接的生命周期、事件对账与本地意图提交。
 *
 * 连接 = 取 snapshot → 从该 snapshot 的 epoch/cursor 开 SSE。事件本身只作为
 * 「有变化」的信号，状态一律以合并后的 snapshot 为准，因此空闲时不轮询。
 * 流结束或世代变化时按 epoch/cursor 重新对账；真断了就停在 offline，等用户手动重连。
 */
import {
  errorMessage,
  makeError,
  type CompanionArtifact,
  type KernelError,
  type Result,
} from '@pet/contracts';

import {
  getArtifact,
  getSnapshot,
  sendMessage,
  stopTask,
  streamEvents,
  STREAM_IDLE_TIMEOUT_MS,
  type ClientTransport,
} from './protocol.js';
import {
  initialClientState,
  reduce,
  reuseCommandId,
  type ClientAction,
  type ClientState,
} from './state.js';

const REFRESH_COALESCE_MS = 120;

export interface CompanionClientOptions {
  /** 服务根地址；同源部署留空，请求走相对路径。 */
  readonly baseUrl?: string;
  readonly newCommandId?: () => string;
  /** 测试用：缩短事件合并窗口。 */
  readonly refreshDelayMs?: number;
  /** 测试用：缩短事件流的空闲心跳超时。 */
  readonly streamIdleTimeoutMs?: number;
}

/**
 * 一次提交的落点：`accepted` 才能清掉草稿；`uncertain` 要保留原文以便原样重试；
 * `failed` 是服务端明确拒绝，草稿同样保留，用户改完再发。
 */
export type SubmitOutcome = 'accepted' | 'uncertain' | 'failed' | 'skipped';

export class CompanionClient {
  readonly #baseUrl: string;
  readonly #newCommandId: () => string;
  readonly #refreshDelayMs: number;
  readonly #streamIdleTimeoutMs: number;
  readonly #listeners = new Set<() => void>();

  #state: ClientState = initialClientState;
  #token = '';
  #controller: AbortController | null = null;
  #refreshTimer: ReturnType<typeof setTimeout> | null = null;
  #refreshing = false;
  #refreshPending = false;

  constructor(options: CompanionClientOptions = {}) {
    this.#baseUrl = options.baseUrl ?? '';
    this.#newCommandId = options.newCommandId ?? defaultCommandId;
    this.#refreshDelayMs = options.refreshDelayMs ?? REFRESH_COALESCE_MS;
    this.#streamIdleTimeoutMs = options.streamIdleTimeoutMs ?? STREAM_IDLE_TIMEOUT_MS;
  }

  getState = (): ClientState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  get #transport(): ClientTransport {
    return { baseUrl: this.#baseUrl, token: this.#token };
  }

  /**
   * 用当前 token 建连：取到 snapshot 即算连上，事件流在后台继续跟随。
   * 先停掉旧流，避免两条流同时写状态。
   */
  async connect(token: string): Promise<void> {
    this.#teardown();
    this.#token = token;
    this.#dispatch({ type: 'connect' });
    const controller = new AbortController();
    this.#controller = controller;
    const snapshot = await getSnapshot(this.#transport, controller.signal);
    if (controller.signal.aborted) return;
    if (!snapshot.ok) {
      this.#dispatch({
        type: 'offline',
        error: snapshot.error,
        protocolMismatch: snapshot.protocolVersion,
      });
      return;
    }
    this.#dispatch({ type: 'snapshot', snapshot: snapshot.value, at: Date.now() });
    void this.#follow(controller.signal);
  }

  disconnect(): void {
    this.#teardown();
    this.#dispatch({ type: 'disconnect' });
  }

  async reconnect(): Promise<void> {
    if (this.#token === '') return;
    await this.connect(this.#token);
  }

  /** 提交一条文字。结果不明时复用同一 commandId；内容变了就是新意图。 */
  async submit(text: string): Promise<SubmitOutcome> {
    const trimmed = text.trim();
    if (trimmed === '' || this.#state.phase !== 'live') return 'skipped';
    const commandId = reuseCommandId(this.#state.outbox, trimmed) ?? this.#newCommandId();
    this.#dispatch({
      type: 'outbox-add',
      entry: { commandId, text: trimmed, uncertain: false },
    });
    const result = await sendMessage(this.#transport, { commandId, text: trimmed });
    if (result.ok) {
      this.#dispatch({ type: 'outbox-accepted', commandId });
      this.#scheduleRefresh();
      return 'accepted';
    }
    if (isUnknownOutcome(result.error)) {
      this.#dispatch({ type: 'outbox-uncertain', commandId });
      return 'uncertain';
    }
    this.#dispatch({ type: 'outbox-failed', commandId, error: result.error });
    return 'failed';
  }

  async requestStop(taskId: string): Promise<void> {
    const existing = this.#state.stops[taskId];
    const commandId = existing?.commandId ?? this.#newCommandId();
    this.#dispatch({
      type: 'stop-add',
      taskId,
      intent: { commandId, uncertain: existing?.uncertain ?? false },
    });
    const result = await stopTask(this.#transport, taskId, { commandId });
    if (result.ok) {
      this.#dispatch({ type: 'stop-accepted', taskId });
      // 受理不等于退出：显示「停止请求已发送」，等快照里的真实终态。
      this.#scheduleRefresh();
      return;
    }
    if (isUnknownOutcome(result.error)) {
      this.#dispatch({ type: 'stop-uncertain', taskId });
      return;
    }
    this.#dispatch({ type: 'stop-failed', taskId, error: result.error });
  }

  /** 产物按需下载：带认证取 Blob，再交给浏览器生成本地链接，token 不进 URL。 */
  async downloadArtifact(artifact: CompanionArtifact): Promise<Result<null>> {
    const result = await getArtifact(this.#transport, artifact.id);
    if (!result.ok) {
      this.#dispatch({ type: 'notice', notice: `下载失败：${errorMessage(result.error)}` });
      return result;
    }
    saveBlob(result.value, artifact.name);
    return { ok: true, value: null };
  }

  dispose(): void {
    this.#teardown();
    this.#listeners.clear();
  }

  /**
   * 保持一条事件流。流被服务端结束（例如世代切换）时按新快照重新对账，
   * 只有真的取不到快照或世代没变才判定断线。
   */
  async #follow(signal: AbortSignal): Promise<void> {
    for (;;) {
      const current = this.#state.snapshot;
      if (current === null || signal.aborted) return;
      const stream = await streamEvents(
        this.#transport,
        {
          after: current.cursor,
          epoch: current.epoch,
          signal,
          idleTimeoutMs: this.#streamIdleTimeoutMs,
        },
        () => this.#scheduleRefresh(),
      );
      if (signal.aborted) return;
      // 流一失效，实时确认就已经丢了：先进入现有的 offline（保留最后确认数据、标为未知），
      // 再去对账。否则在最多 20s 的取快照期间，界面会继续声称「已连接」。
      this.#dispatch({
        type: 'offline',
        error: stream.kind === 'failed' ? stream.error : makeError('network'),
      });
      // 认证失败不会因为再取一次快照而好转。
      if (stream.kind === 'failed' && stream.error.code === 'auth-failed') return;
      const next = await getSnapshot(this.#transport, signal);
      if (signal.aborted) return;
      if (!next.ok) {
        this.#dispatch({ type: 'offline', error: next.error });
        return;
      }
      if (next.value.epoch === current.epoch) {
        // 世代没变却断了流：服务端已断开，停在 offline 等用户手动重连。
        return;
      }
      // 世代已变：采纳新快照（回到实时），并以新游标重开流。
      this.#dispatch({ type: 'snapshot', snapshot: next.value, at: Date.now() });
    }
  }

  #scheduleRefresh(): void {
    if (this.#refreshTimer !== null) return;
    this.#refreshTimer = setTimeout(() => {
      this.#refreshTimer = null;
      void this.#refresh();
    }, this.#refreshDelayMs);
  }

  async #refresh(): Promise<void> {
    if (this.#refreshing) {
      this.#refreshPending = true;
      return;
    }
    const controller = this.#controller;
    if (this.#state.phase !== 'live' || controller === null) return;
    this.#refreshing = true;
    try {
      const result = await getSnapshot(this.#transport, controller.signal);
      if (controller.signal.aborted) return;
      // 取不到快照就不能再声称「已连接」：保留最后确认的数据，但把当前状态标成未知。
      if (result.ok) {
        this.#dispatch({ type: 'snapshot', snapshot: result.value, at: Date.now() });
      } else {
        this.#dispatch({ type: 'offline', error: result.error });
      }
    } finally {
      this.#refreshing = false;
      if (this.#refreshPending) {
        this.#refreshPending = false;
        this.#scheduleRefresh();
      }
    }
  }

  #teardown(): void {
    if (this.#refreshTimer !== null) {
      clearTimeout(this.#refreshTimer);
      this.#refreshTimer = null;
    }
    this.#refreshPending = false;
    this.#controller?.abort();
    this.#controller = null;
  }

  #dispatch(action: ClientAction): void {
    const next = reduce(this.#state, action);
    if (next === this.#state) return;
    this.#state = next;
    for (const listener of this.#listeners) listener();
  }
}

/**
 * 只有「请求可能已被处理」才算结果不明；服务端明确拒绝时不能假装未知，
 * 否则用户会反复重试一个已经失败的提交。
 */
export function isUnknownOutcome(error: KernelError): boolean {
  return (
    error.code === 'network' ||
    error.code === 'timeout' ||
    error.code === 'unavailable' ||
    error.code === 'internal'
  );
}

function defaultCommandId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // 立即撤销会让部分浏览器取消下载，留一个宏任务。
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
