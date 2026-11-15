/**
 * 协议响应校验。
 *
 * 只信任界面真正读取的字段，并按契约重建对象：未知附加字段被忽略，
 * 缺失或类型不对就让整条响应作废——界面不会拿着半个对象去渲染。
 * 浏览器安全：不引 Node、Ajv 或 host-kernel，也没有运行时 Schema 依赖。
 */
import {
  COMPANION_PROTOCOL_VERSION,
  COMPANION_MEMORY_MAX_FACTS,
  COMPANION_MEMORY_MAX_KEY_UNITS,
  COMPANION_MEMORY_MAX_VALUE_UNITS,
  COMPANION_MEMORY_MAX_DATA_BYTES,
  COMPANION_MEMORY_MAX_ORIGIN_BYTES,
  type CompanionApplication,
  type CompanionAudience,
  type CompanionMaterialRef,
  isCompanionAudience,
  isCompanionConversationAudience,
  isCompanionMessageContent,
  isCompanionMaterialRef,
  isCompanionOrigins,
  isCompanionTaskOrigin,
  isQQStatus,
  COMPANION_MATERIAL_MAX_PARTS,
  type CompanionFactOrigin,
  type CompanionMemoryStatus,
  type CompanionMemoryView,
  type CompanionMemoryMutationResult,
  isKernelErrorCode,
  makeError,
  type CompanionAgentView,
  type CompanionProfileView,
  type CompanionArtifact,
  type CompanionCommandReceipt,
  type CompanionEvent,
  type CompanionFact,
  type CompanionMessage,
  type CompanionModelBindingView,
  type CompanionModelCheckView,
  type CompanionModelConnectorView,
  type CompanionModelCredentialView,
  type CompanionModelView,
  type CompanionPluginView,
  type CompanionSnapshot,
  type CompanionTask,
  type CompanionTaskStatus,
  type JsonObject,
  type JsonValue,
  type KernelError,
  type ResponsesConnectionSettings,
} from '@pet/contracts';

interface ProtocolFailure {
  readonly error: KernelError;
  /** 服务端协议版本不被支持时是收到的数字；其它失败为 null。 */
  readonly version: number | null;
}

type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: ProtocolFailure };

function protocolFailure(
  error: KernelError,
  version: number | null = null,
): { readonly ok: false; readonly failure: ProtocolFailure } {
  return { ok: false, failure: { error, version } };
}

const malformed = () => protocolFailure(makeError('unavailable', false));

type Fields = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string';
const isId = (value: unknown): value is string =>
  isText(value) && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const isFlag = (value: unknown): value is boolean => typeof value === 'boolean';
/**
 * 时间戳必须在 Date 能表示的范围内：超出 ±8.64e15 的有限数字会让
 * `Intl.DateTimeFormat` 与 `toISOString()` 抛 RangeError，直接打断渲染。
 */
const MAX_TIME = 8.64e15;
const isTime = (value: unknown): value is number =>
  typeof value === 'number' && Math.abs(value) <= MAX_TIME;
const isInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value);
/** 游标与事件序号：安全非负整数。 */
const isCount = (value: unknown): value is number => isInteger(value) && value >= 0;

/** 只用于事件 data：它从不参与渲染，但仍须是有限深度的 JSON 对象。 */
function isJson(value: unknown, depth = 0): value is JsonValue {
  if (depth > 8) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJson(item, depth + 1));
  if (isRecord(value)) return Object.values(value).every((item) => isJson(item, depth + 1));
  return false;
}

function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value) && Object.values(value).every((item) => isJson(item));
}

function parseList<T>(value: unknown, parse: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  const items: T[] = [];
  for (const item of value) {
    const parsed = parse(item);
    if (parsed === null) return null;
    items.push(parsed);
  }
  return items;
}

/**
 * 按固定错误码重建，丢弃服务端给的 messageKey：显示文案只来自本地表，
 * 未知码收敛为 internal（makeError 自己就做这件事）。
 */
export function parseKernelError(value: unknown): KernelError | null {
  if (!isRecord(value)) return null;
  const code = value['code'];
  if (!isText(code)) return null;
  const retryable = value['retryable'];
  return makeError(
    isKernelErrorCode(code) ? code : 'internal',
    isFlag(retryable) ? retryable : undefined,
  );
}

/**
 * 错误字段在契约里必填：`null` 表示没有错误，缺失或读不懂都算整条作废
 * （JSON 里不会有 undefined，因此 undefined 就是缺字段）。
 */
function parseNullableError(value: unknown): KernelError | null | undefined {
  if (value === null) return null;
  return parseKernelError(value) ?? undefined;
}

function isTaskStatus(value: unknown): value is CompanionTaskStatus {
  switch (value) {
    case 'accepted':
    case 'running':
    case 'cancel-requested':
    case 'completed':
    case 'cancelled':
    case 'failed':
    case 'interrupted':
    case 'unknown':
      return true;
    default:
      return false;
  }
}

function isEventKind(value: unknown): value is CompanionEvent['kind'] {
  switch (value) {
    case 'message':
    case 'task':
    case 'fact':
    case 'profile':
    case 'runtime':
      return true;
    default:
      return false;
  }
}

function parseArtifact(value: unknown): CompanionArtifact | null {
  if (!isRecord(value)) return null;
  const id = value['id'];
  const taskId = value['taskId'];
  const name = value['name'];
  const mediaType = value['mediaType'];
  const sizeBytes = value['sizeBytes'];
  if (!isText(id) || !isText(taskId) || !isText(name) || !isText(mediaType)) return null;
  if (!isCount(sizeBytes)) return null;
  return { id, taskId, name, mediaType, sizeBytes };
}

function parseMessage(value: unknown): CompanionMessage | null {
  if (!isRecord(value)) return null;
  const id = value['id'];
  const role = value['role'];
  const text = value['text'];
  const createdAt = value['createdAt'];
  const inputId = value['inputId'];
  const taskId = value['taskId'];
  if (!isText(id) || !isText(text) || !isTime(createdAt)) return null;
  if (role !== 'user' && role !== 'assistant' && role !== 'notice') return null;
  if (inputId !== null && !isText(inputId)) return null;
  if (taskId !== null && !isText(taskId)) return null;

  /**
   * 多参与者之后，消息多了归属与内容形态。
   *
   * 这些字段是可选的（旧服务/旧记录没有），但**一旦出现就必须整份读得懂**：
   * 剥掉 audience 会让界面把群里的话当成自己的，剥掉 materials/content 会让
   * 长文与附件显示成不完整正文。用契约自己的 guard 判定，界面不再复述形状。
   */
  const audience =
    value['audience'] === undefined
      ? undefined
      : isCompanionConversationAudience(value['audience'])
        ? value['audience']
        : null;
  if (audience === null) return null;
  const origins =
    value['origins'] === undefined
      ? undefined
      : isCompanionOrigins(value['origins'])
        ? value['origins']
        : null;
  if (origins === null) return null;
  const materials =
    value['materials'] === undefined
      ? undefined
      : Array.isArray(value['materials']) &&
          value['materials'].length <= COMPANION_MATERIAL_MAX_PARTS &&
          value['materials'].every(isCompanionMaterialRef)
        ? (value['materials'] as readonly CompanionMaterialRef[])
        : null;
  if (materials === null) return null;
  const content =
    value['content'] === undefined
      ? undefined
      : isCompanionMessageContent(value['content'])
        ? value['content']
        : null;
  if (content === null) return null;

  return {
    id,
    role,
    text,
    createdAt,
    inputId,
    taskId,
    ...(audience === undefined ? {} : { audience }),
    ...(origins === undefined ? {} : { origins }),
    ...(materials === undefined ? {} : { materials }),
    ...(content === undefined ? {} : { content }),
  };
}

function parseFact(value: unknown): CompanionFact | null {
  if (!isRecord(value)) return null;
  const key = value['key'];
  const text = value['value'];
  const revision = value['revision'];
  const updatedAt = value['updatedAt'];
  if (
    !isText(key) ||
    !key ||
    key.length > COMPANION_MEMORY_MAX_KEY_UNITS ||
    !isText(text) ||
    !text ||
    text.length > COMPANION_MEMORY_MAX_VALUE_UNITS ||
    !isCount(revision) ||
    revision < 1 ||
    !isTime(updatedAt)
  )
    return null;
  const origin = value['origin'] === undefined ? undefined : parseOrigin(value['origin']);
  if (origin === null) return null;
  // scope 是行身份的一部分：同键的私有行与公开行是两条，丢了它就没法区分。
  const audience = value['audience'] === undefined ? undefined : parseAudience(value['audience']);
  if (audience === null) return null;
  return {
    key,
    value: text,
    revision,
    updatedAt,
    ...(origin === undefined ? {} : { origin }),
    ...(audience === undefined ? {} : { audience }),
  };
}

function parsePlugin(value: unknown): CompanionPluginView | null {
  if (!isRecord(value)) return null;
  const id = value['id'];
  const name = value['name'];
  const state = value['state'];
  const desiredActive = value['desiredActive'];
  const guarded = value['protected'];
  if (!isText(id) || !isText(name) || !isText(state)) return null;
  if (!isFlag(desiredActive) || !isFlag(guarded)) return null;
  return { id, name, state, desiredActive, protected: guarded };
}

export function parseTask(value: unknown): CompanionTask | null {
  if (!isRecord(value)) return null;
  const id = value['id'];
  const executionId = value['executionId'];
  const title = value['title'];
  const status = value['status'];
  const createdAt = value['createdAt'];
  const updatedAt = value['updatedAt'];
  const exitCode = value['exitCode'];
  const stdout = value['stdout'];
  const stderr = value['stderr'];
  const logsTruncated = value['logsTruncated'];
  if (!isText(id) || !isText(executionId) || !isText(title)) return null;
  if (!isTaskStatus(status) || !isTime(createdAt) || !isTime(updatedAt)) return null;
  if (exitCode !== null && !isInteger(exitCode)) return null;
  if (!isText(stdout) || !isText(stderr) || !isFlag(logsTruncated)) return null;
  const artifacts = parseList(value['artifacts'], parseArtifact);
  const error = parseNullableError(value['error']);
  if (
    artifacts === null ||
    error === undefined ||
    artifacts.some((artifact) => artifact.taskId !== id)
  )
    return null;
  // 任务的发起人/受众是权限与路由的依据，不能在这一层被剥掉。
  const origin =
    value['origin'] === undefined
      ? undefined
      : isCompanionTaskOrigin(value['origin'])
        ? value['origin']
        : null;
  if (origin === null) return null;
  return {
    id,
    executionId,
    title,
    status,
    createdAt,
    updatedAt,
    exitCode,
    stdout,
    stderr,
    logsTruncated,
    artifacts,
    error,
    ...(origin === undefined ? {} : { origin }),
  };
}

function parseAgent(value: unknown): CompanionAgentView | null {
  if (!isRecord(value)) return null;
  const id = value['id'];
  const name = value['name'];
  // harness 是普通字符串：不假设只有两个取值。
  const harness = value['harness'];
  const mode = value['mode'];
  const status = value['status'];
  const profileRevision = value['profileRevision'];
  if (!isId(id) || !isText(name) || !isText(harness) || !isCount(profileRevision)) return null;
  if (mode !== 'scripted' && mode !== 'model') return null;
  if (status !== 'ready' && status !== 'busy' && status !== 'unavailable') return null;
  const error = parseNullableError(value['error']);
  if (error === undefined) return null;
  const profileApplication =
    value['profileApplication'] === undefined
      ? undefined
      : parseApplication(value['profileApplication']);
  if (
    profileApplication === null ||
    (profileApplication?.appliedRevision !== undefined &&
      profileApplication.appliedRevision !== null &&
      (profileApplication.appliedRevision < 1 ||
        profileApplication.appliedRevision > profileRevision))
  )
    return null;
  return {
    id,
    name,
    harness,
    mode,
    status,
    profileRevision,
    error,
    ...(profileApplication === undefined ? {} : { profileApplication }),
  };
}

/**
 * 投影标记只影响「是否还有更早记录」的提示；读不懂就不提示，
 * 因为不提示本身不构成对完整性的声明。
 */
function parseProjection(value: unknown): NonNullable<CompanionSnapshot['projection']> | undefined {
  if (!isRecord(value)) return undefined;
  const hasMoreMessages = value['hasMoreMessages'];
  const hasMoreTasks = value['hasMoreTasks'];
  const taskDetailsTruncated = value['taskDetailsTruncated'];
  if (!isFlag(hasMoreMessages) || !isFlag(hasMoreTasks) || !isFlag(taskDetailsTruncated)) {
    return undefined;
  }
  return { hasMoreMessages, hasMoreTasks, taskDetailsTruncated };
}

const AUTH_MODES = ['local-client-id', 'gateway-key'] as const;
const CHECK_STATES = ['unconfigured', 'configured', 'validating', 'verified', 'failed'] as const;
const EVIDENCE = ['network', 'synthetic'] as const;
const CREDENTIAL_SOURCES = [
  'none',
  'local-client-id',
  'not-required',
  'environment',
  'memory',
] as const;

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

/** 可选字符串字段：契约用 `null` 表示没有，缺失同样算读不懂。 */
function parseNullableText(value: unknown): string | null | undefined {
  if (value === null) return null;
  return isText(value) ? value : undefined;
}

function parseNullableTime(value: unknown): number | null | undefined {
  if (value === null) return null;
  return isTime(value) ? value : undefined;
}

function parseSettings(value: unknown): ResponsesConnectionSettings | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const baseUrl = value['baseUrl'];
  const model = value['model'];
  const authMode = value['authMode'];
  if (!isText(baseUrl) || !isText(model) || !isOneOf(AUTH_MODES, authMode)) return undefined;
  return { baseUrl, model, authMode };
}

function parseCredential(value: unknown): CompanionModelCredentialView | null {
  if (!isRecord(value)) return null;
  const required = value['required'];
  const available = value['available'];
  const source = value['source'];
  const version = value['version'];
  const writable = value['writable'];
  if (!isFlag(required) || !isFlag(available) || !isOneOf(CREDENTIAL_SOURCES, source)) return null;
  if (!isText(version) || !isFlag(writable)) return null;
  return { required, available, source, version, writable };
}

function parseConnector(value: unknown): CompanionModelConnectorView | null {
  if (!isRecord(value)) return null;
  const id = value['id'];
  const label = value['label'];
  const synthetic = value['synthetic'];
  const configRevision = value['configRevision'];
  const model = value['model'];
  if (!isText(id) || !isText(label) || !isFlag(synthetic) || !isCount(configRevision)) return null;
  if (model !== null && !isText(model)) return null;
  const settings = parseSettings(value['settings']);
  const credential = parseCredential(value['credential']);
  if (settings === undefined || credential === null) return null;
  return { id, label, synthetic, configRevision, settings, model, credential };
}

function parseBinding(value: unknown): CompanionModelBindingView | null {
  if (!isRecord(value)) return null;
  const connectorId = value['connectorId'];
  const configRevision = value['configRevision'];
  const credentialVersion = value['credentialVersion'];
  if (!isText(connectorId) || !isCount(configRevision) || !isText(credentialVersion)) return null;
  return { connectorId, configRevision, credentialVersion };
}

function parseCheck(value: unknown): CompanionModelCheckView | null {
  if (!isRecord(value)) return null;
  const state = value['state'];
  if (!isOneOf(CHECK_STATES, state)) return null;
  const commandId = parseNullableText(value['commandId']);
  const startedAt = parseNullableTime(value['startedAt']);
  const checkedAt = parseNullableTime(value['checkedAt']);
  if (commandId === undefined || startedAt === undefined || checkedAt === undefined) return null;
  const elapsedMs = value['elapsedMs'];
  if (elapsedMs !== null && !isCount(elapsedMs)) return null;
  const evidence = value['evidence'];
  if (evidence !== null && !isOneOf(EVIDENCE, evidence)) return null;
  const binding = value['binding'] === null ? null : parseBinding(value['binding']);
  const error = parseNullableError(value['error']);
  if (binding === null && value['binding'] !== null) return null;
  if (error === undefined) return null;
  return {
    state,
    commandId,
    binding,
    startedAt,
    checkedAt,
    elapsedMs,
    evidence,
    error,
  };
}

/**
 * 模型连接视图是可选的：缺省表示这个服务没有该能力，界面就不给入口；
 * 给了但读不懂必须整条作废，否则界面会拿着半个连接去显示「已保存」。
 */
export function parseModelView(value: unknown): CompanionModelView | null {
  if (!isRecord(value)) return null;
  const profileRevision = value['profileRevision'];
  const enabled = value['enabled'];
  if (!isCount(profileRevision) || !isFlag(enabled)) return null;
  const desired = value['desired'];
  if (!isRecord(desired)) return null;
  const mode = desired['mode'];
  const connectorId = desired['connectorId'];
  if (mode !== 'scripted' && mode !== 'model') return null;
  if (!isText(connectorId)) return null;
  const applied = value['applied'] === null ? null : parseBinding(value['applied']);
  if (applied === null && value['applied'] !== null) return null;
  const connectors = parseList(value['connectors'], parseConnector);
  const check = parseCheck(value['check']);
  const error = parseNullableError(value['error']);
  if (connectors === null || check === null || error === undefined) return null;
  return {
    profileRevision,
    desired: { mode, connectorId },
    applied,
    enabled,
    connectors,
    check,
    error,
  };
}

/** `{ok:true,value}` / `{ok:false,error}`；其它形状一律视为服务端不可用。 */
export function parseEnvelope(value: unknown): ParseResult<unknown> {
  if (!isRecord(value)) return malformed();
  if (value['ok'] === true) {
    return Object.hasOwn(value, 'value') ? { ok: true, value: value['value'] } : malformed();
  }
  if (value['ok'] === false) {
    const error = parseKernelError(value['error']);
    return error === null ? malformed() : { ok: false, failure: { error, version: null } };
  }
  return malformed();
}

export function parseSnapshot(value: unknown): ParseResult<CompanionSnapshot> {
  if (!isRecord(value)) return malformed();
  const received = value['protocolVersion'];
  if (received !== COMPANION_PROTOCOL_VERSION) {
    return protocolFailure(makeError('unavailable', false), isCount(received) ? received : null);
  }
  const epoch = value['epoch'];
  const cursor = value['cursor'];
  const now = value['now'];
  if (!isText(epoch) || !isCount(cursor) || !isTime(now)) return malformed();

  // 契约里这些字段都必填：缺省不能当成空数组，否则等于替服务端声明「没有事实」。
  const agent = parseAgent(value['agent']);
  const messages = parseList(value['messages'], parseMessage);
  const tasks = parseList(value['tasks'], parseTask);
  const facts = parseList(value['facts'], parseFact);
  const plugins = parseList(value['plugins'], parsePlugin);
  if (agent === null || messages === null || tasks === null) return malformed();
  if (facts === null || plugins === null) return malformed();

  const projection = parseProjection(value['projection']);
  // `model` 是可选成员：缺省是「旧服务」，出现了就必须整份读得懂。
  const model = value['model'] === undefined ? undefined : parseModelView(value['model']);
  if (model === null) return malformed();
  const memory = value['memory'] === undefined ? undefined : parseMemoryStatus(value['memory']);
  if (memory === null || (memory && !memoryFactsMatch(memory, facts))) return malformed();
  // `qq` 同样是可选成员：缺省是「这个服务没有 QQ」，出现了就必须整份读得懂。
  // 桌面只读这一份状态，不另开 reader。
  const qq = value['qq'] === undefined ? undefined : isQQStatus(value['qq']) ? value['qq'] : null;
  if (qq === null) return malformed();
  return {
    ok: true,
    value: {
      protocolVersion: COMPANION_PROTOCOL_VERSION,
      epoch,
      cursor,
      now,
      agent,
      messages,
      tasks,
      facts,
      plugins,
      ...(projection === undefined ? {} : { projection }),
      ...(model === undefined ? {} : { model }),
      ...(memory === undefined ? {} : { memory }),
      ...(qq === undefined ? {} : { qq }),
    },
  };
}

/**
 * 回执必须回答「我们发出的那一次提交」：commandId 对不上时，
 * 受理的是别的意图，不能拿来清掉本地待确认行。
 */
export function parseReceipt(
  value: unknown,
  expectedCommandId: string,
): CompanionCommandReceipt | null {
  if (!isRecord(value)) return null;
  const commandId = value['commandId'];
  const status = value['status'];
  const messageId = value['messageId'];
  const taskId = value['taskId'];
  if (commandId !== expectedCommandId) return null;
  if (status !== 'accepted' && status !== 'duplicate') return null;
  if (messageId !== null && !isText(messageId)) return null;
  if (taskId !== null && !isText(taskId)) return null;
  return { commandId, status, messageId, taskId };
}

/**
 * 事件只用来提示「有变化」，游标始终取自 snapshot，所以丢弃坏帧不会让游标错位。
 */
export function parseEvent(value: unknown): CompanionEvent | null {
  if (!isRecord(value)) return null;
  const id = value['id'];
  const epoch = value['epoch'];
  const sequence = value['sequence'];
  const time = value['time'];
  const kind = value['kind'];
  const data = value['data'];
  if (!isText(id) || !isText(epoch) || !isCount(sequence) || !isTime(time)) return null;
  if (!isEventKind(kind) || !isJsonObject(data)) return null;
  return { id, epoch, sequence, time, kind, data };
}

/** Config strings count code points; wire payloads retain their independent UTF-8 budget. */
export function parseProfile(value: unknown): CompanionProfileView | null {
  if (!isRecord(value)) return null;
  const { agentId, name, persona, revision } = value;
  if (
    !isId(agentId) ||
    typeof name !== 'string' ||
    [...name].length < 1 ||
    [...name].length > 80 ||
    typeof persona !== 'string' ||
    [...persona].length < 1 ||
    [...persona].length > 16384 ||
    !isCount(revision) ||
    revision < 1
  )
    return null;
  if (value['management'] === undefined) return { agentId, name, persona, revision };
  const management = value['management'];
  if (!isRecord(management)) return null;
  const application = parseApplication(management['application']);
  const overrides = management['launchOverrides'];
  if (
    !application ||
    (application.appliedRevision !== null &&
      (application.appliedRevision < 1 || application.appliedRevision > revision)) ||
    !isRecord(overrides) ||
    !isFlag(overrides['name']) ||
    !isFlag(overrides['persona'])
  )
    return null;
  return {
    agentId,
    name,
    persona,
    revision,
    management: {
      application,
      launchOverrides: { name: overrides['name'], persona: overrides['persona'] },
    },
  };
}

export function parseApplication(value: unknown): CompanionApplication | null {
  if (!isRecord(value)) return null;
  const revision = value['appliedRevision'];
  const error = parseNullableError(value['error']);
  if ((revision !== null && !isCount(revision)) || error === undefined) return null;
  return { appliedRevision: revision, error };
}
export function parseOrigin(value: unknown): CompanionFactOrigin | null {
  if (!isRecord(value)) return null;
  if (value['kind'] === 'legacy-unknown' || value['kind'] === 'owner-form')
    return { kind: value['kind'] };
  const evidence = value['evidence'];
  if (
    value['kind'] !== 'user-input' ||
    !isId(value['inputId']) ||
    !isRecord(evidence) ||
    !isCount(evidence['start']) ||
    !isCount(evidence['end']) ||
    evidence['end'] <= evidence['start'] ||
    evidence['end'] > 8000
  )
    return null;
  return {
    kind: 'user-input',
    inputId: value['inputId'],
    evidence: { start: evidence['start'], end: evidence['end'] },
  };
}
/** 事实的 scope：用契约自己的判定，界面不再复述一遍 audience 的形状。 */
export function parseAudience(value: unknown): CompanionAudience | null {
  return isCompanionAudience(value) ? value : null;
}

export function parseMemoryStatus(value: unknown): CompanionMemoryStatus | null {
  if (!isRecord(value) || !isCount(value['revision'])) return null;
  const application = parseApplication(value['application']);
  const usage = value['usage'];
  if (
    !application ||
    !isRecord(usage) ||
    !isCount(usage['count']) ||
    !isCount(usage['dataBytes']) ||
    !isCount(usage['originBytes']) ||
    usage['count'] > COMPANION_MEMORY_MAX_FACTS ||
    usage['dataBytes'] > COMPANION_MEMORY_MAX_DATA_BYTES ||
    usage['originBytes'] > COMPANION_MEMORY_MAX_ORIGIN_BYTES ||
    (application.appliedRevision !== null && application.appliedRevision > value['revision'])
  )
    return null;
  return {
    revision: value['revision'],
    application,
    usage: {
      count: usage['count'],
      dataBytes: usage['dataBytes'],
      originBytes: usage['originBytes'],
    },
  };
}
export function parseMemory(value: unknown): CompanionMemoryView | null {
  if (!isRecord(value) || !isId(value['agentId'])) return null;
  const status = parseMemoryStatus(value);
  const facts = parseList(value['facts'], parseFact);
  if (!status || !facts || !memoryFactsMatch(status, facts)) return null;
  return { ...status, agentId: value['agentId'], facts };
}
export function parseMemoryMutation(
  value: unknown,
  commandId: string,
): CompanionMemoryMutationResult | null {
  if (!isRecord(value)) return null;
  const receipt = parseReceipt(value['receipt'], commandId);
  const view = parseMemory(value['view']);
  const revision = value['committedRevision'];
  if (revision !== null && !isCount(revision)) return null;
  if (
    !receipt ||
    receipt.messageId !== null ||
    receipt.taskId !== null ||
    !view ||
    (revision === null ? receipt.status !== 'duplicate' : revision < 1 || revision > view.revision)
  )
    return null;
  return { receipt, committedRevision: revision, view };
}

function memoryFactsMatch(status: CompanionMemoryStatus, facts: readonly CompanionFact[]): boolean {
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
  return (
    status.usage.count === facts.length &&
    new Set(facts.map((fact) => fact.key)).size === facts.length &&
    facts.every((fact) => fact.revision <= status.revision) &&
    status.usage.dataBytes ===
      bytes(
        facts.map(({ key, value, revision, updatedAt }) => ({ key, value, revision, updatedAt })),
      ) &&
    status.usage.originBytes ===
      bytes(facts.map((fact) => fact.origin ?? { kind: 'legacy-unknown' }))
  );
}
