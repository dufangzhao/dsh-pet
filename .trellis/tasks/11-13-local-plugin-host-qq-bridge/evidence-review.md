# Delivery, material custody and State planning review

Read-only source review against `6897787`, updated2026-11-14 after Parent's R1–R3 amendments. Only this review is authored; no product code, service, QQ/SnowLuma connection, test Agent, Docker job, paid model or original4120 data was run or changed.

## Verdict

**R1, R2 and R3 are closed at the planning level. No remaining blocking finding in this assigned delivery/media/State review.** The revised design and G0/G4/G5 gates address the actual source conflicts. This is approval of the plan's coverage, not evidence that the bridge is implemented or its IO gates have passed.

The selected independent daemon, one server Agent, both protocols/four media, server-owned model/codec/work roles, same-owner bearer limitation and honest Windows-candidate status are consistent. Keep the fresh bounded per-business-request server check; no renewable permission cache, new PKI or second local delivery ledger is needed.

## R1 — Closed: remote uncertainty versus global sender failure

**Observed source:** [qq-delivery.ts:566](../../../apps/companion-service/src/qq-delivery.ts#L566) assumes `cleanup:'settled'` on a thrown in-process transport. Merely changing that result to unknown would trigger the controller-wide `cleanupFailure` at [line626](../../../apps/companion-service/src/qq-delivery.ts#L626), reject all future deliveries at [line211](../../../apps/companion-service/src/qq-delivery.ts#L211), and retain failure on close at [line835](../../../apps/companion-service/src/qq-delivery.ts#L835). Updating State late facts alone would not clear that private global latch.

**Reviewed resolution:** [design§6](design.md#6-frozen-delivery-and-local-native-effects) separates service-owned physical cleanup failure from an uncertainty hold on the original remote source/local-task/claim. Matching actual cleanup or explicit same-host owned-resource recovery is required; a new boot/socket/config is not proof. Unrelated sources are not poisoned. Server shutdown joins its own resources and preserves remote uncertainty. [G0](implement.md#L12) now proves lost acknowledgement→fact-only reconciliation→new independent delivery, with old effect count1 and no boot-only release. Genuine local physical cleanup failure remains retained. This closes the planning conflict.

## R2 — Closed: raw custody before codec/ASR

**Observed source:** [QQMediaTransfer.pull:286](../../../apps/companion-service/src/qq-media-transfer.ts#L286) gives the consumer a source-coupled access object; [line336](../../../apps/companion-service/src/qq-media-transfer.ts#L336) waits producer and consumer and checks that source afterward. [prepareInput:526](../../../apps/companion-service/src/qq-media-transfer.ts#L526) checks it again. [QQAudio.transcribe:375](../../../apps/companion-service/src/qq-audio.ts#L375) carries the same access through decode, material storage and [ASR:417](../../../apps/companion-service/src/qq-audio.ts#L417). A network proxy alone would therefore keep later server ASR attached to the local socket.

**Reviewed resolution:** [design§5](design.md#5-canonical-input-and-material-custody) now places a private custody cut after **all required raw parts** have actual native completion/reader join, bounded EOF/hash validation and owned server staging commit under the valid original actor/candidate. It occurs before codec/ASR and is not erased by a source-only postflight failure. Subsequent processing uses that original server authority/task lifetime without old socket signals or `originalSource.check()`. Raw staging does not become a premature ready MaterialRef. [G0](implement.md#L13) and [G4](implement.md#L47) include disconnect-after-custody and server-actor-revocation controls. This closes the milestone ambiguity without weakening format/transcript validation.

## R3 — Closed: report channel versus original execution identity

**Observed source:** [ControlEndpoint.receive:275](../../../packages/host-kernel/src/ipc/control-endpoint.ts#L275) rejects another session/owner envelope; [handler completion:463](../../../packages/host-kernel/src/ipc/control-endpoint.ts#L463) drops a return after endpoint closure. [close:484](../../../packages/host-kernel/src/ipc/control-endpoint.ts#L484) resolves requests and aborts handlers but does not prove remote native settlement. A bare RPC return cannot retain the late fact.

**Reviewed resolution:** [design§6](design.md#6-frozen-delivery-and-local-native-effects) records KnownOutcome in the bounded local operation owner before attempting the RPC response. Reconciliation uses the current authenticated reporting envelope with the **original immutable binding/local-task/attempt**, and can only enrich facts. It cannot execute the old command, redeem a continuation or reopen voice. The first positive fresh check binds the actual local TaskHandle reference once before native IO, so later cleanup evidence has an exact owner to match. Contradictory native IDs still conflict. This closes the identity/retention ambiguity without relaxing old-epoch control handling.

The State4 extension remains necessary: [validateAttempt:90](../../../plugins/state-sqlite/src/deliveries.ts#L90) currently freezes settled facts beyond limited cleanup/correlation enrichment; [transition:285](../../../plugins/state-sqlite/src/deliveries.ts#L285) freezes terminal outcome/phase; [recovery:583](../../../plugins/state-sqlite/src/deliveries.ts#L583) seals uncertain attempts and cancels pending voice. The narrow enrichment path must retain those execution fences. Current format is [schema.ts:5](../../../plugins/state-sqlite/src/schema.ts#L5); stopped3→4 and absent-binding legacy fingerprints unchanged are appropriate. The final [A1–A10 mapping](implement.md#L80) is now corrected.

## Scope coverage retained

| Requirement | Source-backed seam and disposition |
| --- | --- |
| Both protocols/private+group/all media | [PRD A3–A4](prd.md#L34) and [G4/G5](implement.md#L45) retain the full scope. Existing M6 gates are regressions, not evidence of the new network boundary. |
| Semantic full text/multisay | [sender semantic read:317](../../../apps/companion-service/src/qq-delivery.ts#L317) reads the actual document; [State validation:100](../../../plugins/state-sqlite/src/deliveries.ts#L100) protects message/origin/content identity. The explanatory stub must not become the delivered or synthesized body. |
| Text before voice | [QQAudio.exportVoice:463](../../../apps/companion-service/src/qq-audio.ts#L463) requires sending/pending plus known mandatory-text acceptance. Late facts retain terminal/voice-cancelled fences, and the revised plan also checks the same frozen source's usability before new synthesis. |
| Worker material/results | [runtime.readWorkMaterial:1049](../../../packages/companion-runtime/src/runtime.ts#L1049) remains the server authority boundary. Ready bytes do not cause another native download; accepted cloud work remains independent of local source loss. |
| Proactive media | [prepareInput:495](../../../apps/companion-service/src/qq-media-transfer.ts#L495) and [transcribe:365](../../../apps/companion-service/src/qq-audio.ts#L365) currently require `kind='qq'`, while [proactive:404](../../../apps/companion-service/src/qq-ingress.ts#L404) uses `qq-proactive`. The planned private original-observation/actor candidate authority and actual proactive media proof are required; a fake actor or public-kind widening is not authority. |
| Private upload continuations | The current [WeakMap:370](../../../apps/companion-service/src/qq-delivery-transport.ts#L370) and [redemption:572](../../../apps/companion-service/src/qq-delivery-transport.ts#L572) rely on local object identity. [Snow remotePath:42](../../../plugins/qq-onebot/src/media-types.ts#L42), official `file_info` and [registered COS refs:23](../../../plugins/qq-official/src/media-types.ts#L23) stay local. The plan binds an opaque continuation to the original peer/route/part/hash/upload parent and following claimed send. |
| Once-only ordering | [sender claim:505](../../../apps/companion-service/src/qq-delivery.ts#L505) precedes execution. Preserve passive reservations/sequences and OneBot file/text compound publication. Upload/transfer acknowledgement alone is not publication acceptance. |
| Trust and platform claims | [design§4](design.md#4-network-bridge-and-authentication) explicitly retains owner-level bearer trust; hostId is not independent device authentication. [design§8](design.md#8-local-delivery-and-compatibility) separates an actual portable Windows candidate from pending Windows-device/native/account execution. |

## G0 assessment and implementation evidence

The revised [G0](implement.md#L7) now includes the missing small two-stage upload→claimed-send continuation proof, cross-session/part rejection, raw-custody cut with revocation control, and sender recovery after lost acknowledgement. These are sufficient **planned proof obligations** to expose the identified technical unknowns before broad implementation; no additional architecture blocker is inferred. They must pass using actual registered drivers, authenticated two-process transport, real tasks/readers, bytes/hashes and controlled native HTTP/WS receipts. State DTOs or mock call counts cannot substitute for those observations.

Retain the bounded fresh-check test: a delayed/lost check beyond5s from local request start or original eligibility starts zero new native requests; an already dispatched request may complete later and its actual outcome must survive. Server checks belong before the corresponding business calls, while local checks remain at chunk boundaries. Measure actual cost before adding any cache.

Do not expand G0 into all32MiB/120s combinations. G4/G5 still own full both-protocol/private/group/media, textdoc, actual codec/controlled ASR/TTS, cloud independence and same-attempt reconciliation acceptance. If State4 persistence is completed in G1, its real migration/enrichment proof is a mandatory G1 exit gate, not a G0 mock pass.

## Simplification retained

Keep the existing kernel tasks, one server State, bounded local operation/continuation records and fresh check. Do not add a retry/outbox, renewable authorization cache, per-event credential service, second platform framework or daemon delivery database. State4/private binding and late-fact enrichment address demonstrated source constraints and should not be deleted. Maintain normative behavior in design and ordered proofs in implement; research/review should reference them rather than establish another contract.

All assigned review findings are closed in the current plan. Implementation and its actual IO proofs remain future work; no new product decision or expanded scope is requested.
