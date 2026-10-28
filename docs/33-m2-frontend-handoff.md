# M2 前端新会话交接

> 本文保留该阶段的历史交付记录。当前产品使用与扩展以[插件式桌宠指南](34-plugin-pet-guide.md)为准。

> 本文保留交接时的历史状态；本轮实施与验收以[M2 进展](../qa/M2-status.md)为准。

## 当前进度

这是独立的MIT、Windows优先Electron桌宠项目，不依赖DSH运行。工作区为 C:/Users/ASUS/Documents/DeepSeek-WorkSpace/Projects/桌宠。

| 范围 | 状态 |
| --- | --- |
| M1-01至09 | 宿主内核、插件运行区、配置迁移、权限、凭据代理、任务/流、SDK与参考夹具已通过限定主会话验收，见[矩阵](../qa/M1-acceptance-matrix.md) |
| M2宿主窗口 | 原生设置窗、预加载和真实快照已接通，支持复用、关闭重开 |
| M2-06 | 五类贡献点的注册、停用清理与展示目录已验证 |
| M2-08 | “停止全部”宿主命令已完成；托盘尚未实现 |
| M2-01/02 | 未实现。组件包仍为空壳，设置台页面目录尚不存在 |
| M2其余前端 | Schema表单、插件操作、审批UI、正式角色/气泡和托盘仍需后续实施 |

最后一次完整检查：1096项工作区测试、QA120通过/1既有权限跳过、类型/lint/格式/构建、严格探针及10条原生流程通过。记录见[M2进展](../qa/M2-status.md)。本次交接只改文档，没有重新跑功能测试。

关键提交：d2bd549（设置窗/快照）、1b2f84f（贡献目录）、28ca49d（停止全部）。新会话以实际git状态为准。

## 本会话的DeepSeek调用情况

4次WorkBuddy DeepSeek委派均在完成前失败，未产出组件或页面代码。最近两次包括正常组件包委派和只回交三个组件代码的任务；正常委派曾确认读到项目，随后仍中断。工具未提供具体失败原因，不推断账户、网络或模型本身故障。

用户要求在新会话继续使用WorkBuddy DeepSeek子代理，不擅自改用其它模型或由主会话包办前端。已撤回未使用的React依赖准备和空CSS导出，当前没有运行中的后台作业。

## 新会话先做什么

先读[开发约定](../AGENTS.md)、[M2短规格](32-m2-console-v1.md)、[M2原工作包](19-implementation-plan.md#L103)与[当前接口](../packages/contracts/src/console.ts)，随后尽快委派，不重做产品访谈。

使用普通subagent，不是Agency专家：provider=workbuddy-subscription，model=deepseek-v4.1-flash；先查询该路由的当前可用性。先让一个子代理完成M2-01组件包，收到实际文件并验收后，再继续M2-02。子代理使用ui-ux-pro-max技能。

前端写入范围：

- [组件入口](../packages/ui-kit/src/index.ts)所在的src目录：Button、Field、List、Section、StatusBadge、EmptyState、Dialog、Toast和主题样式。
- apps/desktop/src/renderer/console/：七页导航、深浅/系统主题、加载/空/错误状态及真实快照展示。
- [桌宠面板](../apps/desktop/src/renderer/pet/PrototypePanel.tsx)和[样式](../apps/desktop/src/renderer/pet/pet.css)：增加真实设置入口；不改拖拽和命中逻辑。

主会话负责包配置、依赖与锁文件、构建、宿主接口、审查、Electron验证、QA记录及本地约定式提交。不给子代理同时修改这些共享文件。

## 接口与接线

- window.petConsole.getSnapshot()返回Result<ConsoleSnapshot>，含host、plugins、contributions、app。
- window.petConsole.stopAll()返回Result<HostStatus>：取消当前任务，宿主继续可用；pendingWork可能尚未归零。
- window.petSettings.open()打开设置窗。调用入口在桌宠主框架；读取快照和停止命令只接受对应设置窗主框架。
- 上述类型均从contracts根导入；组件和页面不导入host-kernel或validation。
- 当前没有保存配置、启停/卸载插件、答复审批的页面API。首版展示真实只读状态；相关写操作按后续工作包接入。

关键主会话待办：

1. [UI-kit包配置](../packages/ui-kit/package.json)尚未声明React与CSS出口；[桌面包配置](../apps/desktop/package.json)尚未依赖ui-kit。按实际产出添加，并用pnpm install --ignore-scripts链接现有版本。
2. [构建脚本](../apps/desktop/build.mjs)目前只构建pet页面。增加console入口，输出dist/renderer/console/index.html，匹配[设置窗路径](../apps/desktop/src/main/windows/console-window.ts)。
3. 配置全局桥类型声明，接上桌宠设置按钮；复用现有窗口和桥，不另造宿主管理层。

环境：Node24.18.0、pnpm11.24.0、Electron45.0.0、React19.3.1、TS6.0.3、Vite8.3.5。若命令不在PATH，使用load_workspace_dependencies返回的Node/pnpm路径，不另装工具。

## 视觉与验收

精简桌面工具：约210px侧栏、单栏内容、系统字体、中性色和一个强调色；普通原生窗口1040×740、最小760×560。七页是开始、桌宠、语音输入、模型、插件、权限与数据、关于。高级版本信息和组件演示放关于页高级区。避免卡片墙、虚假功能、远程字体和过度抽象。

先验证有意义的组件行为，再运行pnpm check与严格探针类型检查。主会话用真实Electron/Playwright检验七页导航、三种主题、键盘焦点、Dialog/Toast、实际快照、设置入口与停止命令，并检查截图；静态渲染测试不能代替交互验收。

已有[窗口探针](../qa/probes/console-host-smoke.mjs)只用临时HTML，不能据其通过宣布真实设置台完成。无需启动另一个Web服务器，DSH网页也不是桌宠设置台。

M0快速交互/混合DPI保留项与250ms阈值不变；真实语音闭环尚未完成。不运行Coopanion克隆、不调用用户Key或付费服务、不创建远程或推送。Coopanion进一步学习与可视化仍按原计划后续开展。

本会话目标在交接时暂停。新会话收到继续指令后恢复已有M2目标；若无法访问旧目标，则按本文件创建当前目标，不把暂停写成完成。
