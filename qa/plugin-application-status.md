# 插件式桌宠验收

当前产品说明统一见[使用与扩展](../docs/34-plugin-pet-guide.md)。实现保留 DSH 式统一宿主，Cortico 为普通智能体插件，五个页面通过普通贡献加载。无付费服务调用、无用户 Key、无环境录音；本机权重与公开 WAV 不入库。

## 已执行

| 检查 | 结果与证据 |
| --- | --- |
| pnpm check | 全工作区类型、测试、QA、lint、格式、构建通过；最终提交前按最后源变化再确认 |
| Core 实际运行 | [runtime report](cortico-runtime-results.json)：事件/完整Generation/工具/媒体、取消、重启5项 |
| 普通智能体插件 | [plugin report](cortico-plugin-results.json)：发现与来源、配置CAS/权限、统一游标与停止/重启5项；退出已确认 |
| 共享应用后端 | [app report](application-backend-results.json)：9项，含气泡直接引导、5017字提示词、实际语音开关、清空、较早记录/增量游标、停用恢复、外部页面配置与动作/故障撤下 |
| 模型配置审批 | [model report](application-model-results.json)：4项；4个完整请求，允许只增加一次版本，拒绝不变，旧确认/版本冲突被拒，私有canary没有进入模型或媒体 |
| 实际GUI | [GUI report](screenshots/application/acceptance-report.json)：9组全部通过，主进程与页面无异常，两个启动进程均正常退出 |
| 实际鼠标 | [native pointer](pet-pointer-results.json)：Win32 SetCursorPos/SendInput，仅自有窗口；透明角落点击进入单独进程，角色拖动位移并释放，真实设置按钮打开窗口；最后鼠标已还原 |

GUI使用真实页面按钮与输入完成初始名字/配色/语音/回应选择、键入聊天、提示词保存、两个形态/四种配色/三种大小、原生置顶/隐藏与隐藏预览；真实戳后红晕显示，再记录一条脸红回执，之后恢复。深浅主题、760×560窗口与键盘放大/缩小/复位无横向溢出。键盘加速经Electron原生sendInputEvent路径验证，CDP键事件绕过before-input-event，不能把它当作OS加速器证据。

公开SenseVoice WAV经真实本机识别，约19.8秒自动结束、9次实际权限决定、1次getUserMedia、1次成功结束；跨人设/对话页后仍是同一录音，音轨ended，识别48个字符并收到明确离线脚本回复。全部使用假音频设备但未使用媒体自动同意参数。

截图为当前实际窗口，保留在[本机截图目录](screenshots/application/)。当前截图足以审阅布局与表情，不等于所有设备/多屏条件都已覆盖。此前M0/M1/M2记录只代表各自阶段，现有完整版GUI入口是 application-ui-acceptance.mjs。

## 发行边界

当前无本项目安装包/更新发布源；更新状态与动作适配器仅以实际状态fixture验证，界面不显示虚构版本。Coopanion产品源码/角色资产未复用。Cortico0.2.7/tsx4.23.15固定版本及许可已记录，分发依赖与权重仍按[第三方说明](../THIRD_PARTY_NOTICES.md)分别处理。
