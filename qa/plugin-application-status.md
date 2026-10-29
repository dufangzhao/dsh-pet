# 插件式桌宠验收

当前产品说明统一见[使用与扩展](../docs/34-plugin-pet-guide.md)。实现保留 DSH 式统一宿主，Cortico 为普通智能体插件，五个页面通过普通贡献加载。无付费服务调用、无用户 Key、无环境录音；本机权重与公开 WAV 不入库。

## 插件式基础版本已执行（e6b291d）

| 检查           | 结果与证据                                                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| pnpm check     | 全工作区类型、测试、QA、lint、格式、构建通过；最终提交前按最后源变化再确认                                                                                               |
| Core 实际运行  | [runtime report](cortico-runtime-results.json)：事件/完整Generation/工具/媒体、取消、重启5项                                                                             |
| 普通智能体插件 | [plugin report](cortico-plugin-results.json)：发现与来源、配置CAS/权限、统一游标与停止/重启5项；退出已确认                                                               |
| 共享应用后端   | [app report](application-backend-results.json)：9项，含气泡直接引导、5017字提示词、实际语音开关、清空、较早记录/增量游标、停用恢复、外部页面配置与动作/故障撤下          |
| 模型配置审批   | [model report](application-model-results.json)：4项；4个完整请求，允许只增加一次版本，拒绝不变，旧确认/版本冲突被拒，私有canary没有进入模型或媒体                        |
| 实际GUI        | [GUI report](screenshots/application/acceptance-report.json)：9组全部通过，主进程与页面无异常，两个启动进程均正常退出                                                    |
| 实际鼠标       | [native pointer](pet-pointer-results.json)：Win32 SetCursorPos/SendInput，仅自有窗口；透明角落点击进入单独进程，角色拖动位移并释放，真实设置按钮打开窗口；最后鼠标已还原 |

GUI使用真实页面按钮与输入完成初始名字/配色/语音/回应选择、键入聊天、提示词保存、两个形态/四种配色/三种大小、原生置顶/隐藏与隐藏预览；真实戳后红晕显示，再记录一条脸红回执，之后恢复。深浅主题、760×560窗口与键盘放大/缩小/复位无横向溢出。键盘加速经Electron原生sendInputEvent路径验证，CDP键事件绕过before-input-event，不能把它当作OS加速器证据。

公开SenseVoice WAV经真实本机识别，约19.8秒自动结束、9次实际权限决定、1次getUserMedia、1次成功结束；跨人设/对话页后仍是同一录音，音轨ended，识别48个字符并收到明确离线脚本回复。全部使用假音频设备但未使用媒体自动同意参数。

截图为当前实际窗口，保留在[本机截图目录](screenshots/application/)。当前截图足以审阅布局与表情，不等于所有设备/多屏条件都已覆盖。此前M0/M1/M2记录只代表各自阶段，现有完整版GUI入口是 application-ui-acceptance.mjs。

## 当前开始栏复刻验收

本轮仍在集成前端，基础版本的GUI截图不作为新界面验收。当前 [模型报告](start-model-results.json) 已通过13组真实宿主检查，覆盖18个API Key端点、实际审批、失败与版本冲突，以及同一隔离profile的四次新Host/worker生命周期；全部退出确认，未强制结束。恢复不发模型请求、不解密Key、不覆盖deny，明确禁用后仍不恢复。报告的emulatedCipher=true仅用于headless数据流程，不证明DPAPI或完整OS进程重启。

浏览器登录的7项本地回调测试覆盖PKCE/JWKS身份、nonce与套餐授权拒绝、取消、加密令牌轮换和永久拒绝刷新后的退出状态，未使用真人账号或登录服务。模型协议测试另含真实格式的Chat/Responses、Anthropic/Gemini、Gemini工具签名重放、ChatGPT流式回执和可用模型选择；没有实际付费调用。新 [界面验收脚本](probes/coopanion-start-ui-e2e.mjs) 已通过全部12组；[最终报告](screenshots/coopanion-start/coop-start-1793262754337-88ae2a0b/acceptance-report.json)记录两个真实应用进程正常退出、零脚本/远端请求异常。预览日夜、菜单、拖动、键盘与禁止拖动点按、真实表情/聊天、向导显隐和重启偏好均通过。截图与参考版本说明见[对照](screenshots/coopanion-start/comparison.md)。[原资料正常启动](start-normal-results.json)已确认五页、Core ready、桌宠与设置均显示；未加测试资料或兼容启动标志。

## 发行边界

当前无本项目安装包/更新发布源；更新状态与动作适配器仅以实际状态fixture验证，界面不显示虚构版本。Coopanion产品源码/角色资产未复用。Cortico0.2.7/tsx4.23.15固定版本及许可已记录，分发依赖与权重仍按[第三方说明](../THIRD_PARTY_NOTICES.md)分别处理。

## Start设计评审与可复用流程（2026-10-29）

在已接受的开始栏动作上完成5个DeepSeek QoderCN max展示方案，普通入口保留基准；独立[评审启动器](../Start-Design-Lab.cmd)与[截图/取舍](screenshots/start-design-lab/comparison.md)已交付。UI Designer实际回报1/3，UX/Frontend咨询因共享3席容量未返回，不冒称共识。

- 最终pnpmcheck通过（jobfd371cc416024221）：类型、448项桌面测试及其他workspace/QA测试、lint、格式、构建；包含真实插槽按钮禁用状态5项回归。原生先抓到saveEnabled正值直接传disabled的问题，已由DeepSeek修正并补组件层断言。
- [当前正常入口回归](screenshots/coopanion-start/coop-start-1793272804867-49bf2eb9/acceptance-report.json)：12组全过，2次真实应用进程正常退出。
- [五版评审原生报告](screenshots/start-design-lab/start-lab-1793272859631-b3d0f795/acceptance-report.json)：7组全过，5版各一次真实poke+user+pet，同一Core记录；跨版Key/model内存草稿、真实pause/visibility、spine/stage/workspaces退出撤试色、880×600/zoom/keyboard/reducedMotion、进程重启保留；2次正常退出。15幅原生截图+1幅对照已核阅代表性浅/深/最小窗口。
- Morphicons2.0.2为实装MIT引擎；glyph是本项目自绘。Uiverse3条MIT许可逐页核实，仅作可供性参考后独立改写；无Lucide第二套依赖，无Coopanion产品代码/角色移植。完整NOTICE在源码同目录。
- [replicate-then-redesign](../.agents/skills/replicate-then-redesign/SKILL.md)已入项目并可被skilltool发现；格式校验与[独立气泡前向计划测试](replica-redesign-skill-results.md)完成。新气泡功能没有在此任务实现，规划产物不冒称native通过。

模型协议/真人账号/费用验证范围沿用前述已接受证据；本轮没有真人授权或付费模型请求。正常资料目录未用于评审；flag单独运行使用.cache/pet-start-design-lab-profile，自动验收使用唯一隔离profile。最终评审打开元数据见[start-design-review-open.json](start-design-review-open.json)。

## 后续纠正：原创控件体系

用户退回上一轮的控件语言；旧截图保留为退回稿。原创 kit、外壳、状态/动作层、预览与配色已实现。[基础原生报告](screenshots/original-controls/start-lab-1793296307496-9b1e65c4/acceptance-report.json) 10/10 通过、27 图、三个应用进程均正常退出，覆盖保存后网络拒绝、Core 历史、36 色事务与五版最小窗口/缩放/重启。独立视觉复审实际 PASS，原头像/窄场景阻塞关闭。

随后完整 `pnpm check` 退出 0：[原始输出](screenshots/original-controls/start-lab-1793296307496-9b1e65c4/workspace-check.log)含 523 项桌面测试（52 文件）、其余 workspace 测试、QA 120 通过/1 跳过/0 失败、类型、lint、格式与构建。本次全检查先于后续折叠栏 CSS 修正；该修正另有 43 项定点测试/格式通过及[最终稳态原生增量](screenshots/original-controls/collapsed-1793300116862-5ff40377/acceptance-report.json)通过：两种窗口均为 72px，三档主题指针/键盘与完整焦点可见，6 图、单次进程正常退出。仅 probe 与侧栏 CSS 变动；[合并指纹](screenshots/original-controls/start-lab-1793296307496-9b1e65c4/integration-evidence.json)已核对当前 47 个文件。

本轮的组件替换、五版取舍、技能验证与实际截图统一见[原创控件评审](original-controls-review.md)；原生执行细节由[QA 执行记录](original-controls-results.md)维护。
