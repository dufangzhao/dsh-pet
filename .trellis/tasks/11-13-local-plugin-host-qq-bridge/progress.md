# Local host / QQ bridge progress

## Current execution

Implementation and the authorized Linux controlled acceptance are complete on `feat/local-plugin-host-qq-bridge`, from baseline `6897787`. The complete proposal was approved on 2026-11-14; its approval hashes remain unchanged. The user subsequently authorized this stage's commits, GitHub push and merge, and specified Windows as the next development machine. Final work commits and remote publication are being completed; the task remains `in_progress` until their finish record is written.

**Current delivery: Windows x64 portable preview candidate `0.1.0-preview.9`.** The start page contains only the connection card; QQ includes client access management; ASR and TTS have separate pages; plugin management groups related components and collapses internal parts. QQ client labels now name SnowLuma / NapCat（OneBot v11）and official QQ without claiming client detection or installation. The user's preview8 Windows startup test found an executable `//` line in the PowerShell initialization script. The confirmed defect is fixed in both copies inside preview9, and script failures are no longer mislabeled as missing authorization. See [Windows regression evidence](evidence/windows-startup-fix.md) and [Windows development handoff](../../../docs/41-windows-development-handoff.md).

The previous preview6 Linux production GUI acceptance covered three-source authorization, actual GUI exit with the daemon continuing, same-boot/key reattachment and offline stop. That evidence remains Linux-only. The repaired preview9 still needs the user's Windows startup/reattach/stop confirmation; actual QQ/account/model joint tests remain separate.

## Implemented slices and evidence

| Slice | Canonical evidence | Accepted scope |
| --- | --- | --- |
| Coreless kernel and shared sources | [Kernel](evidence/g0-kernel.md), [shared sources](evidence/g2-sources.md) | Actual factories, one shared QQSourceCore, real source/task leases and source-specific cleanup |
| Independent process and native management | [Process and management](evidence/g0-process.md), [stop-order review](evidence/g6-stop-review.md) | Independent daemon, HMAC management and sensitive binary credentials; physical terminal-write settlement before shutdown |
| Transport and gateway events | [Wire](evidence/g0-wire.md), [review](evidence/g0-wire-review.md), [HELLO](evidence/g0-official-hello.md), [two-process mechanism](evidence/g0-bridge.md) | Authenticated closed transport, actual claim/native effects, bounded streams and immediate gateway-event handling |
| State4 | [Durable execution and migration](evidence/g1-state4.md) | Legacy fingerprints preserved, original task/process once-bound, transactional cleanup-only enrichment |
| Raw custody and server media | [Custody](evidence/g0-custody.md), [media](evidence/g4-media.md) | Required raw parts before codec/ASR, original server actor after custody, scoped work/material reuse |
| Production bridge and Core | [G3 bridge](evidence/g3-bridge.md) | Real State/Core admission, original grants, full remote file bytes/native completion, observed-file work, reconnect dedup and rejected wrong bearer |
| Once-only delivery and recovery | [G5 delivery](evidence/g5-delivery.md), [independent review](evidence/g5-independent-review.md) | Final scoped matrix, real old-process exit proof, preserved unknown effects and known receipts, no replay |
| Desktop and user controls | [Renderer](evidence/g6-ui.md), [Main/native](evidence/g6-native.md), [r6 actual GUI report](../../../qa/fixtures/local-host/evidence/desktop-ed89c186-57e7-437e-b565-e1f55bc0f301/report.json) | All three sources have explicit review/trust/allow/deny controls; real DOM and native lifecycle accepted; stale-boot responses cannot overwrite the accepted target |
| Portable package | [G7 assembly and audit](evidence/g7-package.md) | preview9 ZIP/CRC/SHA256 and target runtime/dependencies verified; both shipped Windows private-directory helpers include the repair; older candidates remain historical |
| Settings UI | [UI redesign](evidence/ui-redesign.md) | QQ client access, ASR/TTS pages, grouped plugin modules and readable platform labels; final desktop 1144 tests passed |
| Windows startup | [Windows regression evidence](evidence/windows-startup-fix.md) | Actual preview8 failure identified at PowerShell line95; regression fails on old source and passes after repair; Windows-only native test awaits Windows execution |
| Whole-project quality | [Final gate report](evidence/quality-final.md), [budget fixture correction](evidence/quality-model-budget.md), [Docker supplement](evidence/quality-docker-optin.md) | Six base gates passed, required prepared-image Docker targets actually passed, final source types/lint/format independently rechecked |
| Preserved test-service identity | [Service handoff](evidence/service-handoff.md) | Verified whole-root backup, cold format3→4 migration without changing Agent/epoch, restored empty loopback preview |

Per-slice counts overlap and must not be summed as product coverage. Reports retain failed attempts and their actual fixes; a later successful retry alone did not resolve the UI controls gap or the stop-ordering defect.

## Final acceptance notes

- Repeated State polling in the G3 integration test created authorized task/hash work and starved its own input. The fixture now waits for the actual terminal event or observed receipt and reads State once; production trust was not cached or weakened.
- Retained-history construction remains296 actual State calls with all original data. Only its setup clock moved into a bounded `beforeAll`; the final snapshot retained its original20s budget and all payload/fact/projection assertions.
- The daemon stop defect was fixed in the product: it joins physical writes before the shutdown it triggers and suppresses unusable view-change hints while stopping. Kernel cleanup failure still remains failure and does not retire discovery.
- Original-process recovery changes only the original attempt's cleanup. Old missing process identities remain unproven; actual daemon exit does not undo external QQ/COS effects or authorize replay. API details remain in the [State/QQ contract](../../spec/backend/qq-platform-entry.md) and [local-host contract](../../spec/backend/local-plugin-host.md).

## Service and handoff

The session-owned preview runs at `http://127.0.0.1:4121` in scripted mode with the original Agent and epoch, zero user messages/tasks/facts, and QQ sources disabled. It is owned by the main conversation's managed background job, with private runtime/log records under the existing ignored operator directory. The initial child-owned run's later exit cause was not established; that history was preserved, and the final service was explicitly restarted under the parent after an identity/idle check. No new Agent root or second migration was performed.

The Windows candidate, Chinese usage guide and checksum are separate user deliverables. The [commit review plan](commit-plan.md) describes proposed local work-commit batches; it is not permission to execute them.

## Remaining human actions

1. Run preview9 on Windows and confirm QQ access startup, GUI exit/reattach and explicit stop. The new Windows-only private-directory test is also available from the [development handoff](../../../docs/41-windows-development-handoff.md).
2. Complete GitHub device login for the already-authorized push/merge. Use the final handoff receipt to identify the published commit and branch. Live account/model testing is independent of this code handoff.

## Environment and authorization

No real QQ account, paid-model trial, original4120 data change or existing SnowLuma/AstrBot restart occurred. Prepared local Docker images were used for the authorized controlled tests only. The latest user authorization covers work commits, GitHub push and merge; it does not request a public binary release, installer registration or OS startup service. Private runtime data, credentials and generated screenshots remain outside the source commits.
