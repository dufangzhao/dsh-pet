# M0-04 下载支持任务 · 主会话审查未通过

日期：2026-10-24；基线 `73d20ba`。这只是M0-04的准备任务，尚未运行两个模型识别样本，不能标为V-03通过。

## 当前材料

DeepSeek按指定路由交付[下载脚本草稿](probes/asr-download.mjs)及[原有测试草稿](probes/asr-download.test.mjs)。两文件**尚未提交、未验收**；固定模型元数据已在上一提交纳入[清单](M0-asr-fixtures.json)。

审查时Git blob ID（没有写入Git对象库）：下载脚本 `ffa667f38cbc5acb92796d96527f8f21ff71d187`；原有测试 `a9ebd91812a38c6b8c396dba476f26debfa32f6a`。

## 主会话实测

| 项目 | 结果 | 证据等级 |
| --- | --- | --- |
| 两个交付文件与审查回归文件 `node --check` | exit 0 | 主会话运行 |
| 原有Node测试 | 84 pass / 0 fail，11 suites，报告skip 0 | 主会话运行；某些建链异常会直接return，不能据此证明这些分支一定执行 |
| `node qa/probes/asr-download.mjs --check` | exit 0，12 verified，477,645,710字节，1113ms | 主会话离线复验；收据在忽略缓存 |
| 主会话补充安全回归 | **0 pass / 3 fail / 0 skip，exit 1** | Windows本机junction与确定性并发写入注入 |

失败输出（仅规范行尾空白）见[记录](M0-asr-review-output.txt)，复现代码为[审查回归草稿](probes/asr-review-regressions.test.mjs)。只使用各测试自己创建的临时目录、公开合成字节和假fetch，无网络；finally清理。第三例在发布系统调用处确定性注入另一写入者，不是观察到真实攻击。没有改写用户文件或真实模型缓存。

## 必须返修

| 编号 | 缺陷与定位 | 已观察结果 | 修复要求 |
| --- | --- | --- | --- |
| R1 | [runDownload:695–698](probes/asr-download.mjs#L695-L698)先递归mkdir，再仅检查缓存根本身 | `.cache`为junction时仍下载成功，没有拒绝 | 从可信工作区根开始逐段检查/创建缓存路径，不能先穿过未检查的父目录写入 |
| R2 | [checkOnly:742–746](probes/asr-download.mjs#L742-L746)只检查末级文件 | `test_wavs`为junction时仍报告校验通过 | 离线验证也逐段检查中间目录；拒绝链接后receipt须失败 |
| R3 | [发布:646–650](probes/asr-download.mjs#L646-L650)先检查存在、后rename | 检查后出现的另一写入者内容被覆盖 | 使用原子“不覆盖”发布原语（例如同卷独占硬链接发布，失败不退回覆盖式rename），并保留回归测试 |

另有静态待修项：fetch等响应头期间没有明确截止/AbortSignal，流的idle watchdog仅在拿到响应后开始；部分symlink测试遇EPERM/EACCES直接return会被统计为pass，应显式skip；CLI额外开放任意manifest/cache路径超出本次固定缓存需求，应移除或明确约束；错误路径需取消未消费的响应体。

不宣称Node路径检查是对同用户恶意程序的OS安全沙箱；修复后仍应准确记录并发目录替换等边界。

## 处置与恢复

本交付不合格，不能提交为已通过工作包。返修要求已记录供DeepSeek继续任务时执行；因K3异常后整体等待确认，**尚未重新激活子代理返修**，不声称已送达或已修好。恢复后先按原DeepSeek路由交回修改，主会话重新审查并跑原有+新增测试；全部通过才提交支持脚本。下载数据可保留，但每次推理前应重新校验清单。

模型实际加载出字、性能/准确性、麦克风、中英混说、ASR取消均未验证；未调用任何付费服务或真实Key。
