/**
 * Fixed error taxonomy for every host/plugin boundary.
 *
 * `KernelError` never carries an original exception, a key, a URL or any user
 * content: only a code, the derived message key and a retry flag. Display copy
 * is a fixed lookup so that no input can be echoed back to a user or a log.
 */

export const KERNEL_ERROR_CODES = [
  'not-ready',
  'invalid-input',
  'auth-failed',
  'quota-exceeded',
  'rate-limited',
  'network',
  'unavailable',
  'timeout',
  'cancelled',
  'internal',
  'permission-denied',
  'stale-owner',
] as const;

export type KernelErrorCode = (typeof KERNEL_ERROR_CODES)[number];

/** Prefix of the message key derived from a code. */
export const ERROR_MESSAGE_KEY_PREFIX = 'errors.';

export type KernelErrorMessageKey = `errors.${KernelErrorCode}`;

/** Fixed, non-echoing display copy. Kept in one table so UI copy stays central. */
export const ERROR_MESSAGES: Readonly<Record<KernelErrorCode, string>> = Object.freeze({
  'not-ready': '插件尚未就绪',
  'invalid-input': '输入不符合约定',
  'auth-failed': '身份验证失败',
  'quota-exceeded': '额度已用完',
  'rate-limited': '请求过于频繁',
  network: '网络不可用',
  unavailable: '当前不可用',
  timeout: '操作超时',
  cancelled: '操作已取消',
  internal: '内部错误',
  'permission-denied': '没有获得授权',
  'stale-owner': '插件实例已失效',
});

/** Whether a code is worth retrying when the caller does not decide explicitly. */
export const RETRYABLE_BY_DEFAULT: Readonly<Record<KernelErrorCode, boolean>> = Object.freeze({
  'not-ready': true,
  'invalid-input': false,
  'auth-failed': false,
  'quota-exceeded': false,
  'rate-limited': true,
  network: true,
  unavailable: true,
  timeout: true,
  cancelled: false,
  internal: false,
  'permission-denied': false,
  'stale-owner': false,
});

export interface KernelError {
  code: KernelErrorCode;
  messageKey: KernelErrorMessageKey;
  retryable: boolean;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: KernelError };

export function isKernelErrorCode(value: unknown): value is KernelErrorCode {
  return typeof value === 'string' && (KERNEL_ERROR_CODES as readonly string[]).includes(value);
}

/**
 * Build a fixed error. Unknown codes collapse to `internal` so a foreign string
 * can never be smuggled into `messageKey`.
 */
export function makeError(code: KernelErrorCode, retryable?: boolean): KernelError {
  const safeCode: KernelErrorCode = isKernelErrorCode(code) ? code : 'internal';
  return {
    code: safeCode,
    messageKey: `${ERROR_MESSAGE_KEY_PREFIX}${safeCode}` as KernelErrorMessageKey,
    retryable: retryable ?? RETRYABLE_BY_DEFAULT[safeCode],
  };
}

/** Fixed display copy for an error; never derived from the failing input. */
export function errorMessage(error: KernelError): string {
  return ERROR_MESSAGES[error.code] ?? ERROR_MESSAGES.internal;
}
