# M2-02 七页设置台验收

2026-10-26：M2-01/02 首版前端交付完成。前端由普通子代理 Magpie / workbuddy/deepseek-v4.1-flash、max 推理实现，使用 ui-ux-pro-max；主会话负责依赖、构建、入口、审查和真实 Electron 验收。M2 整体未完成。

## 交付

[设置台](../apps/desktop/src/renderer/console/console-app.tsx)包含开始、桌宠、语音输入、模型、插件、权限与数据、关于七页。210px 侧栏与单栏内容，系统字体、中性色、单一强调色；支持浅色/深色/系统主题并保存本机偏好，关于页与插件页以原生 details 收纳高级内容。

[构建](../apps/desktop/build.mjs)输出 dist/renderer/console/index.html；[桌宠设置按钮](../apps/desktop/src/renderer/pet/PrototypePanel.tsx)真实调用 petSettings.open()。UI-kit 的 React 声明和 desktop 引用沿用既有版本，补齐显式样式出口。未新增宿主 API、未放宽来源校验。

getSnapshot() 提供真实宿主/插件/贡献/版本数据；stopAll() 成功后直接合并返回的 HostStatus，不另取快照。停止确认、进行中防重复、失败提示和恢复均已接入。尚未实现的配置保存、插件写操作、审批和数据管理用简短空状态展示。

## 验证

- 最终 pnpm check 通过：1096 项工作区测试；QA 120 通过、1 项既有 Windows 符号链接权限跳过；类型、lint、格式及双入口构建通过。
- pnpm exec tsc --noEmit -p qa/probes/tsconfig.security.json 通过，包含新增受控原生宿主夹具。
- [真实设置台报告](M2-console-ui-results.json)：Electron 45.0.0 / Node 24.22.0 / Playwright 1.64.1，19 组交互检查通过，无页面错误和远程请求。
- [组件报告](M2-ui-kit-results.json)：6 组交互检查通过；Dialog 14 步双向 Tab、Escape/取消/关闭恢复焦点、Toast、字段关联和三态主题通过。

设置台验收覆盖：七页导航且来源 URL 始终不变；侧栏键盘顺序、跳至内容与可见焦点；主题持久化和系统配色实时改变；版本/示例高级分层；窗口复用、关闭重开和760×560最小窗口；缺桥、加载、Result 错误、空状态及刷新恢复；两插件和十条同名贡献的归属展示。三种主题各测21个文字样本，最低对比度为6.02/5.07/5.07。

停止命令使用真实 DesktopHost/TaskSupervisor 与插件运行区，受控工作暂缓清理以验证 pendingWork：

| 观察点 | 运行任务 | 待结束工作 | 宿主 |
| --- | --- | --- | --- |
| 停止被接受 | 0 | 1 | ready |
| 工作完成清理 | 0 | 0 | ready |
| 注入停止失败 | 1 | 1 | ready |

Escape 不发送停止命令；请求期间键盘再次激活只产生一次调用；成功不再取快照（即使下一次快照读取会失败，状态仍正确更新）；失败后可重试。停用一个插件后贡献列表由10条变为5条，另一个插件仍运行；最终 shutdown 为 exitConfirmed:true、forced:false。故障/空状态由受控夹具注入，其余数据来自真实运行区。

已保存12张设置台截图，主要视图：[浅色开始](screenshots/m2/console-start.png)、[深色开始](screenshots/m2/console-start-dark.png)、[真实插件](screenshots/m2/console-real-plugins.png)、[最小窗口](screenshots/m2/console-minimum-size.png)、[任务收尾](screenshots/m2/console-stopping.png)。已人工查看深浅主题、插件、权限、关于、语音空状态、最小窗口与收尾状态。

## 复跑与限制

先 pnpm install --ignore-scripts、pnpm check；随后运行上述严格类型检查与 node qa/probes/console-e2e.mjs。当前工具环境必须显式附加 --no-sandbox 才能启动 Electron，报告记录 sandboxOverride:true；标准沙箱启动失败的实际证据和验证范围见[环境说明](M2-ui-kit.md#当前执行环境)。这些结果证明真实界面与接口交互，不代替沙箱隔离安全验收。

M2-03 Schema 表单/保存、M2-04 插件写操作、M2-05 审批、M2-07 正式角色/气泡及托盘仍待后续。M0 原保留项、真实语音闭环与250ms阈值不变；本轮不增加性能结论。
