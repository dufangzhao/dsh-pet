import type {
  AccessMode,
  ApplicationInteraction,
  ApplicationInteractionKind,
  ApplicationPreferences,
  ApplicationSnapshot,
  AuditEvent,
  AuditSource,
  ContributionKind,
  DemoPhase,
  DemoReplyMode,
  FileScope,
  HostRuntimeState,
  PermissionDeclaration,
  PermissionKind,
  PermissionPreset,
  PluginLifecycleState,
} from '@pet/contracts';
import type { Tone } from '@pet/ui-kit';

/**
 * 状态文案：把契约里的英文枚举翻成一句中文，并给徽标一个语义色。
 * 颜色只做辅助，含义始终由文字承担。
 */
interface ToneText {
  text: string;
  tone: Tone;
}

const HOST_RUNTIME: Readonly<Record<HostRuntimeState, ToneText>> = {
  starting: { text: '正在启动', tone: 'warn' },
  ready: { text: '运行中', tone: 'ok' },
  failed: { text: '启动失败', tone: 'danger' },
  stopped: { text: '已停止', tone: 'neutral' },
};

const PLUGIN_STATE: Readonly<Record<PluginLifecycleState, ToneText>> = {
  rejected: { text: '已拒绝', tone: 'danger' },
  disabled: { text: '已停用', tone: 'neutral' },
  activating: { text: '正在启用', tone: 'warn' },
  active: { text: '已启用', tone: 'ok' },
  unready: { text: '未就绪', tone: 'warn' },
  failed: { text: '失败', tone: 'danger' },
  deactivating: { text: '正在停用', tone: 'warn' },
  pending_restart: { text: '待重启', tone: 'warn' },
};

const CONTRIBUTION_KIND: Readonly<Record<ContributionKind, string>> = {
  command: '命令',
  'shortcut-button': '快捷按钮',
  hotkey: '快捷键',
  settings: '设置',
  panel: '面板',
};

export function contributionKind(kind: ContributionKind): string {
  return CONTRIBUTION_KIND[kind];
}

/*
 * 枚举本身是给宿主看的，直接摆给用户既难判断也不准确：
 * 剪贴板 access=read 会被读成"读写"。三张表把枚举翻成动作，类型保证不漏项。
 */
const FILE_SCOPE_TEXT: Readonly<Record<FileScope, string>> = {
  'plugin-data': '插件数据目录',
  resources: '插件资源',
  'user-selected': '用户选择的文件',
};

const FILE_ACCESS_TEXT: Readonly<Record<AccessMode, string>> = {
  read: '只读',
  write: '写入',
  'read-write': '读写',
};

const CLIPBOARD_TEXT: Readonly<Record<AccessMode, string>> = {
  read: '读取剪贴板',
  write: '写入剪贴板',
  'read-write': '读写剪贴板',
};

/**
 * 一件权限声明的人话描述。具体参数（来源、键名）一并列出：
 * 用户要判断的是"它到底能碰什么"，含糊的概括反而会藏住信息。
 */
export function describePermission(permission: PermissionDeclaration): string {
  switch (permission.kind) {
    case 'capability-use':
      return `使用能力 ${permission.capability}`;
    case 'microphone':
      return '使用麦克风';
    case 'screen-capture':
      return '截取屏幕';
    case 'text-input':
      return '模拟键盘输入';
    case 'network':
      return `访问网络：${permission.origins.join('、')}`;
    case 'credentials':
      return `使用凭据：${permission.keys.join('、')}`;
    case 'files':
      return `访问文件（${FILE_SCOPE_TEXT[permission.scope]}，${FILE_ACCESS_TEXT[permission.access]}）`;
    case 'process':
      return `启动工作进程：${permission.workers.join('、')}`;
    case 'clipboard':
      return CLIPBOARD_TEXT[permission.access];
  }
}

const PLUGIN_ORIGIN: Readonly<Record<'builtin' | 'user', string>> = {
  builtin: '内置',
  user: '用户',
};

export function pluginOrigin(origin: 'builtin' | 'user'): string {
  return PLUGIN_ORIGIN[origin];
}

/** 插件条目的稳定 key：同一 pluginId 可能来自不同实例/世代。 */
export function ownerKey(owner: {
  pluginId: string;
  instanceId: string;
  generation: number;
}): string {
  return `${owner.pluginId}|${owner.instanceId}|${owner.generation}`;
}

export function hostRuntime(state: HostRuntimeState): ToneText {
  return HOST_RUNTIME[state];
}

export function pluginState(state: PluginLifecycleState): ToneText {
  return PLUGIN_STATE[state];
}

/**
 * 宿主的一句话状态。只说计数与真实运行时，不写“一切正常”这类泛化结论：
 * 插件数为 0 或存在未就绪插件时，那种话就是假的。
 */
export function hostSummary(
  runtime: HostRuntimeState,
  installedPlugins: number,
  activePlugins: number,
): string {
  if (installedPlugins === 0) {
    switch (runtime) {
      case 'ready':
        return '已经就绪，尚未安装插件。';
      case 'starting':
        return '正在启动，尚未安装插件。';
      case 'failed':
        return '应用启动失败。';
      case 'stopped':
        return '已经停止。';
    }
  }
  const counts = `已安装 ${installedPlugins} 个插件，其中 ${activePlugins} 个运行中。`;
  switch (runtime) {
    case 'ready':
      return counts;
    case 'starting':
      return `正在启动，状态可能还会变化。${counts}`;
    case 'failed':
      return `应用启动失败。${counts}`;
    case 'stopped':
      return `已经停止。${counts}`;
  }
}

/**
 * 任务的一句话。
 * pendingWork 也包含仍在运行的工作，所以只有在没有运行中任务时，
 * 剩下的 pendingWork 才能说成“正在结束”。
 */
export function taskSummary(runningTasks: number, pendingWork: number): string {
  if (runningTasks === 0 && pendingWork === 0) {
    return '没有正在运行的任务。';
  }
  if (runningTasks === 0) {
    return `没有运行中的任务，还有 ${pendingWork} 项工作正在结束。`;
  }
  if (pendingWork === 0) {
    return `${runningTasks} 个任务在运行。`;
  }
  return `${runningTasks} 个任务在运行，共 ${pendingWork} 项工作尚未结束。`;
}

/* ---- 权限、预设与审计 ---- */

/*
 * 审计只记 kind，不记声明本身，所以这里要一份短名：
 * 列表一行里塞不下 describePermission 那种完整句子。
 */
const PERMISSION_KIND: Readonly<Record<PermissionKind, string>> = {
  'capability-use': '能力调用',
  microphone: '麦克风',
  'screen-capture': '屏幕截取',
  'text-input': '键盘输入',
  network: '网络',
  credentials: '凭据',
  files: '文件',
  process: '工作进程',
  clipboard: '剪贴板',
};

export function permissionKind(kind: PermissionKind): string {
  return PERMISSION_KIND[kind];
}

const PRESET_LABEL: Readonly<Record<PermissionPreset, string>> = {
  ask: '每次询问',
  deny: '全部拒绝',
  local: '本地放行',
};

export function presetLabel(preset: PermissionPreset): string {
  return PRESET_LABEL[preset];
}

const AUDIT_EVENT: Readonly<Record<AuditEvent, string>> = {
  requested: '请求',
  approved: '已同意',
  denied: '已拒绝',
  cancelled: '已取消',
  started: '开始执行',
  completed: '完成',
  failed: '失败',
  closed: '结束',
  revoked: '已撤回',
};

export function auditEvent(event: AuditEvent): string {
  return AUDIT_EVENT[event];
}

const AUDIT_SOURCE: Readonly<Record<AuditSource, string>> = {
  preset: '按预设',
  approval: '按审批',
  undeclared: '未声明',
  invalid: '请求无效',
  stale: '已失效',
  unavailable: '通道不可用',
  control: '控制操作',
};

export function auditSource(source: AuditSource): string {
  return AUDIT_SOURCE[source];
}

/** 指纹只用来比对“是不是同一份”，列表里给前 8 位就够；完整值在确认对话框里。 */
export function shortDigest(digest: string): string {
  return digest.slice(0, 8);
}

/* ---- Demo 控制台 ---- */

const DEMO_PHASE: Readonly<Record<DemoPhase, ToneText>> = {
  setup: { text: '还没准备好', tone: 'warn' },
  idle: { text: '等待输入', tone: 'neutral' },
  preparing: { text: '正在准备', tone: 'warn' },
  arming: { text: '正在开启录音', tone: 'warn' },
  recording: { text: '正在录音', tone: 'warn' },
  recognizing: { text: '正在识别', tone: 'warn' },
  thinking: { text: '正在生成回复', tone: 'warn' },
  responding: { text: '正在回复', tone: 'warn' },
  saving: { text: '正在保存记录', tone: 'warn' },
  stopping: { text: '正在停止', tone: 'warn' },
  error: { text: '出错', tone: 'danger' },
};

/** 阶段只翻译，不推测：宿主说 responding 就是正在回复，页面不替它算进度。 */
export function demoPhase(phase: DemoPhase): ToneText {
  return DEMO_PHASE[phase];
}

/** 「离线脚本演示」这几个字是承诺的一部分：它不是 AI，界面不能含糊过去。 */
const DEMO_REPLY_MODE: Readonly<Record<DemoReplyMode, string>> = {
  demo: '离线脚本演示（不是 AI）',
  deepseek: '真实 DeepSeek',
};

export function demoReplyMode(mode: DemoReplyMode): string {
  return DEMO_REPLY_MODE[mode];
}

const DEMO_PLUGIN_STATE: Readonly<Record<PluginLifecycleState | 'missing', ToneText>> = {
  ...PLUGIN_STATE,
  missing: { text: '本机没有', tone: 'danger' },
};

export function demoPluginState(state: PluginLifecycleState | 'missing'): ToneText {
  return DEMO_PLUGIN_STATE[state];
}

/** 审计时间只到秒；不用 Intl，避免区域设置影响排序与截图。 */
export function clockTime(at: number): string {
  const date = new Date(at);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/* ---- 应用偏好、代理状态与统一记录 ---- */

/*
 * 枚举是给宿主看的，界面只说用户能判断的那几个词。
 * 值的含义（生效方式、会不会自动发送）由所在那一行的说明承担，不靠颜色表达。
 */
const REPLY_LANGUAGE: Readonly<Record<ApplicationPreferences['replyLanguage'], string>> = {
  'zh-CN': '简体中文',
  en: 'English',
};

export function replyLanguage(value: ApplicationPreferences['replyLanguage']): string {
  return REPLY_LANGUAGE[value];
}

const STYLE: Readonly<Record<ApplicationPreferences['style'], string>> = {
  quiet: '安静',
  natural: '默认',
  lively: '活泼',
};

export function styleLabel(value: ApplicationPreferences['style']): string {
  return STYLE[value];
}

const FIGURE: Readonly<Record<ApplicationPreferences['figure'], string>> = {
  minimal: '简约',
  round: '圆头',
};

export function figureLabel(value: ApplicationPreferences['figure']): string {
  return FIGURE[value];
}

const PALETTE: Readonly<Record<ApplicationPreferences['palette'], string>> = {
  morning: '晨蓝',
  lavender: '雪青',
  pine: '松墨',
  orange: '柿橙',
};

export function paletteLabel(value: ApplicationPreferences['palette']): string {
  return PALETTE[value];
}

const SIZE: Readonly<Record<ApplicationPreferences['size'], string>> = {
  small: '小巧',
  normal: '适中',
  large: '放大',
};

export function sizeLabel(value: ApplicationPreferences['size']): string {
  return SIZE[value];
}

const AGENT_STATE: Readonly<Record<ApplicationSnapshot['agent']['state'], ToneText>> = {
  starting: { text: '正在准备', tone: 'warn' },
  ready: { text: '运行中', tone: 'ok' },
  stopped: { text: '已停止', tone: 'neutral' },
  error: { text: '出错', tone: 'danger' },
};

export function agentState(state: ApplicationSnapshot['agent']['state']): ToneText {
  return AGENT_STATE[state];
}

/* 时间线一行只有四种说法，与桌宠那边共用同一套词：含义靠文字，颜色只做辅助。 */
const INTERACTION_KIND: Readonly<Record<ApplicationInteractionKind, string>> = {
  user: '我说',
  pet: '桌宠说',
  interaction: '动作',
  application: '状态',
};

export function interactionKind(kind: ApplicationInteractionKind): string {
  return INTERACTION_KIND[kind];
}

const INTERACTION_VIA: Readonly<Record<NonNullable<ApplicationInteraction['via']>, string>> = {
  bubble: '气泡里',
  console: '设置台里',
  voice: '用语音',
};

export function interactionVia(via: NonNullable<ApplicationInteraction['via']>): string {
  return INTERACTION_VIA[via];
}

/* 离线回复必须带着「离线」两个字：这是承诺的一部分，不含糊过去。 */
export function interactionMode(mode: NonNullable<ApplicationInteraction['mode']>): string {
  return mode === 'demo' ? '离线' : '真实 DeepSeek';
}
