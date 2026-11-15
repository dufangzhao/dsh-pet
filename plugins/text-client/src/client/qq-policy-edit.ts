/**
 * QQ 名单与映射的纯规则。
 *
 * 这里只有一件事最重要：**名单是按 (account, id) 存的，不是按 id 存的**。
 * 双协议下两个账号可以有同一个 senderId 或同一个 groupId，界面若按 id 显示、
 * 按「当前选中账号」整体替换，改 A 就会把 B 的名单一起毁掉。
 *
 * 所以这里所有函数都按完整 `QQAccountRef` 定位，并且只动命中的那一条。
 */
import {
  QQ_ADMINISTRATORS_MAX,
  QQ_GROUP_ALLOWLIST_MAX,
  QQ_PRINCIPAL_ALIASES_MAX,
  QQ_PRIVATE_ALLOWLIST_MAX,
  isCompanionRecordId,
  isQQAccountRef,
  type QQAccountRef,
  type QQExternalActor,
  type QQPolicySettings,
} from '@pet/contracts';

export type QQPrivateEntry = QQPolicySettings['privateAllowlist'][number];
export type QQGroupEntry = QQPolicySettings['groupAllowlist'][number];
export type QQAliasEntry = QQPolicySettings['principalAliases'][number];

/** 两个账号是不是同一个来源账号（含协议与实例，不只 accountId）。 */
export function sameAccount(left: QQAccountRef, right: QQAccountRef): boolean {
  return (
    left.protocol === right.protocol &&
    left.sourcePluginId === right.sourcePluginId &&
    left.instanceId === right.instanceId &&
    left.accountId === right.accountId
  );
}

/** 私聊条目是否属于这个账号。 */
export function privateOf(entry: QQPrivateEntry, account: QQAccountRef): boolean {
  return entry.scene === 'private' && sameAccount(entry.account, account);
}

export function groupOf(entry: QQGroupEntry, account: QQAccountRef): boolean {
  return sameAccount(entry.account, account);
}

/** 这个账号下的私聊名单（只读视图，不复制条目）。 */
export function privateFor(
  settings: QQPolicySettings,
  account: QQAccountRef,
): readonly QQPrivateEntry[] {
  return settings.privateAllowlist.filter((entry) => privateOf(entry, account));
}

export function groupsFor(
  settings: QQPolicySettings,
  account: QQAccountRef,
): readonly QQGroupEntry[] {
  return settings.groupAllowlist.filter((entry) => groupOf(entry, account));
}

/**
 * 用新的一组私聊条目替换**这个账号**的名单，其他账号原样保留。
 *
 * 这是修掉「改 A 毁 B」的那一处：不是 `privateAllowlist = next`，
 * 而是「去掉本账号的旧条目 + 拼上本账号的新条目 + 保留其余」。
 */
export function replacePrivateFor(
  settings: QQPolicySettings,
  account: QQAccountRef,
  entries: readonly QQPrivateEntry[],
): QQPolicySettings {
  const others = settings.privateAllowlist.filter((entry) => !privateOf(entry, account));
  return { ...settings, privateAllowlist: [...others, ...entries] };
}

export function replaceGroupsFor(
  settings: QQPolicySettings,
  account: QQAccountRef,
  entries: readonly QQGroupEntry[],
): QQPolicySettings {
  const others = settings.groupAllowlist.filter((entry) => !groupOf(entry, account));
  return { ...settings, groupAllowlist: [...others, ...entries] };
}

/**
 * 解析一行名单文本。
 *
 * 逗号分隔的输入**只在保存/失焦时**才解析——不要在每次按键时把已解析结果
 * 写回成 `join(', ')`，那样用户刚敲的尾逗号会被立刻吃掉，多项也输不进去。
 *
 * 超上限不是「悄悄截断」，而是明确的 invalid：静默丢条目会让用户以为
 * 已经加进去了。
 */
export interface ParsedIds {
  readonly ids: readonly string[];
  readonly problem: string | null;
}

export function parseIdList(raw: string, max: number, label: string): ParsedIds {
  const ids: string[] = [];
  for (const part of raw.split(',')) {
    const id = part.trim();
    if (id === '') continue;
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length > max)
    return { ids: [], problem: `${label}最多 ${max} 个，现在有 ${ids.length} 个。` };
  return { ids, problem: null };
}

/** 这个账号的私聊条目，按给定 id 顺序重建。 */
export function privateEntries(
  account: QQAccountRef,
  ids: readonly string[],
): readonly QQPrivateEntry[] {
  return ids.map((senderId) => ({ account, scene: 'private' as const, senderId }));
}

export function groupEntries(
  account: QQAccountRef,
  ids: readonly string[],
): readonly QQGroupEntry[] {
  return ids.map((groupId) => ({ account, groupId }));
}

/**
 * 一个外部 actor 的稳定键。
 *
 * 用于 React key 与去重：两个账号的同号群必须是两个键，
 * 否则列表会互相顶掉、编辑也会改错行。
 */
export function actorKey(actor: QQExternalActor): string {
  const base = [
    actor.account.protocol,
    actor.account.sourcePluginId,
    actor.account.instanceId,
    actor.account.accountId,
    actor.scene,
    actor.senderId,
  ];
  if (actor.scene === 'group') base.push(actor.groupId);
  return base.join('\u0000');
}

/** 别名行：把某个外部 actor 绑到某个 principal。 */
export function upsertAlias(
  settings: QQPolicySettings,
  actor: QQExternalActor,
  principalId: string,
): QQPolicySettings {
  const key = actorKey(actor);
  const rest = settings.principalAliases.filter((entry) => actorKey(entry.actor) !== key);
  return { ...settings, principalAliases: [...rest, { actor, principalId }] };
}

export function removeAlias(settings: QQPolicySettings, actor: QQExternalActor): QQPolicySettings {
  const key = actorKey(actor);
  return {
    ...settings,
    principalAliases: settings.principalAliases.filter((entry) => actorKey(entry.actor) !== key),
  };
}

/** 已知的机器人 actor：同样按完整 actor 键去重。 */
export function toggleMachineActor(
  settings: QQPolicySettings,
  actor: QQExternalActor,
  known: boolean,
): QQPolicySettings {
  const key = actorKey(actor);
  const rest = settings.knownMachineActors.filter((entry) => actorKey(entry) !== key);
  return { ...settings, knownMachineActors: known ? [...rest, actor] : rest };
}

/** 管理员名单：去重、去空白；超上限同样明确报错而不是截断。 */
export function parseAdmins(raw: string): ParsedIds {
  return parseIdList(raw, QQ_ADMINISTRATORS_MAX, '管理员');
}

export function replaceAdmins(
  settings: QQPolicySettings,
  ids: readonly string[],
): QQPolicySettings {
  return { ...settings, administratorPrincipalIds: [...ids] };
}

/** 名单容量上限，供界面显示真实额度。 */
export const LIMITS = {
  private: QQ_PRIVATE_ALLOWLIST_MAX,
  group: QQ_GROUP_ALLOWLIST_MAX,
  alias: QQ_PRINCIPAL_ALIASES_MAX,
  admin: QQ_ADMINISTRATORS_MAX,
} as const;

/** principal 必须是合法的 canonical id，不能是随手写的字符串。 */
export function principalProblem(raw: string): string | null {
  const value = raw.trim();
  if (value === '') return 'principal 不能为空。';
  return isCompanionRecordId(value) ? null : 'principal 必须是合法的记录 ID。';
}

/** 账号必须能被契约认出来（协议/插件/实例/账号都要对）。 */
export function accountProblem(value: unknown): string | null {
  return isQQAccountRef(value) ? null : '账号标识不完整。';
}
