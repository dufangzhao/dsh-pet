# M2 设置台首版

> 本文保留该阶段的历史交付记录。当前产品使用与扩展以[插件式桌宠指南](34-plugin-pet-guide.md)为准。

本轮：M2-01/02。先交基础组件和真实只读界面；表单保存、插件操作与审批随后接入。

## 视觉

- 精简桌面工具：约210px侧栏，内容单栏为主，留白和细分隔线，不做Hero/CTA或卡片墙。
- 系统字体（Segoe UI/Microsoft YaHei），16px正文、12px以上辅助文字。温和中性色与一个清晰强调色，深浅/跟随系统三选；主题偏好可存localStorage。
- 不加动效库、远程字体或图片依赖。SVG线性图标；焦点可见，Tab可用，尊重reduced-motion。
- 设计检索采用Minimalism/Swiss的简洁与可访问性建议，不采纳不匹配的营销版式、红色强调和滚动特效。

## 界面

导航：开始、桌宠、语音输入、模型、插件、权限与数据、关于。真实数据来自快照；未接功能用简短空状态，不放假按钮。
开始页：一句状态、宿主运行情况和插件/任务摘要；插件页读真实列表；关于页版本与入口。其余页明确待接入内容。
普通/高级分层：技术版本与组件演示放关于的高级区。基础组件含Button、Field、Section、StatusBadge、EmptyState、Dialog、Toast及小型组件演示。
普通原生窗口默认1040×740、最小760×560；窗口按钮由系统提供，前端保留内容顶栏，不模拟窗口按钮。

## 接口

类型以[console契约](../packages/contracts/src/console.ts)为准。window.petConsole?:ConsoleBridge，version、getSnapshot()与stopAll()。返回Result<ConsoleSnapshot>，包含host、plugins、contributions、app；无配置值、文件路径、密钥。
window.petSettings?:SettingsLauncher，唯一open()。桌宠PrototypePanel增加设置按钮调用它；不改App拖拽/命中/状态逻辑。缺桥时禁用按钮，失败简短提示。
stopAll()只取消当前任务并返回HostStatus，不关闭应用；pendingWork非零时仍有工作在结束。
ConsolePlugin字段为owner/name/version/state/origin/protected/permissions/reason，均为只读展示。贡献条目只有owner/id/kind/title，按owner+id区分，详情由宿主解析。界面只导入contracts根，不导入validation或host-kernel。

## 分工

DeepSeek：通过 Magpie 普通子代理、max 推理实现 packages/ui-kit/src/ 与 apps/desktop/src/renderer/console/。不得改主进程/预加载/契约/包配置/锁。
主会话：契约、窗口、只读快照、预加载、构建、依赖链接、桌宠设置按钮、审查、原生验收、QA 与本地提交。当前交付状态与证据见[进展](../qa/M2-status.md)。
遵循[开发约定](../AGENTS.md)：直接实现，少层次，不重复兜底；每个未完成功能只说明一次。
