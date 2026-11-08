# 真实 API 联调记录（frontend，A–L 完成）

状态：**已完成**。2026-11-08 在 parent 提供的最终实例上跑完 A–L 与截图审阅。

证据等级：**loopback 真实服务 + parent 受控 HTTP/SSE 协议 peer**。不是真实 Magpie、不是上游供应商模型、不是公网部署。

## 环境

| 项 | 值 |
| --- | --- |
| service URL | `http://127.0.0.1:44037` |
| 只读入口 | `http://127.0.0.1:42423`（loopback-only 代理，Host 固定非 loopback） |
| 网关 peer | `http://127.0.0.1:34835/v1`，统计 `http://127.0.0.1:34835/stats` |
| 连接文件 | `/tmp/companion-model-browser-Tr6QZN/connection.json`（Node 内存读取，未打印 token/key） |
| profile | 全新临时 profile，`calls` 起始为 `[]` |
| 浏览器 | 持久 Chromium `chrome-headless-shell`，隔离运行库 + Noto CJK fontconfig |
| 中文字体 | Noto Serif CJK JP / KR / HK（截图非方框） |

## 运行命令

```sh
export LD_LIBRARY_PATH=$PWD/.companion-data/tooling/browser/libraries/usr/lib/x86_64-linux-gnu
export FONTCONFIG_FILE=$PWD/.companion-data/tooling/browser/fonts.conf
export COMPANION_CONNECTION=/tmp/companion-model-browser-Tr6QZN/connection.json

# A–K：21 项
node qa/probes/companion-model-browser-acceptance.mjs

# L：不同 configRevision 的连接切换，4 项
node qa/probes/companion-model-switch-revision.mjs
```

## 结果

| 段 | 检查 | 关键实测 |
| --- | --- | --- |
| A | 2 | 初始 `scripted / applied=null / enabled=false / check=unconfigured`；摘要说明脚本模式；连接列表含 Magpie 与模拟连接 |
| B | 1 | 保存网关地址 + `loopback-ok` 且保持 scripted：**网关 0 调用**；保存后 `credential` 变 `required=true, writable=true, available=false` |
| C | 1 | key-only：只发 credential，输入立即清空，**0 调用** |
| D | 1 | 测试：202 受理 → `verified`、`evidence=network`、**恰好 1 次** peer 请求（`{model:"loopback-ok",stream:true}`） |
| E | 1 | 同 `commandId` 第二次测试返回 `duplicate`，网关仍只有 1 次 |
| F | 2 | `loopback-error` → `check.state=failed` + 固定错误码；`loopback-hang` → 服务端 15s 期限 `timeout` |
| G | 1 | fixture → `evidence=synthetic`，界面写「模拟检查通过，未连接真实模型」 |
| H | 2 | 只读入口：读 200、`writable=false`、写入 **403 permission-denied**；界面无密码框，只给宿主注入说明 |
| I | 5 | 模型模式聊天（回复明写「未调用真实模型」）；`start_work` 任务；产物恰为 `summary.md`+`items.csv`；下载合计 **25**；脚本↔模型来回切换后 agent identity、任务、产物保留 |
| J | 3 | 390px 按钮在视口内且可命中；Tab 焦点环可见；无未捕获页面错误 |
| K | 2 | 关闭态 1440/390 均 `display:none`、无盒子、`elementFromPoint` 可命中、真实点击落焦 |
| L | 4 | magpie=5 / fixture=1 时切换：**无**假外部变更提示；无 Key 连接**无错误提示、无密钥框**；保存以 **rev 1** 被接受；无未捕获错误 |

**合计 25 项检查全部通过**（A–K 21 + L 4）。

产物 sha256：`summary.md 99de59b9b48e134ac754a62c9926aa76f5797b7f81d48d1f72fc9a280085d246`、`items.csv f1b8c3dfd97d5e33ba13ebd674afeeac8e2ea76055ddb9cd827121b3e2e566e6`。任务 `ea36ab8a-3a14-4d4e-96b5-057c6dc36ef1`。

## 结束状态（实测）

```
peer stats: calls=8, closedStreams=1
  loopback-ok ×6, loopback-error ×1, loopback-hang ×1
view: desired=scripted/fixture, applied=fixture, enabled=false, check=configured
snapshot: messages=6, tasks=1, agent=同伴/scripted
pageErrors=[], consoleErrors=[], failedRequests=[]
```

## 截图（10 张，`qa/screenshots/companion-model/`）

| 文件 | 内容 |
| --- | --- |
| `a-initial-dialog.png` | 初始：脚本模式、模型为空、不需要密钥、未测试 |
| `b-saved-scripted.png` | 保存后仍 scripted |
| `d-verified-network.png` | 测试通过，`network` 证据 |
| `g-synthetic.png` | 模拟连接，明写「模拟检查通过，未连接真实模型」 |
| `h-readonly-ingress.png` | 只读入口：不允许写密钥、当前没有可用密钥 |
| `i-model-chat.png` | 模型模式聊天，回复标注未真实模型 |
| `i-task-artifacts.png` | 任务完成 + 两份产物 |
| `j-390-keyboard.png` | 390px 对话框，按钮在视口内 |
| `k-closed-state.png` | 关闭态无遮挡，输入框有焦点环 |
| `l-switch-different-revision.png` | 不同 revision 连接切换，无错误提示 |

截图均经 `read_image` 人工审阅，未发现新的产品问题。

## 产品版本指纹

```
plugins/text-client/src/client/styles.css     3da83e059c0a9d10
plugins/text-client/dist/client.css           34562a6108ca70e7
plugins/text-client/dist/client.js            03c4722c4a7b37f1
plugins/text-client/src/client/model.tsx      70f7d9ef31c9ae57
plugins/text-client/src/client/model-form.ts  29e5d6910e11e30e
COMBINED                                      43382d1f633e351e201c82ba21bfc166
```

本轮未修改任何产品源码或 dist（`dist/client.js` mtime 09:25，源码 09:18，均早于本轮开跑）；只更新了 `qa/probes/`、`qa/screenshots/` 与本文件。

## 尚未验证

| 项 | 原因 |
| --- | --- |
| 真实 Magpie / 上游供应商模型 | peer 是受控协议 peer，非真实供应商；真实调用需 owner 授权与配置 |
| 公网/反代部署 | 只验了 loopback 与 loopback-only 只读代理，未做真实公网入口 |
| 服务重启后旧表单版本被拒 | 需要重启实例；本轮 profile 未重启 |
| 长对话/大负载下 SSE 稳定性 | 本轮消息量小（6 条），未做压力场景 |
| 真实付费推理的计费/取消 | 不涉及真实上游，无法验证 |

## 缺陷修复历史（本轮之前已完成并验证）

1. 关闭态对话框 `display:flex` 覆盖浏览器默认 `display:none`，导致整页被透明盒子挡住 —— 改为 `.pk-dialog[open]`。
2. 切换连接下拉被误报「服务端配置在别处改过」 —— `changedUnderneath` 改为与**同一 `baseline.connectorId`** 比较并单比 `profileRevision`。
3. 不需要密钥的连接被提示「先把连接保存下来，密钥要按已保存的连接单独填」 —— 新增 `pendingAuthChange`，只由同一连接已保存 `settings` 与草稿 `settings` 推导。
