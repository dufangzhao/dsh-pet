/**
 * 模型设置的状态机（纯函数，不依赖 React）。
 *
 * 三条不变量：CAS 用草稿读到时的基线；密钥发起即清空、目标一变即作废；
 * 服务端视图是唯一真相，不因「请求成功」就宣布已应用。
 */
import {
  errorMessage,
  type CompanionModelBindingView,
  type CompanionModelCredentialCommand,
  type CompanionModelSaveCommand,
  type CompanionModelTestCommand,
  type CompanionModelCheckView,
  type CompanionModelConnectorView,
  type CompanionModelView,
  type KernelError,
  type JsonObject,
  type ResponsesConnectionSettings,
  type Result,
} from '@pet/contracts';

export type ModelBusy = 'saving' | 'credential' | 'testing' | null;

/**
 * 草稿读到的版本：profile 修订 + 本草稿目标 connector 的 config/credential 修订。
 * 保存时用它做 CAS，而不是用最新视图。
 */
export interface ModelBaseline {
  readonly profileRevision: number;
  readonly connectorId: string;
  readonly configRevision: number;
  readonly credentialVersion: string;
}

export interface ModelDraft {
  readonly connectorId: string;
  readonly mode: 'scripted' | 'model';
  readonly settings: ResponsesConnectionSettings | null;
  readonly baseline: ModelBaseline;
  /** 用户是否动过。不能用内容差异判断：服务端改值也会造成差异，那时该跟上。 */
  readonly edited: boolean;
}

export type ModelNotice =
  | { readonly kind: 'ok' | 'info'; readonly text: string }
  | { readonly kind: 'error'; readonly text: string; readonly error: KernelError | null };

export interface ModelFormState {
  readonly draft: ModelDraft | null;
  /** 只活在这个组件里的一次性输入；发起任何请求后立刻清空。 */
  readonly key: string;
  readonly busy: ModelBusy;
  readonly notice: ModelNotice | null;
  /** 非secret保存意图的 commandId：同一份未改动的意图重试时复用。 */
  readonly saveIntent: { readonly commandId: string; readonly fingerprint: string } | null;
}

export const emptyModelForm: ModelFormState = {
  draft: null,
  key: '',
  busy: null,
  notice: null,
  saveIntent: null,
};

export function baselineOf(view: CompanionModelView, connectorId: string): ModelBaseline {
  const connector = view.connectors.find((item) => item.id === connectorId);
  return {
    profileRevision: view.profileRevision,
    connectorId,
    configRevision: connector?.configRevision ?? 0,
    credentialVersion: connector?.credential.version ?? '',
  };
}

export function seedDraft(view: CompanionModelView): ModelDraft {
  const connector =
    view.connectors.find((item) => item.id === view.desired.connectorId) ?? view.connectors[0];
  const connectorId = connector?.id ?? view.desired.connectorId;
  return {
    connectorId,
    mode: view.desired.mode,
    settings: connector?.settings ?? null,
    baseline: baselineOf(view, connectorId),
    edited: false,
  };
}

export function seedForm(view: CompanionModelView): ModelFormState {
  return { ...emptyModelForm, draft: seedDraft(view) };
}

/**
 * 现在能不能把表单重铺成服务端的值：没编辑、没有待提交的密钥、没有请求在途。
 * 少任何一个条件，一次无关刷新都会清掉输入或错误解锁。
 */
export function followable(state: ModelFormState): boolean {
  return state.draft !== null && !state.draft.edited && state.key === '' && state.busy === null;
}

/**
 * 外部是否改过配置。
 *
 * baseline 描述「profile 修订 + 本草稿目标 connector 的 config/credential 修订」，
 * 所以要和 view 里**同一个 connector** 的当前值比，而不是和服务端当前选择比：
 * 换了目标只是草稿变了，服务端什么都没动。服务端切换选择或改模式会升
 * profileRevision，由那一条覆盖。
 */
export function changedUnderneath(draft: ModelDraft, view: CompanionModelView): boolean {
  const current = baselineOf(view, draft.baseline.connectorId);
  return (
    draft.baseline.profileRevision !== view.profileRevision ||
    draft.baseline.configRevision !== current.configRevision ||
    draft.baseline.credentialVersion !== current.credentialVersion
  );
}

/**
 * 是否正在把**同一个已选连接**从不需要密钥改成网关密钥。
 *
 * 只由该连接已保存的 settings 与草稿的 settings 推导，不看通用的 dirty：
 * 换目标连接本身不算「正在改鉴权」，不需要密钥的连接也就永远不该提示填密钥。
 */
export function pendingAuthChange(draft: ModelDraft, view: CompanionModelView): boolean {
  if (draft.settings === null) return false;
  const saved = view.connectors.find((item) => item.id === draft.connectorId)?.settings ?? null;
  return draft.settings.authMode === 'gateway-key' && saved?.authMode !== 'gateway-key';
}

export interface DirtyState {
  /** 需要走 /api/model 的那部分改动。 */
  readonly nonsecret: boolean;
  /** 只是填了密钥：只走 /api/model/credential。 */
  readonly key: boolean;
}

export function dirtyOf(draft: ModelDraft, view: CompanionModelView, key: string): DirtyState {
  const saved = view.connectors.find((item) => item.id === draft.connectorId)?.settings ?? null;
  return {
    nonsecret:
      draft.connectorId !== view.desired.connectorId ||
      draft.mode !== view.desired.mode ||
      !sameSettings(draft.settings, saved),
    key: key !== '',
  };
}

function sameSettings(
  a: ResponsesConnectionSettings | null,
  b: ResponsesConnectionSettings | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.baseUrl === b.baseUrl && a.model === b.model && a.authMode === b.authMode;
}

export interface SavePlan {
  /** 这一次先发哪个请求；密钥永远单独一次提交。 */
  readonly kind: 'nonsecret' | 'credential';
  readonly commandId: string;
  readonly fingerprint: string;
}

/**
 * 「保存并应用」发什么：只有密钥改动就只写密钥；有设置改动才先保存非secret。
 * 同一份未改动的意图重试复用 commandId，内容一变就是新意图。
 */
export function savePlan(
  state: ModelFormState,
  view: CompanionModelView,
  newCommandId: () => string,
): SavePlan | null {
  if (state.draft === null) return null;
  const dirty = dirtyOf(state.draft, view, state.key);
  if (!dirty.nonsecret && !dirty.key) return null;
  const fingerprint = JSON.stringify({
    connectorId: state.draft.connectorId,
    mode: state.draft.mode,
    settings: state.draft.settings,
    key: dirty.key,
    profileRevision: state.draft.baseline.profileRevision,
    configRevision: state.draft.baseline.configRevision,
    credentialVersion: state.draft.baseline.credentialVersion,
  });
  return {
    kind: dirty.nonsecret ? 'nonsecret' : 'credential',
    commandId:
      state.saveIntent?.fingerprint === fingerprint ? state.saveIntent.commandId : newCommandId(),
    fingerprint,
  };
}

export interface Availability {
  readonly canSave: boolean;
  readonly canTest: boolean;
  /** 不能点时说清为什么；能点时为 null。 */
  readonly saveReason: string | null;
  readonly testReason: string | null;
}

export function availability(
  state: ModelFormState,
  view: CompanionModelView,
  options: { readonly live: boolean; readonly agentBusy: boolean },
): Availability {
  const draft = state.draft;
  if (draft === null) {
    return { canSave: false, canTest: false, saveReason: '正在读取设置。', testReason: null };
  }
  const dirty = dirtyOf(draft, view, state.key);
  const validating = view.check.state === 'validating';
  const applied = view.applied;
  const connector =
    applied === null ? undefined : view.connectors.find((c) => c.id === applied.connectorId);

  const blockedBy = options.live
    ? options.agentBusy
      ? '正在回复，等这一轮结束再切换连接。'
      : null
    : '当前未连接服务。';

  const saveReason =
    blockedBy ??
    (state.busy !== null ? '正在处理上一次操作。' : null) ??
    (validating ? '正在测试，等这一轮结束再保存。' : null) ??
    (!dirty.nonsecret && !dirty.key ? '没有改动。' : null);

  const testReason =
    blockedBy ??
    (state.busy !== null ? '正在处理上一次操作。' : null) ??
    (validating ? '正在测试…' : null) ??
    // 填了但没写入的密钥同样是未保存改动：测的就是还没生效的那份配置。
    (dirty.nonsecret || dirty.key ? '配置有改动，先保存再测试。' : null) ??
    (applied === null ? '还没有应用到服务的连接。' : null) ??
    (applied !== null && applied.connectorId !== draft.connectorId
      ? '测试针对已应用的那一份连接；先保存切换。'
      : null) ??
    (connector !== undefined && connector.credential.required && !connector.credential.available
      ? '还缺密钥。'
      : null);

  return {
    canSave: saveReason === null,
    canTest: testReason === null,
    saveReason,
    testReason,
  };
}

/** 操作开始：密钥立刻从状态里消失，只作为参数传给这一次请求。 */
export function beginOperation(
  state: ModelFormState,
  busy: Exclude<ModelBusy, null>,
  intent: SavePlan | null = null,
): ModelFormState {
  return {
    ...state,
    key: '',
    busy,
    notice: null,
    saveIntent:
      intent === null
        ? state.saveIntent
        : { commandId: intent.commandId, fingerprint: intent.fingerprint },
  };
}

/** 服务端给了新视图：采纳它作为新的基线，并把表单铺回服务端的值。 */
export function adoptView(state: ModelFormState, view: CompanionModelView): ModelFormState {
  return { ...state, busy: null, draft: seedDraft(view), saveIntent: null };
}

/**
 * 冲突之后唯一的恢复动作：只换基线，内容原样留下，由用户核对后再保存。
 * 清掉 saveIntent，免得下次点击复用那个必然冲突的 commandId。
 */
export function rebaseOnLatest(state: ModelFormState, view: CompanionModelView): ModelFormState {
  if (state.draft === null) return state;
  return {
    ...state,
    // 只换版本，不动内容：用户填的值必须原样留下，由他自己核对后再保存。
    draft: { ...state.draft, baseline: baselineOf(view, state.draft.connectorId) },
    saveIntent: null,
    notice: { kind: 'info', text: '已读取最新版本，你填的内容还在。核对后再保存。' },
  };
}

/** 操作失败：保留草稿（用户的输入不能因为一次失败就消失），只报原因。 */
export function failOperation(
  state: ModelFormState,
  error: KernelError,
  text: string,
): ModelFormState {
  return { ...state, busy: null, notice: { kind: 'error', text, error } };
}

export function noteOperation(state: ModelFormState, text: string): ModelFormState {
  return { ...state, busy: null, notice: { kind: 'ok', text } };
}

/** 换连接：换成那一份已保存的设置，并把不属于新目标的密钥丢掉。 */
export function selectConnector(
  state: ModelFormState,
  view: CompanionModelView,
  connectorId: string,
): ModelFormState {
  if (state.draft === null) return state;
  const next = view.connectors.find((item) => item.id === connectorId);
  const retarget = connectorId !== state.draft.connectorId;
  return {
    ...state,
    draft: {
      ...state.draft,
      connectorId,
      settings: next?.settings ?? null,
      // 基线跟着草稿目标走：保存 B 必须用 B 的 config/credential 版本做 CAS。
      // 是否「外部改过」由 changedUnderneath 按同一 connectorId 比较决定，
      // 所以这里换基线不会误报。
      baseline: retarget ? baselineOf(view, connectorId) : state.draft.baseline,
      edited: state.draft.edited || retarget,
    },
    key: retarget ? '' : state.key,
  };
}

export function setMode(state: ModelFormState, mode: 'scripted' | 'model'): ModelFormState {
  return state.draft === null
    ? state
    : {
        ...state,
        draft: { ...state.draft, mode, edited: state.draft.edited || mode !== state.draft.mode },
      };
}

/**
 * 改设置。地址或鉴权方式变了就等于换了目标，必须丢掉已经输入的密钥；
 * 只改模型名仍在同一份凭据下，可以保留。
 */
export function setSettings(
  state: ModelFormState,
  patch: Partial<ResponsesConnectionSettings>,
): ModelFormState {
  if (state.draft === null || state.draft.settings === null) return state;
  const settings = { ...state.draft.settings, ...patch };
  const retarget =
    settings.baseUrl !== state.draft.settings.baseUrl ||
    settings.authMode !== state.draft.settings.authMode;
  return {
    ...state,
    draft: {
      ...state.draft,
      settings,
      edited: state.draft.edited || !sameSettings(settings, state.draft.settings),
    },
    key: retarget ? '' : state.key,
  };
}

/** 输入密钥也算「动过」：后台刷新不能把正在输入的密钥清掉。 */
export function setKey(state: ModelFormState, key: string): ModelFormState {
  if (state.draft === null) return { ...state, key };
  return {
    ...state,
    key,
    draft: { ...state.draft, edited: state.draft.edited || key !== '' },
  };
}

/* ---- 展示文案（纯函数，便于逐条回归） ---- */

export function summaryText(view: CompanionModelView, agentStatus: string): string {
  const applied = view.applied;
  const label = labelOf(view, applied);
  if (applied === null) {
    return view.desired.mode === 'scripted'
      ? '现在用脚本回复。要接真实模型，先选连接并填好地址和模型。'
      : '模型模式已选，但还没有可用的连接。';
  }
  // 只有真的选的是脚本模式才说脚本；「模型模式但前台没切过去」是另一件事。
  if (view.desired.mode === 'scripted') {
    return `连接已就绪（${label}），但服务仍是脚本演示；保存时选「模型回复」才会切换。`;
  }
  if (!view.enabled) return `连接已就绪（${label}），但前台还没有切到它。`;
  const connector = view.connectors.find((item) => item.id === applied.connectorId);
  const model = connector?.model ?? label;
  return agentStatus === 'unavailable'
    ? '模型模式已选，但连接当前不可用。'
    : `模型回复 · ${label} · ${model}`;
}

/**
 * 测试结论只在「测的那份绑定就是现在应用的那份」时成立。
 * 任何一边缺失都说明这条结论不再能归到当前连接上。
 */
export function checkText(
  check: CompanionModelCheckView,
  view: CompanionModelView,
  dirty: boolean,
  live: boolean,
): string {
  if (!live) return '当前状态未知，显示的是上次确认的内容。';
  if (check.state === 'validating') return '正在测试…';
  if (dirty) return '配置有改动，先保存再测试。';
  const settled = check.state === 'verified' || check.state === 'failed';
  if (settled) {
    const same =
      check.binding !== null && view.applied !== null && sameBinding(check.binding, view.applied);
    if (!same) return '这条结果对应的连接已经变了，需要重新测试。';
  }
  if (check.state === 'configured' && check.commandId !== null) {
    return '上次测试没有留下结果，需要重新测试。';
  }
  if (check.state === 'verified' && check.checkedAt !== null) {
    return check.evidence === 'synthetic'
      ? `${clockTimeOf(check.checkedAt)} 模拟检查通过，未连接真实模型。`
      : `${clockTimeOf(check.checkedAt)} 测试通过：这一份连接返回了真实回复。`;
  }
  if (check.state === 'failed') {
    const when = check.checkedAt === null ? '' : `${clockTimeOf(check.checkedAt)} `;
    const why = check.error === null ? '当前不可用' : errorMessage(check.error);
    return `${when}测试没有通过：${why}。`;
  }
  return '还没有测试过这一份连接。';
}

/** 保存后只说这次真的发生了什么；判定依据是响应里的视图，不是请求是否成功。 */
export function savedText(view: CompanionModelView): string {
  if (view.applied === null) return '配置已保存，但还没有应用到服务。';
  return view.enabled ? '已保存并应用。' : '配置已保存，但前台还没有切到这个连接。';
}

export function labelOf(
  view: CompanionModelView,
  binding: CompanionModelBindingView | null,
): string {
  if (binding === null) return '';
  const connector: CompanionModelConnectorView | undefined = view.connectors.find(
    (item) => item.id === binding.connectorId,
  );
  return connector?.label ?? binding.connectorId;
}

export function sameBinding(a: CompanionModelBindingView, b: CompanionModelBindingView): boolean {
  return (
    a.connectorId === b.connectorId &&
    a.configRevision === b.configRevision &&
    a.credentialVersion === b.credentialVersion
  );
}

function clockTimeOf(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(timestamp);
}

/** 只发这三项；服务端 Config 是闭集，多余字段没有意义。 */
export function configOf(settings: ResponsesConnectionSettings): JsonObject {
  return { baseUrl: settings.baseUrl, model: settings.model, authMode: settings.authMode };
}

/* ---- 点击之后发生什么（可注入 client，因此能真的跑一遍） ---- */

export interface ModelTransport {
  saveModel(command: CompanionModelSaveCommand): Promise<Result<CompanionModelView>>;
  testModel(command: CompanionModelTestCommand): Promise<Result<CompanionModelView>>;
  writeModelCredential(
    command: CompanionModelCredentialCommand,
  ): Promise<Result<CompanionModelView>>;
}

/** 密钥写入要对比的那一版。key-only 与清除都用草稿捕获的基线。 */
interface CredentialTarget {
  readonly connectorId: string;
  readonly configRevision: number;
  readonly credentialVersion: string;
}

function baselineTarget(draft: ModelDraft): CredentialTarget {
  return {
    connectorId: draft.connectorId,
    configRevision: draft.baseline.configRevision,
    credentialVersion: draft.baseline.credentialVersion,
  };
}

async function writeCredential(
  state: ModelFormState,
  transport: ModelTransport,
  target: CredentialTarget,
  key: string | null,
): Promise<ModelFormState> {
  const result = await transport.writeModelCredential({
    connectorId: target.connectorId,
    expectedConfigRevision: target.configRevision,
    expectedCredentialVersion: target.credentialVersion,
    apiKey: key,
  });
  if (!result.ok) {
    return failOperation(
      state,
      result.error,
      result.error.code === 'conflict'
        ? '连接在别处改过，密钥没有写入；你的输入还在这里。读取最新版本后再保存。'
        : `密钥没有写入：${errorMessage(result.error)}`,
    );
  }
  return noteOperation(adoptView(state, result.value), '密钥已写入。');
}

/** 「保存并应用」的完整流程。密钥以参数传入，状态里那份在进入前已清空。 */
export async function runSave(
  state: ModelFormState,
  view: CompanionModelView,
  transport: ModelTransport,
  key: string,
): Promise<ModelFormState> {
  // 进入本函数前密钥已被清掉，所以用传入的那一份重新判断「这次要发什么」。
  const plan = savePlan({ ...state, key }, view, newLocalCommandId);
  if (plan === null) return state;
  const draft = state.draft;
  if (draft === null) return state;

  if (plan.kind === 'credential') {
    const target = view.connectors.find((item) => item.id === draft.connectorId);
    if (target === undefined || !target.credential.writable) {
      return failOperation(
        state,
        { code: 'not-ready', messageKey: 'errors.not-ready', retryable: false },
        '这个入口不接受在这里写密钥。',
      );
    }
    const started = beginOperation(state, 'credential', plan);
    return writeCredential(started, transport, baselineTarget(draft), key);
  }

  const started = beginOperation(state, 'saving', plan);
  const result = await transport.saveModel({
    commandId: plan.commandId,
    expectedProfileRevision: draft.baseline.profileRevision,
    connectorId: draft.connectorId,
    expectedConfigRevision: draft.baseline.configRevision,
    mode: draft.mode,
    ...(draft.settings === null ? {} : { config: configOf(draft.settings) }),
  });
  if (!result.ok) {
    // 409 也走这里：草稿原样保留，用户看到固定原因后自己决定下一步。
    return failOperation(
      started,
      result.error,
      result.error.code === 'conflict'
        ? '连接在别处改过，没有覆盖。你的修改还在这里；点「读取最新版本」后再保存。'
        : `没有保存成功：${errorMessage(result.error)}`,
    );
  }
  const saved = result.value;
  const target = saved.connectors.find((item) => item.id === draft.connectorId);
  if (key !== '' && target !== undefined && target.credential.writable) {
    // 第二段用刚返回的那一版：它才是这次保存之后的配置与凭据版本。
    const afterSave = beginOperation(adoptView(started, saved), 'credential', null);
    const written = await writeCredential(
      afterSave,
      transport,
      {
        connectorId: target.id,
        configRevision: target.configRevision,
        credentialVersion: target.credential.version,
      },
      key,
    );
    if (written.notice?.kind === 'error') return written;
    return noteOperation(written, `${savedText(saved)}密钥也已写入。`);
  }
  return noteOperation(
    adoptView(started, saved),
    key === '' ? savedText(saved) : '配置已保存，但这个入口不接受在这里写密钥。',
  );
}

/** 「测试连接」只针对已应用的那一份绑定；没有它就不发请求。 */
export async function runTest(
  state: ModelFormState,
  view: CompanionModelView,
  transport: ModelTransport,
): Promise<ModelFormState> {
  const applied = view.applied;
  if (applied === null) return state;
  const started = beginOperation(state, 'testing');
  const result = await transport.testModel({
    commandId: newLocalCommandId(),
    connectorId: applied.connectorId,
    expectedConfigRevision: applied.configRevision,
    expectedCredentialVersion: applied.credentialVersion,
  });
  if (!result.ok) {
    // 明确拒绝（409/503/401…）说明没开始；网络/超时可能已经受理，
    // 那属于「结果未知」，不能写成一次没开始的测试。
    return failOperation(started, result.error, testFailureText(result.error));
  }
  return noteOperation(adoptView(started, result.value), '已提交测试，结果随后到。');
}

/** 显式清除密钥：`apiKey: null`，不是空字符串。 */
export async function runRemoveKey(
  state: ModelFormState,
  view: CompanionModelView,
  transport: ModelTransport,
): Promise<ModelFormState> {
  const draft = state.draft;
  if (draft === null) return state;
  const target = view.connectors.find((item) => item.id === draft.connectorId);
  if (target === undefined) return state;
  const started = beginOperation(state, 'credential');
  return writeCredential(started, transport, baselineTarget(draft), null);
}

/** 已受理与否决定措辞：只有明确拒绝才能说「没开始」。 */
export function testFailureText(error: KernelError): string {
  return error.code === 'network' || error.code === 'timeout'
    ? '测试请求没有得到答复，可能已经开始；结果以连接状态为准，需要时再测一次。'
    : `这次没有开始测试：${errorMessage(error)}`;
}

let localCounter = 0;
function newLocalCommandId(): string {
  localCounter += 1;
  return `model-${Date.now().toString(36)}-${localCounter}`;
}
