# text-client 验证证据（2026-11-07）

本文件记录 `plugins/text-client` 在交付时实际跑过的检查与输出。范围仅限本地：**不含真实服务联调、真实模型/执行、浏览器视觉与键盘走查**。

## 环境

- Node v26.13.0，Linux x86_64
- 依赖由父代理统一 `pnpm install --ignore-scripts` 建立 workspace link
- 无 Playwright 浏览器二进制、无 Electron 可执行文件，因此没有截图或真实点击证据

## 命令与结果

```sh
# 类型
plugins/text-client/node_modules/.bin/tsc --noEmit -p tsconfig.json
# 结果：无输出（通过）

# 构建
node build.mjs
# 结果：dist/index.html、dist/client.js、dist/client.css、dist/index.mjs

# 测试
node --import ./tests/source-loader.mjs --test tests/*.test.mjs
# 结果：tests 60, pass 60, fail 0

# 代码规范（仓库根）
node node_modules/eslint/bin/eslint.js "plugins/text-client/**/*.{ts,tsx,mjs}"      # 0 problems
node node_modules/prettier/bin/prettier.cjs --check "plugins/text-client/**/*.{ts,tsx,mjs,json,css,html,md}"
```

## 用例清单（60）

协议分帧 `tests/sse.test.mjs`：

- 解析 `id/event/data` 帧，忽略注释行（服务端 15s keepalive 即注释行）
- 半帧缓冲到空行到达
- 跨 chunk 的 CRLF
- 多行 `data` 合并与默认事件名

状态语义 `tests/state.test.mjs`：

- 快照确认后移除对应的本地待确认消息
- 结果不明时复用 commandId；文本改动后不复用
- 同 commandId 重复加入替换而非追加
- 明确拒绝时移除待确认行并给出固定错误文案
- 断线把待发消息与运行中任务标为未知，不当作当前真相
- 停止请求显示「停止请求已发送」，仅服务端终态才结束
- 结果不明的停止保留 commandId
- 终态不提供停止操作
- epoch 变化替换投影但保留本地待确认意图

响应校验 `tests/guards.test.mjs`（浏览器安全的字段级重建）：

- 合法快照逐字段重建，未知附加字段被丢弃
- 协议版本不支持时拒绝并带回收到的数字；非数字版本不臆造数字
- 单个字段损坏（角色、状态、cursor、epoch、数组类型、agent 为空）整条作废
- 列表中任意一项损坏整条作废（消息、任务的 artifacts、事实、插件）
- 必填数组 `messages/tasks/facts/plugins` 缺省即作废，不当成空数组
- 时间戳超出 Date 范围（`8.64e15±1`、`1e300`、`Infinity`、`NaN`）被拒；边界值仍合法
- 退出码必须是安全整数，小数与超大数被拒
- 必填的 `error` 字段缺失即作废（显式 `null` 才表示没有错误）
- 回执形状校验：缺字段、错误状态、错误类型都返回 null
- 回执的 commandId 必须与本次提交一致，`accepted`/`duplicate` 都不例外
- 事件 sequence 必须是安全非负整数；未知 kind 或非 JSON 对象 data 被拒
- 错误对象只按固定码重建，未知码收敛为 internal，服务端 messageKey 不参与显示

客户端行为 `tests/client.test.mjs`：

- token 只在请求头，任何 URL 都不含它
- 401 进入 offline 且保留固定错误码
- 两条事件合并为一次快照读取，之后空闲不再读取（无轮询）
- 无 id 的 `refresh` 同样合并成一次读取
- epoch 变化按新快照重新对账并保持连接
- 世代未变的流关闭判为断线并保留最后确认数据
- 结果不明的发送复用同一 commandId，重试不产生第二次提交
- 改动文本取得新 commandId
- 停止受理不等于退出，终态快照才结束
- 产物经认证请求取字节，文件名用于本地下载
- 损坏快照体、非 JSON 响应、超出 Date 范围的时间戳都让连接进入 offline 且不留半个对象
- 协议版本不支持停在入口并带上版本号
- 回执形状损坏或 commandId 不匹配时保持「结果未知」，不假装已受理
- 坏事件帧（坏 JSON、坏 sequence、未知事件名）被忽略且流继续工作

渲染语义 `tests/render.test.mjs`（`react-dom/server` 静态渲染，只证明文案与语义）：

- 令牌入口说明「只保存在本页内存中」，`type=password`，无 token 参数
- scripted 模式标注「离线脚本回复，未调用模型」
- 运行中任务有停止控件，已完成任务没有
- 断线运行中任务显示「状态未知」并给「重新连接」
- 断线时输入保留且发送按钮不可用
- 未输入令牌时渲染入口而非主界面
- 首次连接失败停留在入口并显示原因

真实 HTTP + SSE `tests/integration.test.mjs`（数据来自 `tests/fixture-server.mjs` 夹具，**不是产品服务**）：

- 建连 → 发消息 → 停止（请求先到，终态后到）→ 产物
- 未授权令牌被拒，永不进入 live
- 断开后重连对账到当前快照，不重放

## 未覆盖

| 项                                 | 原因                           |
| ---------------------------------- | ------------------------------ |
| 真实产品服务联调                   | 由父代理在服务 URL 上验收      |
| 真实模型回复 / 真实执行 / 云端部署 | 不在本次范围                   |
| 浏览器视觉、键盘焦点、窄屏实测     | 本机无浏览器二进制             |
| 15s keepalive 长连接下的实际稳定性 | 需真实服务；注释行解析已有单测 |
