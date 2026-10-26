import type { ContributionKind, HostRuntimeState, PluginLifecycleState } from '@pet/contracts';
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
        return '宿主已就绪，尚未安装插件。';
      case 'starting':
        return '宿主正在启动，尚未安装插件。';
      case 'failed':
        return '宿主启动失败。';
      case 'stopped':
        return '宿主已停止。';
    }
  }
  const counts = `已安装 ${installedPlugins} 个插件，其中 ${activePlugins} 个运行中。`;
  switch (runtime) {
    case 'ready':
      return counts;
    case 'starting':
      return `宿主正在启动，状态可能还会变化。${counts}`;
    case 'failed':
      return `宿主启动失败。${counts}`;
    case 'stopped':
      return `宿主已停止。${counts}`;
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
