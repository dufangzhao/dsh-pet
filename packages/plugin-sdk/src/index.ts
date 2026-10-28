/**
 * `@pet/plugin-sdk` 根入口（浏览器安全）。
 *
 * 只导出插件作者需要的类型与 `definePlugin`。本文件的每个 import 都是
 * `import type`，运行时导入数为零：渲染进程不会因此拉入 Node、Electron、
 * host-kernel 或 contracts/validation。宿主工厂在 `@pet/plugin-sdk/host`。
 */

import type {
  CapabilityId,
  ConfigSave,
  JsonObject,
  JsonValue,
  LocalId,
  OwnerRef,
  PluginId,
  Result,
} from '@pet/contracts';

/**
 * 一次用户意图的任务句柄。
 *
 * `signal` 是原生 AbortSignal；`deadline` 是当前时钟域的单调毫秒，不能跨进程比较。
 */
export interface PluginTask {
  readonly taskId: LocalId;
  readonly signal: AbortSignal;
  readonly deadline?: number;
}

/** 宿主交付给插件的只读配置快照；`data` 是已校验、已冻结的 JSON 对象副本。 */
export interface PluginConfigSnapshot {
  readonly pluginId: PluginId;
  readonly instanceId: LocalId;
  readonly schemaVersion: number;
  readonly revision: number;
  readonly data: JsonObject;
}

/**
 * 媒体流引用：只描述端点身份，不携带字节。
 *
 * 宿主依据已绑定的任务为端点选择数据源/去向；引用不能用来更换 owner 或任务。
 */
export interface MediaReference {
  readonly streamId: LocalId;
  readonly taskId: LocalId;
  readonly owner: OwnerRef;
}

/** 插件向宿主写出的媒体端点。字节只经此端口，不进入控制通道的 JSON。 */
export interface PluginMediaWriter {
  readonly reference: MediaReference;
  write(payload: Uint8Array): Promise<Result<null>>;
  end(): Promise<Result<null>>;
  cancel(): void;
}

/** 宿主向插件送入的媒体端点；单消费者，`cancel` 结束流。 */
export interface PluginMediaReader extends AsyncIterable<Uint8Array> {
  readonly reference: MediaReference;
  cancel(): void;
}

/**
 * 凭据服务：插件唯一能拿到明文的位置。
 *
 * 原始值只出现在 `operation` 的参数里，不进 `Result`、不进配置快照、不进日志。
 * 没有 set/delete/repair/授权/namespace 参数：owner 由宿主工厂绑定，`keyId` 只能是
 * 本插件已声明的本地标识。这是「已知值」的有限旁路防护，不是同进程恶意代码的沙箱。
 */
export interface PluginCredentialServices {
  withSecret(
    task: PluginTask,
    keyId: LocalId,
    operation: (secret: string, signal: AbortSignal) => Promise<JsonValue>,
  ): Promise<Result<JsonValue>>;
}

/** 插件可用的宿主服务。没有任意 request/send，也没有文件、网络、进程或凭据明文接口。 */
export interface PluginHostServices {
  readonly version: 1;
  readonly config: {
    get(): Promise<Result<PluginConfigSnapshot>>;
    save?(
      task: PluginTask,
      data: JsonObject,
      expectedRevision: number,
    ): Promise<Result<ConfigSave>>;
  };
  readonly capabilities: {
    invoke(
      task: PluginTask,
      capability: CapabilityId,
      method: LocalId,
      input: JsonValue,
    ): Promise<Result<JsonValue>>;
  };
  readonly media: {
    openInput(task: PluginTask): Promise<Result<PluginMediaReader>>;
    openOutput(task: PluginTask): Promise<Result<PluginMediaWriter>>;
  };
  /** 可选凭据入口：宿主端口没有声明 `withSecret` 时这个字段整体不存在。 */
  readonly credentials?: PluginCredentialServices;
}

/**
 * 宿主注入给 `createPluginHostServices` 的端口。
 *
 * 只是宿主侧的注入参数，绝不会出现在返回的服务对象上；无权限时由宿主返回
 * `permission-denied`，SDK 不补默认值。
 */
export interface PluginHostPort {
  getConfig(owner: OwnerRef): Promise<Result<PluginConfigSnapshot>>;
  saveConfig?(
    owner: OwnerRef,
    task: PluginTask,
    data: JsonObject,
    expectedRevision: number,
  ): Promise<Result<ConfigSave>>;
  invoke(
    owner: OwnerRef,
    task: PluginTask,
    capability: CapabilityId,
    method: LocalId,
    input: JsonValue,
  ): Promise<Result<JsonValue>>;
  openInput(owner: OwnerRef, task: PluginTask): Promise<Result<PluginMediaReader>>;
  openOutput(owner: OwnerRef, task: PluginTask): Promise<Result<PluginMediaWriter>>;
  /**
   * 可选凭据端口：真正的传输、授权与已知值登记都由宿主完成。
   *
   * `operation` 是 SDK 包装过的一次性回调。端口必须原样用 `(secret, signal)`
   * 调用它一次、等待结果，并在成功时把同一个结果（或 `null`）作为 `value` 返回；
   * 跳过、重复调用或返回别的值都会被 SDK 拒绝。
   */
  withSecret?(
    owner: OwnerRef,
    task: PluginTask,
    keyId: LocalId,
    operation: (secret: string, signal: AbortSignal) => Promise<JsonValue>,
  ): Promise<Result<JsonValue>>;
}

/** 能力方法签名：任务与 JSON 输入，异步返回 JSON。不额外导出，避免扩大 SDK 面。 */
type CapabilityMethod = (task: PluginTask, input: JsonValue) => Promise<JsonValue>;

/** 同步或异步释放函数。不额外导出，避免扩大 SDK 面。 */
type Disposer = () => void | Promise<void>;

/**
 * 激活上下文。`provide`/`contribute` 都是同步注册：只登记，不执行。
 */
export interface PluginContext {
  /** Persistent path supplied only for declared plugin-data access. */
  readonly dataDirectory?: string;
  readonly owner: Readonly<OwnerRef>;
  readonly signal: AbortSignal;
  readonly config: Readonly<JsonObject>;
  provide(providerId: LocalId, methods: Readonly<Record<string, CapabilityMethod>>): void;
  contribute(contributionId: LocalId, handler?: CapabilityMethod): void;
  effect(factory: () => Disposer): void;
  readonly host: PluginHostServices;
}

/** 插件定义：激活入口与可选的配置迁移。 */
export interface PluginDefinition {
  activate(context: PluginContext): void | Disposer | Promise<void | Disposer>;
  migrateConfig?(request: {
    readonly fromVersion: number;
    readonly toVersion: number;
    readonly data: Readonly<JsonObject>;
    readonly signal: AbortSignal;
  }): Promise<JsonObject>;
}

const INVALID_DEFINITION = 'invalid plugin definition';

function invalidDefinition(): TypeError {
  return new TypeError(INVALID_DEFINITION);
}

/**
 * 校验并冻结一份插件定义。
 *
 * 只检查形状（自有 `activate`/`migrateConfig` 函数、无未知字段、无访问器）；
 * 不执行 `activate` 或 `migrateConfig`，不创建权限，不做任何 I/O。返回的是
 * 冻结的自有顶层副本，因此调用方之后再改原对象不会影响已定义结果。
 */
export function definePlugin(definition: PluginDefinition): PluginDefinition {
  if (typeof definition !== 'object' || definition === null || Array.isArray(definition)) {
    throw invalidDefinition();
  }
  const record = definition as unknown as Record<string, unknown>;
  const prototype = Object.getPrototypeOf(record);
  if (prototype !== Object.prototype && prototype !== null) throw invalidDefinition();
  if (Object.getOwnPropertySymbols(record).length > 0) throw invalidDefinition();

  const activate = Object.getOwnPropertyDescriptor(record, 'activate');
  if (activate === undefined || !('value' in activate) || typeof activate.value !== 'function') {
    throw invalidDefinition();
  }
  const migrate = Object.getOwnPropertyDescriptor(record, 'migrateConfig');
  if (migrate !== undefined && (!('value' in migrate) || typeof migrate.value !== 'function')) {
    throw invalidDefinition();
  }
  for (const key of Object.getOwnPropertyNames(record)) {
    if (key !== 'activate' && key !== 'migrateConfig') throw invalidDefinition();
  }

  const copy: PluginDefinition = {
    activate: activate.value as PluginDefinition['activate'],
  };
  if (migrate !== undefined) {
    copy.migrateConfig = migrate.value as NonNullable<PluginDefinition['migrateConfig']>;
  }
  return Object.freeze(copy);
}
