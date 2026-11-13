# QQ integration handoff

Implementation coordination. Product/design remain in the approved artifacts; current verification is recorded in [progress](progress.md). Public schemas/types are maintained only in [contracts](../../../../../packages/contracts/src/companion-qq.ts). The service now installs these HTTP/private seams; remaining whole-product checks are not implied by this wiring map.

## Owner HTTP routes

All retain existing bearer/origin/no-store gates. Control routes keep the existing JSON limits; the material route is a separately bounded byte stream. Settings/credential changes return `Result<QQView>` with actual saved/applied state; they never test-send or infer a model reply. Conflicts do not silently overwrite drafts.

| Route | Request | Success value |
| --- | --- | --- |
| GET `/api/qq` | none | `QQView` |
| GET `/api/qq/status` | none | `QQStatus` |
| POST `/api/qq/policy` | `QQPolicyCommand` | `QQView` |
| POST `/api/qq/source` | `QQSourceSettingsCommand` | `QQView` |
| POST `/api/qq/credential` | `QQCredentialCommand` | `QQView`; existing private credential ingress required |
| POST `/api/qq/judge` | `QQJudgeSettingsCommand` (two CAS revisions) | `QQView` |
| POST `/api/qq/judge/credential` | `QQJudgeCredentialCommand` | `QQView`; private credential ingress required |
| GET `/api/qq/deliveries?after=&limit=` | bounded paging | `QQDeliveryPage` |
| GET `/api/qq/deliveries/{id}` | exact canonical ID | `QQDeliveryView` |
| GET `/api/qq/principals?after=&limit=` | bounded paging | `QQPrincipalPage` |
| GET `/api/materials/{id}` | exact canonical ID, authenticated operator | verified raw bytes with real length/type/name; not a JSON success envelope |

Enable/disable continues through the actual `POST /api/plugins/{pluginId}` route with `{commandId,enabled}` and `CompanionCommandReceipt`, then refetch QQ view. The server/controller must route QQ source changes through its normal lifecycle reconciliation; no UI-only enabled flag.

The current first profile is official production WebSocket plus OneBot reverse Universal. No unimplemented sandbox/forward/split control is exposed. File/stream/media readiness remains explicit per source. Paged `next` values are actual canonical IDs, not invented/base64 cursors. Operator material downloads do not enlarge the legacy personal artifact/Pet eligibility boundary.

Existing protected `/api/memory`, `/api/facts` and `/api/facts/forget` support scoped facts: mutations carry optional `audience`; omitted old commands retain their old JSON/fingerprint. Fact-row identity is `(audience,key)`, not `key` alone. Management views can contain private/public same-key rows, so forms must retain the selected scope. Ordinary QQ members do not access these HTTP routes.

## Private runtime and protocol seams

Runtime owner: `39b94ada-8563-4e5c-b4a8-f178a1780e0e`; actual types in `packages/companion-runtime/src/input-authority.ts`. Parent installs material/terminal ports and mints participant-policy grants. `dispatchReadyInput` queues; persistent `claimInput` happens only when Harness actually binds an active slot.

Harness owner: `a4ca84ff-3b77-42ff-a74d-4cbf9fbfd47f`; actual private signatures in `plugins/harness-cortico/src/harness.d.mts`. Unbound queued inputs use `queueSignal`/`inputRejected`; successfully bound contexts use their own terminal callback. Capability accept keeps its existing null success value.

State owner: `1bd35581-14bd-491d-90c2-590f20b2e8ff`; canonical synchronous Result methods in `plugins/state-sqlite/src/types.ts`. Exact readers, claims, bounded observations and format3 migration are implemented in that package; public provenance does not grant authority.

Protocol owner: `019a7a3b-3873-4cb1-9727-9e6e2edda645`; private native IO signatures live with each plugin in `src/ports.ts`. Host factories own fixed endpoint/authentication/physical IO; ordinary drivers own protocol sequencing and do not grant roles or write State.

Codec owner: `e4e66342-3e46-4708-9657-e8c5ad86ab45`; actual factory/private operation signatures in `plugins/qq-media-codec/src/index.ts`. A remote path or public media ref is not a host file-read permission.

Parent owns service QQ policy/controller/sender/HTTP/composition, shared-QQ and participation-model package composition, model purpose binding and root dependency coordination. Frontend owner DeepSeek consumes the closed HTTP contracts above and server-owned truth; no fake save/connection or second storage authority.

## Frozen facts that prevent integration drift

- Canonical `eventKey` is a host-namespaced identity; reply-reference `eventId` is nullable true upstream data. Never send a derived key as official `event_id`.
- Quote evidence stays separate from authored text/wake words/memory cues. Identity-less group-file notices are context resources only, not actionable/proactive admissions.
- Direct owner tasks may have no chat input; task origin then has null input and no invented historical origin. Work-result remains reply-only.
- Text is mandatory. Upload/transfer IDs alone cannot open the text-accepted gate. Optional voice remains an intent until all mandatory text is accepted, then may prepare/encode/upload/send.
- Focused tests run from their package directory with installed Node tool entrypoints. `pnpm exec` may synchronize the workspace; only Parent coordinates install/lock changes.
