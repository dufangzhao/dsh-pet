# 需求追踪与开工准备度 v0.1

更新：2026-10-24。此页的“已确认”仅来自用户实际回答；自动整理文档不能代替用户决策。当前没有新增许可、框架、MVP或默认权限选择。

## 已确认方向

| 来源 | 决定 | 记录 |
| --- | --- | --- |
| Q1=B | 能力 + 受控UI贡献点 | [ADR-0001](adr/0001-controlled-ui-contributions.md) |
| Q2=A | 独立应用，DSH可选集成 | [ADR-0002](adr/0002-standalone-with-optional-dsh.md) |
| Q3=MIT | 自有代码MIT；第三方内容另审 | [ADR-0003](adr/0003-mit-license.md) |
| Q4=A | 能力/插件中心，优先复用合适框架 | [ADR-0004](adr/0004-capability-centered-host.md) |
| Q5=A | Windows首发，其他平台后续 | [ADR-0005](adr/0005-windows-first.md) |
| AGPL追问后的补充 | Coopanion仅参考，本阶段不二开 | [ADR-0006](adr/0006-reference-coopanion-without-fork.md) |
| Q6=A | 首条闭环为语音听写到目标应用 | [ADR-0007](adr/0007-dictation-first-workflow.md) |
| Q7=C | 首版完整本地/云ASR，用户首次选择 | [ADR-0008](adr/0008-local-and-cloud-asr.md) |
| Q8=A | 云ASR使用用户自带服务商Key | [ADR-0009](adr/0009-cloud-asr-byok.md) |
| Q9修订确认 | 统一单层插件模型，职责/来源不分层级 | [ADR-0010](adr/0010-unified-plugin-model.md) |
| Q10=A | Electron + TypeScript桌面底座 | [ADR-0011](adr/0011-electron-typescript-desktop.md) |
| Q11=按DSH方案 | 可信插件 + 权限预设 + 一次性审批 + 审计 | [ADR-0012](adr/0012-dsh-style-trust-and-permissions.md) |
| Q12=C | 听写一个键两种用法 | [选型清单](01-discovery-plan.md) |
| Q13=C | 默认直接写入，可切换为预览 | [听写PRD](09-dictation-mvp-prd.md) |
| Q13b=A | 持续听写说一句写一句 | [听写PRD](09-dictation-mvp-prd.md) |

用户询问AGPL含义并在解释后明确“仅作参考，先不二开”。当前保持MIT，Coopanion仅作交互/架构参考，见[ADR-0006](adr/0006-reference-coopanion-without-fork.md)。不得继续将该问题标为等待回答，也不得把不fork误解为所有基础组件必须自写。

## 需求 → 场景 → 验收

所有场景和验收ID在[候选场景规格](07-use-cases-and-acceptance.md)中。列入此表不等于进入MVP。

| 用户需求 | 场景 | 验收组 | 缺少的产品决定 |
| --- | --- | --- | --- |
| U-01 语音输入 | UC-01对话 / UC-02听写 | AC-VC / AC-DI | 到底先做哪种，触发与提交策略 |
| U-01 TTS | UC-03朗读 | AC-TT | 首个提供方、声音、流式/离线策略 |
| U-01 音色合成 | UC-04声音制作 | AC-VO | 现成音色/克隆/设计/训练的深度 |
| U-01 制作角色 | UC-05角色 | AC-AV | 人设、导入与制作工具的边界 |
| U-01 看屏幕 | UC-06视觉 | AC-VI | 捕获范围、单次/持续、本地/云 |
| U-01 操作鼠标 | UC-07电脑任务 | AC-CU | 自动化深度、执行器、授权与停止 |
| U-02/03/08 扩展与定制 | UC-08插件 | AC-PL | 首版贡献点、插件类型/信任、安装源 |
| U-04/05 设置与流畅 | UC-09设置、全部场景 | AC-SE及跨场景性能 | 信息架构、性能环境/指标/阈值 |
| U-06/07 Git和先确认再开发 | 全部文档与开发流程 | 提交/验收记录 | 远程/分支/发布策略、最终开工确认 |

## 准备度：不按文档页数判断

| 门槛 | 当前状态 | 继续收敛所需信息 |
| --- | --- | --- |
| 产品形态/方向 | 已确认 | 独立、插件中心、受控UI、Windows首发 |
| 许可与产品复用路线 | 已确认方向 | MIT、Coopanion仅参考；具体组件/素材仍逐项核验 |
| 目标用户/使用环境 | 未确认 | 首批使用者、典型工作任务、Windows版本/架构 |
| MVP与非目标 | 部分确认 | 首闭环为语音听写；完整首版范围、支持矩阵和延期项待确认 |
| 技术基线 | 部分确认 | Electron/TS已定；版本、UI、插件框架及原生/重计算方式待选 |
| 插件契约 | 草案v0.1 | [契约草案](13-plugin-contract-draft.md)已覆盖清单、生命周期、能力规则与听写接口；信任模型已按DSH方案确定，包格式与数值待定 |
| 功能规格 | 候选草案 | 将MVP用例细化成明确输入输出与状态 |
| 安全与数据 | 草案v0.1 | [安全与隐私策略](15-security-and-privacy.md)已覆盖数据清单、信任边界、风险对策与验收；信任边界、留存、统计、更新签名待选 |
| 性能与可靠性 | 方法草案 | [测试策略](14-test-and-acceptance-strategy.md)已定义分段耗时、负载场景与证据格式；数值待选 |
| 组件可用性 | 未实测 | 安装、CPU/GPU、提供方、系统输入等验证 |
| 发布与维护 | 未确认 | 分发、签名、更新、回滚、支持范围 |
| 任务可执行性 | 尚不足 | 每任务产物、依赖、验收、写范围及负责人 |
| 用户批准开工 | 未取得 | 清楚说明遗留风险后共同确认 |

## 关键风险及验证出口（建议，尚未执行）

| 风险 | 影响 | 验证出口 | 相关资料 |
| --- | --- | --- | --- |
| 选择代码底座后才发现许可不兼容 | 重做或无法按选定方式发布 | 固定版本/资产清单和许可检查 | [许可说明](06-license-notes.md) |
| 框架API/生命周期不符合预期 | 插件泄漏、升级困难 | 最小依赖/启停/失败清理测试 | [平台调研](../research/tech-platform.json) |
| 只隔离进程却宣传为安全沙箱 | 第三方原生代码仍可越权 | 明确信任模型与可执行的权限控制面 | [架构草案](05-architecture-overview.md) |
| 把录音聊天当作系统听写 | 焦点错误、覆盖内容、不能回滚 | 有支持列表的文本注入验证 | [Windows资料](../research/tech-windows-automation.json) |
| 4GB显存下多模型争用 | 启动失败或交互卡顿 | 按需加载与目标硬件实测，不先承诺阈值 | [语音资料](../research/tech-voice-character.json) |
| 只测正常完成，不测取消/重连 | 旧音频继续播放、旧动作继续执行 | 晚到/乱序/断线/取消故障注入 | [场景验收](07-use-cases-and-acceptance.md) |
| 外观/音色许可误认为随代码开放 | 无法合法分发素材 | 分开记录代码、权重、声音、角色权利 | [第三方边界](../THIRD_PARTY_NOTICES.md) |
| 依赖当前网页文档，不固定实际版本 | 实现时API已变更 | 锁版本、契约测试与升级复核 | [平台调研](../research/tech-platform.json) |

## 下一轮访谈应先解决什么

许可追问与Q6已解决，首条闭环为[语音听写](09-dictation-mvp-prd.md)。Q7已选择首版完整本地/云双路径；Q8已确定BYOK；Q9进一步确认功能与提供者采用统一单层插件模型。Q10已选择Electron + TypeScript。开工前剩余问题Q11—Q27已按依赖排序列入[选型清单](01-discovery-plan.md)；Q11已按DSH方案确定（[ADR-0012](adr/0012-dsh-style-trust-and-permissions.md)）；Q12已选一个键两种用法；Q13已选默认直接写入；Q13b已选说一句写一句；当前问Q14（首版识别语言）。不要在缺少答案时自动采用推荐项。

完成MVP与技术选择后，再把[架构草案中的验证任务](05-architecture-overview.md)转换为可执行工作包。验证原型也需要用户允许；本阶段不启动实现或安装被研究项目。
