# M2-01 组件与主题验收

2026-10-26：第一阶段通过。前端由普通子代理 Magpie / workbuddy/deepseek-v4.1-flash、max 推理实施，使用 ui-ux-pro-max；主会话审查、补样式导出并验收。

## 交付

[UI-kit 入口](../packages/ui-kit/src/index.ts)导出 Button、Field、List/ListItem、Section、StatusBadge、EmptyState、Dialog、Toast 与 UiKitDemo。主题使用系统字体、中性色和单一强调色；light/dark/system 共用 light-dark() 令牌。React 19.3.1 沿用原版本，显式样式出口为 @pet/ui-kit/theme.css、@pet/ui-kit/components.css；根入口同时加载样式。

## 验证

- 主会话完整 pnpm check、UI-kit 类型/lint/格式与最终 Electron 复核通过；全量检查汇总见[阶段二验收](M2-console-ui.md)。
- [真实 Electron 结果](M2-ui-kit-results.json)：Electron 45.0.0 / Node 24.22.0，Playwright 1.64.1，6 组交互检查通过，无页面错误。
- Field 的 label、描述与错误关联正确；Dialog 初始焦点、7 次 Tab 与 7 次 Shift+Tab、Escape、取消/关闭后焦点恢复通过。发现并修复了原生 dialog 首尾环绕时焦点短暂落到 BODY 的问题。
- Toast 不抢焦点，手动关闭与 5 秒自动消失通过。浅、深、系统主题各测 26 个文字样本，最低对比度分别为 5.88、5.07、5.07，超过 4.5:1。系统配色改变可即时跟随。
- 已查看[浅色截图](screenshots/m2/ui-kit-light.png)与[深色截图](screenshots/m2/ui-kit-dark.png)。

复跑：node qa/probes/ui-kit-e2e.mjs。当前受限执行环境须显式附加 --no-sandbox；结果里的 sandboxOverride 会如实记录。

## 当前执行环境

标准 Electron 启动在当前工具进程内退出 3，旧 console-host-smoke 探针同样失败；73 个 Electron 文件与缓存的 45.0.0 发行 zip 哈希全部一致。诊断确认执行进程处于 Windows Job Object，脱离作业的请求被系统拒绝；--no-sandbox 验证启动可运行。本文的 Electron 结果只验收真实界面交互，不作为标准沙箱启动或隔离安全性的验收证据。产品启动脚本、BrowserWindow 的 sandbox/contextIsolation/nodeIntegration 设置未改。

M0 快速交互与混合 DPI 保留项、250ms 阈值不变。
