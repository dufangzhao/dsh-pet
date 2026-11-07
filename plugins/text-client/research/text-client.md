# text-client 实现记录

`plugins/text-client` 是可替换的文字入口：一个普通插件，runtime 注册 `panel` 贡献 `text-client`，页面是构建产物里的静态资产。协议按 [implementation-contract.md](../../../.trellis/tasks/11-07-text-agent-foundation/implementation-contract.md) 实现，服务端由主实现方提供。

## 结构

| 文件                     | 作用                                                                              |
| ------------------------ | --------------------------------------------------------------------------------- |
| `src/index.ts`           | runtime：`definePlugin` + `context.contribute('text-client')`，无状态             |
| `src/client/protocol.ts` | 同源 HTTP + `Authorization: Bearer`；SSE 用 fetch 流，产物取 Blob                 |
| `src/client/guards.ts`   | 响应校验：按字段重建快照/回执/事件，浏览器安全，不引 Node/Ajv                     |
| `src/client/sse.ts`      | SSE 分帧（CRLF、注释、多行 `data`）                                               |
| `src/client/state.ts`    | 纯 reducer：连接阶段、待确认消息/停止意图、状态文案                               |
| `src/client/client.ts`   | 连接生命周期、事件合并刷新、命令去重、产物下载                                    |
| `src/client/*.tsx`       | 令牌入口、对话、任务条、连接行                                                    |
| `build.mjs`              | esbuild：`dist/index.mjs`、`dist/client.js`、`dist/client.css`、`dist/index.html` |

## 协议对应

| 端点                          | 用法                                                             |
| ----------------------------- | ---------------------------------------------------------------- |
| `GET /api/snapshot`           | 建连与每次合并刷新的唯一真相来源                                 |
| `GET /api/events?after&epoch` | fetch 流；`companion` 事件推进游标，`refresh`（无 id）只触发刷新 |
| `POST /api/messages`          | `CompanionMessageCommand`，commandId 去重                        |
| `POST /api/tasks/<id>/stop`   | `CompanionStopCommand`；受理 ≠ 退出                              |
| `GET /api/artifacts/<id>`     | 带认证取 Blob，再生成下载链接                                    |

token 只在内存与请求头里，不出现在任何 URL、localStorage 或 DOM 属性中。

## 状态语义

- **断线**：保留最后一次快照，但非终态任务显示「状态未知（上次：运行中）」，不把旧 `running` 当现在；`ConnectionLine` 明说「当前状态未知」并给手动重连。
- **停止**：点击后本地显示「停止请求已发送」，只有快照出现 `completed/cancelled/failed/interrupted` 才换成真实终态。
- **命令重试**：`network/timeout/unavailable/internal` 视为结果不明，保留 commandId 与草稿；改过的文本重新取 id，不会复用旧 id。
- **合并刷新**：事件只当「有变化」信号，120ms 窗口合并成一次 snapshot 读取；空闲不轮询。
- **世代**：流结束或 `epoch` 变化时按新快照重新对账；世代没变才算真断线。
- **投影有界**：`snapshot.projection.hasMoreMessages/hasMoreTasks` 为真时显示「较早的…未显示」，不假装全量。
- **模式**：`agent.mode === 'scripted'` 显示「离线脚本回复，未调用模型」。

## 响应校验

`guards.ts` 在边界完成全部校验，只信任界面真正读取的字段，并按契约重建对象：未知附加字段被忽略，缺失或类型不符就让整条响应作废。因此坏响应不会变成半个对象进渲染。

- **Result**：`ok:true` 必须自带 `value`；`ok:false` 必须有可识别错误。错误只按固定码重建，服务端的 `messageKey` 不参与显示。
- **协议版本**：`protocolVersion` 必须等于 `COMPANION_PROTOCOL_VERSION`。不等时返回固定错误并带上收到的数字，界面能说清是版本不匹配而非网络问题。
- **快照**：`epoch/cursor/now/agent/messages/tasks/facts/plugins` 全部按契约校验，数组里任意一项损坏就整条作废。`harness` 是普通字符串，不假设 `cortico`/`fixture` 枚举。
- **时间戳**：必须是 `Date` 能表示的范围（±8.64e15）。只查「是个数字」不够——`1e300` 会让 `Intl.DateTimeFormat` 与 `toISOString()` 抛 `RangeError` 打断渲染。
- **回执**：除字段形状外，`commandId` 必须与本次提交一致；受理了别的意图不能清掉本地待确认行。校验不过按结果未知处理，重试复用同一 commandId。
- **事件**：`sequence` 是安全非负整数，`kind` 必须已知，`data` 必须是有限深度的 JSON 对象；坏帧直接丢弃，不中断流。

校验只用普通 TypeScript，浏览器端不引 Node、Ajv 或 host-kernel，也没有运行时 Schema 依赖。

## 验证状态

已验证（本地，无产品服务）：

- `node build.mjs` 产出 `dist/index.html`、`client.js`、`client.css`、`index.mjs`；`client.js` 不含 `node:sqlite`、Ajv 或 host-kernel。
- 59 个测试通过：SSE 分帧、响应校验边界、reducer 状态语义、客户端请求形状/去重/断线/停止/产物、静态渲染文案。
- `tests/integration.test.mjs` 用 `tests/fixture-server.mjs` 走真实 HTTP + SSE 往返：建连、发消息、停止（请求 → 真终态）、令牌拒绝、重连对账。

**未验证**：真实产品服务联调、真实模型/执行、浏览器内的视觉与键盘走查。静态渲染只证明文案与语义，不代表视觉效果已验收；真实浏览器验收由父代理在服务 URL 上完成。
