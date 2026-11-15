# G6 stop 失败定位与最窄修复

## 结论

`desktop-5eeb57f8` 的 `offline-authenticated-local-stop → unavailable` **不是** Native 清理失败，
而是**管理层在自己的 stop 回应还没写完时就把承载它的 socket 关了**。

`daemon.ts:84` 的 `onStopped` 会 `close()`（`server.close` → 对端 `destroySoon`）并 `app.exit(0)`；
它由 `management.ts` 的 stop handler 用 `setImmediate` 调度。而 stop 的 response 由
`ControlEndpoint` 在 handler return 之后才 `send`（`control-endpoint.ts:471`）。两者都在同一个
event-loop 轮次里：只要 response 的 `socket.write` callback 还没回来（对端读得慢、或有其它
写入排在前面），`destroySoon` 就会先发生，回应被丢弃。客户端 `ControlEndpoint.close()`
把 pending 请求一律 resolve 成 `unavailable`（`control-endpoint.ts:488-492`），于是 Main 看到
`{ok:false,error.code:'unavailable'}`，而 daemon 其实已经 `phase='stopped'` 并退役了 rendezvous。

这同时解释了现场三条事实：初次 stop 返回 `unavailable`、`rendezvous.json` 已消失、
第二次 Main.stop 报 `stale-owner`（客户端已随 daemon 退出而关闭）。

## 复现（真实 TCP，未改生产码）

故障注入：真实 `daemon.ts` + `createProductionLocalHost` + 真实 `attachLocalManagement`，
把 stop 回应那一次 `socket.write` 的**物理写入延后 40ms**，用来把"回应尚未落盘"这个窗口放大成确定可观测的。

- 修复前：`{"holdMs":40,"ok":false,"code":"unavailable","stopped":true}`
- 修复后：`{"holdMs":40,"ok":true,"code":null,"stopped":true}`

`exp26.mts` 给出同轮的单调阶段顺序：

- 无延迟：`response-write-cb → onStopped → destroySoon`
- 延后 30ms：`response-write-called → onStopped → destroySoon → client-stop-resolved`（回应丢失）

修复后即使延后 30ms，`onStopped` 也排在 `response-write-cb` 之后。

**范围说明**：以上是"延后物理写入"的故障注入，证明的是 ordering 契约（回应写入未结算前不得关闭承载它的 peer），
**不等于**已直接捕获现场那次真实网络慢读的完整证据链。现场 `desktop-5eeb57f8` 只能由
`rendezvous.json` 已消失 + 二次 stop 报 `stale-owner` 佐证"daemon 停成功、回应丢失"这一方向；
该方向与本次注入暴露的同一 ordering 缺口一致，但没有在真实慢读网卡条件下逐帧抓取。

## 修复（仅 `packages/local-host/src/management.ts`）

1. `ManagementTransport` 记录在途写入（`pending`），新增 `flush()`：等待这些写入**结算**。
   `flush()` 的两个输入（每个 physical write、以及 `settled`）都只会 resolve，所以它不会 reject；
   `settled`（socket close）作为上界，已关闭的对端不能投递更多字节，允许完成这次 join。
   **结算 ≠ 对端应用已处理**：这里只保证字节已交给 socket，不宣称远端已读。
2. stop handler 的 `setImmediate` 改为 `transport.flush() → onStopped()`：
   回应的物理写入结算之后，才允许关闭承载它的 peer / 退出进程。
   最后一步 `onStopped()` 抛错仍走原 `phase = 'failed'`。
3. `changed()` 在 `phase !== 'running'` 时不再发 hint：stopping 阶段的 view 已经不可读，
   这些 hint 只会在同一条 peer 上抢占写入配额，无任何收益。

没有改 kernel cleanup 语义：`kernel.close()` 失败仍然 `phase='failed'` 且返回 `unavailable`，
`close()` 仍然不会 `server.close`/`publication.retire`。没有加 sleep/timeout/扩大队列/吞异常。

## 回归测试

`packages/local-host/src/management.test.ts` 新增
`does not let a slow stop reply be discarded by the close it triggers`：
fixture 按真实 daemon 形状让 `onStopped` 关闭 server，并把 `"phase":"stopped"` 回应的
`socket.write` 物理写入延后 25ms。

- 无修复：`expected ... ok: true` 实际 `unavailable`（失败）
- 有修复：通过

## 实际执行

最终（删掉死 `.catch` 后，行为不变）：

- `packages/local-host` vitest：9 files / 37 tests 全 pass（含新增 ordering 回归）
- `pnpm --filter @pet/local-host typecheck`：通过
- eslint / prettier（改动两文件）：通过

修复前一轮已全量跑过、本轮无新逻辑故不重复：`apps/desktop` 1128 tests、
`packages/host-kernel` 218 tests、`@pet/desktop typecheck`。

## 未做与边界

- 未重建 `/tmp/pet-qq-preview-linux-20261115-r5`，未改 r5 产物；GUI 6/6 旧 PASS 保留。
  Root 已决定新 candidate preview 6，不复用 5 只改 probe。
- 本修复不改变"第二次 stop 报 stale-owner"这一正常结果（daemon 已退出）。
- 未触碰 Main/preload/renderer/QQNative/source/permission-kernel，未动 4121 Root 服务。
