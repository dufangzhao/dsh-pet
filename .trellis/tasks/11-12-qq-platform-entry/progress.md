# QQ implementation progress

2026-11-13. Implementation and controlled acceptance are complete; the task remains in progress pending the explicit work-commit batch approval, archive and journal. Both protocols, scoped State/Core/work, all four media, judgment, full Web management and desktop readonly/open-Web are composed and verified. Whole-workspace quality stages and the final production Electron subset passed. User approval and its hashes remain in task metadata; M6 has not used a real account/message/paid-model trial.

## Current truth

[PRD Q1–16](prd.md) captures all user decisions. The [design](design.md) is the technical authority and [implementation plan](implement.md) defines ordered gates; research preserves evidence/history rather than a second implementation specification.

Branch: `feat/qq-platform-entry`, based on completed M5 HEAD `b706007`. The original4120 service/data/tokens remain untouched. The broader roadmap and unrelated tasks remain open. Actual SnowLuma version/endpoints and permitted real test recipients are later integration material.

## Independent review

Reviewer `5519bce6-c4e1-43ba-a56a-1321ff3e4c9c` reviewed the selected scope and source evidence, then reread the main design/implementation plan. It reported no remaining substantive design blocker after these three corrections:

1. Bounded input-owned contexts and one pre-credential primary-model permit retain real native tool receipts; destructive yield/replanning and the artificial one-work-per-input restriction were rejected. Multiple work effects and actual cancel/join remain explicit gates.
2. Personal surface/Pet eligibility is owner-private, checked before Main FIFO and again before service synthesis. Management visibility is not automatic playback authority.
3. Complete canonical semantic text, declared inline/full-text-file delivery, frozen attempt/sequence/quota plans and mandatory-text-before-voice gates replace silent clipping and ambiguous partial sends.

The reviewer also checked the concrete supervised codec-job choice and separate judge source/config/credential purpose. These are **planning conclusions**, not successful execution/media/platform tests. Architecture researcher `a4ca84ff-3b77-42ff-a74d-4cbf9fbfd47f` separately confirmed the selected context handling matches the inspected SDK extension points and corrected the historical proposal header.

A later independent code review covered the implemented State/runtime/Harness/model-purpose boundaries and confirmed no reproducible P0/P1/P2 finding in that scope. Its [four controlled canaries](../../../qa/companion-qq-review-core-5519.test.mjs) passed: pre-limit scope isolation, preserved legacy retries, material/admission atomicity, and a cancelled parked permit making zero native calls. This was a core review, not validation of the unfinished whole UI/media product.

## Planning checks

- Both context manifests contain19 real spec/research entries and pass `task.py validate`; no seed-only rows remain.
- Product selections have no remaining blocking question. Concrete resource defaults and limitations are exposed in design for final review.
- Checked16 scoped Markdown files:0 broken local links. Both19-entry manifests validate; whitespace check is clean. All20 changed files are task/planning records, with0 product changes.
- The final summary was approved by the user2026-11-13. `task.py start` succeeded. The planning-only counts above are historical, not a statement about the current working tree.

## Implemented gates — 2026-11-13

These are scoped results, not a completed product or live-platform acceptance. Do not add overlapping test counts together.

| Slice | Actual evidence and current boundary |
| --- | --- |
| Contracts | Origin/material/QQ schemas and guards, additive canonical fields, old command fingerprint preservation: 80 focused tests initially; later scoped page-guard/desktop additions passed. Public `eventKey` is separate from true native `event_id`; pure upload never opens the text-accepted gate. |
| Context proof and Harness | [Real SDK proof](evidence/phase0-context-proof.md) and [Harness integration](evidence/harness-context-integration.md): actual native-tail retention, one FIFO permit, lazy ready queue, input-owned contexts and actual joins; Harness 25 tests. |
| Independent model purpose | Runtime binding tests 17 passed, including simultaneous foreground/judgment and exact-source retirement. Service-control extension is implemented; final combined service verification follows composition. |
| State and cold migration | Format3 single writer, exact scoped readers, admissions/materials/observations/delivery, persistent judgment/proactive budgets. State 42 tests and synthetic migration 3 tests passed; later private binary-intent and full-record-budget focused boundaries passed. Only fresh synthetic roots were migrated/tested. |
| Runtime | Actual Host/SQLite/Cortico two-person grant→claim→output→terminal loop and retained multiple works. Binary reader uses existing execution/task identity and work-owned access after input/Harness retirement. Current material/quoted-note data stays separate from history and authored memory cues; terminal events carry the original private policy grant. Scoped gates also cover parallel sticky rechecks and 0-history/current-data behavior. |
| Protocol and native I/O | Final protocol suites: official44 and OneBot44 passed, including whole32MiB streams, real hashes/ranges, one-attempt publication, epoch fencing and physical cleanup failures. Host-controlled HTTP/WS gates additionally exercise large registered stream frames, bounded drain, pinned public DNS, secret-free COS PUT and completed-response preservation after revoke. [Additional HTTP facts](evidence/media-http-contracts.md). |
| Codec | [Single codec evidence set](../../../qa/fixtures/companion-qq-codec/README.md): 18 actual codec cases plus 7 lifecycle cases, full 120s/6-span/SILK content checks, resource limits and joined cancellation. Use the final image in `plugins/qq-media-codec/codec-image.lock.json`; earlier image IDs are obsolete. The final 16MiB kill is not falsely labeled OOMKilled; the separate genuine OOM observation is retained. |
| Material storage | 16 real State/Host/files-authority tests passed: exact content/hash, scope checks, path/inode protection, cancellation/commit uncertainty, owner semantic-text resolution and actual image bytes. |
| Worker binary inputs/outputs | [Cloud executor](../../../plugins/cloud-exec/src/index.ts) retained old text/lifecycle behavior:38 actual Docker checks. Runtime/service now inject the fixed execution-bound material reader. The protected artifact/current-material → current-reply material resolver passed12 tests; say attachments retain full text and reject unsupported voice forwarding instead of dropping it. |
| Personal surfaces | Main/preload/FIFO44 and service speech34 passed. Startup now injects the fixed Web opener and actual full-text resolver. Read-only desktop QQ status uses the existing snapshot; affected renderer113 and actual Chromium DOM7 passed. |
| Audio consumer bridge |21 distinct QQ audio cases verified with actual pinned codec and controlled native ASR/TTS. The120s input produces six exact20s spans; multisay/document speech checks actual State text acceptance and full semantic bytes, not a notice stub. Existing voice19/speech34 also passed. |
| Input media bridge |19 distinct cases verified across both protocols/private+group, real byteplane/store/codec and controlled ASR. Shared-file observations can become current-input-bound worker materials through exact scoped lookup; no fake message admission or repeated download of ready materials. |
| Judgment and delivery | [Judge24](evidence/qq-judge-controller.md) and [sender20](evidence/qq-delivery-sender.md) passed. State freezes unique passive sequences/reserved capacity across batches, using actual native basis/SQL time. Known receipts survive later revoke; no unknown retry. The output adapter passed22 cases including actual multipart/Snow algorithms and acceptance retained alongside failed cleanup. |
| Service composition |4 fresh-root API/text checks and [4 complete media/work paths](evidence/qq-service-media.md) passed: actual inbound PNG/binary/WAV→Core, native text-ack-before-real-TTS/SILK, unknown-text zero synthesis/upload, and one real container copy/result file publication across disconnect. Admission6 covers grant tracking before SQL await, early preparing receipts and actual joins. All use controlled protocol/model peers; no real QQ account. |
| Web management |Final frozen source passed326 client cases, real-service DOM18, real-material DOM3 and controlled panel DOM5. [Independent UI canary](../../../qa/companion-qq-review-ui-5519.test.mjs)9/9 closed the reproduced secret/CAS/late-owner/byte-bound bugs. Full source/account and group controls, aliases/machines, explicit public facts and actual full-text/download actions are present. Static fact-key checks are not mislabeled as reconciliation coverage. |

## Current coordination

[Integration handoff](integration.md) assigns the closed HTTP and private port seams. Parent owns service composition, incoming mapping/admission, outgoing delivery and root dependencies; source modules use the existing PluginManager/Config/permissions/tasks rather than a second runtime. Participant grants stay private and are distinct from protocol connections.

The [acceptance record](../../../qa/companion-qq-acceptance.md) owns the final results and scope: service315, full workspace types/packages, root QA178 plus the18-case opt-in Docker service run, lint/format/build, Web DOM, independent UI9 and serial production Electron. The final integration review's scene inconsistency is fixed and covered by real controlled WSS. Remaining work is the concrete work-commit approval followed by archive/journal. The backend and frontend executable specs and operator guidance are present. No M6 commits or push have been made; the original4120 service/data/token remain untouched.
