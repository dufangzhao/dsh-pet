# M2-04 插件管理

2026-10-27：M2-04已交付，主会话完成后端、接口、集成审查及限定环境的真实Electron验收。前端由普通子代理Magpie / workbuddy-ai/deepseek-v4.1-flash、max推理实现，沿用ui-ux-pro-max。整体状态见[M2进展](M2-status.md)。

## 契约与行为

[控制台契约](../packages/contracts/src/console.ts)固定runPluginAction({owner, action})，只允许enable、disable、uninstall。外层Result负责请求/传输失败；有效请求返回完整snapshot与operationError，页面先应用真实快照，再判断操作是否达成，不补一次快照读取去掩盖结果。失败后发生的世代、unready或pending_restart状态同时返回。

[处理器](../apps/desktop/src/main/console-plugin-request.ts)只接受当前设置窗口、主frame和固定URL，校验精确参数与完整OwnerRef。按稳定实例身份拒绝并行动作，启用读取持久化配置，并在等待配置时检查世代有效性。未信任插件不因点击启用而获得批准；管理操作不构成敏感权限授权。

[用户包移除](../apps/desktop/src/main/plugin-removal.ts)只接受宿主登记的用户根目录直接子目录，检查规范路径与目录联接；内置、受保护、越界目录均不经此物理删除路径。内置功能由[M2-05登记表](../apps/desktop/src/main/builtin-registry.ts)持久记录逻辑移除与恢复。PluginManager先停用并清理贡献，只有明确清理成功才移除代码包；失败保留条目，允许用户明确重试。配置、凭据和插件数据位于其他根目录，卸载不删除它们；移除成功清理信任登记并撤销现有权限。

## 管理页

[插件页](../apps/desktop/src/renderer/console/pages/plugins.tsx)按真实生命周期显示动作、来源、版本、保护标记、错误与修复导航。受保护插件不显示停用/卸载；未保护的内置功能现支持逻辑移除与显式恢复，修正记录见[M2-05](M2-security.md)；unready/failed仍可明确停用，pending_restart提示重启完成清理，不再提供启停卸载。权限明细明确是声明而非授权，文件范围与访问模式使用中文，剪贴板只读不会显示成读写。

停用和卸载使用宿主Dialog，取消为默认焦点，Escape取消；确认按钮使用既有危险色令牌。请求期间按owner防重复，Schema草稿守卫保留。外层不可用或回包丢失时，复用[快照错误状态](../apps/desktop/src/renderer/console/use-snapshot.ts)持续显示“结果未确认”，收起旧插件操作，用户明确重新读取后恢复，不自动重试或声称回滚。

## 验证

| 检查 | 结果 |
| --- | --- |
| 工作区 | 1143项测试通过，QA120通过/1项既有Windows符号链接权限跳过；类型、lint通过。完整检查发现的新增测试格式问题已修复，格式与双入口构建单独复验通过 |
| 原生夹具 | 严格tsconfig.security类型检查通过 |
| [管理桥](M2-plugin-bridge-results.json) | 8组通过 |
| [管理页](M2-plugin-management-results.json) | 16组通过，无页面错误或远程请求；Electron45.0.0 / Node24.22.0 |
| [Schema回归](M2-config-ui-results.json) | 17组通过 |
| [设置台回归](M2-console-ui-results.json) | 23组通过 |
| [组件回归](M2-ui-kit-results.json) | 6组通过 |

[管理边界测试](../apps/desktop/src/main/console-plugin-request.test.ts)覆盖最新配置启用、失败后的新世代、并发、旧窗口/参数、卸载失败与重试、清理失败落入待重启。文件移除测试覆盖根目录/越界/内置/受保护拒绝、根与包的目录联接拒绝，以及移除包内联接时保留外部目标。预加载检查精确参数数量、冻结方法集合和无二次Result包装。

原生验收使用生产窗口、renderer、preload、DesktopHost、PluginManager、运行区进程及真实文件系统。夹具只在独立.cache目录创建代码包与数据；显式批准自己的已知包，另有未信任包验证默认拒绝，没有通过renderer批准信任。正向启用必须读到Schema表单实际保存的count=9，否则夹具激活失败。验证停用按owner清掉5种贡献且其他插件不受影响；删除代码后重新发现不再包含它，配置和数据/vault标记保留，信任已撤销。

还验证了激活失败后明确重试、卸载取消、卸载文件失败后保留条目并重试，以及“宿主已经启用但回包丢失”的真实不确定效果：旧操作会被隐藏，手动读取才能恢复。故障开关只在夹具主进程。敏感权限没有自动批准。

三种主题各测36个文字样本，最低对比度6.02/7.70/7.70，最小760×560窗口无横向溢出且动作可达。已保存4张原生截图：[浅色列表](screenshots/m2-plugin/plugin-list-2026-10-27T14-14-32-071Z.png)、[卸载确认](screenshots/m2-plugin/uninstall-dialog-2026-10-27T14-14-32-071Z.png)、[深色列表](screenshots/m2-plugin/plugin-list-dark-2026-10-27T14-14-32-071Z.png)、[最小窗口](screenshots/m2-plugin/plugin-minimum-2026-10-27T14-14-32-071Z.png)。管理页报告保存最终构建的SHA-256；中间截图归入.cache。

## 复跑与边界

先完成工作区检查与严格原生夹具类型检查，原生脚本串行执行，避免窗口竞争焦点：

~~~sh
node qa/probes/plugin-e2e.mjs --bridge-only --no-sandbox
node qa/probes/plugin-e2e.mjs --no-sandbox
node qa/probes/config-e2e.mjs --no-sandbox
node qa/probes/console-e2e.mjs --no-sandbox
node qa/probes/ui-kit-e2e.mjs --no-sandbox
~~~

当前执行环境仍沿用显式--no-sandbox，[已有环境说明](M2-ui-kit.md#当前执行环境)中的隔离限制不变。M2-05再接信任/审批界面；本轮如实显示未信任拒绝，权限与数据页说明当前没有审批对话框，需要审批的能力拒绝。真实语音链路、M0保留项与250ms初值不变；没有下载模型、新增Python/PyTorch或复制Coopanion代码和素材。
