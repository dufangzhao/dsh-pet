# M2-03 Schema 设置与保存

2026-10-27：M2-03 已交付，完成主会话审查、集成与限定环境的真实 Electron 验收。前端由普通子代理 Magpie / workbuddy-ai/deepseek-v4.1-flash、max 推理实现，使用 ui-ux-pro-max；后端、契约、预加载、验收和提交由主会话完成。开始实施前已做一次不修改文件的 DeepSeek 实际调用。整体进展见[M2 状态](M2-status.md)。

## 接口与首次保存

共享纯数据类型维护于[配置契约](../packages/contracts/src/config.ts)，设置入口维护于[控制台契约](../packages/contracts/src/console.ts)。inspectConfig 返回受限 Schema、默认候选、字段生效方式与有效快照；只有确实没有记录时 snapshot=null，读取不创建记录。坏文件、旧 Schema 和非法现有数据保留错误，不能伪装为空配置。

[配置服务](../packages/host-kernel/src/config/service.ts)接受 expectedRevision=0 的完整候选，在服务锁内映射底层 null CAS 创建 revision1；已有记录按 revision 比较，竞争写入返回 conflict，不覆盖赢家。相同数据不增加已有 revision。保存只报告 changeMode，不自动启用、重载插件或证明模型可运行。

[受控处理器](../apps/desktop/src/main/console-config-request.ts)只接受当前设置窗口主 frame 与固定文件 URL，校验完整 OwnerRef 后投影稳定存储身份。Result 直接传递，不套用只读快照的成功包装器。未启动或已停用插件可以配置；凭据字段只允许已声明的 credential-ref 枚举，本轮不写入真实 Key。

## 表单与交互

入口位于插件行的“配置”。[宿主表单](../apps/desktop/src/renderer/console/config-form.tsx)渲染受限 Schema 的标量、枚举、const、嵌套对象与数组，包含长度、数值范围、数组数量与唯一性校验。字段标签与生效提示分开，错误与输入关联，非法提交聚焦错误摘要；const 显示固定值，可选字段通过“设置此项”区分缺失与合法空值。

[草稿逻辑](../apps/desktop/src/renderer/console/config-draft.ts)在首次无记录时以宿主 defaults 为起点，补齐必填字段；已有快照中缺失的可选项保持缺失，不补默认值。required 只约束属性存在，字符串按 Unicode code point 计长度。空字符串、false、0、null、空数组均能明确保存。

[配置状态](../apps/desktop/src/renderer/console/use-config.ts)保留保存失败的草稿，用请求门闩防重复提交；冲突后禁止保存，必须显式重新读取，不自动合并或覆盖。读取中与读取失败不保留可保存的旧表单。离开配置页或返回列表前确认是否丢弃草稿，Escape 继续编辑。保存只按返回值提示生效方式。

## 验证

| 检查 | 结果 |
| --- | --- |
| 工作区检查 | 完整 pnpm check 与最后修复复验通过；串行1127项工作区测试，QA120通过、1项既有Windows符号链接权限跳过；类型、lint、格式与双入口构建通过 |
| 严格原生夹具类型检查 | pnpm exec tsc --noEmit -p qa/probes/tsconfig.security.json 通过 |
| [原生桥结果](M2-config-bridge-results.json) | 5组通过：纯读取、来源与世代、首次创建/并发CAS、真实文件持久化、坏记录/旧Schema保留 |
| [原生表单结果](M2-config-ui-results.json) | 17组通过，无页面错误或远程请求；Electron45.0.0 / Node24.22.0 |
| [设置台回归](M2-console-ui-results.json) | 23组通过 |
| [组件回归](M2-ui-kit-results.json) | 6组通过，含 Field 标签/描述/错误关联和 Dialog 焦点 |

[首次保存测试](../packages/host-kernel/src/config/first-save.test.ts)覆盖无完整默认值、纯读取、首配、同服务及跨服务CAS、旧Schema、坏数据、读取错误与取消。[设置边界测试](../apps/desktop/src/main/console-config-request.test.ts)覆盖错窗口、子frame、改变URL、精确参数、旧世代及停用后配置。前端另有18项草稿和渲染回归，主会话用真实交互补足静态渲染不能证明的行为。

主会话实际复现并修复过两条取消路径：停用后的保存等待期间重新启用，旧世代仍能写入；以及读取期间取消的无变化保存仍返回成功。现由[插件管理器](../packages/host-kernel/src/runtime/plugin-manager.ts)提供当前 OwnerRef 生命周期信号，下一世代、卸载成功或宿主关闭时取消；正常停用仍保留配置能力。配置服务在读取后、无变化返回前检查取消。复现用例均先失败、修复后通过。独立 Code Reviewer 只完成静态核对，不作为完整审查通过；上述运行复现与修复由主会话完成。

最终复验另捕获了Windows并发读取与发布替换的共享冲突：[I/O回归证据](M2-config-io-regression-results.json)记录rename返回EPERM，改名开始时读句柄0、失败时1。配置检查现在复用已有实例锁与保存串行执行，避免同一宿主的读取句柄跨越替换过程，没有新增重试。确定性并发回归先失败、修复后通过；修复后4次受控原生流程均通过，未再出现非注入的保存失败。临时文件系统追踪已移除，最终验收使用正常文件系统实现。

真实表单覆盖首次保存、必填/范围/数组错误、emoji输入、合法空值、取消可选项、三种生效提示、失败保留与重试、防重复提交、冲突保留/显式重读/读取失败恢复、导航草稿确认、窗口关闭重开。使用真实生产窗口、renderer、preload、处理器、ConfigService 和 FileConfigStore；故障注入与测试插件只在独立 .cache 目录，不读取用户 Key。

三种主题各测42个文字样本，最低对比度为6.02/5.07/5.07；760×560原生窗口中的表单可滚动，保存按钮可达，无横向溢出。已保存6张原生截图，主会话人工查看[首次配置](screenshots/m2-config/first-config-2026-10-27T12-53-32-727Z.png)、[深色表单](screenshots/m2-config/saved-dark-2026-10-27T12-53-32-727Z.png)与[最小窗口](screenshots/m2-config/minimum-size-2026-10-27T12-53-32-727Z.png)。表单报告保存构建文件的SHA-256；主会话逐项回读确认与最终构建一致。中间调试截图归入 .cache。

## 复跑与范围

先执行 pnpm check 与严格类型检查，再串行执行，避免多个原生窗口竞争焦点：

~~~sh
node qa/probes/config-e2e.mjs --bridge-only --no-sandbox
node qa/probes/config-e2e.mjs --no-sandbox
node qa/probes/console-e2e.mjs --no-sandbox
node qa/probes/ui-kit-e2e.mjs --no-sandbox
~~~

本次标准沙箱启动实际报 Process failed to launch；显式 --no-sandbox 才能在当前执行环境运行，结果记录 sandboxOverride:true。此环境边界沿用[既有说明](M2-ui-kit.md#当前执行环境)，不将界面验收当作沙箱隔离通过。

Coopanion 仅用于设计参考，没有复制产品代码或素材。本轮不接通真实录音/ASR/对话，不下载模型、不引入 Python/PyTorch。后续本地 ASR 延续[最新调研](../research/coopanion-0212-voice-settings.md)：ModelScope 国内来源优先，复用已缓存的 sherpa-onnx、SenseVoice 和流式 Paraformer。M0 保留项与250ms初值不变。
