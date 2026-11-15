/**
 * 从冻结的 preload 桥面读本机 QQ 接入管理面。
 *
 * 与其它 bridge 一样：缺失就是「这台机器没有这个能力」，页面据此显示真实
 * 不可用态，不画假数据。这里不做兜底、不重试、不缓存第二份快照。
 */
import type { DesktopLocalHostBridge } from '@pet/contracts';

/** 当前可用的本机接入桥；没接上时返回 null。 */
export function readLocalHostBridge(): DesktopLocalHostBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = window.petLocalHost;
  return bridge !== undefined && bridge.version === 1 ? bridge : null;
}
