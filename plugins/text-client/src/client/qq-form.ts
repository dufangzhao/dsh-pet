/**
 * QQ 管理表单的状态机（纯函数，不依赖 React）。
 *
 * 与模型/人格那两套同源的三条不变量：
 * - CAS 用**草稿读到时的**版本，不是最新视图。
 * - 只有受理了才推进基线/清草稿；冲突、失败、未知都保留原文。
 * - 服务端视图是唯一真相；保存不测试发送、不测试模型、不推断连接成功。
 *
 * 另外两条是这个界面特有的：
 * - 两个协议模块各自持有 owner（protocol + configRevision），一份草稿不会写到另一个上。
 * - 连接状态只来自视图的 source/phase/account，不由「刚保存成功」推出来。
 */
import {
  type CompanionAudience,
  type KernelError,
  type QQAccountRef,
  type QQGroupSettings,
  type QQPolicySettings,
  type QQSourceSettings,
  type QQSourceView,
  type QQJudgeSettings,
  isQQJudgeSettings,
  type QQView,
  type Result,
  errorMessage,
  isQQGroupSettings,
  isQQPolicySettings,
  isQQSourceSettings,
} from '@pet/contracts';

export type QQBusy = 'policy' | 'source' | 'credential' | 'judge' | 'judge-credential' | 'toggle';

/**
 * 一份草稿属于哪个来源。
 *
 * 身份由**来源本身**决定：协议 + sourcePluginId + instanceId，再加上这次服务连接的
 * identity（连接换代后旧闭包不能把结果写到新连接上）。
 *
 * 不包含 configRevision：同一来源的版本前进是「同一份配置被别处改过」，
 * 那时草稿必须留着等用户决定；revision 单独记，只作 CAS 基线。
 */
export interface QQSourceOwner {
  readonly protocol: QQSourceView['protocol'];
  readonly sourcePluginId: string;
  readonly instanceId: string;
  /** 服务连接身份（clientId）：换一次连接就是另一个世界。 */
  readonly connectionId: string;
  readonly configRevision: number;
}

export interface QQPolicyDraft {
  readonly settings: QQPolicySettings;
  /** 读到时的 policy revision；保存用它做 CAS。 */
  readonly revision: number;
  /** 用户是否动过。内容差异不算：服务端改了值，干净表单该跟过去。 */
  readonly edited: boolean;
}

export interface QQSourceDraft {
  readonly settings: QQSourceSettings;
  readonly owner: QQSourceOwner;
  readonly edited: boolean;
}

export interface QQFormState {
  readonly policy: QQPolicyDraft | null;
  readonly source: QQSourceDraft | null;
  readonly judge: QQJudgeDraft | null;
  readonly busy: QQBusy | null;
  readonly notice: string | null;
  readonly failure: KernelError | null;
}

export const emptyQQForm: QQFormState = {
  policy: null,
  source: null,
  judge: null,
  busy: null,
  notice: null,
  failure: null,
};

/**
 * 同一个来源。
 *
 * protocol 不够：服务可以用一个不同的 source 替换同一协议的实现，
 * 那时旧草稿/旧密钥不能写到新来源上。所以比完整身份，但仍**不含 revision**。
 */
export function sameSourceOwner(left: QQSourceOwner | null, right: QQSourceOwner | null): boolean {
  return (
    left !== null &&
    right !== null &&
    left.protocol === right.protocol &&
    left.sourcePluginId === right.sourcePluginId &&
    left.instanceId === right.instanceId &&
    left.connectionId === right.connectionId
  );
}

export function seedPolicy(view: QQView): QQPolicyDraft {
  return { settings: view.policy.settings, revision: view.policy.revision, edited: false };
}

export function seedSource(source: QQSourceView, connectionId: string): QQSourceDraft {
  return {
    settings: source.settings,
    owner: {
      protocol: source.protocol,
      sourcePluginId: source.sourcePluginId,
      instanceId: source.instanceId,
      connectionId,
      configRevision: source.configRevision,
    },
    edited: false,
  };
}

/**
 * 用视图重铺表单。
 *
 * 只重铺**没被编辑过**的那一份：正在改的草稿不能被一次无关刷新清掉。
 * 换协议模块时旧草稿一律不迁移——那是另一份配置。
 */
export function followView(
  form: QQFormState,
  view: QQView,
  selected: QQSourceView | null,
  connectionId: string,
): QQFormState {
  /**
   * 脏的 policy 草稿保留，但它的 `judge` 子集必须跟随**已保存视图**：
   * 那部分不归 policy 编辑域所有，留着旧值就会在下一次保存时把它写回去。
   */
  const nextPolicy =
    form.policy === null
      ? seedPolicy(view)
      : form.policy.edited
        ? {
            ...form.policy,
            settings: { ...form.policy.settings, judge: view.policy.settings.judge },
          }
        : seedPolicy(view);
  /**
   * judge 也按同一条规则：干净就跟随服务端，脏就留着。
   * 它的基线只在显式 rebase 或这次保存被受理后推进。
   */
  const nextJudge =
    form.judge === null || !form.judge.edited || !sameJudgeOwner(form.judge, connectionId)
      ? seedJudge(view, connectionId)
      : form.judge;
  if (selected === null) return { ...form, policy: nextPolicy, judge: nextJudge, source: null };
  const owner = ownerOf(selected, connectionId);
  const keepSource =
    form.source !== null && form.source.edited && sameSourceOwner(form.source.owner, owner);
  return {
    ...form,
    policy: nextPolicy,
    judge: nextJudge,
    source: keepSource ? form.source : seedSource(selected, connectionId),
  };
}

export function ownerOf(source: QQSourceView, connectionId: string): QQSourceOwner {
  return {
    protocol: source.protocol,
    sourcePluginId: source.sourcePluginId,
    instanceId: source.instanceId,
    connectionId,
    configRevision: source.configRevision,
  };
}

/** 选中的模块：视图里没有就是 null（例如该模块尚未安装）。 */
export function selectSource(
  view: QQView | null,
  protocol: QQSourceView['protocol'] | null,
): QQSourceView | null {
  if (view === null || protocol === null) return null;
  return view.sources.find((source) => source.protocol === protocol) ?? null;
}

export function editPolicy(
  form: QQFormState,
  change: (settings: QQPolicySettings) => QQPolicySettings,
): QQFormState {
  if (form.policy === null || form.busy !== null) return form;
  const settings = change(form.policy.settings);
  return isQQPolicySettings(settings)
    ? { ...form, policy: { ...form.policy, settings, edited: true }, failure: null, notice: null }
    : form;
}

export function editSource(
  form: QQFormState,
  change: (settings: QQSourceSettings) => QQSourceSettings,
): QQFormState {
  if (form.source === null || form.busy !== null) return form;
  const settings = change(form.source.settings);
  return isQQSourceSettings(settings)
    ? { ...form, source: { ...form.source, settings, edited: true }, failure: null, notice: null }
    : form;
}

/**
 * 按群覆盖：同一 (account, groupId) 只留一条。
 *
 * 群设置在视图里是数组而不是 map，因为 account 是结构化身份；
 * 这里用 `sameGroup` 比较，避免把两个账号的同号群当成同一个群。
 */
export function sameGroup(
  left: { readonly account: QQAccountRef; readonly groupId: string },
  right: { readonly account: QQAccountRef; readonly groupId: string },
): boolean {
  return (
    left.groupId === right.groupId &&
    left.account.protocol === right.account.protocol &&
    left.account.sourcePluginId === right.account.sourcePluginId &&
    left.account.instanceId === right.account.instanceId &&
    left.account.accountId === right.account.accountId
  );
}

export function groupSettingsOf(
  settings: QQPolicySettings,
  account: QQAccountRef,
  groupId: string,
): QQGroupSettings {
  const found = settings.groups.find((group) => sameGroup(group, { account, groupId }));
  return found?.settings ?? settings.groupDefaults;
}

export function setGroupSettings(
  settings: QQPolicySettings,
  account: QQAccountRef,
  groupId: string,
  group: QQGroupSettings,
): QQPolicySettings {
  if (!isQQGroupSettings(group)) return settings;
  const rest = settings.groups.filter((item) => !sameGroup(item, { account, groupId }));
  return { ...settings, groups: [...rest, { account, groupId, settings: group }] };
}

/** 清掉按群覆盖，回到全局默认。 */
export function clearGroupSettings(
  settings: QQPolicySettings,
  account: QQAccountRef,
  groupId: string,
): QQPolicySettings {
  return {
    ...settings,
    groups: settings.groups.filter((item) => !sameGroup(item, { account, groupId })),
  };
}

/**
 * 连接状态怎么显示。
 *
 * 只按视图事实说：phase/account/source 是服务端给的。
 * 保存成功、凭证存在、socket 打开都不能单独推出「已连接」。
 */
export interface QQConnectionFacts {
  readonly label: string;
  readonly tone: 'ok' | 'warn' | 'neutral' | 'danger';
  readonly detail: string | null;
}

export function connectionFacts(source: QQSourceView): QQConnectionFacts {
  const account = source.account?.accountId ?? null;
  const phase = source.phase;
  if (source.source === 'unavailable') {
    return {
      label: '不可用',
      tone: 'danger',
      detail: source.error === null ? null : errorMessage(source.error),
    };
  }
  if (!source.desiredEnabled) {
    return { label: '已停用', tone: 'neutral', detail: null };
  }
  switch (phase) {
    case 'ready':
      return { label: '已连接', tone: 'ok', detail: account };
    case 'connecting':
      return { label: '正在连接', tone: 'warn', detail: account };
    case 'authenticating':
      return { label: '正在验证', tone: 'warn', detail: account };
    case 'offline':
      return { label: '已离线', tone: 'warn', detail: account };
    case 'retiring':
      return { label: '正在断开', tone: 'warn', detail: account };
    case 'failed':
      return {
        label: '连接失败',
        tone: 'danger',
        detail: source.error === null ? null : errorMessage(source.error),
      };
    case 'unconfigured':
      return { label: '待配置', tone: 'neutral', detail: null };
    default:
      return { label: '已停用', tone: 'neutral', detail: null };
  }
}

/**
 * judge 的连接草稿。
 *
 * 它有自己的 owner：judge 是**独立 purpose**，用独立模型来源与独立密钥，
 * 改它不会动主模型，也不会动 policy 的其他部分。所以它单独保存一份
 * `configRevision` 作为 CAS 基线，不从点击那一刻的最新 view 里取。
 */
export interface QQJudgeDraft {
  readonly settings: QQJudgeSettings;
  /**
   * 读到时的 **policy** 版本。
   *
   * judge 保存是两段 CAS：policy 那半 + judge 连接那半。两段都必须用**草稿读到
   * 时**的值。之前只捕获了 configRevision，policy 那半借的是 `form.policy.revision`
   * ——一份干净的 policy 会跟着服务端前进，于是 dirty 的 judge 会拿新 revision
   * 提交旧 settings，把别人刚写的预算覆盖掉（lost update）。
   */
  readonly policyRevision: number;
  /** 读到时的 judge 配置版本。 */
  readonly configRevision: number;
  readonly credentialVersion: string;
  /** 服务连接身份；换连接后旧闭包不落地。 */
  readonly connectionId: string;
  readonly edited: boolean;
}

export function seedJudge(view: QQView, connectionId: string): QQJudgeDraft {
  return {
    settings: view.judge.settings,
    policyRevision: view.policy.revision,
    configRevision: view.judge.configRevision,
    credentialVersion: view.judge.credential.version,
    connectionId,
    edited: false,
  };
}

/**
 * judge 草稿是否仍属于当前这次连接。
 *
 * 只比连接身份，**不比 configRevision**：版本前进是「同一份 judge 配置被
 * 别处改过」，那时脏草稿必须留着等用户决定；版本变了就重铺等于静默丢弃输入。
 */
export function sameJudgeOwner(draft: QQJudgeDraft | null, connectionId: string): boolean {
  return draft !== null && draft.connectionId === connectionId;
}

export function editJudge(
  form: QQFormState,
  change: (settings: QQJudgeSettings) => QQJudgeSettings,
): QQFormState {
  if (form.judge === null || form.busy !== null) return form;
  const settings = change(form.judge.settings);
  return isQQJudgeSettings(settings)
    ? { ...form, judge: { ...form.judge, settings, edited: true }, failure: null, notice: null }
    : form;
}

/**
 * judge 保存命令。
 *
 * 两段 CAS：policy 那半只在 policy 真的被编辑过时才提交（judge 的连接改动
 * 不该顺手推进 policy），连接那半永远用**草稿捕获的** configRevision。
 */
export function judgeSaveCommand(form: QQFormState): {
  readonly expectedPolicyRevision: number;
  readonly expectedConfigRevision: number;
  readonly settings: QQJudgeSettings;
} | null {
  if (form.judge === null || !form.judge.edited) return null;
  // 两段 CAS 都用草稿自己捕获的版本，不借任何「干净表单」的最新 revision。
  return {
    expectedPolicyRevision: form.judge.policyRevision,
    expectedConfigRevision: form.judge.configRevision,
    settings: form.judge.settings,
  };
}

/**
 * judge 密钥草稿。
 *
 * 密钥必须自己记住它属于**哪个已保存的 target**。只存一个字符串是不够的：
 * 用户在 A 上敲了密钥，外部把已保存的 target 换成 B，这次 reread 会把干净的
 * judge 表单重铺成 B 的基线——裸字符串却还是 A 的，于是 A 的密钥会带着 B 的
 * 合法 CAS 被写到 B 上，后端所有 CAS 都会通过。
 *
 * 所以这里连 provider、连接三字段、两段 revision 与 credential 版本一起捕获；
 * 任何一项变化就让这份草稿失效。
 */
export interface JudgeSecretDraft {
  readonly value: string;
  readonly providerRef: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly authMode: 'local-client-id' | 'gateway-key';
  readonly configRevision: number;
  readonly credentialVersion: string;
  readonly connectionId: string;
}

/** 这份密钥是否仍属于当前**已保存的** judge target。 */
export function judgeSecretValid(
  draft: JudgeSecretDraft | null,
  view: QQView,
  connectionId: string,
): boolean {
  if (draft === null) return false;
  if (draft.connectionId !== connectionId) return false;
  const saved = view.judge.settings;
  return (
    draft.providerRef === saved.providerRef &&
    draft.baseUrl === saved.connection.baseUrl &&
    draft.model === saved.connection.model &&
    draft.authMode === saved.connection.authMode &&
    draft.configRevision === view.judge.configRevision &&
    draft.credentialVersion === view.judge.credential.version
  );
}

/**
 * judge 保存成功：用**返回视图里的** judge 推进草稿基线。
 *
 * 不能复用 `adoptSave(...,'policy')`：那只会重铺 policy，judge 草稿仍带着
 * 旧的 `edited` 与旧 configRevision，下一次写密钥或再保存就会撞自己的旧基线。
 *
 * 也**不能**整体重铺 policy：judge 只占 policy 的 judge 子集，把整份 policy
 * 换掉会丢掉用户还没保存的 allowlist / 群设置。
 */
export function adoptJudge(form: QQFormState, view: QQView, connectionId: string): QQFormState {
  return {
    ...form,
    busy: null,
    failure: null,
    notice: '已保存参与判断设置。',
    judge: seedJudge(view, connectionId),
  };
}

/** judge 保存失败：保留草稿与它捕获的基线，只报原因。 */
export function failJudge(form: QQFormState, error: KernelError): QQFormState {
  const conflict = error.code === 'conflict';
  return {
    ...form,
    busy: null,
    failure: conflict ? null : error,
    /*
     * conflict 不等于零副作用。
     *
     * judge 是两段 CAS：后台可能已经把 config 那半落了盘，policy 那半才冲突，
     * 最终 error.code 仍是 conflict。所以这里**不能**说「这次没有写入」——
     * 只能说「没确认全部完成」，并让用户去看实际状态。草稿与它捕获的基线保留。
     */
    notice: conflict
      ? '版本冲突：未确认全部完成，可能有一部分已保存。草稿保留；请读取实际状态后再决定。'
      : `未确认是否保存成功：${errorMessage(error)}。请查看最新状态后再决定是否重试。`,
  };
}

/**
 * 本地 judge 的 target（连接三字段 + provider）是否和**已保存的**一致。
 *
 * 密钥只能写到已经保存的那个 target 上：用户改了 URL/model/auth 但还没保存时，
 * 屏幕上那个「新 target」在服务端并不存在，把密钥写过去会落到旧 target 上。
 */
export function judgeTargetSaved(form: QQFormState, view: QQView): boolean {
  const draft = form.judge?.settings;
  if (draft === undefined) return false;
  const saved = view.judge.settings;
  return (
    draft.providerRef === saved.providerRef &&
    draft.connection.baseUrl === saved.connection.baseUrl &&
    draft.connection.model === saved.connection.model &&
    draft.connection.authMode === saved.connection.authMode
  );
}

/** 配置保存了、但还没被应用：这两个状态必须分开说。 */
export function appliedFacts(source: QQSourceView): string | null {
  if (source.appliedRevision === null) return '已保存，尚未应用。';
  if (source.appliedRevision === source.configRevision) return null;
  return `已保存；正在生效的是修订 ${source.appliedRevision}。`;
}

/** 媒体支持只报真实状态，不把「未验证」说成可用。 */
export function mediaLabel(state: 'unverified' | 'available' | 'unavailable'): string {
  switch (state) {
    case 'available':
      return '可用';
    case 'unavailable':
      return '不可用';
    default:
      return '未验证';
  }
}

/**
 * policy 保存命令。
 *
 * `QQPolicySettings` 里含 `judge`，但 judge 有**自己的编辑域与自己的双段 CAS**。
 * 如果这里把 policy 草稿整份发出去，而 judge 草稿在此期间保存过（或外部改过），
 * 这份 policy 草稿里的 judge 子集就是旧的——保存 allowlist 会把 judge 悄悄写回去。
 *
 * 所以保存前用**当前已保存视图**的 judge 子集替换掉草稿里的那一份。
 * 只替换这一个子集：allowlist / groups / 管理员等可见编辑仍按草稿走。
 */
export function policySaveCommand(
  form: QQFormState,
  view: QQView | null,
): { readonly expectedRevision: number; readonly settings: QQPolicySettings } | null {
  if (form.policy === null || !form.policy.edited) return null;
  if (view === null) return null;
  return {
    expectedRevision: form.policy.revision,
    settings: { ...form.policy.settings, judge: view.policy.settings.judge },
  };
}

export function sourceSaveCommand(form: QQFormState): {
  readonly protocol: QQSourceView['protocol'];
  readonly expectedRevision: number;
  readonly settings: QQSourceSettings;
} | null {
  if (form.source === null || !form.source.edited) return null;
  return {
    protocol: form.source.owner.protocol,
    expectedRevision: form.source.owner.configRevision,
    settings: form.source.settings,
  };
}

export interface QQSaveOutcome {
  readonly form: QQFormState;
  /** 这次写入是否真的被受理；false 时调用方不该重读成「已应用」。 */
  readonly accepted: boolean;
}

/**
 * 保存结果折回表单。
 *
 * 受理后才推进基线并清 edited；冲突只说冲突、草稿原样留着等用户重读。
 */
export function adoptSave(
  form: QQFormState,
  result: Result<QQView>,
  kind: 'policy' | 'source',
): QQSaveOutcome {
  if (!result.ok) {
    const conflict = result.error.code === 'conflict';
    return {
      accepted: false,
      form: {
        ...form,
        busy: null,
        failure: conflict ? null : result.error,
        /*
         * 同上：conflict 可能是「前一段已落盘、后一段被拒」，不能断言没写。
         * 只有本地校验未派发的情况才谈得上「未写入」，那在调用方就返回了。
         */
        notice: conflict
          ? '版本冲突：未确认全部完成，可能有一部分已保存。草稿保留；请读取实际状态后再决定。'
          : `未确认是否保存成功：${errorMessage(result.error)}。请查看最新状态后再决定是否重试。`,
      },
    };
  }
  const view = result.value;
  const selected =
    kind === 'source' && form.source !== null
      ? selectSource(view, form.source.owner.protocol)
      : null;
  return {
    accepted: true,
    form: {
      ...form,
      busy: null,
      failure: null,
      notice: '已保存。连接状态以这一模块的当前状态为准。',
      policy: kind === 'policy' ? seedPolicy(view) : form.policy,
      source:
        kind === 'source' && selected !== null && form.source !== null
          ? seedSource(selected, form.source.owner.connectionId)
          : form.source,
    },
  };
}

/**
 * 重新读取（冲突后的唯一恢复动作）。
 *
 * **只换基线，不动内容**：用户填的值原样留着，下一次保存用新基线提交。
 * 若连内容一起换成服务端的值，那等于静默丢弃用户的输入。
 */
export function rebaseOnView(form: QQFormState, view: QQView): QQFormState {
  const selected = form.source === null ? null : selectSource(view, form.source.owner.protocol);
  return {
    ...form,
    policy:
      form.policy === null
        ? seedPolicy(view)
        : {
            ...form.policy,
            revision: view.policy.revision,
            settings: { ...form.policy.settings, judge: view.policy.settings.judge },
          },
    source:
      form.source === null || selected === null
        ? form.source
        : {
            ...form.source,
            owner: { ...ownerOf(selected, form.source.owner.connectionId) },
          },
    // judge 也要 rebase：否则用户只能关掉面板重开才能恢复。
    // judge 显式 rebase：两段基线**成对**更新，否则又会出现只更新一半的窗口。
    judge:
      form.judge === null
        ? null
        : {
            ...form.judge,
            policyRevision: view.policy.revision,
            configRevision: view.judge.configRevision,
            credentialVersion: view.judge.credential.version,
            connectionId: form.judge.connectionId,
          },
    notice: '已读取最新版本，你填的内容还在。核对后再保存。',
    failure: null,
  };
}

/** 管理员名单：去重、忽略空白。 */
export function normalizePrincipalIds(ids: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const raw of ids) {
    const id = raw.trim();
    if (id === '' || seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  return next;
}

/** 允许名单里的一行是否重复。 */
export function duplicatePrivate(
  list: readonly { readonly senderId: string; readonly account: { readonly accountId: string } }[],
  entry: { readonly senderId: string; readonly account: { readonly accountId: string } },
): boolean {
  return list.some(
    (item) =>
      item.senderId === entry.senderId && item.account.accountId === entry.account.accountId,
  );
}

export function audienceOf(source: QQSourceView, groupId: string | null): CompanionAudience {
  return groupId === null
    ? { kind: 'owner-private' }
    : {
        kind: 'qq-group',
        account: source.account ?? {
          protocol: source.protocol,
          sourcePluginId: source.sourcePluginId,
          instanceId: source.instanceId,
          accountId: '',
        },
        groupId,
      };
}
