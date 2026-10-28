import { errorMessage, type KernelError } from '@pet/contracts';

/** 失败提示：控制台错误与 Result 错误共用一句话，不猜测原因。 */
export function describeError(error: KernelError): string {
  return errorMessage(error);
}

/** 调用被拒绝（Promise reject）时的统一文案：桥本身没按约定返回 Result。 */
export const CALL_REJECTED = '设置台没有响应，请稍后重试。';

/**
 * 写操作没能确认结果时替换掉整页数据：旧快照可能已经和宿主不一致，
 * 继续展示等于把过期状态当成现状。只有重新读取能恢复。
 */
export const UNCERTAIN = '结果未确认，请重新读取插件状态。';

/** 偏好保存没能确认结果：手上的那份可能已经不是现状，只有重新读取才知道。 */
export const UNCERTAIN_PROFILE = '这次保存没有确认结果，偏好可能已经变了。请重新读取。';

/** 保存被 revision 拒绝：草稿留着，让用户自己决定重读还是再存。 */
export const PROFILE_CONFLICT = '这份偏好已被别处改过，保存被拒绝；重新读取后再保存一次。';

export const COPY = {
  appName: 'AI 桌宠',
  contentSkip: '跳到主要内容',
  navLabel: '设置页导航',
  loading: '正在读取状态…',
  missingBridge: '页面没有连上应用，无法读取状态。',
  retry: '重新读取',
  refresh: '刷新',
  refreshing: '读取中…',
  themeLabel: '主题',
  advanced: '高级',
  /** 插件行里打开配置的入口；配置面板里回到列表用 backToPlugins。 */
  config: '配置',
  backToPlugins: '返回插件列表',
  backToRecovery: '返回扩展列表',
  enable: '启用',
  disable: '停用',
  uninstall: '卸载',
  enabling: '正在启用…',
  disabling: '正在停用…',
  uninstalling: '正在卸载…',
  retryEnable: '重试启用',
  repairConfig: '查看配置',
  goPermissions: '前往权限与数据',
  voiceEntry: '去语音输入页',
  /** 新桥还没接上时的一句实话，不猜原因。 */
  appUnavailable: '还没有连上这份应用状态。',
  discardTitle: '放弃未保存的改动？',
  discardBody: '离开这个页面会丢掉还没有保存的配置。',
  discardConfirm: '放弃改动',
  discardCancel: '继续编辑',
} as const;
