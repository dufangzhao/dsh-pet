# M4 共享语音输入验收

**选定的 Linux／浏览器范围已验证，待工作提交、Trellis 归档与日志。** 本增量将网页和桌面设置台的明确结束录音，经 Magpie ASR 变为同一 Agent 的普通消息。TTS、全双工与其他平台另行推进。

| 项目 | 结论与证据 |
| --- | --- |
| Q1 真实入口与采集 | 生产 Electron 与完整 Chrome 的真实 getUserMedia/AudioWorklet/桥接或 HTTP 路径通过；完整尾帧、实际释放及延迟真实 stream 交付均可观测。设备是合成设备。 |
| Q2 提供者与消息 | 真实服务/普通 provider 的二进制、目录、鉴权、取消、只读恢复通过；最终文本经现有普通消息路径进入同一 Agent 一次。 |
| Q3 并行思考与工作 | ASR 开始/完成/取消不打断当前 Core 推理和真实 Docker 工作；同 task/execution/container、副作用一次、产物字节校验通过。 |
| Q4 撤销与换代 | 真实来源撤信任、连接 retarget 停止旧 tracks/context/lease，旧输入不投新 Agent；迟到结果仍按原归属清理。 |
| Q5 UI 行为 | 真实目录读选存、独立草稿/CAS、固定终态错误、20秒自动结束、预览编辑发送、打字草稿保留、880×600 布局通过。 |
| Q6 真实模型 | 用户明确授权的3秒公开样本，经 Magpie→`xiaomi/mimo-v2.5-asr` 成功；一次上传，返回“开放时间早上九点”，未提交 Agent 消息/任务。 |
| Q7 收尾 | 完整质量门禁、代码规范、操作说明与证据已齐；提交归档按阶段流程完成。 |

## 最终质量门禁

最新完整 `pnpm check && git diff --check` 为 **actual exit0**，job `bash-bc339c01834f42b3`。这次确实包含全工作区类型、包测试、根 QA、lint、格式和完整生产构建，不再以先前分段结果代替：

- 桌面 **972/972**，服务 **70/70**，文字客户端 **249/249**，中性采样器 **13/13**。
- 根 QA **144 passed / 4 expected environment skips**。默认包测试也有既有环境门控的 Docker 项；另行实际 Docker 验证见下。
- 最终 consumer 修复的受控真实 Chromium DOM **32/32**；这是组件证据，不冒充生产设备或人工权限弹窗。
- 当前生产 console `index-D6vt4eTl.js`、CSS `index-K_KCqIS7.css`、pet `index-C-yAv87j.js`。最终 native/Web 运行前后哈希一致。

## 实际集成证据

| 运行 | 范围与实际结果 |
| --- | --- |
| [生产基线 full suite](evidence/final-62621ec4.md) | 前一 consumer 构建12项通过；包含真实桌面/网页完整链路、取消、来源撤销和二 Agent retarget。保留其旧构建事实。 |
| [当前构建针对性 native](evidence/final-targeted-4b165c6c.md) | 当前构建8项通过。高 voice revision 不污染 Companion 状态；独立草稿/CAS、长 ID 布局、迟到真实 stream 交付、401/429、320000 samples 自动结束、review 显式发送。 |
| [当前构建 Web smoke](evidence/final-web-468f3b01.md) | 当前构建4项通过。明确 denied 零音频；实际空模型目录读选存；完整 Chrome 真采样→HTTP→实际 provider→受控 peer→同 Agent 消息；取消无额外输入。 |
| [受控服务往返](../../probes/companion-voice-input-controlled.mjs)／[鉴权隔离](../../probes/companion-voice-input-provider-auth.mjs) | `--run-frozen` 实际通过，job `bash-8e294c1171304db3`。状态恢复不重复 POST，上游401仍为 HTTP200 voice error，服务 bearer401另行处理，文字连接保持 live。 |
| [语音／Core／Docker 并行](../../probes/companion-voice-input-worker.mjs) | job `bash-d6308071580a45ea` actual exit0；四项断言通过，产物 SHA256 `ed9af2b65fab83778933b0527cbc9f2cdda3cb95319a655da47e4c901652b916`。首次失败为 QA 误传完整票据，已改用取消接口的四个键。 |
| 独立 Core／真实 Docker 服务回归 | `test:companion:core` 四项、指定现有镜像运行的 `test:companion` **18/18**，job `bash-b39105bf5b3b4762` actual exit0，无跳过。 |
| [一次真实 ASR](evidence/q6-live-20261110.json) | 用户选择“运行这一次实测”；job `bash-be522bf51d234d40` actual exit0，一次上传、2655ms 上传至结果、final/settled、0消息/0任务，服务关闭。 |

报告中的完整 before/after SHA256 映射、实际退出码、清场结果与安全截图保留原样。Q6 是后续独立授权运行，不回写旧报告当时“尚未实测”的范围声明。Parent 也实际查看了当前桌面目录/布局与网页完成截图。

## 真实 ASR 范围

固定公开样本为 mono16k PCM16、3秒，SHA256 `17e7fba4b006f086d644468a94c937d0d8cff182d16e479887fefa913b2a9467`。原始下载匹配已记录 Git blob SHA1；音频留在忽略的私有 QA 目录，不提交或分发。使用自己的 Magpie 身份与独立语音配置，没有读取或借用 DSH/AstrBot/文字模型密钥。

本次返回文本为“开放时间早上九点”。2655ms 是单次从上传到返回的观察，既不是录音总时长，也不是识别准确率或延迟分布承诺。[单次脚本](../../probes/companion-voice-input-live.mjs)有原子 attempt marker，未知结果不得重跑；失败最多读取同一票据状态，不重新上传。

## 已修复的真实回归

- [尾帧失败](evidence/checkpoint-5f655739.md)：worklet9344 samples／WAV8000，缺1344 tail。旧单测在 finish 之前交尾帧，漏掉真实 flush 时序。已先复现红灯，再区分正常 closing 与取消/失败；当前生产 Web 尾帧192、native 自动 cap 等字节断言通过。
- 成功结果过早清空 capture 引用，导致本地所有权检查反而拦掉发送；已修正并用正常 send/review DOM 回归验证。
- 将 voice bridge 强转为 companion bridge造成跨 projection/revision 污染；当前实测 voice35>companion16 后设置操作仍保留完整连接与 snapshot。
- 独立偏好/凭据保存覆盖 provider 草稿、使用最新 props 绕过 draft baseline；改为捕获基线与显式 rebase。
- ASR 终态 KernelError 丢失，以及 arming 可点 finish 留下旧票据；真实固定错误、arming 只取消、异常 finish fence/release 路径均通过。

## 诊断留存与限制

31份重复的中间诊断已按原 SHA256 保留移至本机忽略目录；[迁移清单](../../../.companion-data/qa-private/companion-voice-input/intermediate-ga8bs2n5/manifest.json)仅供本机复核，不属于提交的交付物。关键尾帧失败与最终范围证据留在本目录。

所有受控 listener 使用随机 loopback 端口，child HOME/XDG 与 SQLite 根隔离，所属 browser/Electron/service/peer/Xvfb/container 均按各报告清场；原4120、原始数据与令牌未用于测试。完整 Chrome 的已授权/已拒绝状态由测试上下文明确设置，未验证人工浏览器/OS弹窗操作。延迟 stream 用的是真实合成设备结果的受控交付，不冒称实际 OS 授权延迟。Windows/macOS、真实物理设备、全部网络/提供者变体和长期质量均不在本阶段已验证范围。
