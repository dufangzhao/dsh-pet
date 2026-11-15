/**
 * 本机 QQ 接入的纯展示派生：只把真实事实翻译成中文，不发请求、不持状态。
 *
 * 三条状态必须各自独立，因为它们的权威完全在不同的地方：
 *
 * - **本机接入进程**：本机进程是否在跑。GUI 退出不影响它。
 * - **QQ 客户端**：本机插件的 saved / applied / 原生连接。
 * - **Agent 连接**：daemon 到远端 Agent 的链路。
 *
 * 任何一条都不能由另一条推出来：进程在跑不等于客户端连上，客户端连上不等于
 * Agent 链路活着。把它们合并成一句「已连接」正是这个任务要修的问题。
 */
import { errorMessage, type KernelError, type QQSourceView } from '@pet/contracts';

/** 接入进程事实。全部来自本地，不需要 server 参与。 */
export interface LocalHostFacts {
  readonly phase: 'stopped' | 'starting' | 'running' | 'stopping' | 'failed';
  readonly packageVersion: string | null;
  readonly hostId: string | null;
  readonly bootId: string | null;
  /** GUI 是连到一个**已经存在**的进程，而不是自己刚启动的。 */
  readonly attached: boolean;
  readonly error: string | null;
}

const HOST_LABEL: Readonly<Record<LocalHostFacts['phase'], string>> = {
  stopped: '未运行',
  starting: '正在启动',
  running: '运行中',
  stopping: '正在停止',
  failed: '启动失败',
};

export function hostLabel(facts: LocalHostFacts): string {
  return HOST_LABEL[facts.phase];
}

/**
 * 协议在界面上的名字：先说用哪个客户端接入，再说协议。
 *
 * 这只是命名，不表示本机探测过、安装过或启动过这些客户端；未知协议原样显示。
 */
const QQ_CLIENT_LABEL: Readonly<Record<string, string>> = {
  'onebot-v11': 'SnowLuma / NapCat（OneBot v11）',
  official: '官方 QQ 机器人',
};

export function qqClientLabel(protocol: string): string {
  return QQ_CLIENT_LABEL[protocol] ?? protocol;
}

/**
 * 启动失败的显示文案。
 *
 * `internal` 在本机接入里只表示「启动程序自己出错」（脚本/环境坏了），不是授权
 * 问题；说清这一点，用户才知道该更新客户端而不是去改权限。其余错误仍按固定码表。
 */
export function hostErrorText(error: KernelError): string {
  return error.code === 'internal' ? 'QQ 连接启动程序出错，请更新客户端。' : errorMessage(error);
}

/**
 * 停止本机接入在什么时候可用。
 *
 * 只看本地事实：进程在跑就能停。**不依赖 Agent 连接**——服务端连不上时
 * 用户仍然必须能停掉自己机器上的进程，否则会被一个停不掉的进程困住。
 */
export function canStopHost(facts: LocalHostFacts): boolean {
  return facts.phase === 'running' || facts.phase === 'starting';
}

export function canStartHost(facts: LocalHostFacts): boolean {
  return facts.phase === 'stopped' || facts.phase === 'failed';
}

/** 进程已运行但 GUI 还没连上时，提供「连接已有进程」而不是再起一个。 */
export function canAttachHost(facts: LocalHostFacts): boolean {
  return facts.phase === 'running' && !facts.attached;
}

/**
 * 源的三层状态。
 *
 * `saved` 是配置是否落盘，`applied` 是运行中的插件是否真的拿到了这份配置，
 * `native` 是平台连接本身。保存成功**不是**登录成功，这三句必须分开说。
 */
export interface SourceFacts {
  /** 已保存的配置修订。 */
  readonly savedRevision: number;
  /** 运行中的插件已应用的修订；null = 还没应用过。 */
  readonly appliedRevision: number | null;
  readonly applied: boolean;
  readonly desiredEnabled: boolean;
  readonly plugin: QQSourceView['source'];
  readonly phase: QQSourceView['phase'];
  readonly account: string | null;
  readonly savedLabel: string;
  readonly appliedLabel: string;
  readonly nativeLabel: string;
  /** 这个源现在有没有在跑真实平台连接。 */
  readonly connected: boolean;
}

export function sourceFacts(source: QQSourceView): SourceFacts {
  const applied = source.appliedRevision === source.configRevision;
  return {
    savedRevision: source.configRevision,
    appliedRevision: source.appliedRevision,
    applied,
    desiredEnabled: source.desiredEnabled,
    plugin: source.source,
    phase: source.phase,
    account: source.account === null ? null : source.account.accountId,
    savedLabel: `已保存 修订 ${String(source.configRevision)}`,
    appliedLabel:
      source.appliedRevision === null
        ? '尚未应用'
        : applied
          ? `已应用 修订 ${String(source.appliedRevision)}`
          : `运行中的还是修订 ${String(source.appliedRevision)}`,
    nativeLabel: nativeLabel(source.phase),
    connected: source.phase === 'ready',
  };
}

const PHASE_LABEL: Readonly<Record<QQSourceView['phase'], string>> = {
  disabled: '未启用',
  unconfigured: '还没填完配置',
  connecting: '正在连接平台',
  authenticating: '正在验证凭据',
  ready: '平台已连接',
  offline: '平台连接已断开',
  retiring: '正在断开',
  failed: '连接失败',
};

function nativeLabel(phase: QQSourceView['phase']): string {
  return PHASE_LABEL[phase];
}

/**
 * 为什么某个控件点不了。
 *
 * 禁用必须能说出「下一步做什么」，否则用户只能猜。返回 null 表示可用。
 */
export function sourceDisabledReason(source: QQSourceView): string | null {
  if (source.source === 'unavailable') return '这个协议插件在本机不可用，先在插件页安装或启用它。';
  if (source.source === 'disabled') return '插件已被停用，先在插件页重新启用。';
  if (source.phase === 'unconfigured') return '先填完账号与连接参数，再启用。';
  if (source.phase === 'retiring') return '正在断开上一个连接，等它结束。';
  return null;
}

/** 启用/停用只在插件就绪时可点，且不能与进行中的转场并发。 */
export function canToggleSource(source: QQSourceView): boolean {
  return source.source === 'ready' && source.phase !== 'retiring' && source.phase !== 'connecting';
}

/**
 * Agent 链路的显示文案。
 *
 * 这里的 `connected` 说的是 daemon→Agent，与上面源的原生连接是两件事。
 */
export function agentLinkLabel(phase: string): string {
  switch (phase) {
    case 'disabled':
      return '未启用';
    case 'offline':
      return '未连接';
    case 'connecting':
      return '正在连接';
    case 'connected':
      return '已连接';
    case 'retiring':
      return '正在断开';
    case 'failed':
      return '连接失败';
    default:
      return '未知状态';
  }
}

/**
 * 源保存能否提交。
 *
 * 只检查本地可判定的事实；真正的 CAS 冲突由服务端/进程返回，不在前端猜。
 */
export function canSaveSource(input: {
  readonly plugin: QQSourceView['source'];
  readonly busy: boolean;
  readonly dirty: boolean;
}): boolean {
  return input.plugin === 'ready' && !input.busy && input.dirty;
}
