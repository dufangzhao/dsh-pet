---
status: accepted
date: 2026-10-28
source: 用户提出复用Cortico智能体底层，并以桌宠作为日常与应用交互主入口
---

# 复用Cortico智能体底层，桌面层承接原生能力和用户交互

建议采用Cortico 0.2.7固定提交 `cb9ddbd685bcccba1f29905098648f46a79b3862` 的Core、Persona/World/Provider接口及公开页面/面板契约，负责唯一智能体循环、会话、事件流、上下文与工具派发。该提交的[许可证](https://github.com/Pal-AI-Lab/Cortico/blob/cb9ddbd685bcccba1f29905098648f46a79b3862/LICENSE)与[包声明](https://github.com/Pal-AI-Lab/Cortico/blob/cb9ddbd685bcccba1f29905098648f46a79b3862/package.json)均为MIT；保留相应版权与许可声明。Coopanion产品实现及角色资产继续只作参考。

Electron侧负责原生桌宠窗口、实际表情/触碰、音频与ASR、气泡选项/输入、应用引导和更新适配。已有配置CAS、凭据代理、来源确认、权限和外部资源取消保留为单一桌面权威，向Core提供受控适配；不同时运行另一套Agent循环、聊天库、扩展安装器或独立配置写入系统。应用宿主决定插件授权与启停，World执行委托Core完成。

桌宠气泡和设置台是同一角色、同一会话、同一份互动记录及配置的两个入口。对话页显示实际聊天、触碰、表情/动作、引导及通知的投影；人设页包含完整可编辑人设提示词和完整生效提示词预览。初始化在未配置模型时仍可用本地气泡流程完成；更新和权限选择须反映真实状态。

本决定具体化[能力中心架构](0004-capability-centered-host.md)中的Agent实现，沿用[统一插件模型](0010-unified-plugin-model.md)与[受控界面边界](0001-controlled-ui-contributions.md)。Core已通过实际Electron的TS/ESM、provider加载、完整模型结果与工具循环、取消和停止/重启验证，并通过普通插件宿主及共享应用服务的原生探针。运行时使用受支持的tsx加载，禁用非必要的共享磁盘变换缓存；不改写上游框架。证据与实施边界见[Trellis研究](../../.trellis/tasks/archive/2026-10/10-28-plugin-settings-redesign/research/cortico-reuse.md)。
