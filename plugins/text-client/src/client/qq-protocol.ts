/**
 * QQ 管理面的线上读取：只发 integration.md 已定的 owner 路由，
 * 响应一律先过契约 guard 再交给表单——半个 QQView 不进界面。
 *
 * 这里没有第二条存储：设置、连接、回执全是服务端事实。
 */
import {
  isQQStatus,
  isQQView,
  makeError,
  type QQCredentialCommand,
  type QQDeliveryPage,
  type QQDeliveryView,
  type QQJudgeCredentialCommand,
  type QQJudgeSettingsCommand,
  type QQPolicyCommand,
  type QQPrincipalPage,
  type QQSourceSettingsCommand,
  type QQStatus,
  type QQView,
  type CompanionCommandReceipt,
  type Result,
  isQQDeliveryView,
  isQQDeliveryPage,
  isQQPrincipalPage,
  QQ_PAGE_MAX_ITEMS,
} from '@pet/contracts';

import { parseReceipt } from './guards.js';
import { requestJson } from './request.js';
import type { ClientTransport } from './protocol.js';

const VIEW_TIMEOUT_MS = 15_000;
const COMMAND_TIMEOUT_MS = 30_000;

const unavailable = (): { ok: false; error: ReturnType<typeof makeError> } => ({
  ok: false,
  error: makeError('unavailable', false),
});

async function readView(
  transport: ClientTransport,
  path: string,
  signal?: AbortSignal,
): Promise<Result<QQView>> {
  const result = await requestJson(
    transport,
    path,
    { method: 'GET', ...(signal ? { signal } : {}) },
    VIEW_TIMEOUT_MS,
  );
  if (!result.ok) return result;
  return isQQView(result.value) ? { ok: true, value: result.value } : unavailable();
}

async function writeView(
  transport: ClientTransport,
  path: string,
  command: object,
  signal?: AbortSignal,
): Promise<Result<QQView>> {
  const result = await requestJson(
    transport,
    path,
    {
      method: 'POST',
      ...(signal ? { signal } : {}),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
    },
    COMMAND_TIMEOUT_MS,
  );
  if (!result.ok) return result;
  return isQQView(result.value) ? { ok: true, value: result.value } : unavailable();
}

export function getQQ(transport: ClientTransport, signal?: AbortSignal): Promise<Result<QQView>> {
  return readView(transport, '/api/qq', signal);
}

export async function getQQStatus(
  transport: ClientTransport,
  signal?: AbortSignal,
): Promise<Result<QQStatus>> {
  const result = await requestJson(
    transport,
    '/api/qq/status',
    { method: 'GET', ...(signal ? { signal } : {}) },
    VIEW_TIMEOUT_MS,
  );
  if (!result.ok) return result;
  return isQQStatus(result.value) ? { ok: true, value: result.value } : unavailable();
}

export function saveQQPolicy(
  transport: ClientTransport,
  command: QQPolicyCommand,
  signal?: AbortSignal,
): Promise<Result<QQView>> {
  return writeView(transport, '/api/qq/policy', command, signal);
}

export function saveQQSource(
  transport: ClientTransport,
  command: QQSourceSettingsCommand,
  signal?: AbortSignal,
): Promise<Result<QQView>> {
  return writeView(transport, '/api/qq/source', command, signal);
}

export function writeQQCredential(
  transport: ClientTransport,
  command: QQCredentialCommand,
  signal?: AbortSignal,
): Promise<Result<QQView>> {
  return writeView(transport, '/api/qq/credential', command, signal);
}

export function saveQQJudge(
  transport: ClientTransport,
  command: QQJudgeSettingsCommand,
  signal?: AbortSignal,
): Promise<Result<QQView>> {
  return writeView(transport, '/api/qq/judge', command, signal);
}

export function writeQQJudgeCredential(
  transport: ClientTransport,
  command: QQJudgeCredentialCommand,
  signal?: AbortSignal,
): Promise<Result<QQView>> {
  return writeView(transport, '/api/qq/judge/credential', command, signal);
}

/**
 * 启用/停用走真实的插件命令路由。
 *
 * 回执只证明这次命令被记录；它不证明来源已经连上。所以这里只返回回执，
 * 调用方必须重新读 `/api/qq` 才谈得上「已连接」。
 */
export async function setQQSourceEnabled(
  transport: ClientTransport,
  pluginId: string,
  commandId: string,
  enabled: boolean,
  signal?: AbortSignal,
): Promise<Result<CompanionCommandReceipt>> {
  const result = await requestJson(
    transport,
    `/api/plugins/${encodeURIComponent(pluginId)}`,
    {
      method: 'POST',
      ...(signal ? { signal } : {}),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId, enabled }),
    },
    COMMAND_TIMEOUT_MS,
  );
  if (!result.ok) return result;
  const receipt = parseReceipt(result.value, commandId);
  return receipt === null ? unavailable() : { ok: true, value: receipt };
}

/**
 * 分页读投递记录。
 *
 * 列表项是 `QQDeliveryPage` 的 **Pick 摘要**（没有 parts/mode/error 这些字段），
 * 所以不能拿 `isQQDeliveryView` 去验——那会要求完整行，把每一条都拒掉。
 * 这里只校验摘要真正拥有的字段；要看完整行走 `readQQDelivery(id)`。
 */
export async function readQQDeliveries(
  transport: ClientTransport,
  options: { readonly after?: string | undefined; readonly limit?: number | undefined } = {},
  signal?: AbortSignal,
): Promise<Result<QQDeliveryPage>> {
  const query = new URLSearchParams();
  if (options.after !== undefined) query.set('after', options.after);
  const limit = Math.min(options.limit ?? QQ_PAGE_MAX_ITEMS, QQ_PAGE_MAX_ITEMS);
  query.set('limit', String(limit));
  const result = await requestJson(
    transport,
    `/api/qq/deliveries?${query.toString()}`,
    { method: 'GET', ...(signal ? { signal } : {}) },
    VIEW_TIMEOUT_MS,
  );
  if (!result.ok) return result;
  // requestJson 已经拆过信封，这里拿到的就是 value 本身。
  return isQQDeliveryPage(result.value) ? { ok: true, value: result.value } : unavailable();
}

export async function readQQDelivery(
  transport: ClientTransport,
  id: string,
  signal?: AbortSignal,
): Promise<Result<QQDeliveryView>> {
  const result = await requestJson(
    transport,
    `/api/qq/deliveries/${encodeURIComponent(id)}`,
    { method: 'GET', ...(signal ? { signal } : {}) },
    VIEW_TIMEOUT_MS,
  );
  if (!result.ok) return result;
  return isQQDeliveryView(result.value) ? { ok: true, value: result.value } : unavailable();
}

export async function readQQPrincipals(
  transport: ClientTransport,
  options: { readonly after?: string | undefined; readonly limit?: number | undefined } = {},
  signal?: AbortSignal,
): Promise<Result<QQPrincipalPage>> {
  const query = new URLSearchParams();
  if (options.after !== undefined) query.set('after', options.after);
  const limit = Math.min(options.limit ?? QQ_PAGE_MAX_ITEMS, QQ_PAGE_MAX_ITEMS);
  query.set('limit', String(limit));
  const result = await requestJson(
    transport,
    `/api/qq/principals?${query.toString()}`,
    { method: 'GET', ...(signal ? { signal } : {}) },
    VIEW_TIMEOUT_MS,
  );
  if (!result.ok) return result;
  return isQQPrincipalPage(result.value) ? { ok: true, value: result.value } : unavailable();
}
