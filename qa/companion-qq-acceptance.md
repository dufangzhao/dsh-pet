# M6 QQ controlled acceptance

2026-11-13, Linux amd64, Node26.13.0, pnpm11.24.0. Branch `feat/qq-platform-entry`, based on M5 `b706007`; M6 is still an uncommitted working tree. The original4120 service/data/token were not started, read for credentials or migrated by these checks.

**Status: controlled implementation, all workspace quality stages, Web interactions, actual container recovery and the serial production Electron subset passed. Local commit/archive approval is the remaining workflow step.** These results are not real QQ account verification. This record will hold the final result rather than summing repeated focused runs.

## Verification levels

- **Source/contract:** pinned protocol documentation and handler behavior, schemas and source-owned API boundaries.
- **Controlled execution:** actual Host/permissions/SQLite/Core, HTTP/WebSocket peers, byteplanes, Docker codec and worker; peer/model content is explicitly synthetic.
- **Product interaction:** actual built Web/Electron surfaces against isolated services, with the exact build recorded.
- **Real deployment:** not performed. No real QQ login/message, deployed SnowLuma endpoint, paid model request, recording device or human playback was used in M6.

## Executed core and data-plane evidence

| Boundary | Evidence |
| --- | --- |
| Contracts, State, runtime, Harness | Full four-package run passed on the then-current tree:362/58/62/30 tests. Later focused contract/State changes add strict receipt facts and owner ready-budget checks; final workspace gate must cover them together. [Private contexts/permit](../plugins/harness-cortico/tests/harness.test.mjs), [scoped runtime](../packages/companion-runtime/src/runtime-inputs.test.ts), [State](../plugins/state-sqlite/src/format-three.test.ts). |
| Protocol sequencing and wire bytes | Official44 and OneBot44 suites passed after receipt/cleanup fixes. Includes complete32MiB data, actual hashes/offsets, true native identities, one-shot claims/echoes and failed physical slots retained. [Official](../plugins/qq-official/src/media-cleanup.test.ts), [OneBot](../plugins/qq-onebot/src/media.test.ts). |
| Actual native host IO | [Native IO tests](../apps/companion-service/src/qq-native-extra.test.ts) use controlled real sockets/HTTP: source/key leases, large registered echoes, backpressure, DNS pinning, private URL registration, known full receipts after revoke and partial-body unknown outcomes. |
| Codec | [Immutable codec evidence](fixtures/companion-qq-codec/README.md) retains the final image/manifest,18 real codec and7 lifecycle cases, complete120s/six-span data and separate actual OOM facts. No host codec fallback. |
| Audio and materials | [QQ audio](../apps/companion-service/src/qq-audio.test.ts), [material store](../apps/companion-service/src/material-store.test.ts), [transfers](../apps/companion-service/src/qq-media-transfer.test.ts), [reply materials](../apps/companion-service/src/reply-materials.test.ts): actual bytes/ACL/hash, current versus quoted transcription, private source lifetimes, complete text and conservative cleanup facts. |
| Delivery | [Sender](../apps/companion-service/src/qq-delivery.test.ts), [native adapter](../apps/companion-service/src/qq-delivery-transport.test.ts), [SQL passive budget](../plugins/state-sqlite/src/delivery-budget.test.ts): full formal batch, all text before optional synthesis, no replay of unknown/accepted attempts, cross-batch quota and unique native sequence, compound file publication once. |
| Independent judgment | [Judge tests](../apps/companion-service/src/qq-judge.test.ts): real local503 request count1 with ordinary generation purpose, persisted limits/restart dedup, strict decision, no private context/tools, independent source/key retirement and actual cancellation. |
| Migration | [Cold v3 migration](../apps/companion-service/src/migrate-v3.test.ts) and [legacy migration](../apps/companion-service/src/migrate.test.ts) use fresh synthetic roots with full backup, original fingerprints/IDs and no historical sends. |

## Whole-service paths already executed

[Service tests](../apps/companion-service/src/qq-service.test.ts) start the actual composition on a fresh root. They cover default-off QQ, actual authenticated reverse-WebSocket→policy→State→Core→native text receipt, exact duplicate handling after alias changes, nonempty canonical-ID pagination, remote-named credential refusal, and authenticated complete material bytes. The observer's captured grant is private; a native sender nickname `owner` does not elevate it.

[Four media/work integration cases](../apps/companion-service/src/qq-service-media.test.ts) passed through production `enqueue`, not a direct sender call:

1. Private PNG,32KiB non-UTF8 file and WAV enter through real WS/file streams, TaskMediaPeer and State. Actual codec/controlled Magpie ASR feed native Core image parts, opaque IDs and full transcription before a text receipt.
2. Group text acceptance is held: TTS count is zero. After real native acceptance reaches State, controlled PCM SSE passes through the actual codec to SILK, then real stream staging and record-send. The TTS peer checks the ledger before responding.
3. Unknown text produces zero TTS/upload requests; no prefix resend or alternate route.
4. Actual pinned worker container copies the32KiB file once. A short protocol disconnect after observed container start does not kill the accepted work. The reply-only result publishes an artifact via the protected resolver, canonical material and one native file action, with complete byte/SHA equality. Legacy personal artifact HTTP remains403; the explicitly managed published material is200. Container removal and zero pending work are checked.

These use the existing immutable cloud image and final codec pin, without rebuilding/pulling them. Every temporary service/profile/peer is owned by the test and physically joined before verified temporary-root removal. The LLM/QQ/Magpie response content is synthetic; Core, kernel, SQLite, bytes, codec and Docker execution are real.

## Independent review and UI

The [independent core canaries](companion-qq-review-core-5519.test.mjs) passed four checks: pre-limit visibility, preserved legacy retries, input/material atomicity and cancelled parked inference making zero native calls. That review found no reproducible P0/P1/P2 in its stated core scope.

The [independent UI canary](companion-qq-review-ui-5519.test.mjs) exposed real problems missed by initial component counts: reserved React props, stale owner closures, a secret borrowing another target's current CAS, coupled judge revisions, hidden policy-field overwrite and post-allocation download limits. Its final frozen-source run passed9/9 with actual exit0. It checks each of those concrete chains, including A→B secrets and dirty two-CAS drafts; it does not substitute for the separate browser interactions.

Actual Web/desktop DOM scripts and screenshots are maintained with their client tests. Frozen client results:326 unit/protocol cases; real-service DOM18, material DOM3, controlled panel DOM5 and desktop readonly DOM7 passed. The material UI seed uses a real service-issued owner grant and actual material storage; it is a UI data fixture, not proof that a model generated a long answer. Full-text clicking compares the actual body with the stored text and differs from the notice; a real binary download matches its SHA. The fact-row React tuple key is source-reviewed; static markup/mutation was correctly not described as reconciliation coverage.

The final integration review found one additional scene inconsistency: an official private-only source previously admitted group events although its outbound path rejected them. The captured applied-source scene is now checked before ingress. The [real controlled WSS regression](companion-qq-review-integration-scenes.test.ts) verifies zero input/receipt/observation for the disabled scene, an allowed private input on the same healthy socket, and zero group HTTP IO. This was the only reproduced finding in that final integration review.

## Final quality and production gates

The stages of `pnpm check` were run across the complete workspace, with final failures fixed and the affected stage rerun. Do not describe an earlier interrupted aggregate invocation as exit0.

| Command / scope | Final result |
| --- | --- |
| `pnpm -r typecheck` | Passed all participating packages. The new judgment wrapper uses the same required TypeScript import option as its base connector. |
| `pnpm -r test` | Passed all package suites, including contracts365, State60, runtime62, Harness30, service315 and Desktop1059. Optional Docker package cases remain opt-in; separate actual results below cover that execution scope. |
| `pnpm test:qa` |178 passed,4 opt-in cases skipped,0 failures. The legacy lifecycle probe now gates the actual input-bound publication port. |
| Fixed `PET_CLOUD_EXEC_IMAGE` + `pnpm test:companion` |18 passed,0 skipped/failures,exit0. Includes both actual SIGKILL/restart recoveries, independent B context while A retains its native tool receipt, continuing Docker work, exact cancellation, unchanged effects/IDs and owned-container removal. |
| `pnpm lint` / `pnpm format:check` | Passed. Generated QQ manifests use the existing formatted-generator convention; build does not recreate format churn. |
| `pnpm build` + another `pnpm format:check` + `git diff --check` | Passed. Production service and both desktop renderer artifacts are built. |
| Independent frozen-source UI regression |9/9 passed; client/material real DOM scopes above also passed. |
| Serial production Electron subset | First run exit0. [Native report](fixtures/companion-qq-desktop/evidence/eec1249c-c314-4364-9586-db18fc78dc56/report.json), [readonly card](fixtures/companion-qq-desktop/evidence/eec1249c-c314-4364-9586-db18fc78dc56/readonly-qq.png). |

Native verification used actual Electron45 Main/preload/two file windows with a fresh scripted service. Both surfaces read its actual QQ status. The real UI opener passed through the frozen facade/IPC/Main to a process-local `shell.openExternal` spy; extra URL fields, an untrusted exact frame and old connection IDs were refused. A new connection's click used the new target. All149 frozen inputs matched before/after and a separate current-file rehash. Electron/service/Xvfb were joined; the owned profile/home/data directories were identity-verified and removed. The report records `--no-sandbox` and makes neither an OS browser launch nor OS sandbox claim.

Final task context/link validation and the concrete commit plan are recorded with the task. Archive and journal follow the one-shot work-commit approval; no M6 commit or push has been made yet.

Exact platform account permission, deployed protocol version, public-network deployment and actual QQ media display/listening remain separate evidence. They are not silently substituted by these controlled results.
