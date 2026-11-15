/**
 * QQ 客户端配置的草稿状态。
 *
 * 与服务端那份（`plugins/text-client/src/client/qq-form.ts`）规则相同，
 * 但**身份不同**：本地客户端属于某个进程的一次启动（hostId + bootId）与它的
 * Config 修订，不属于某条 server 连接。把 `connectionId` 搬过来是错的——
 * 那个值在 GUI 重连时会变，而本机接入在 GUI 退出期间必须继续存在。
 *
 * 这里只做纯状态转场，不发请求；保存由组件的 typed callback 交给后台进程。
 */
import type { QQSourceSettings, QQSourceView } from '@pet/contracts';

/**
 * 客户端配置的归属。
 *
 * `bootId` 让「进程重启」成为一个可判定的事件：重启后旧草稿的 CAS 基线
 * 已经失效，必须重新读，不能拿旧修订去保存。
 */
export interface LocalSourceOwner {
  readonly hostId: string;
  readonly bootId: string;
  readonly protocol: QQSourceView['protocol'];
  readonly sourcePluginId: string;
  readonly instanceId: string;
  readonly configRevision: number;
}

export interface LocalSourceDraft {
  readonly settings: QQSourceSettings;
  readonly owner: LocalSourceOwner;
  readonly edited: boolean;
}

/**
 * 同一份源身份（不含修订）。
 *
 * 修订前进不代表换了一份源：那是同一条配置的新版本，脏草稿要留着。
 */
export function sameLocalSource(
  left: LocalSourceOwner | null,
  right: LocalSourceOwner | null,
): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.hostId === right.hostId &&
    left.bootId === right.bootId &&
    left.protocol === right.protocol &&
    left.sourcePluginId === right.sourcePluginId &&
    left.instanceId === right.instanceId
  );
}

export function seedLocalSource(
  source: QQSourceView,
  host: { readonly hostId: string; readonly bootId: string },
): LocalSourceDraft {
  return {
    settings: source.settings,
    owner: {
      hostId: host.hostId,
      bootId: host.bootId,
      protocol: source.protocol,
      sourcePluginId: source.sourcePluginId,
      instanceId: source.instanceId,
      configRevision: source.configRevision,
    },
    edited: false,
  };
}

/**
 * 用最新视图重铺草稿。
 *
 * - 干净的草稿跟随视图（用户没动过，就该看到最新值）。
 * - 脏草稿保留用户输入**与它捕获的修订**，等用户显式重读。
 * - 进程重启（bootId 变了）或换了客户端：旧草稿一律丢弃，那是另一份配置。
 */
export function followLocalSource(
  draft: LocalSourceDraft | null,
  source: QQSourceView,
  host: { readonly hostId: string; readonly bootId: string },
): LocalSourceDraft | null {
  const next = seedLocalSource(source, host);
  if (draft === null) return next;
  if (!sameLocalSource(draft.owner, next.owner)) return next;
  if (draft.edited) return draft;
  return next;
}

/** 编辑设置：标脏，但**不动**捕获的修订。 */
export function editLocalSource(
  draft: LocalSourceDraft | null,
  change: (settings: QQSourceSettings) => QQSourceSettings,
): LocalSourceDraft | null {
  if (draft === null) return null;
  return { ...draft, settings: change(draft.settings), edited: true };
}

/** 显式重读：只换基线，保留用户填的内容。 */
export function rebaseLocalSource(
  draft: LocalSourceDraft | null,
  source: QQSourceView,
  host: { readonly hostId: string; readonly bootId: string },
): LocalSourceDraft | null {
  if (draft === null) return seedLocalSource(source, host);
  return {
    ...draft,
    owner: { ...draft.owner, configRevision: source.configRevision },
  };
}

/**
 * 保存命令：用草稿**自己捕获的**修订，不借最新视图的。
 *
 * 借最新的会覆盖别人刚提交的改动——这正是 lost-update。
 */
export function localSourceSaveCommand(draft: LocalSourceDraft | null): {
  readonly protocol: QQSourceView['protocol'];
  readonly expectedRevision: number;
  readonly settings: QQSourceSettings;
} | null {
  if (draft === null || !draft.edited) return null;
  return {
    protocol: draft.owner.protocol,
    expectedRevision: draft.owner.configRevision,
    settings: draft.settings,
  };
}

/**
 * 源的密钥草稿。
 *
 * 与 judge 密钥同样的道理：一个裸字符串不知道自己属于哪个 target。
 * 进程重启、源配置修订变化或凭据版本变化之后，旧密钥一律作废——
 * 否则 A 的密钥会带着 B 的合法 CAS 被写过去。
 */
export interface LocalSourceSecretDraft {
  readonly value: string;
  readonly protocol: QQSourceView['protocol'];
  readonly sourcePluginId: string;
  readonly hostId: string;
  readonly bootId: string;
  readonly configRevision: number;
  readonly credentialVersion: string;
}

export function localSecretValid(
  secret: LocalSourceSecretDraft | null,
  source: QQSourceView,
  host: { readonly hostId: string; readonly bootId: string },
): boolean {
  if (secret === null) return false;
  return (
    secret.protocol === source.protocol &&
    secret.sourcePluginId === source.sourcePluginId &&
    secret.hostId === host.hostId &&
    secret.bootId === host.bootId &&
    secret.configRevision === source.configRevision &&
    secret.credentialVersion === source.credential.version
  );
}

/** 首次输入即捕获完整归属；之后只改值。 */
export function typeLocalSecret(
  current: LocalSourceSecretDraft | null,
  value: string,
  source: QQSourceView,
  host: { readonly hostId: string; readonly bootId: string },
): LocalSourceSecretDraft {
  const keep = localSecretValid(current, source, host);
  return {
    value,
    protocol: source.protocol,
    sourcePluginId: source.sourcePluginId,
    hostId: host.hostId,
    bootId: host.bootId,
    configRevision: keep
      ? (current?.configRevision ?? source.configRevision)
      : source.configRevision,
    credentialVersion: keep
      ? (current?.credentialVersion ?? source.credential.version)
      : source.credential.version,
  };
}

/**
 * 密钥只能在源**已保存**之后写。
 *
 * 屏幕上改过的连接参数在后台进程那里还不存在；这时写密钥会落到旧配置上。
 */
export function localSecretTargetSaved(
  draft: LocalSourceDraft | null,
  source: QQSourceView,
): boolean {
  if (draft === null) return false;
  return !draft.edited && draft.owner.configRevision === source.configRevision;
}
