import type {
  ApplicationBridge,
  ConsoleBridge,
  DemoBridge,
  SettingsLauncher,
} from '@pet/contracts';

declare global {
  interface Window {
    readonly petConsole?: ConsoleBridge;
    readonly petDemo?: DemoBridge;
    readonly petSettings?: SettingsLauncher;
    /**
     * 应用视图与统一记录的新桥：由 preload 暴露，缺失就是"这台机器还没有这份记录"，
     * 页面据此显示真实不可用态，不画假数据。
     */
    readonly petApplication?: ApplicationBridge;
  }
}
