import { errorMessage, type KernelError } from '@pet/contracts';

/** 失败提示：控制台错误与 Result 错误共用一句话，不猜测原因。 */
export function describeError(error: KernelError): string {
  return errorMessage(error);
}

/** 调用被拒绝（Promise reject）时的统一文案：桥本身没按约定返回 Result。 */
export const CALL_REJECTED = '设置台没有响应，请稍后重试。';

export const COPY = {
  appName: 'AI 桌宠',
  contentSkip: '跳到主要内容',
  navLabel: '设置页导航',
  loading: '正在读取宿主状态…',
  missingBridge: '页面未连上宿主，无法读取状态。',
  retry: '重新读取',
  refresh: '刷新',
  refreshing: '读取中…',
  themeLabel: '主题',
  advanced: '高级',
} as const;
