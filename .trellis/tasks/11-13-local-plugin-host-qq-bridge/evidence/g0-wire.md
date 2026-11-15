# G0 external bridge primitives

Implementation evidence, 2026-11-14. This is the control/media/authentication slice, not a working full remote QQ integration or State4 acceptance.

## Implemented

- Browser-safe local-host identity, source/task provenance and closed operation purposes are declared once in [contracts](../../../../packages/contracts/src/local-host.ts). Those metadata references are not grants.
- [Header-authenticated handshake](../../../../packages/local-host/src/bridge-handshake.ts) binds the configured owner bearer, selected host, Agent ID/epoch and server-issued transport owner/session. It does not provide independent device identity. No redirects/token URLs or generic runtime.invoke channel is accepted.
- [Channel](../../../../packages/local-host/src/bridge-channel.ts) reuses ControlEndpoint and TaskMediaPeer with strict owner/session/sequence,64KiB control, bounded binary framing/credits and4 live streams. The kernel media limit is an optional narrower bound; its default64 and credit8 semantics remain unchanged.
- Physical socket `settled` is explicitly separate from logical cancellation and native task completion. Connection-scope abort immediately closes the logical channel and its inbound RPC signals; it does not wait for a peer's close handshake. The focused independent [wire review](g0-wire-review.md) identified that initial gap and verified the fix.
- [Fresh authority check](../../../../packages/local-host/src/authority-check.ts) revalidates the exact current host/boot/bridge request with actual local source checks on both sides of the bounded RPC, without caching the result. It rejects excessive permit budgets, stale connections, local withdrawal and elapsed time beyond the returned bound. The production server participant/claim handler and real private task mapping are still later work.

## Executed checks

- `pnpm --filter @pet/local-host exec vitest run src/bridge-channel.test.ts`: latest **10/10** passed, exit0 (job `bash-e95fc285e57648e6`). Includes real loopback HTTP/WebSocket, wrong bearer/Agent epoch, namespace forgery, oversized control, non-UTF8 credited bytes, global four-stream cap, local secret preflight with subsequent safe traffic, immediate abort and held-handler settlement distinction, and fresh-check timing/binding.
- Latest local-host TypeScript and Parent-owned scoped ESLint passed in that same job.
- Earlier combined local-host suite:17 passed before the additional abort/authority cases. Kernel/media regression:12 passed (`media-port`, `media-close`, `media-framing`), plus local-host/Desktop type checks and scoped lint, exit0 (`bash-f340dbe0d2624f76`). Do not add overlapping counts as another acceptance suite.
- A secret-preflight test initially timed out because the test awaited socket closure; the existing ControlEndpoint deliberately rejects an unsafe outgoing payload without terminating safe traffic. The test now checks no receiver call for the secret and a successful subsequent safe request. No production behavior was weakened to make it pass.

## Remaining integration proof

Unit `signalFor` functions are controlled test signals, not proof of kernel task/participant permission. The actual local kernel and independent process are covered by their separate evidence; the remote facade still must map registered purposes into real server/local tasks. State4 private binding/enrichment, raw custody, full participant ingress/Core, actual claimed native publication, private continuations, sender recovery and package/resource identity remain their declared gates. No real QQ, paid model, existing account/config, original4120 data, or Git commit/publication was used.
