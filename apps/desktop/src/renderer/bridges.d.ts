import type {
  ApplicationBridge,
  ConsoleBridge,
  DemoBridge,
  ModelConnectionBridge,
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
    /**
     * 模型连接桥：读快照、存 Key 并开始、测试在用端点、暂停与打开服务页。
     * 缺失就是这台机器还没有这条通道——连接卡片据此报不可用，不猜配置。
     */
    readonly petModels?: ModelConnectionBridge;
  }
}
