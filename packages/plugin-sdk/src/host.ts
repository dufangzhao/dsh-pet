/**
 * `@pet/plugin-sdk/host` — 宿主侧工厂。
 *
 * 只有宿主运行区可以导入本子路径：它使用 `@pet/contracts/validation` 的 Node
 * 安全校验，因此不能进渲染进程包。根入口 `@pet/plugin-sdk` 保持浏览器安全。
 *
 * 本文件只做「把宿主端口包成冻结服务」这一件事：不实现媒体传输、不实现能力
 * 路由、不读文件/网络/进程，也不把端口暴露给插件。
 */

import { types } from 'node:util';
import {
  CAPABILITY_ID_PATTERN,
  LOCAL_ID_PATTERN,
  PLUGIN_ID_PATTERN,
  makeError,
  type CapabilityId,
  type JsonValue,
  type KernelError,
  type LocalId,
  type OwnerRef,
  type Result,
} from '@pet/contracts';
import { jsonPreflight } from '@pet/contracts/validation';
import type {
  MediaReference,
  PluginConfigSnapshot,
  PluginHostPort,
  PluginHostServices,
  PluginMediaReader,
  PluginMediaWriter,
  PluginTask,
} from './index.js';

/** 工厂作用域：本插件实例的 owner 与它的取消信号。 */
export interface PluginHostScope {
  readonly owner: OwnerRef;
  readonly signal: AbortSignal;
}

/** 工厂入参不合法时同步抛出；固定文案，不回显输入。 */
const INVALID_SCOPE = 'invalid plugin host scope';

const LOCAL_ID = new RegExp(LOCAL_ID_PATTERN);
const CAPABILITY_ID = new RegExp(CAPABILITY_ID_PATTERN);
const PLUGIN_ID = new RegExp(PLUGIN_ID_PATTERN);

const OWNER_KEYS = 'generation,instanceId,pluginId';
const SNAPSHOT_KEYS = 'data,instanceId,pluginId,revision,schemaVersion';
const REFERENCE_KEYS = 'owner,streamId,taskId';
const ERROR_KEYS = 'code,messageKey,retryable';

/** 校验成功的包装：`null` 专门表示「拒绝」，因此 `null` 值本身也能通过。 */
interface Accepted<T> {
  readonly value: T;
}

function accept<T>(value: T): Accepted<T> {
  return { value };
}

function invalidScope(): TypeError {
  return new TypeError(INVALID_SCOPE);
}

function fail(code: KernelError['code']): Result<never> {
  return { ok: false, error: makeError(code) };
}

/** 属性不存在。 */
const ABSENT = Symbol('absent');
/** 属性是访问器：一律拒绝，绝不执行。 */
const ACCESSOR = Symbol('accessor');

/**
 * 沿原型链按 descriptor 读取一个数据属性，从不执行 getter，也从不触发 Proxy trap。
 *
 * 返回 `ABSENT` / `ACCESSOR` 两种标记，让调用方区分「可选字段缺失」与「被拒绝」。
 */
function readDataValue(value: object, key: string | symbol): unknown {
  let current: object | null = value;
  while (current !== null) {
    if (types.isProxy(current)) return ACCESSOR;
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor !== undefined) {
      if (!('value' in descriptor)) return ACCESSOR;
      return descriptor.value;
    }
    current = Object.getPrototypeOf(current);
  }
  return ABSENT;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 非 JSON 的结构体同样先拒 Proxy，再做任何反射。 */
function isReflectable(value: unknown): value is Record<string, unknown> {
  if (!isObject(value)) return false;
  return !types.isProxy(value);
}

/** 契约结构体（owner/快照/引用/任务）必须是普通对象，不接受类实例。 */
function isPlainReflectable(value: unknown): value is Record<string, unknown> {
  if (!isReflectable(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** 自有键必须恰好是这些名字（顺序无关），并且不带 symbol 键。 */
function hasExactOwnKeys(value: Record<string, unknown>, expected: string): boolean {
  if (Object.getOwnPropertySymbols(value).length > 0) return false;
  return Object.getOwnPropertyNames(value).sort().join(',') === expected;
}

/** owner 必须是纯数据对象，字段与已有契约正则/范围完全一致。 */
function readOwner(value: unknown): OwnerRef | null {
  if (!isPlainReflectable(value)) return null;
  if (!hasExactOwnKeys(value, OWNER_KEYS)) return null;
  const pluginId = readDataValue(value, 'pluginId');
  const instanceId = readDataValue(value, 'instanceId');
  const generation = readDataValue(value, 'generation');
  if (typeof pluginId !== 'string' || !PLUGIN_ID.test(pluginId)) return null;
  if (typeof instanceId !== 'string' || !LOCAL_ID.test(instanceId)) return null;
  if (!Number.isSafeInteger(generation) || (generation as number) < 1) return null;
  return { pluginId, instanceId, generation: generation as number };
}

function sameOwner(left: OwnerRef, right: OwnerRef): boolean {
  return (
    left.pluginId === right.pluginId &&
    left.instanceId === right.instanceId &&
    left.generation === right.generation
  );
}

/** 原生 AbortSignal 判定：伪造的原型链没有内部槽，读 `aborted` 会抛错。 */
const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const aborted = (signal: AbortSignal) => nativeAborted.call(signal) as boolean;
function isNativeSignal(value: unknown): value is AbortSignal {
  if (typeof value !== 'object' || value === null || types.isProxy(value)) return false;
  if (
    Object.getPrototypeOf(value) !== AbortSignal.prototype ||
    Object.getOwnPropertyDescriptor(value, 'aborted')
  )
    return false;
  try {
    nativeAborted.call(value);
    return true;
  } catch {
    return false;
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  return Object.freeze(value);
}

/**
 * 预检并复制 JSON。`jsonPreflight` 只读 own descriptor，因此不执行访问器与
 * Proxy trap，也已经在复制过程中拒绝了危险键与预算溢出。
 */
function readJson(input: unknown): Accepted<JsonValue> | null {
  const checked = jsonPreflight(input);
  return checked.ok ? accept(checked.value) : null;
}

/** control Result 也要校验固定形状，不能把任意值当成错误码透传。 */
function readResult<T>(
  value: unknown,
  acceptValue: (value: unknown) => Accepted<T> | null,
): Result<T> | null {
  if (!isPlainReflectable(value)) return null;
  const ok = readDataValue(value, 'ok');
  if (ok === true) {
    if (!hasExactOwnKeys(value, 'ok,value')) return null;
    const accepted = acceptValue(readDataValue(value, 'value'));
    return accepted === null ? null : { ok: true, value: accepted.value };
  }
  if (ok !== false) return null;
  if (!hasExactOwnKeys(value, 'error,ok')) return null;
  const error = readDataValue(value, 'error');
  if (!isPlainReflectable(error)) return null;
  if (!hasExactOwnKeys(error, ERROR_KEYS)) return null;
  const code = readDataValue(error, 'code');
  const messageKey = readDataValue(error, 'messageKey');
  const retryable = readDataValue(error, 'retryable');
  if (typeof code !== 'string' || typeof messageKey !== 'string') return null;
  if (typeof retryable !== 'boolean') return null;
  const fixed = makeError(code as KernelError['code'], retryable);
  if (fixed.code !== code || fixed.messageKey !== messageKey) return null;
  return { ok: false, error: fixed };
}

/** `Result<null>` 的成功臂值必须恰好是 `null`。 */
const acceptNull = (value: unknown): Accepted<null> | null =>
  value === null ? accept(null) : null;

function readSnapshot(value: unknown, owner: OwnerRef): Accepted<PluginConfigSnapshot> | null {
  if (!isPlainReflectable(value)) return null;
  if (!hasExactOwnKeys(value, SNAPSHOT_KEYS)) return null;
  const pluginId = readDataValue(value, 'pluginId');
  const instanceId = readDataValue(value, 'instanceId');
  const schemaVersion = readDataValue(value, 'schemaVersion');
  const revision = readDataValue(value, 'revision');
  const data = readJson(readDataValue(value, 'data'));
  if (data === null) return null;
  if (pluginId !== owner.pluginId || instanceId !== owner.instanceId) return null;
  if (typeof schemaVersion !== 'number' || !Number.isSafeInteger(schemaVersion)) return null;
  if (schemaVersion < 1) return null;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1) return null;
  if (typeof data.value !== 'object' || data.value === null || Array.isArray(data.value)) {
    return null;
  }
  const snapshot: PluginConfigSnapshot = deepFreeze({
    pluginId,
    instanceId,
    schemaVersion,
    revision,
    data: data.value as PluginConfigSnapshot['data'],
  });
  return accept(snapshot);
}

function readReference(
  value: unknown,
  owner: OwnerRef,
  taskId: string,
): Accepted<MediaReference> | null {
  if (!isPlainReflectable(value)) return null;
  if (!hasExactOwnKeys(value, REFERENCE_KEYS)) return null;
  const streamId = readDataValue(value, 'streamId');
  const refTaskId = readDataValue(value, 'taskId');
  const refOwner = readOwner(readDataValue(value, 'owner'));
  if (typeof streamId !== 'string' || !LOCAL_ID.test(streamId)) return null;
  if (refTaskId !== taskId) return null;
  if (refOwner === null || !sameOwner(refOwner, owner)) return null;
  return accept(deepFreeze({ streamId, taskId, owner: refOwner }));
}

/**
 * 只暴露冻结的描述对象与两个方法：端口对象本身、它的其它字段都不交给插件。
 */
function readReader(
  value: unknown,
  owner: OwnerRef,
  taskId: string,
): Accepted<PluginMediaReader> | null {
  if (typeof value !== 'object' || value === null) return null;
  if (types.isProxy(value)) return null;
  const iterate = readDataValue(value, Symbol.asyncIterator);
  const cancel = readDataValue(value, 'cancel');
  const reference = readReference(readDataValue(value, 'reference'), owner, taskId);
  if (typeof iterate !== 'function' || typeof cancel !== 'function') return null;
  if (reference === null) return null;
  const read = iterate as () => AsyncIterator<Uint8Array>;
  const stop = cancel as () => void;
  const reader: PluginMediaReader = Object.freeze({
    reference: reference.value,
    [Symbol.asyncIterator]() {
      return read.call(value);
    },
    cancel() {
      stop.call(value);
    },
  });
  return accept(reader);
}

function readWriter(
  value: unknown,
  owner: OwnerRef,
  taskId: string,
): Accepted<PluginMediaWriter> | null {
  if (typeof value !== 'object' || value === null) return null;
  if (types.isProxy(value)) return null;
  const write = readDataValue(value, 'write');
  const end = readDataValue(value, 'end');
  const cancel = readDataValue(value, 'cancel');
  const reference = readReference(readDataValue(value, 'reference'), owner, taskId);
  if (typeof write !== 'function' || typeof end !== 'function' || typeof cancel !== 'function') {
    return null;
  }
  if (reference === null) return null;
  const send = write as (payload: Uint8Array) => Promise<unknown>;
  const finish = end as () => Promise<unknown>;
  const stop = cancel as () => void;
  const writer: PluginMediaWriter = Object.freeze({
    reference: reference.value,
    async write(payload: Uint8Array): Promise<Result<null>> {
      if (!(payload instanceof Uint8Array) || types.isProxy(payload)) {
        return fail('invalid-input');
      }
      let raw: unknown;
      try {
        raw = await send.call(value, payload);
      } catch {
        return fail('unavailable');
      }
      return readResult(raw, acceptNull) ?? fail('unavailable');
    },
    async end(): Promise<Result<null>> {
      let raw: unknown;
      try {
        raw = await finish.call(value);
      } catch {
        return fail('unavailable');
      }
      return readResult(raw, acceptNull) ?? fail('unavailable');
    },
    cancel() {
      stop.call(value);
    },
  });
  return accept(writer);
}

const DANGEROUS_KEYS: ReadonlySet<string> = new Set(['__proto__', 'prototype', 'constructor']);

/**
 * 任务结构体：`taskId`/`signal` 必填，`deadline` 可选。
 *
 * 宿主可能给任务对象附带自己的字段，因此不要求闭合；但危险键一律拒绝，字段只按
 * descriptor 读取，绝不做 `String(...)` 之类的强制转换。
 */
function readTask(task: unknown): PluginTask | null {
  if (!isPlainReflectable(task)) return null;
  for (const key of Object.getOwnPropertyNames(task)) {
    if (DANGEROUS_KEYS.has(key)) return null;
  }
  const taskId = readDataValue(task, 'taskId');
  const signal = readDataValue(task, 'signal');
  const deadline = readDataValue(task, 'deadline');
  if (typeof taskId !== 'string' || !LOCAL_ID.test(taskId)) return null;
  if (!isNativeSignal(signal)) return null;
  if (deadline === ABSENT) return { taskId, signal };
  if (typeof deadline !== 'number' || !Number.isFinite(deadline)) return null;
  return { taskId, signal, deadline };
}

/**
 * 把宿主端口包成冻结的 `PluginHostServices`。
 *
 * 端口方法只在创建时读取一次，之后既不重新读取也不外露；每次调用都先校验任务
 * 与 scope 状态，调用后再校验一次，避免取消或超时后交付晚到结果。
 */
export function createPluginHostServices(
  scope: PluginHostScope,
  port: PluginHostPort,
): PluginHostServices {
  if (!isPlainReflectable(scope)) throw invalidScope();
  const owner = readOwner(readDataValue(scope, 'owner'));
  const signal = readDataValue(scope, 'signal');
  if (owner === null || !isNativeSignal(signal)) throw invalidScope();
  if (!isReflectable(port)) throw invalidScope();

  const getConfig = readDataValue(port, 'getConfig');
  const invoke = readDataValue(port, 'invoke');
  const openInput = readDataValue(port, 'openInput');
  const openOutput = readDataValue(port, 'openOutput');
  if (
    typeof getConfig !== 'function' ||
    typeof invoke !== 'function' ||
    typeof openInput !== 'function' ||
    typeof openOutput !== 'function'
  ) {
    throw invalidScope();
  }

  const scopeOwner = Object.freeze({ ...owner });
  const callGetConfig = getConfig as PluginHostPort['getConfig'];
  const callInvoke = invoke as PluginHostPort['invoke'];
  const callOpenInput = openInput as PluginHostPort['openInput'];
  const callOpenOutput = openOutput as PluginHostPort['openOutput'];

  /** 调用前/后都检查：scope 取消、任务取消、deadline 过期都立即拒绝。 */
  const checkTask = (task: PluginTask): KernelError['code'] | null => {
    if (aborted(signal)) return 'cancelled';
    if (aborted(task.signal)) return 'cancelled';
    if (task.deadline !== undefined && performance.now() >= task.deadline) return 'timeout';
    return null;
  };

  const config = Object.freeze({
    async get(): Promise<Result<PluginConfigSnapshot>> {
      if (aborted(signal)) return fail('cancelled');
      let raw: unknown;
      try {
        raw = await callGetConfig.call(port, scopeOwner);
      } catch {
        return fail('unavailable');
      }
      if (aborted(signal)) return fail('cancelled');
      const result = readResult(raw, (value) => readSnapshot(value, owner));
      if (result === null) return fail('unavailable');
      return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error };
    },
  });

  const capabilities = Object.freeze({
    async invoke(
      task: PluginTask,
      capability: CapabilityId,
      method: LocalId,
      input: JsonValue,
    ): Promise<Result<JsonValue>> {
      const checked = readTask(task);
      if (checked === null) return fail('invalid-input');
      if (typeof capability !== 'string' || !CAPABILITY_ID.test(capability)) {
        return fail('invalid-input');
      }
      if (typeof method !== 'string' || !LOCAL_ID.test(method)) return fail('invalid-input');
      const before = checkTask(checked);
      if (before !== null) return fail(before);
      const payload = readJson(input);
      if (payload === null) return fail('invalid-input');

      let raw: unknown;
      try {
        raw = await callInvoke.call(port, scopeOwner, checked, capability, method, payload.value);
      } catch {
        return fail('unavailable');
      }
      const after = checkTask(checked);
      if (after !== null) return fail(after);
      const result = readResult(raw, (value) => {
        const copied = readJson(value);
        return copied === null ? null : accept(deepFreeze(copied.value));
      });
      if (result === null) return fail('unavailable');
      return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error };
    },
  });

  const media = Object.freeze({
    async openInput(task: PluginTask): Promise<Result<PluginMediaReader>> {
      const checked = readTask(task);
      if (checked === null) return fail('invalid-input');
      const before = checkTask(checked);
      if (before !== null) return fail(before);
      let raw: unknown;
      try {
        raw = await callOpenInput.call(port, scopeOwner, checked);
      } catch {
        return fail('unavailable');
      }
      const after = checkTask(checked);
      if (after !== null) return fail(after);
      const result = readResult(raw, (value) => readReader(value, owner, checked.taskId));
      if (result === null) return fail('unavailable');
      return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error };
    },
    async openOutput(task: PluginTask): Promise<Result<PluginMediaWriter>> {
      const checked = readTask(task);
      if (checked === null) return fail('invalid-input');
      const before = checkTask(checked);
      if (before !== null) return fail(before);
      let raw: unknown;
      try {
        raw = await callOpenOutput.call(port, scopeOwner, checked);
      } catch {
        return fail('unavailable');
      }
      const after = checkTask(checked);
      if (after !== null) return fail(after);
      const result = readResult(raw, (value) => readWriter(value, owner, checked.taskId));
      if (result === null) return fail('unavailable');
      return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error };
    },
  });

  return Object.freeze({
    version: 1 as const,
    config,
    capabilities,
    media,
  });
}
