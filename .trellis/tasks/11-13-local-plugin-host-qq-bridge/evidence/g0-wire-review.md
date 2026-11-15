# G0 wire primitive review

2026-11-14. Independent scoped code review against product baseline `6897787` and the current uncommitted Parent-owned wire. The user/Parent authorized G0 implementation; this report does not treat older planning-status prose as an implementation gate.

## Result

**No open blocking finding remains in the reviewed primitives after the connection-abort fix below.** This is a wire-level conclusion, not full G0 acceptance or remote effect authorization.

Reviewed:

- [Bridge channel](../../../../packages/local-host/src/bridge-channel.ts), [handshake](../../../../packages/local-host/src/bridge-handshake.ts) and [wire regressions](../../../../packages/local-host/src/bridge-channel.test.ts).
- [Closed bridge declarations](../../../../packages/contracts/src/local-host.ts).
- The optional `TaskMediaPeer.maxStreams` change and its interaction with the existing [media peer](../../../../packages/host-kernel/src/tasks/media-peer.ts#L87), framing and ControlEndpoint.
- Relevant approved design and [transport-boundary evidence](../research/transport-reuse.md), with existing kernel behavior consulted directly.

Only this evidence document was written. No product, original test, dependency or runtime artifact was changed by the reviewer.

## P1 found and closed during review

**Connection-scope abort initially requested a raw WebSocket close without immediately fencing the channel.** The first inspected `connectAgentBridge` implementation called `socket.close()` when `options.signal` aborted after handshake. Channel lifetime and active RPC handler signals would then depend on the physical close event, potentially remaining live during the close handshake. Logical cancellation and physical closure are separate facts.

Parent changed the existing closure to retain one `activePeer` and call [its close method on abort](../../../../packages/local-host/src/bridge-handshake.ts#L277). This immediately aborts the [channel lifetime and ControlEndpoint](../../../../packages/local-host/src/bridge-channel.ts#L77), while `peer.settled` remains specifically the socket's physical closure. It adds no new operation registry.

Independent controlled loopback verification observed both channel and held inbound RPC signals already aborted immediately after caller abort. The subsequent physical-close wait completed separately. The inline reproduction loaded the already-fixed source: **the reviewer did not independently execute an old-source red run**. The original finding is source-backed; the successful reproduction and [new scope-abort regression](../../../../packages/local-host/src/bridge-channel.test.ts#L278) verify the fix.

## Verified behavior and exact boundaries

- **Authentication and namespace:** bearer authentication occurs before upgrade; hello checks expected host/Agent/epoch, and the server issues a fresh session with its configured bridge owner. Welcome must match the captured identities and bridge owner type. Credentials are headers rather than URL parameters, redirects are disabled, and malformed/incorrect identities cannot reach a handler. This remains the approved trusted-owner bearer model, not independent device identity.
- **Closed control:** the [method list](../../../../packages/contracts/src/local-host.ts#L34) is finite; constructor handlers and outgoing/incoming request names are checked. `runtime.invoke` is refused. Existing ControlEndpoint additionally validates owner/session/sequence and bounds pending work. Complete text control envelopes are checked against64KiB before forwarding.
- **Secret preflight:** configured `allowJson` rejects a known local secret before a handler runs. A later safe request still succeeds. This matches existing ControlEndpoint semantics; rejection of a secret is not a requirement to close an otherwise valid channel. The test proves the configured filter's behavior, not that future composition may omit the actual broker/redactor wiring.
- **Binary frames and flow:** WebSocket payload and incremental frame parsing stay bounded; wrong owners are rejected. The channel opts into four live media endpoints through [the narrow kernel option](../../../../packages/local-host/src/bridge-channel.ts#L124). The kernel default remains64, and accepted limits are1..64. The existing eight-credit/per-stream256KiB-chunk mechanisms are retained. Actual non-UTF8 bytes traverse the loopback channel, and a fifth live endpoint is refused. No full32MiB/120s matrix was demanded or run.
- **Closure versus native completion:** channel close fences logical RPC and eventually physically closes the socket, including a bounded terminate fallback. A held handler can remain unfinished after socket closure. Neither the channel's `settled` promise nor an unsuccessful RPC result proves that native work settled or that an external message was not accepted.
- **Known results:** the wire correctly makes no authoritative known-result claim. Retaining outcomes before reply, inspecting the same LocalOwner operation and applying fact-only reconciliation belong to the operation/claim owner. Closing a ControlEndpoint must not be that owner's storage or dedup mechanism. The reviewed held-handler test demonstrates the distinction, not durable result retention by itself.

## Actual execution

Executed only the scoped wire file:

```text
pnpm --filter @pet/local-host exec vitest run src/bridge-channel.test.ts
8 tests passed; 0 failed; exit 0
Start: 06:43:28
```

Also ran one reviewer-owned inline Node/tsx loopback probe with a fresh ephemeral HTTP/WebSocket listener and synthetic bearer/identity. It held a real RPC handler, aborted the connection scope, observed immediate logical signal fencing and then awaited physical closure. The listener and bridge were closed; there was no QQ/native-account operation.

The reviewer did not rerun Parent's full package/media regressions or the other owners' lifecycle/kernel/real-claim proofs, and does not add their counts to these eight tests.

## Limits and remaining composition work

The wire test's `signalFor` returns a controlled unit signal. **It is not an actual kernel task lookup or participant/device grant.** The production caller must map the authenticated session and authorized operation into actual task signals; a JSON OwnerRef/task ID does not acquire authority. That mapping, the full fresh remote check, canonical State4 binding and sender's scoped remote hold remain the planned G1/G3/G5 work, not missing primitives to be reported as bugs here.

These tests use an owned loopback HTTP/WS channel. They do not establish remote TLS deployment, packaged Windows behavior, daemon lifetime, real State claim/native publication, same-attempt late evidence, QQ ingress/media completeness or whole G0 completion. The LocalOwner evidence and the other owners' actual kernel/lifecycle/two-process work must be assessed separately.

No real QQ, SnowLuma, paid model, original4120, existing test Agent, full root suite or Native UI acceptance was accessed or run.
