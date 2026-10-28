# 可用桌宠 Demo 交付记录

2026-10-28。录音、真实本地识别、文字对话、桌宠状态与停止、来源审批、持久化及恢复已完成原生验收。前端使用实际成功写入的 `magpie/qoder-cn/dfmodel`、`max`；WorkBuddy额度用尽后未再使用。后端、串行原生验收、审查与本地提交由主会话完成，不推送。持续目标为 `goal-5666d5a1-90f6-44df-b227-92d07f0987b8`。

启动、首次选择、可选真实回复与交付限制仅在 [使用说明](../docs/21-demo-guide.md)维护。五个内置功能实际运行，沿用已有 sherpa-onnx 和两份模型缓存，没有另下模型、引入 Python/PyTorch 或复制参考项目资源。

## 原生证据

| 验证 | 结果与证据 |
| --- | --- |
| 产品ASR | [两个缓存模型](M3-asr-product-results.json)：SenseVoice公开样本14字；Paraformer公开样本51字、13次文本输出；Electron45/Node24.22，进程关闭确认 |
| 完整监督后端 | [PCM→ASR→语音编排→回复→历史](demo-backend-results.json)通过，待审批/lease/pendingWork归零，正常退出 |
| 最终真实应用 | [13组GUI验收](demo-ui-results.json)通过，无页面错误；包括首次模型选择、独立信任与本地预设、文字与气泡、实际getUserMedia/AudioWorklet到识别14字、轨道释放、无lease开麦拒绝、桌宠停止、跨页5次真实审批与取消、20秒自动结束、加密Key存在/删除、重启历史与模型、显式清空。自动停止含识别收尾约21秒 |
| 来源与权限界面 | [11组安全验收](M2-security-results.json)通过；行为说明见 [M2-05](M2-security.md) |
| 配置回归 | 最新原生17组通过；既有设置台23组通过，相关报告保存在各工作包记录 |

最终GUI仅使用公开WAV假设备，已去掉会绕过权限判断的 Chromium 自动同意参数。没有调用付费接口。原生脚本都显式使用本机所需的 `--no-sandbox`，执行串行，不能据此声称操作系统沙箱或真人硬件已验收。

## 实际修复与检查

Web Audio公开假设备出现1.0000293的轻微overshoot：采集端先拒绝非finite，再标准化到[-1,1]；后端继续严格校验，尾帧与ack完成后才提交识别。用唯一全局会话保留跨页录音控制，迟到设备用AbortSignal释放；最新读取统一收起loading，句柄归属使用本次AbortController，避免ready事件错误关掉自己的设备。以上均由最终原生路径复验。

工作区1216项测试通过：contracts298、SDK97、host-kernel204、跨包契约285、desktop329、真实回复协议mock3。QA120通过/1既有Windows权限跳过；类型、lint、格式与双入口构建通过。具体复跑命令见 [项目说明](../README.md#开发检查)。

最终截图：[对话](screenshots/demo/demo-conversation.png)、[听取状态](screenshots/demo/pet-listening.png)、[回复气泡](screenshots/demo/pet-reply.png)。历史工作包与尚未验收的完整规划见 [M2进展](M2-status.md)；这次完成范围为上述可用Demo。
