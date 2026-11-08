/**
 * 一次意图一个 ID。
 *
 * 内容不变的未确认重试必须复用同一个：服务端按它去重，换一个就会变成第二次提交。
 * 内容改了就是另一件事，调用方要给新 ID。
 */
export function newCommandId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
