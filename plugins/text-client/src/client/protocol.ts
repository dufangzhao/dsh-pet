/**
 * 同源 HTTP/SSE 协议。
 *
 * 每个 /api/* 请求都带 `Authorization: Bearer <token>`，token 只存在于内存，
 * 从不进入 URL；产物下载也用带认证的 fetch 取 Blob，再由调用方生成本地链接。
 * 响应先过 guards 校验再交给状态层：坏响应不会变成半个对象进界面。
 */
import {
  makeError,
  type CompanionProfileSaveCommand,
  type CompanionMemoryView,
  type CompanionMemoryUpsertCommand,
  type CompanionMemoryForgetCommand,
  type CompanionMemoryMutationResult,
  type CompanionCommandReceipt,
  type CompanionEvent,
  type CompanionMessageCommand,
  type CompanionModelCommandResult,
  type CompanionModelCredentialCommand,
  type CompanionModelSaveCommand,
  type CompanionModelTestCommand,
  type CompanionModelView,
  type CompanionSnapshot,
  type CompanionProfileView,
  type CompanionTask,
  type CompanionStopCommand,
  type KernelError,
  type Result,
} from '@pet/contracts';

import {
  parseMemory,
  parseMemoryMutation,
  parseEvent,
  parseModelView,
  parseReceipt,
  parseSnapshot,
  parseProfile,
  parseTask,
} from './guards.js';
import { SseDecoder, type SseMessage } from './sse.js';
import { networkError, statusError, requestJson } from './request.js';

export interface ClientTransport {
  /** 服务根地址；同源部署时为空串，请求走相对路径。 */
  readonly baseUrl: string;
  readonly token: string;
}

export type EventMessage =
  | { readonly kind: 'companion'; readonly event: CompanionEvent }
  /** 无 id 的瞬时提示：只触发合并刷新，不推进持久游标。 */
  | { readonly kind: 'refresh' };

export interface EventStreamOptions {
  readonly after: number;
  readonly epoch: string;
  readonly signal: AbortSignal;
  /**
   * 多久没收到任何字节就判定流已死。服务端每 15 秒发一条 keepalive 注释，
   * 留足调度余量：三个心跳周期没消息才判定断开。
   */
  readonly idleTimeoutMs?: number;
}

/** 三个服务端心跳周期（15s）：容忍一次调度抖动，又不至于长时间谎称已连接。 */
export const STREAM_IDLE_TIMEOUT_MS = 45_000;

export type EventStreamResult =
  { readonly kind: 'ended' } | { readonly kind: 'failed'; readonly error: KernelError };

/**
 * 快照读取的失败可能带着服务端协议版本：版本不支持要说清楚，
 * 否则用户会把它当成网络问题反复重试。
 */
export type SnapshotResult =
  | { readonly ok: true; readonly value: CompanionSnapshot }
  | { readonly ok: false; readonly error: KernelError; readonly protocolVersion?: number };

/** 单个 HTTP 请求的上限。SSE 有自己的心跳看门狗，不走这个值。 */
export const REQUEST_TIMEOUT_MS = 20_000;
let requestTimeoutMs = REQUEST_TIMEOUT_MS;
/** 仅测试用：缩短请求超时，避免用例真的等 20 秒。 */
export function setRequestTimeoutMs(value: number): void {
  requestTimeoutMs = value;
}

function request(
  transport: ClientTransport,
  path: string,
  init: RequestInit,
): Promise<Result<unknown>> {
  return requestJson(transport, path, init, requestTimeoutMs);
}

export async function getSnapshot(
  transport: ClientTransport,
  signal: AbortSignal,
): Promise<SnapshotResult> {
  const result = await request(transport, '/api/snapshot', { method: 'GET', signal });
  if (!result.ok) return result;
  const snapshot = parseSnapshot(result.value);
  if (!snapshot.ok) {
    const version = snapshot.failure.version;
    return version === null
      ? { ok: false, error: snapshot.failure.error }
      : { ok: false, error: snapshot.failure.error, protocolVersion: version };
  }
  return { ok: true, value: snapshot.value };
}

async function command(
  transport: ClientTransport,
  path: string,
  body: { readonly commandId: string },
  signal?: AbortSignal,
): Promise<Result<CompanionCommandReceipt>> {
  const result = await request(transport, path, {
    method: 'POST',
    ...(signal ? { signal } : {}),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!result.ok) return result;
  const receipt = parseReceipt(result.value, body.commandId);
  if (receipt === null) return { ok: false, error: makeError('unavailable', false) };
  return { ok: true, value: receipt };
}

export function sendMessage(
  transport: ClientTransport,
  command_: CompanionMessageCommand,
  signal?: AbortSignal,
): Promise<Result<CompanionCommandReceipt>> {
  return command(transport, '/api/messages', command_, signal);
}

export async function stopTask(
  transport: ClientTransport,
  taskId: string,
  stop: CompanionStopCommand,
  signal?: AbortSignal,
): Promise<Result<CompanionCommandReceipt>> {
  const result = await command(
    transport,
    `/api/tasks/${encodeURIComponent(taskId)}/stop`,
    stop,
    signal,
  );
  return result.ok && result.value.taskId !== taskId
    ? { ok: false, error: makeError('unavailable', false) }
    : result;
}

/**
 * 模型设置的三个动作。保存与测试都返回「回执 + 视图」：回执必须对应本次
 * commandId，视图必须整份读得懂，否则按结果未知处理，不拿半个视图去改界面。
 */
async function modelCommand(
  transport: ClientTransport,
  path: string,
  command: CompanionModelSaveCommand | CompanionModelTestCommand,
  signal?: AbortSignal,
): Promise<Result<CompanionModelView>> {
  const result = await request(transport, path, {
    method: 'POST',
    ...(signal ? { signal } : {}),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  if (!result.ok) return result;
  const envelope = result.value;
  if (typeof envelope !== 'object' || envelope === null) {
    return { ok: false, error: makeError('unavailable', false) };
  }
  const value = envelope as Partial<CompanionModelCommandResult>;
  if (parseReceipt(value.receipt, command.commandId) === null) {
    return { ok: false, error: makeError('unavailable', false) };
  }
  const view = parseModelView(value.view);
  return view === null
    ? { ok: false, error: makeError('unavailable', false) }
    : { ok: true, value: view };
}

export function saveModel(
  transport: ClientTransport,
  command: CompanionModelSaveCommand,
  signal?: AbortSignal,
): Promise<Result<CompanionModelView>> {
  return modelCommand(transport, '/api/model', command, signal);
}

export function testModel(
  transport: ClientTransport,
  command: CompanionModelTestCommand,
  signal?: AbortSignal,
): Promise<Result<CompanionModelView>> {
  return modelCommand(transport, '/api/model/test', command, signal);
}

/** 密钥只随这一次请求体离开页面；返回的是非secret视图。 */
export async function writeModelCredential(
  transport: ClientTransport,
  command: CompanionModelCredentialCommand,
  signal?: AbortSignal,
): Promise<Result<CompanionModelView>> {
  const result = await request(transport, '/api/model/credential', {
    method: 'POST',
    ...(signal ? { signal } : {}),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  if (!result.ok) return result;
  const view = parseModelView(result.value);
  return view === null
    ? { ok: false, error: makeError('unavailable', false) }
    : { ok: true, value: view };
}

/** Authenticated bytes; caller owns bounded streaming and actual body cleanup. */
export async function fetchArtifact(
  transport: ClientTransport,
  artifactId: string,
  signal?: AbortSignal,
): Promise<Result<Response>> {
  const deadline = AbortSignal.timeout(120_000);
  try {
    const response = await fetch(
      `${transport.baseUrl}/api/artifacts/${encodeURIComponent(artifactId)}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${transport.token}` },
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      return { ok: false, error: statusError(response.status) };
    }
    return { ok: true, value: response };
  } catch {
    return { ok: false, error: deadline.aborted ? makeError('timeout') : networkError() };
  }
}

export async function getArtifact(
  transport: ClientTransport,
  artifactId: string,
  signal?: AbortSignal,
): Promise<Result<Blob>> {
  const result = await fetchArtifact(transport, artifactId, signal);
  if (!result.ok) return result;
  try {
    return { ok: true, value: await result.value.blob() };
  } catch {
    return { ok: false, error: networkError() };
  }
}

export async function getProfile(
  transport: ClientTransport,
  signal?: AbortSignal,
): Promise<Result<CompanionProfileView>> {
  const result = await request(transport, '/api/profile', {
    method: 'GET',
    ...(signal ? { signal } : {}),
  });
  if (!result.ok) return result;
  const value = parseProfile(result.value);
  return value ? { ok: true, value } : { ok: false, error: makeError('unavailable', false) };
}
export async function getTask(
  transport: ClientTransport,
  id: string,
  signal?: AbortSignal,
): Promise<Result<CompanionTask>> {
  const result = await request(transport, `/api/tasks/${encodeURIComponent(id)}`, {
    method: 'GET',
    ...(signal ? { signal } : {}),
  });
  if (!result.ok) return result;
  const value = parseTask(result.value);
  return value && value.id === id
    ? { ok: true, value }
    : { ok: false, error: makeError('unavailable', false) };
}
export async function stopForeground(
  transport: ClientTransport,
  commandId: string,
  signal?: AbortSignal,
): Promise<Result<null>> {
  const result = await request(transport, '/api/foreground/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commandId }),
    ...(signal ? { signal } : {}),
  });
  if (!result.ok) return result;
  return result.value === null
    ? { ok: true, value: null }
    : { ok: false, error: makeError('unavailable', false) };
}

/**
 * 打开已认证事件流。
 *
 * `after`/`epoch` 是上次确认的游标与世代；服务端返回冲突表示世代已变，
 * 调用方应重新取 snapshot 而不是继续增量。流自然结束或被中止都算 ended。
 */
export async function streamEvents(
  transport: ClientTransport,
  options: EventStreamOptions,
  onMessage: (message: EventMessage) => void,
): Promise<EventStreamResult> {
  const query = new URLSearchParams({ after: String(options.after), epoch: options.epoch });
  // 内部 controller 让看门狗能真正 abort 这条请求；调用方的 signal 仍然照常生效。
  const controller = new AbortController();
  const signal = AbortSignal.any([options.signal, controller.signal]);
  let timedOut = false;
  const idle = idleWatch(options.idleTimeoutMs ?? STREAM_IDLE_TIMEOUT_MS, () => {
    timedOut = true;
    controller.abort();
  });
  let response: Response;
  try {
    response = await fetch(`${transport.baseUrl}/api/events?${query.toString()}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${transport.token}`, Accept: 'text/event-stream' },
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      signal,
    });
  } catch {
    idle.stop();
    if (options.signal.aborted) return { kind: 'ended' };
    if (timedOut) return { kind: 'failed', error: makeError('network') };
    return { kind: 'failed', error: networkError() };
  }
  if (!response.ok) {
    idle.stop();
    return { kind: 'failed', error: statusError(response.status) };
  }
  if (response.body === null) {
    idle.stop();
    return { kind: 'failed', error: makeError('unavailable', false) };
  }

  const decoder = new SseDecoder();
  const reader = response.body.getReader();
  const text = new TextDecoder();
  // 用户主动断开要立刻生效，不能被后面的超时判定顶掉。
  // 同一个 signal 会在重连时复用，所以正常结束时必须摘掉监听，避免越积越多。
  let detach = (): void => {};
  const aborted = new Promise<'aborted'>((resolve) => {
    if (options.signal.aborted) {
      resolve('aborted');
      return;
    }
    const onAbort = (): void => resolve('aborted');
    options.signal.addEventListener('abort', onAbort, { once: true });
    detach = () => options.signal.removeEventListener('abort', onAbort);
  });
  try {
    for (;;) {
      const outcome = await Promise.race([
        reader.read().then((read) => ({ kind: 'chunk' as const, read })),
        idle.waited.then(() => ({ kind: 'idle' as const })),
        aborted.then(() => ({ kind: 'aborted' as const })),
      ]);
      if (outcome.kind === 'aborted') return { kind: 'ended' };
      if (outcome.kind === 'idle') {
        // 看门狗已 abort 请求；这里再取消 reader，确保底层连接和缓冲都释放。
        await reader.cancel().catch(() => {});
        return { kind: 'failed', error: makeError('network') };
      }
      // 任何字节（含 keepalive 注释行）都算活着，只有真收到字节才重新计时。
      idle.touch();
      if (outcome.read.done) return { kind: 'ended' };
      for (const message of decoder.push(text.decode(outcome.read.value, { stream: true }))) {
        const parsed = parseStreamMessage(message);
        if (parsed !== null) onMessage(parsed);
      }
    }
  } catch {
    // 用户主动断开优先于超时判定，不能被误报成网络故障。
    if (options.signal.aborted) return { kind: 'ended' };
    return { kind: 'failed', error: networkError() };
  } finally {
    idle.stop();
    detach();
    controller.abort();
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/**
 * 空闲看门狗：断网时浏览器不会让 fetch 立刻失败，只有服务端心跳停止到达
 * 才能证明连接已死。超时同时做两件事——真正 abort 请求释放连接，
 * 并让等待循环立刻结束（不依赖底层流是否配合拒绝读取）。
 */
function idleWatch(
  timeoutMs: number,
  onIdle: () => void,
): { waited: Promise<void>; touch: () => void; stop: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let fire: (() => void) | null = null;
  const waited = new Promise<void>((resolve) => {
    fire = resolve;
  });
  const arm = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onIdle();
      fire?.();
    }, timeoutMs);
  };
  arm();
  return {
    waited,
    touch: arm,
    stop: () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

/** 坏帧直接丢弃：事件只是「有变化」的信号，游标以 snapshot 为准。 */
function parseStreamMessage(message: SseMessage): EventMessage | null {
  if (message.event === 'refresh') return { kind: 'refresh' };
  if (message.event !== 'companion') return null;
  let data: unknown;
  try {
    data = JSON.parse(message.data);
  } catch {
    return null;
  }
  const event = parseEvent(data);
  return event === null ? null : { kind: 'companion', event };
}

export async function saveProfile(
  transport: ClientTransport,
  command: CompanionProfileSaveCommand,
  signal?: AbortSignal,
): Promise<Result<CompanionProfileView>> {
  const result = await request(transport, '/api/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    ...(signal ? { signal } : {}),
  });
  if (!result.ok) return result;
  const value = parseProfile(result.value);
  return value?.management
    ? { ok: true, value }
    : { ok: false, error: makeError('unavailable', false) };
}
export async function getMemory(
  transport: ClientTransport,
  signal?: AbortSignal,
): Promise<Result<CompanionMemoryView>> {
  const result = await request(transport, '/api/memory', {
    method: 'GET',
    ...(signal ? { signal } : {}),
  });
  if (!result.ok) return result;
  const value = parseMemory(result.value);
  return value ? { ok: true, value } : { ok: false, error: makeError('unavailable', false) };
}
async function memoryMutation(
  transport: ClientTransport,
  path: string,
  command: CompanionMemoryUpsertCommand | CompanionMemoryForgetCommand,
  signal?: AbortSignal,
): Promise<Result<CompanionMemoryMutationResult>> {
  const result = await request(transport, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    ...(signal ? { signal } : {}),
  });
  if (!result.ok) return result;
  const value = parseMemoryMutation(result.value, command.commandId);
  return value ? { ok: true, value } : { ok: false, error: makeError('unavailable', false) };
}
export const upsertFact = (
  transport: ClientTransport,
  command: CompanionMemoryUpsertCommand,
  signal?: AbortSignal,
): Promise<Result<CompanionMemoryMutationResult>> =>
  memoryMutation(transport, '/api/facts', command, signal);
export const forgetFact = (
  transport: ClientTransport,
  command: CompanionMemoryForgetCommand,
  signal?: AbortSignal,
): Promise<Result<CompanionMemoryMutationResult>> =>
  memoryMutation(transport, '/api/facts/forget', command, signal);
