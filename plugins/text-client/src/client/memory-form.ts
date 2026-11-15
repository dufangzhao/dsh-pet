/**
 * 人格与当前记忆的表单规则（纯函数，不依赖 React，web 与桌面共用）。
 *
 * 三条不变量，与模型设置那一套同源：
 * - CAS 用**草稿读到时的版本**：人格用 profileRevision，记忆用 memoryRevision，
 *   单行改动还要带上那一行的 revision。
 * - 只有「已受理」才允许清草稿/推进基线；未知、冲突、过期都保留原文。
 * - 服务端视图是唯一真相；命令回执只属于它自己那次操作，绝不写进全局快照。
 *
 * 这里不发明 DTO：类型全部来自 @pet/contracts。
 */
import {
  errorMessage,
  type CompanionAudience,
  type CompanionFact,
  type CompanionFactOrigin,
  type CompanionMemoryForgetCommand,
  type CompanionMemoryMutationResult,
  type CompanionMemoryStatus,
  type CompanionMemoryUpsertCommand,
  type CompanionMemoryView,
  type CompanionProfileSaveCommand,
  type CompanionProfileView,
  type KernelError,
  type Result,
} from '@pet/contracts';

/** 表单能做的一件事；同一时刻只做一件。 */
export type PersonaMemoryBusy = 'profile' | 'memory' | null;

export type PersonaMemoryNotice =
  | { readonly kind: 'ok' | 'info'; readonly text: string }
  | { readonly kind: 'error'; readonly text: string; readonly error: KernelError | null };

export interface PersonaMemoryForm {
  /** 人格草稿：值 + 它读到的 profileRevision。 */
  readonly name: string;
  readonly persona: string;
  /** null = 还没从真实视图捕获过。0 是合法的 revision，不是「未初始化」。 */
  readonly profileBaseline: number | null;
  /** 用户是否动过人格。不能用内容差异判断：服务端改值也会造成差异。 */
  readonly profileEdited: boolean;
  /**
   * 记忆区当前正在编辑的那一行；null 表示在「新增」。
   *
   * 行的身份是 (audience, key)：管理视图可以同时存在同键的私有行与公开行，
   * 只按 key 找会抓到另一条，随后用不带 audience 的命令改到 owner 事实上。
   */
  readonly editingKey: string | null;
  /** 那一行的 scope；null = 新增，或旧数据里没有 scope 的 owner 事实。 */
  readonly editingAudience: CompanionAudience | null;
  /**
   * 新增一条时选的 scope：'owner-private' 保持旧行为（命令里省略 audience），
   * 'public' 才显式带上 `{kind:'public'}`。编辑既有行时这个字段不参与。
   */
  readonly addingScope: 'owner-private' | 'public';
  readonly key: string;
  readonly value: string;
  /** 这次记忆改动读到的集合版本与（编辑既有行时的）行版本；null = 尚未捕获。 */
  readonly memoryBaseline: number | null;
  readonly factBaseline: number | null;
  /** 只用于「要不要现在显示红字」；不参与校验，也不参与按钮禁用。 */
  readonly memoryTouched: boolean;
  readonly busy: PersonaMemoryBusy;
  readonly notice: PersonaMemoryNotice | null;
}

export const emptyPersonaMemoryForm: PersonaMemoryForm = {
  name: '',
  persona: '',
  profileBaseline: null,
  profileEdited: false,
  editingKey: null,
  editingAudience: null,
  addingScope: 'owner-private',
  key: '',
  value: '',
  memoryBaseline: null,
  factBaseline: null,
  memoryTouched: false,
  busy: null,
  notice: null,
};

/** 人格区能不能编辑：看的是**它自己**那份 metadata，不因为记忆缺字段就一起禁掉。 */
export function profileEditable(view: CompanionProfileView | null): boolean {
  return view !== null && view.management !== undefined;
}

/** 记忆区能不能编辑：同样只看自己的 metadata。 */
export function memoryEditable(status: CompanionMemoryStatus | null | undefined): boolean {
  return status !== undefined && status !== null;
}

/**
 * 表单现在能不能被服务端值重铺：没编辑人格、没有正在写的记忆、没有请求在途。
 * 少任何一个条件，一次无关刷新都会清掉输入。
 */
export function followable(form: PersonaMemoryForm): boolean {
  return !form.profileEdited && form.busy === null && form.key === '' && form.value === '';
}

/** 用已保存的人格重铺，保留刚完成那次操作的提示。 */
export function seedProfile(
  form: PersonaMemoryForm,
  view: CompanionProfileView,
): PersonaMemoryForm {
  return {
    ...form,
    name: view.name,
    persona: view.persona,
    profileBaseline: view.revision,
    profileEdited: false,
    notice: form.notice,
  };
}

/**
 * 外部是否改过人格。
 *
 * 只看「比草稿基线更新」：比基线**旧**的一份是还没跟上的视图，不是别人改了东西。
 * `selfPending` 是自己这次保存还在途——那期间服务端 revision 前进是本次写入的中间态。
 */
export function profileChangedUnderneath(
  baseline: number | null,
  view: CompanionProfileView,
  selfPending = false,
): boolean {
  if (selfPending) return false;
  // 还没捕获基线：任何值都还不是「被改过」。
  if (baseline === null) return false;
  return view.revision > baseline;
}

/**
 * 外部是否改过记忆集合（或正在编辑的那一行）。
 *
 * 与人格同一条规则：只认**比基线更新**的版本。自己保存还在途时不算外部改动。
 * 正在编辑的行被别处删掉也算被改动过——不能当成「还是那一行」继续写。
 */
export function memoryChangedUnderneath(
  baseline: number | null,
  status: CompanionMemoryStatus,
  facts: readonly CompanionFact[],
  editingKey: string | null,
  factBaseline: number | null,
  selfPending = false,
  editingAudience: CompanionAudience | null = null,
): boolean {
  if (selfPending) return false;
  if (baseline !== null && status.revision > baseline) return true;
  if (editingKey === null) return false;
  const row = facts.find((fact) => sameFact(fact, editingKey, editingAudience));
  // 正在编辑的行没了：那是别人删的。
  if (row === undefined) return true;
  // 行被改到比我们捕获的版本更新：那是别人改的。
  return factBaseline !== null && row.revision > factBaseline;
}

/**
 * 键的规范化：去掉首尾空白，区分大小写。
 * 值**原样保留**——不 trim、不改写；空白值不是删除，是无效输入。
 */
/** 契约里的名字/正文上限按**码点**算，不是 UTF-16 单元。 */
export function codePointLength(text: string): number {
  return Array.from(text).length;
}

export function normalizeKey(raw: string): string {
  return raw.trim();
}

/**
 * 键的问题。始终验证——按钮能不能点必须用这个真实结果，
 * 「现在先不红」是渲染层的决定，不是校验结果。
 */
export function keyProblem(raw: string, maxUnits: number): string | null {
  const key = normalizeKey(raw);
  if (key === '') return '键不能为空。';
  if (key.length > maxUnits) return `键最多 ${maxUnits} 个字符。`;
  return null;
}

/** 内容的问题。同样始终验证；只看有没有非空白字符，内容本身一个字符都不改。 */
export function valueProblem(raw: string, maxUnits: number): string | null {
  if (raw.trim() === '') return '内容不能为空。';
  if (raw.length > maxUnits) return `内容最多 ${maxUnits} 个字符。`;
  return null;
}

/** 保存人格要发什么；没有实际改动就不发。 */
export function profilePlan(
  form: PersonaMemoryForm,
  view: CompanionProfileView | null,
): CompanionProfileSaveCommand | null {
  if (view === null || !profileEditable(view)) return null;
  if (form.name === view.name && form.persona === view.persona) return null;
  // 没捕获基线就不发：0 不是一个可以拿去 CAS 的值。
  if (form.profileBaseline === null) return null;
  return {
    expectedProfileRevision: form.profileBaseline,
    name: form.name,
    persona: form.persona,
  };
}

/**
 * 一条事实是不是「正在编辑的那一行」。
 *
 * 必须同时比 scope 与键：同键不同 scope 是两条不同的行。
 * 旧数据没有 audience 字段，`undefined` 与 `null` 视为同一 scope（owner 缺省）。
 */
export function sameFact(
  fact: CompanionFact,
  key: string | null,
  audience: CompanionAudience | null,
): boolean {
  return fact.key === key && (fact.audience ?? null) === (audience ?? null);
}

/** 记忆区此刻在编辑哪一行：新增时是 null，改既有行时是那一行。 */
export function editingFact(
  form: PersonaMemoryForm,
  facts: readonly CompanionFact[],
): CompanionFact | null {
  if (form.editingKey === null) return null;
  return facts.find((fact) => sameFact(fact, form.editingKey, form.editingAudience)) ?? null;
}

export interface MemoryPlan {
  readonly kind: 'upsert' | 'forget';
  readonly commandId: string;
  readonly fingerprint: string;
}

/**
 * 记忆改动要发什么。
 *
 * commandId 由调用方按「同一份未改动的意图」复用：结果未知的重试必须带同一个，
 * 否则服务端会把它当成第二次提交。内容一改就是新意图。
 */
export function memoryPlan(
  form: PersonaMemoryForm,
  kind: 'upsert' | 'forget',
  newCommandId: () => string,
  previous: { readonly commandId: string; readonly fingerprint: string } | null,
): MemoryPlan | null {
  const key = kind === 'forget' ? form.editingKey : normalizeKey(form.key);
  if (key === null) return null;
  if (form.memoryBaseline === null) return null;
  const fingerprint = JSON.stringify({
    kind,
    key,
    // 值按原样参与指纹：改一个空格也是另一件事。
    value: kind === 'upsert' ? form.value : null,
    memoryRevision: form.memoryBaseline,
    factRevision: form.factBaseline,
  });
  return {
    kind,
    commandId: previous?.fingerprint === fingerprint ? previous.commandId : newCommandId(),
    fingerprint,
  };
}

export function upsertCommand(
  form: PersonaMemoryForm,
  plan: MemoryPlan,
): CompanionMemoryUpsertCommand {
  if (form.memoryBaseline === null) throw new Error('memory baseline not captured');
  return {
    commandId: plan.commandId,
    expectedMemoryRevision: form.memoryBaseline,
    // 0 表示「这一行还不存在」——新增的合法基线。
    expectedFactRevision: form.factBaseline ?? 0,
    key: normalizeKey(form.key),
    value: form.value,
    // 编辑既有行：带它捕获的 scope。新增行：只有选了「公开」才显式带上，
    // 默认仍然省略——这样旧命令的 JSON 与指纹一个字节都不变。
    ...(form.editingKey !== null
      ? form.editingAudience === null
        ? {}
        : { audience: form.editingAudience }
      : form.addingScope === 'public'
        ? { audience: { kind: 'public' as const } }
        : {}),
  };
}

/** 忘记：捕获渲染那一行的键、行版本与集合版本，不能拿更新的行去删。 */
export function forgetCommand(
  form: PersonaMemoryForm,
  plan: MemoryPlan,
  key: string,
): CompanionMemoryForgetCommand {
  return {
    commandId: plan.commandId,
    expectedMemoryRevision: form.memoryBaseline ?? 0,
    expectedFactRevision: form.factBaseline ?? 0,
    key,
    ...(form.editingAudience === null ? {} : { audience: form.editingAudience }),
  };
}

export interface Availability {
  readonly canSaveProfile: boolean;
  readonly saveProfileReason: string | null;
  readonly canWriteMemory: boolean;
  readonly memoryReason: string | null;
}

/**
 * 现在能不能写。`live`/`agentBusy`/本地在途是**操作条件**，
 * 与 metadata 是否存在是两回事：metadata 在也不代表此刻能写。
 */
export function availability(
  form: PersonaMemoryForm,
  options: {
    readonly live: boolean;
    readonly agentBusy: boolean;
    readonly profileSupported: boolean;
    readonly memorySupported: boolean;
  },
): Availability {
  const blocked = options.live
    ? options.agentBusy
      ? '正在回复，等这一轮结束再改。'
      : null
    : '当前未连接服务。';

  const busy = form.busy === null ? null : '正在处理上一次操作。';

  const saveProfileReason =
    blocked ??
    busy ??
    (options.profileSupported ? null : '服务暂未提供可编辑的人格。') ??
    (form.name.trim() === '' ? '名字不能为空。' : null) ??
    (form.profileBaseline === null ? '正在读取人格版本…' : null) ??
    (form.persona.trim() === '' ? '人格正文不能为空。' : null);

  const memoryReason =
    blocked ?? busy ?? (options.memorySupported ? null : '服务暂未提供可编辑的记忆。');

  return {
    canSaveProfile: saveProfileReason === null,
    saveProfileReason,
    canWriteMemory: memoryReason === null,
    memoryReason,
  };
}

/** 操作开始：进入忙碌态并清掉上一次的提示。 */
export function beginOperation(
  form: PersonaMemoryForm,
  busy: Exclude<PersonaMemoryBusy, null>,
): PersonaMemoryForm {
  return { ...form, busy, notice: null };
}

/**
 * 人格保存成功。
 *
 * 基线用**这次写入真正落下的 revision**（`saved.revision`），不是提交前那次渲染的值，
 * 也不猜 +1；没拿到就保持原基线，绝不推进到别处的更新上。
 */
export function adoptProfile(
  form: PersonaMemoryForm,
  saved: CompanionProfileView,
): PersonaMemoryForm {
  const applied = saved.management?.application.appliedRevision ?? null;
  const error = saved.management?.application.error ?? null;
  // 这次操作的结论只用这次响应里的事实：保存成功不等于已经在用。
  return {
    ...form,
    busy: null,
    name: saved.name,
    persona: saved.persona,
    profileBaseline: saved.revision,
    profileEdited: false,
    notice: {
      kind: 'ok',
      text:
        error !== null
          ? `已保存，但尚未生效：${errorMessage(error)}`
          : applied === null
            ? '已保存，尚未生效。'
            : `已保存并生效（修订 ${applied}）。`,
    },
  };
}

/**
 * 记忆改动成功。
 *
 * 基线用回执里的 `committedRevision`：为 null 表示这是**旧命令的只读重放**，
 * 此时不推进基线、也不说「刚保存」。
 */
export function adoptMemory(
  form: PersonaMemoryForm,
  result: CompanionMemoryMutationResult,
  facts: readonly CompanionFact[],
): PersonaMemoryForm {
  const duplicate = result.committedRevision === null;
  const stillThere =
    form.editingKey === null
      ? null
      : (facts.find((f) => sameFact(f, form.editingKey, form.editingAudience)) ?? null);
  return {
    ...form,
    busy: null,
    editingKey: null,
    editingAudience: null,
    addingScope: 'owner-private',
    key: '',
    value: '',
    memoryTouched: false,
    // 只读重放没有新的集合版本：保持原基线，等用户显式重读。
    memoryBaseline: duplicate ? form.memoryBaseline : result.committedRevision,
    factBaseline: stillThere?.revision ?? null,
    notice: {
      kind: result.view.application.error === null ? 'ok' : 'info',
      text: duplicate
        ? '这是此前那次操作的结果，没有重复写入。'
        : result.receipt.status === 'duplicate'
          ? '这次提交此前已记录，没有重复写入。'
          : result.view.application.error === null
            ? '已保存。'
            : // 保存成功但应用失败：两个事实分开说，不谎称已在用。
              `已保存，但尚未应用：${errorMessage(result.view.application.error)}`,
    },
  };
}

/**
 * 忘记成功。
 *
 * 与 upsert 的成功不同：这次操作删的是**别人那一行**，不能顺手清掉用户
 * 正在编辑的另一行草稿。只有被忘记的正好是当前编辑行时才收起编辑态。
 * 集合基线前进到 committedRevision；行基线只在仍编辑该行时才更新。
 */
export function forgetSucceeded(
  form: PersonaMemoryForm,
  forgottenKey: string,
  result: CompanionMemoryMutationResult,
  facts: readonly CompanionFact[],
): PersonaMemoryForm {
  // 忘记的正好是正在编辑的那一行才收起编辑态；否则那是**另一行**，草稿必须留着。
  const keepEditing = form.editingKey !== null && form.editingKey !== forgottenKey;
  const row = keepEditing
    ? (facts.find((f) => sameFact(f, form.editingKey, form.editingAudience)) ?? null)
    : null;
  return {
    ...form,
    busy: null,
    ...(keepEditing
      ? { factBaseline: row?.revision ?? form.factBaseline }
      : {
          editingKey: null,
          editingAudience: null,
          key: '',
          value: '',
          factBaseline: null,
          memoryTouched: false,
        }),
    memoryBaseline: result.committedRevision ?? form.memoryBaseline,
    notice: {
      kind: result.view.application.error === null ? 'ok' : 'info',
      text:
        result.committedRevision === null
          ? '这条忘记此前已经记录过，没有重复删除。'
          : result.view.application.error === null
            ? '已从当前记忆移除；对话记录与日志保留。'
            : `已从当前记忆移除，但尚未应用：${errorMessage(result.view.application.error)}`,
    },
  };
}

/**
 * 冲突之后唯一的恢复动作：只换基线，内容原样留下。
 *
 * 每个 feature 各自重读、各自报告：一边失败不能让另一边假装读到了。
 * 成功时也不倒退到比已观察到的更旧的版本。
 */
export function rebaseOnLatest(
  form: PersonaMemoryForm,
  reads: {
    readonly profile:
      | { readonly ok: true; readonly value: CompanionProfileView }
      | { readonly ok: false; readonly error: KernelError }
      | null;
    readonly memory:
      | { readonly ok: true; readonly value: CompanionMemoryView }
      | { readonly ok: false; readonly error: KernelError }
      | null;
  },
): PersonaMemoryForm {
  const profileOk = reads.profile?.ok === true;
  const memoryOk = reads.memory?.ok === true;
  const profile = profileOk ? reads.profile.value : null;
  const memory = memoryOk ? reads.memory.value : null;
  const row =
    memory === null || form.editingKey === null
      ? null
      : (memory.facts.find((fact) => sameFact(fact, form.editingKey, form.editingAudience)) ??
        null);

  const next: PersonaMemoryForm = {
    ...form,
    profileBaseline:
      profile !== null &&
      (form.profileBaseline === null || profile.revision >= form.profileBaseline)
        ? profile.revision
        : form.profileBaseline,
    memoryBaseline:
      memory !== null && (form.memoryBaseline === null || memory.revision >= form.memoryBaseline)
        ? memory.revision
        : form.memoryBaseline,
    factBaseline: row?.revision ?? (form.editingKey === null ? null : form.factBaseline),
  };

  // 两边都失败：没有读到任何新东西，如实说，不谎称「已读取最新版本」。
  if (!profileOk && !memoryOk) {
    const error =
      (reads.profile?.ok === false ? reads.profile.error : null) ??
      (reads.memory?.ok === false ? reads.memory.error : null);
    return {
      ...next,
      notice: {
        kind: 'error',
        text: '没有读到最新版本，你填的内容还在。稍后再试。',
        error,
      },
    };
  }

  const failed = profileOk ? reads.memory?.ok === false : true;
  return {
    ...next,
    notice: failed
      ? { kind: 'info', text: '读到了其中一部分，你填的内容还在。' }
      : { kind: 'info', text: '已读取最新版本，你填的内容还在。核对后再保存。' },
  };
}

/** 失败：保留草稿（用户输入不能因为一次失败就消失），只报原因。 */
export function failOperation(
  form: PersonaMemoryForm,
  error: KernelError,
  text: string,
): PersonaMemoryForm {
  return { ...form, busy: null, notice: { kind: 'error', text, error } };
}

export function noteOperation(form: PersonaMemoryForm, text: string): PersonaMemoryForm {
  return { ...form, busy: null, notice: { kind: 'ok', text } };
}

/** 开始编辑既有行：捕获它的键与版本，值原样放进草稿。 */
/**
 * 把一条既有事实「创建公开副本」。
 *
 * 不是把原行改成公开：那会静默改变它自己的 scope（原来群里的上下文会失去它）。
 * 这里返回的是一份新的新增草稿，key 沿用，scope 设为 public。
 */
export function startPublicCopy(
  form: PersonaMemoryForm,
  fact: CompanionFact,
  status: CompanionMemoryStatus,
): PersonaMemoryForm {
  return {
    ...form,
    editingKey: null,
    editingAudience: null,
    addingScope: 'public',
    key: fact.key,
    value: fact.value,
    memoryTouched: true,
    memoryBaseline: status.revision,
    factBaseline: 0,
    notice: null,
  };
}

export function startEditing(
  form: PersonaMemoryForm,
  fact: CompanionFact,
  status: CompanionMemoryStatus,
): PersonaMemoryForm {
  return {
    ...form,
    editingKey: fact.key,
    // 捕获这一行自己的 scope：之后保存/忘记都必须打回同一条。
    editingAudience: fact.audience ?? null,
    key: fact.key,
    value: fact.value,
    memoryBaseline: status.revision,
    factBaseline: fact.revision,
    notice: null,
  };
}

/** 开始新增：集合版本照旧捕获，行版本为 0（表示「还不存在」）。 */
export function startAdding(
  form: PersonaMemoryForm,
  status: CompanionMemoryStatus,
): PersonaMemoryForm {
  return {
    ...form,
    editingKey: null,
    editingAudience: null,
    addingScope: 'owner-private',
    key: '',
    value: '',
    memoryTouched: false,
    memoryBaseline: status.revision,
    factBaseline: 0,
    notice: null,
  };
}

/** 取消编辑：草稿清空，回到「新增」状态。 */
export function cancelEditing(form: PersonaMemoryForm): PersonaMemoryForm {
  return {
    ...form,
    editingKey: null,
    editingAudience: null,
    addingScope: 'owner-private',
    key: '',
    value: '',
    factBaseline: 0,
    notice: null,
  };
}

/**
 * scope 怎么说。界面必须让人看出这一行属于谁，
 * 否则「同键两条」会看起来像重复渲染。
 */
export function audienceLabel(audience: CompanionAudience | undefined): string {
  switch (audience?.kind) {
    case 'public':
      return '公开';
    case 'person-private':
      return '某人私有';
    case 'qq-group':
      return `群 ${audience.groupId}`;
    default:
      // 缺省就是 owner 私有：旧数据的 audience 字段本来就不存在。
      return '仅自己';
  }
}

/** 来源怎么说。旧数据不猜成「你添加的」。 */
export function originLabel(origin: CompanionFactOrigin | undefined): string {
  switch (origin?.kind) {
    case 'owner-form':
      return '手动设置';
    case 'user-input':
      return '对话中记住';
    case 'legacy-unknown':
      return '来源未知（旧数据）';
    default:
      // 字段缺失同样是未知：不补一个「所有者」上去。
      return '来源未知';
  }
}

/** 保存与应用的差别要如实说：保存成功不等于已经在用。 */
export function applicationLabel(applied: number | null, error: KernelError | null): string {
  if (error !== null) return `尚未生效：${errorMessage(error)}`;
  if (applied === null) return '已保存，尚未生效';
  return `已生效（修订 ${applied}）`;
}

/** 把一次结果折成表单的下一步；调用方只按 outcome 决定清不清草稿。 */
export type Outcome<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'conflict'; readonly error: KernelError }
  | { readonly kind: 'failed'; readonly error: KernelError };

export function outcomeOf<T>(result: Result<T>): Outcome<T> {
  if (result.ok) return { kind: 'ok', value: result.value };
  if (result.error.code === 'conflict') return { kind: 'conflict', error: result.error };
  return { kind: 'failed', error: result.error };
}

/** 记忆视图：优先用显式读取的那一份，否则由快照推导（同一个数组，不复制）。 */
export function memoryOf(
  explicit: CompanionMemoryView | null,
  snapshot: {
    readonly facts: readonly CompanionFact[];
    readonly memory?: CompanionMemoryStatus;
  } | null,
): CompanionMemoryView | null {
  if (explicit !== null) return explicit;
  if (snapshot?.memory === undefined) return null;
  return { ...snapshot.memory, agentId: '', facts: snapshot.facts };
}
