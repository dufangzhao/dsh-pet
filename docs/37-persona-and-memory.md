# 人格与当前记忆

网页和桌面管理同一个服务 Agent 的名字、人格和当前记忆。身份 ID、对话历史、已有任务与产物不因这些修改而更换。桌面连接方式沿用[共享入口指南](36-shared-desktop-agent.md)。本阶段的真实迁移、Core、工作连续性、HTTP 重试和双端验收已完成，结果由[阶段 QA 记录](../qa/fixtures/companion-persona-memory/acceptance.md)统一维护。

## 使用

- 打开网页的人格／记忆区域，或桌面控制台的人格页。名字与人格正文从服务读取；本机外观、语音和气泡设置仍是本机设置。
- 修改后保存。界面分别显示“已保存”和是否已经用于后续回复；应用失败不会把已保存的数据撤销或伪装成已生效。当前回复未完成时，修改可能返回忙碌冲突，草稿会保留。
- 当前记忆可以新增、修正或忘记。忘记只从当前事实集合移除该条，不会抹去对话、日志或备份。编辑中的旧版本遇到别处修改会冲突；先明确重读，再决定是否提交保留的草稿。
- 服务默认最多保留32条、8KiB事实数据。键区分大小写，值按原文保存；超限会明确拒绝，不会自动截断或删除旧条目。来源未知的旧记录不会猜成由用户添加。
- “请记住我喜欢乌龙茶”这类明确请求可由当前对话处理；用于保存的值须来自这条用户输入的原文。模型仍参与语义选择，这不是对所有自然语言含义的零误差证明。引用里出现的命令、任务完成通知和无明确记忆意图的推测，不构成新的写入授权。

保存不自动测试模型或发起推理。普通资料修改也不会重新启用你明确停用的 Harness；这种情况下可保存，但应用状态会保持未就绪。模型连接与密钥继续使用[模型文字指南](35-text-agent-foundation.md)中的独立设置。

如果启动进程显式设置了 `COMPANION_NAME` 或 `COMPANION_PERSONA`，界面会提示下次启动可能覆盖保存值。需要由操作者调整自己的启动参数；界面不会修改启动脚本或环境文件。

## 已有 v1 数据的显式升级

新资料根直接使用 SQLite格式v2。普通服务启动拒绝静默升级已有v1。升级入口是构建后的 `apps/companion-service/dist/migrate.mjs` 导出的 `migrateCompanionData`，不是 HTTP 接口，也不是一次聊天操作。

1. 等待工作完成，或明确停止已有工作；正常关闭并排空服务与它拥有的执行进程。资料根必须没有另一个写者。
2. 选定原服务资料根和一个**尚不存在**的备份目录。备份的父目录须存在，备份与资料根不能互相包含。
3. 在项目根执行以下示例，把两个绝对路径换成已核对的路径：

```sh
node --input-type=module -e '
import { migrateCompanionData } from "./apps/companion-service/dist/migrate.mjs";
const [dataDirectory, backupDirectory] = process.argv.slice(1);
if (!dataDirectory || !backupDirectory) throw new Error("需要资料根和新的备份目录");
console.log(await migrateCompanionData({ dataDirectory, backupDirectory }));
' /absolute/service-data /absolute/backups/service-before-v2
```

迁移先取得现有 SQLite 排他锁，再复制并逐项核对整个资料根的备份，之后才提交格式版本和记忆集合版本。保留 Agent ID、epoch、事实、消息、命令回执、任务与产物；旧事实来源显示未知。不能覆盖既有备份，不能在原服务仍持有写锁时迁移。失败时会明确报错，未提交的 SQLite 变更回滚；失败的备份目录也不是升级成功的证明。

升级后用新版启动该资料根。需要回滚时，先停下新版并保留其资料副本，再恢复验证过的**完整**升级前备份，最后使用旧程序。不要只替换一个 SQLite 文件，也不要让旧程序写入v2资料。

这里的命令是操作者说明；开发验收只使用合成资料。原4120试用服务仍按此前要求关闭，原资料与凭据没有被这次实现自动读取或迁移。

## 技术与验证入口

- [本阶段要求](../.trellis/tasks/archive/2026-11/11-08-controlled-persona-memory/prd.md)与[集中验收计划](../.trellis/tasks/archive/2026-11/11-08-controlled-persona-memory/research/acceptance-plan.md)区分存储、真实 Core、网页和原生桌面证据。
- 工作区类型与包测试、根 QA、静态检查和生产构建已经分段完成；独立 Core／实际 Docker 门禁也已运行。完整迁移、实际双端交互、工作持续性和 HTTP 丢回执重试均已验收；具体运行与构建归属见上方阶段 QA 记录。
- Windows 专属设备、快捷键与桌面合成仍沿用共享桌宠阶段的验证范围，不能由 Linux 图像或组件测试替代。
