# M2-03 Schema 设置与保存

2026-10-27。当前后端与桥已实现；Schema 表单及最终集成验收进行中，完成后更新本记录。整体进展见[M2 状态](M2-status.md)。

## 接口与首次保存

共享纯数据类型维护于[配置契约](../packages/contracts/src/config.ts)，设置入口维护于[控制台契约](../packages/contracts/src/console.ts)。inspectConfig 返回受限 Schema、默认候选、字段生效方式与有效快照；只有确实没有记录时 snapshot=null，读取不创建记录。坏文件、旧 Schema 和非法现有数据保留错误，不能伪装为空配置。

[配置服务](../packages/host-kernel/src/config/service.ts)接受 expectedRevision=0 的完整候选，在服务锁内映射底层 null CAS 创建 revision1；已有记录按 revision 比较，竞争写入返回 conflict，不覆盖赢家。相同数据不增加已有 revision。保存只报告 changeMode，不自动启用、重载插件或证明模型可运行。

[受控处理器](../apps/desktop/src/main/console-config-request.ts)只接受当前设置窗口主 frame 与固定文件 URL，校验完整 OwnerRef 后投影稳定存储身份。Result 直接传递，不套用只读快照的成功包装器。未启动或已停用插件可以配置；凭据字段只允许已声明的 credential-ref 枚举，本轮不写入真实 Key。

## 回归与原生证据

[首次保存测试](../packages/host-kernel/src/config/first-save.test.ts)覆盖无完整默认值、纯读取、首配、同服务及跨服务 CAS、旧 Schema、坏数据、读取错误和取消。[设置边界测试](../apps/desktop/src/main/console-config-request.test.ts)覆盖错窗口、子 frame、改变 URL、精确参数、旧世代及停用后配置。

主会话实际复现过停用后保存跨越下一次启用世代的竞态：已中止的运行信号被省略，旧请求在等待读取后仍能创建记录。现由[插件管理器](../packages/host-kernel/src/runtime/plugin-manager.ts)提供独立的当前 OwnerRef 生命周期信号，下一世代、卸载成功或宿主关闭时取消；正常停用仍保留配置能力。复现用例先失败、修复后通过。

[原生桥结果](M2-config-bridge-results.json)使用真实 Electron45、生产 preload/窗口/处理器/ConfigService/FileConfigStore。验证读取不写、非法候选、旧世代与错误窗口拒绝、同窗口 URL 改变被拒绝、首次创建、并发一胜一冲突、窗口重开持久化，以及损坏文件/旧 Schema 不被覆盖。夹具仅在独立 .cache 目录写入测试插件和配置，不使用用户 Key。

独立 Code Reviewer 本轮只完成静态覆盖，等待调用达到120秒上限后收回已完成结果；未作为完整审查通过。其指出的未验证生命周期路径由主会话补充上述运行复现与修复。

## 复跑与范围

先执行 pnpm check 和 pnpm exec tsc --noEmit -p qa/probes/tsconfig.security.json；原生桥执行 node qa/probes/config-e2e.mjs --bridge-only --no-sandbox，完整表单执行 node qa/probes/config-e2e.mjs --no-sandbox；既有设置台执行 node qa/probes/console-e2e.mjs --no-sandbox。

本次标准沙箱启动实际报 Process failed to launch；显式 --no-sandbox 才能在当前执行环境运行，结果记录 sandboxOverride:true。此环境边界沿用[既有说明](M2-ui-kit.md#当前执行环境)，不将界面验收当作沙箱隔离通过。

Coopanion 仅用于设计参考，没有复制产品代码或素材。本轮不接通真实录音/ASR/对话，不下载模型、不引入 Python/PyTorch。后续本地 ASR 延续[最新调研](../research/coopanion-0212-voice-settings.md)：ModelScope 国内来源优先，复用已缓存的 sherpa-onnx、SenseVoice 和流式 Paraformer。M0 保留项与250ms初值不变。
