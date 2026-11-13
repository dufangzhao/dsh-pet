# QQ architecture proposal: one Agent, isolated input authority

Planning research, 2026-11-12. This document proposes implementation boundaries; it does not authorize implementation. Only this research file was written. No service, model, device, account, external endpoint or test was run.

**Supersession note — 2026-11-13:** The selected [main design, section 3](../design.md#L56) supersedes this research's earlier destructive-yield/reconstruction and one-work-per-input candidates. The selected direction is bounded input-owned contexts (default 2, hard cap 4), one primary native-model dispatch permit acquired before credential borrowing, retained native tails/effect receipts while parked, and multiple legitimate work effects. Contexts retire at completion or forced invalidation; crash/forced interruption does not automatically replan started effects. Section 14 below remains the historical candidate comparison. The main design's [media and mandatory-text rules](../design.md#L119) and [delivery gates](../design.md#L152) also take precedence over earlier options here. This records the planning selection, not approval to implement.

[PRD Q1–16](../prd.md#L9) is authoritative. Both protocol sources and all four media categories remain required. Web is the complete management surface; desktop shows status and an entry. Only owner/explicit admins mutate or publish long-term facts. Text is mandatory; voice is an optional addition. SnowLuma's installed version is unknown: implement OneBot v11 plus explicitly named media compatibility operations, not a guessed deployment or another bot runtime. Earlier research's unresolved product questions are superseded where the PRD now decides them.

All identifiers/methods/API paths described below as **proposed** are new design, not existing interfaces. Existing mechanics are linked separately. Detailed protocol evidence and unresolved external limits stay in [QQ media research](qq-media.md), [SnowLuma environment note](onebot-environment.md), [runtime entry](runtime-entry.md) and [runtime media](runtime-media.md).

## 1. Recommended shape

Keep one `CompanionRuntime`, one persistent Agent identity/persona, one canonical State writer, one **active inference projection**, and the existing independent work map/execution provider. Add two ordinary protocol plugins, a small service-owned QQ controller and narrowly scoped State/authorization extensions. Do not keep a Core, memory database or native conversation per person/group/platform.

The decisive invariant is **one actionable input per inference projection**. An input binds one actor, one audience, one reply route and one action grant. Other messages in its authorized history are labelled historical evidence, not additional current instructions. Never merge different actors' grants or let multiple reply destinations enter the same active input batch. Rebuild the disposable projection between inputs; retain conversational continuity in filtered canonical messages/facts/work instead of private native tails.

Flow:

1. A protocol source authenticates its own connection and normalizes a bounded event.
2. The host verifies source/account, allowlist, actual sender, self/bot exclusion and external dedup identity.
3. State records the message/context and necessary provenance. Media preparation and participation gating are tracked under that source.
4. A qualifying direct input or a reply-only proactive input becomes a bounded State admission.
5. The single dispatcher installs its immutable authorized projection, runs it, and records every accepted effect/formal reply against that input.
6. A source-owned sender consumes canonical reply records, plans required text and optional/media parts, and records each upload/send outcome.

Protocol reconnect Sessions and Cortico projection IDs remain internal. Disconnecting QQ retires its ingress/egress resources; accepted background work continues under the service.

## 2. What the current code actually permits

| Existing fact | Consequence |
| --- | --- |
| [runtime.message](../../../../../../packages/companion-runtime/src/runtime.ts#L652) immediately calls Harness `accept` after persistence; [Harness](../../../../../../plugins/harness-cortico/src/harness.mjs#L272) accumulates delivered inputs in `eligible` | A source-aware dispatcher must intervene before Core delivery; adding sender labels alone does not isolate authority |
| [publish](../../../../../../packages/companion-runtime/src/runtime.ts#L1040) stores only `inputIds[0]`; [startWork/stopWork](../../../../../../packages/companion-runtime/src/runtime.ts#L1054) discard origin details | Preserve complete origin and pass the active input through every action port |
| [context](../../../../../../packages/companion-runtime/src/runtime.ts#L1016) returns global messages/facts/tasks; the native Session retains previous rounds | Filtering only a newly generated prompt leaves historical private/tool content behind |
| [input schema](../../../../../../plugins/harness-cortico/src/boundary.mjs#L74) and message State contracts are text-only | Media references and scope metadata require coordinated contracts/State/Harness/client changes |
| [ConfigService schema](../../../../../../packages/host-kernel/src/config/schema.ts#L43) already supports closed objects, bounded arrays, booleans and numeric ranges | Whitelists, per-group policy and judge settings need no replacement config system; stay within 48 KiB values, 16 KiB schema, depth 8/256 nodes/256 array items |
| [HTTP bearer boundary](../../../../../../apps/companion-service/src/server.ts#L305) represents the operator; artifact/task routes accept IDs without participant identity | QQ users must use source-bound host ports, never the operator bearer or arbitrary HTTP proxy |

### Cortico cancellation, reset and actual settlement

Inspected dependency: patched Cortico 0.2.7, linked through the installed Harness package.

| Actual API | Actual behavior; suitability |
| --- | --- |
| [`loop.reloadSystemPrefix()`](../../../../../../node_modules/.pnpm/cortico@0.2.7_patch_hash=7fdf0b783f4465bd37ede05850748cf4a7b52ba4d7dc708ae2c9f81562243995/node_modules/cortico/src/core/loop.ts#L1756) | Replaces system prefix but preserves user/assistant/tool tail. **Not an audience isolation boundary.** |
| [`loop.clearSession()`](../../../../../../node_modules/.pnpm/cortico@0.2.7_patch_hash=7fdf0b783f4465bd37ede05850748cf4a7b52ba4d7dc708ae2c9f81562243995/node_modules/cortico/src/core/loop.ts#L1727) | Waits for the processing batch to finish, then resets session/opening; event store remains. No immediate cancel/join or pending-event isolation. |
| [`loop.abortCurrentRound()` / `interruptCurrentRound()`](../../../../../../node_modules/.pnpm/cortico@0.2.7_patch_hash=7fdf0b783f4465bd37ede05850748cf4a7b52ba4d7dc708ae2c9f81562243995/node_modules/cortico/src/core/loop.ts#L421) | Synchronous abort request; interrupt can stop interruptible tools/skip unstarted calls. Neither confirms physical settlement or discards all previous context. |
| [`Core.stop()`](../../../../../../node_modules/.pnpm/cortico@0.2.7_patch_hash=7fdf0b783f4465bd37ede05850748cf4a7b52ba4d7dc708ae2c9f81562243995/node_modules/cortico/src/core/core.ts#L675) | Stops loop/timers, waits the loop with **1,000 ms** drain budget, seals it and stops Worlds with **20,000 ms** budgets; returns failures. Resolution is not automatically success. [Constants](../../../../../../node_modules/.pnpm/cortico@0.2.7_patch_hash=7fdf0b783f4465bd37ede05850748cf4a7b52ba4d7dc708ae2c9f81562243995/node_modules/cortico/src/core/core.ts#L48). |
| Existing [`harness.retire`](../../../../../../plugins/harness-cortico/src/harness.mjs#L390) | Fences generation, aborts its controller, requests interrupt, awaits Core.stop, and refuses reconstruction if stop failed **or tracked inFlight remains**. |
| Existing [`stopForeground()`](../../../../../../plugins/harness-cortico/src/harness.mjs#L434) | Uses retire then builds a fresh Core in a new projection directory; does not cancel independent product work. Its public port currently has no input-scope parameter. |
| Existing [`close()`](../../../../../../plugins/harness-cortico/src/harness.mjs#L459) | Idempotent final close: fences, joins lifecycle/retirement and unregisters loader. Not a reusable audience-switch API. |

Do not replace this with `session.reset`, prefix edits, changing a mutable `currentUser`, or a success receipt from logical task cancellation. The host-private [source authority helper](../../../../../../packages/companion-runtime/src/source-authority.ts#L6) awaits actual settlement; preserve that distinction for model, tools, media and transport.

## 3. Identity and authority: small explicit records

Proposed canonical identities:

| Record | Minimum information and meaning |
| --- | --- |
| Source/account | Protocol plugin ID, default instance, durable logical account binding. Connection generation/config/credential/policy epochs are separate live authority, not the Agent identity. |
| Principal | Host-minted ID from verified protocol/account/subject namespace. Never a nickname or model-supplied role. Official C2C OpenID, group member OpenID and OneBot user ID are not automatically equivalent. |
| Audience | `owner-private`, private-person namespace or protocol/account/group namespace; plus explicit `public` facts. Private aliases across protocols require explicit verified mapping, not matching names/text. |
| Reply route | Source/account/scene/target and necessary original message/event/reference IDs. No bearer or signed download URL in model context. A route is fixed for the accepted input. |
| Input | Stable ID, canonical message/evidence references, kind, principal, audience, route, policy revision, preparation/dispatch state and effect references. User inputs preserve the existing command receipt relationship. |
| Action grant | **Host-private**, bound to input ID, projection generation, principal/audience, current policy and allowed operations/material IDs. Durable audit fields describe the decision but do not resurrect a live lease after restart. |
| Task origin | Initiating input ID/principal/audience/route, admitted material references and stable effect identity. Product task/execution IDs remain unchanged. |

Authorize in the host at each effect/read boundary, checking the captured input and the current policy after asynchronous admission. Plugin permission leases govern the plugin's capability use; the participant grant additionally governs whose data/work it may use. Neither substitutes for the other.

Proposed grant classes are finite and specific to this release:

- Direct admitted member: reply, inspect permitted materials, start restricted work, list/read/stop **own** work that is also visible in the current audience. Work started in a private scope is not automatically readable in a group, even by its owner through a group reply.
- Owner/explicit admin: the same conversation actions; long-term fact mutations only on an explicit authorized request. Global management/cross-user inspection belongs to the operator management surface or an explicit owner-private administrative context, not an automatic group-context expansion.
- Proactive group input: reply-only. It has system provenance and references the group evidence that caused the decision; it inherits no member/admin action grant.
- Work-result input: reply/read the exact completed task and authorized artifacts only. It cannot start work, stop unrelated work or write facts.

A group administrator role reported by QQ is not an Agent administrator. Quote/forward/ASR text is content, not an actor assertion. Historical messages from an admin cannot authorize the current ordinary member.

Model-facing changes should remain narrow: `say`/`start_work` already carry inputId; retain that, add the origin to host `stopWork`, and bind `list_work` to the active input instead of globally listing work. Do not accept actor, role, audience, arbitrary reply address or permission flags in tool arguments. Remove unavailable tools from that projection's schema and still enforce the same denial in host ports.

## 4. One active projection, bounded dispatch and fair yield

### Proposed facade

Extend the existing Harness facade with an input-scoped operation such as **`activateInput(inputId, projectionToken)`** and a lifecycle result/callback distinguishing completed, yielded, interrupted and failed. Names are proposed. Internally reuse `buildGeneration`/`fence`/`retire`; capture a separate immutable set of product ports for each generation. Do not call `ports.context()` against a global mutable audience.

The host issues a projection descriptor containing only the authorized persona, visible facts, bounded audience history, visible own task summaries, current input and accessible media refs. Each descriptor carries input/projection/policy/profile/memory visibility stamps. Callbacks must match the full descriptor, not just the Harness plugin generation.

Rebuild at every new input in the first implementation, including same-group messages from another sender. This is deliberately simpler than caching per-user native sessions. A yielded continuation of the same input is also rebuilt from canonical state. Historical group messages from multiple authors remain readable data; only the one current input is actionable.

### Switch sequence

1. Keep new arrivals in the bounded State admissions, **outside the old Core bus**. At most one input is delivered to that Core. `generation.eligible` must not become a cross-input authorization set.
2. Natural completion waits formal publications/accepted-effect persistence. `onTurnEnded` alone is insufficient: current code releases admissions there before `onIdle` awaits publications. Use a proposed host acknowledgement only after the applicable work has settled.
3. For responsiveness, check whether another input is waiting **before the next native model request**, in the existing `llm.respond` wrapper. Cortico calls it after the preceding model/tool work; do not use `outputTap.onRoundEnd` alone, which precedes later tool handling and permits eager tool dispatch. See [native loop ordering](../../../../../../node_modules/.pnpm/cortico@0.2.7_patch_hash=7fdf0b783f4465bd37ede05850748cf4a7b52ba4d7dc708ae2c9f81562243995/node_modules/cortico/src/core/loop.ts#L1107).
4. If yielding, do not issue that next request. Fence the current generation and let the wrapper/handler unwind. Notify the outer dispatcher asynchronously; **never await Core.stop from a callback/promise included in that Core's own drain**.
5. The outer dispatcher retires the old projection and checks Core failures plus actual tracked model/tool/publication settlement. Only then mark the input safely yielded/terminal, install another input's descriptor and build a fresh projection directory.
6. A failed or unconfirmed drain blocks replacement and exposes unavailable/cleanup-pending. A sealed Core or a cancelled logical handle does not prove provider/socket/decoder settlement. Do not ignore Cortico's 1-second drain failure to claim an immediate safe switch.

At an ordinary next-request boundary there should be no external operation from the previous step still unaccounted for. If a native call or short effect is still running, the dispatcher cannot promise a latency it has not achieved. Bounded long work stays in the independent worker path; it must not occupy the foreground until completion.

### Continuation without a second reasoning store

An input's continuation consists of its original canonical request, visible conversation facts, its own accepted work/receipts and already committed replies. Do not persist or replay a hidden reasoning tail. A yielded input moves behind waiting inputs; subsequent admission rechecks current authority without broadening the original grant or rebasing memory CAS.

For the initial implementation, propose **one `start_work` admission per direct input**, with a stable input/action slot and request fingerprint: exact retry returns its original task, changed payload conflicts. Multiple tasks remain concurrent across inputs, and a single job can produce multiple declared outputs. This avoids recreating a completed effect with slightly changed generated code after projection reconstruction. If multiple starts per one input are needed later, add explicit bounded effect slots rather than relying solely on model call IDs. This is a proposed action budget, not an existing limit.

Explicit cancellation/permission revocation may interrupt immediately; accepted tasks remain canonical and require the normal task-stop path to stop them. A newer chat input does not silently cancel old work. A known safe yield may resume; a process crash with an active/unknown effect may not be treated as a safe yield.

## 5. Canonical State, full origins and cold migration

Use the current SQLite provider and synchronous transactions. Add only the records necessary to answer whether an input was admitted, what effect belongs to it, and what was attempted externally.

Proposed State changes:

- Extend immutable message provenance with actor/audience/kind, canonical media refs, a primary input reference and the **complete** origin references. Preserve `originInputIds[]`; never collapse them to the first ID. Distinguish supporting historical message IDs from current actionable input IDs.
- Add a fixed-purpose `input_admissions` table keyed by input ID, linking the canonical message/evidence and bounded state such as preparing, ready, active, yielded, completed, cancelled, failed or unknown. Context-only group observations do not become actionable input rows until a direct trigger or reply-only participation decision is admitted.
- Add fixed-purpose media metadata and `qq_deliveries` records (including ordered part/upload/send facts). These are not a broker, arbitrary scheduled-job API or a second conversation store. In-memory maps are only active handles/wakeup hints; the existing State remains authoritative.
- Persist task initiating principal/audience/input/route and material refs when `createTask` commits. Keep deterministic execution identity and stop-race reservation. Record the task-result input once from its task outcome, not from whichever person spoke last.
- Scope facts by audience/public visibility. A composite `(scope,key)` identity prevents one person's labelled fact from overwriting another's. Keep the existing set revision + row revision CAS/dedup mechanism; the first version can retain the existing global monotonic memory revision rather than invent per-scope clocks.

Proposed read methods are purpose-specific: `contextForInput`, `taskForInput`, `artifactForInput`, `readyInputs`, `deliveryStatus`. Methods may ultimately have different names, but no public caller can supply a trusted principal object. The host derives the scope and State applies the actual query/filter. Filtering a global latest page after truncation can hide all permitted results, so selection/filtering must precede pagination/budget projection.

For new assistant publication, require one admitted active input and a deterministic route. Preserve complete origins even though active instruction count is one. A proposed multi-origin output must resolve to the same authorized projection/route or fail; it is never broadcast. A work-result reply binds the original task route and restricted result grant. Optional replies in the owner's Web do not change the external recipient.

### Migration to a new State format

Current writer accepts format 2; existing migration implements only v1→v2. Propose explicit **v2→v3 cold migration** using the same full-root backup, writer exclusion, schema validation, single transaction and commit-last pattern. See [existing migration](../../../../../../apps/companion-service/src/migrate.ts#L35) and [current writer format](../../../../../../plugins/state-sqlite/src/state.ts#L74).

Migration rules:

- Preserve Agent ID, epoch, message/task/execution/artifact IDs, timestamps, commands, fingerprints, receipts, events and memory revision.
- Assign all pre-scope messages, tasks, artifacts and facts to **owner-private**. Missing or ambiguous old provenance stays legacy-unknown within owner-private; do not infer public/group membership or reconstruct origins that were already discarded.
- Prefer added metadata columns/tables over changing immutable legacy payload/fingerprint semantics. Old exact command retries still use their original fingerprint before new defaults are projected; QQ's namespaced external IDs cannot impersonate those retries.
- New external commands fingerprint stable normalized intent/provenance, excluding volatile signed URLs, gateway recovery sequence and secret fields. Duplicate message/notice forms need protocol-specific identity rules; do not deduplicate people/messages by similar text.
- Old history creates no new QQ admissions/deliveries. Do not replay old replies, audio or work after migration.
- Restart marks previously active/unconfirmed input/send phases unknown. Ready work that provably never began may resume only after current admission and expiry checks; active model/tool/send operations are not blindly replayed. Existing task reconciliation still uses verified execution records.

Memory policy changes can invalidate an active projection's visible data even if the actor is unchanged. Fence its model/publication and rebuild. Existing `projectionApplied(memoryRevision)` cannot honestly mean every scope was installed: add the relevant scope/visibility stamp to private acknowledgements and report application only for the applicable view. Preserve global persona identity without claiming global private memory is loaded in a group projection.

## 6. Facts and own-work enforcement

Q15 is settled: ordinary members never receive a fact mutation grant, even for their own private scope. Their `remember` tool is absent and direct host dispatch is denied. Do not reserve the current natural-memory admission slots for their memory cues. They may use visible existing facts and ordinary conversational history.

Owner/admin natural memory requests may preserve current explicit cue + verbatim evidence + CAS rules, bound to the captured input/scope and initial baselines. Owner/admin public publication must be an explicit operation in the management form with scope preview and CAS; do not let a model turn private facts public by selecting a flag. Recording group context is not fact creation.

All task reads/listing/stopping check principal ownership **and** current audience/material visibility before returning data or invoking runtime. An owner/admin global management read uses the private management context, not the current group's model context. A task receipt or known ID proves neither ownership nor export permission. Recheck before artifact bytes leave the service; a current policy change can block delivery without erasing an already completed task.

## 7. Mandatory text, multi-part delivery and two protocols

The output authority is the committed assistant message/reply parts, not model deltas or an adapter's latest contact. `say` may commit multiple formal replies during an input. Each retains its own canonical identity and route; the sender may package compatible adjacent parts without changing their order or claiming atomic delivery.

Proposed `qq_deliveries` facts include logical reply/message IDs, fixed source/account/target, format/part index, content hash, original passive reply basis, allocated sequence, phase, actual returned platform IDs and bounded fixed errors. Persist an attempt before network I/O. After a crash/timeout, an attempted send without a conclusive response remains unknown; OneBot echo is correlation, not a dedup key. Known success is never resent. No fallback switches protocol/target or silently escalates a passive reply to an active message.

Mandatory text is planned first and cannot be removed by TTS failure or a voice preference. Images/files remain explicit reply parts; voice is an additional part when enabled. Distinguish text completeness, each media export/upload, platform acceptance, partial batch and unknown. No status claims recipient receipt, playback or read without evidence.

Long-result recommendation, pending the PRD's final delivery-policy choice: preserve all formal text; plan bounded inline chunks when the target's tested limits and reply budget permit, otherwise offer a clearly labelled complete UTF-8 text attachment plus required textual explanation. Do not silently summarize or call a file attachment complete inline text. The current ordinary-reply `.slice(0,8000)` must not silently discard accepted content; either a bounded complete response is validated before formal publication or complete content is represented by an ordered reply/attachment manifest with bounded State writes. Existing 8,000-unit message/64 KiB control limits remain explicit until that extension is implemented.

Official QQ specifics from [protocol research](qq-media.md#L82): allocate stable `msg_seq` within the original reply basis, count text/media parts against available replies, distinguish display reference from passive authority, and preserve expired/denied/unknown outcomes. C2C window evidence remains contradictory; no design may promise an unconditional delayed reply or silently promote it to proactive. Upload with explicit no-send semantics before the message operation; presigned upload URLs must not receive the bot bearer.

OneBot specifics: use standard arrays/actions/receipts; define a finite compatibility descriptor for the required private/group file events, URL retrieval and uploads. Bind it to a selected implementation/version, with unknown as a real state. SnowLuma's current deployment is not verified. Do not emulate remote protocol paths as local filesystem paths or claim base v11 covers complete files.

Both sources can be enabled independently with one account binding each. No automatic cross-protocol identity/group alias or forwarding. Exclude verified self/system echoes before context/judge admission; known bot exclusions are explicit. Similar text is not identity proof. Cross-source group aliases, if configured later, must specify one automatic responder rather than accidentally forming a bot loop.

## 8. Media staging and artifact authority

Use a bounded service media area with metadata under the existing State authority, not native Core logs. Proposed records contain stable ID, original source/input/audience, verified size/MIME/hash, storage locator and lifecycle state. Signed download URLs, upload tokens and credential-bearing references stay in private source handling, outside prompts/public views.

Stage bytes under a source-owned supervised task: normalize permitted remote reference, download with actual byte budget, validate format, finish an exclusively owned file, then commit the canonical reference. No network work inside SQLite transactions. Failed metadata commit cleans only the verified owned staged path; uncertain files are reported/reconciled, not mass-deleted. Expired source URLs are not durable artifacts.

- Images: resolve permitted canonical refs into native image parts or a bound media resolver; declare/check actual selected-model image capability. Include bounded image context only for the current audience. Formal output uses image references and protocol upload, not arbitrary URLs in model text.
- Voice input: decode/resample QQ recording to M4's mono16kHz f32le; keep original sender/input provenance. Existing ASR supports20-second clips. For a longer admitted recording, propose a bounded sequence of those clips with segment IDs/attempt facts and ordered complete transcript; no truncation or hidden repeat of an unknown ASR call.
- Voice output: consume M5's canonical assistant PCM16LE24kHz stream under a separate QQ output intent, encode/spool completely and upload a supported media container. Raw PCM is not a recording file. Pet opt-in remains independent; text continues even when optional voice fails.
- Files: stage authorized binary materials into the worker's assigned namespace through a narrow host reader/copy port. Extend execution input with opaque material refs resolved by the host; do not replace the current24KiB string cap with inline base64 or give a network-disabled worker broad filesystem/network access. Retain existing contained-path/symlink/hardlink checks.
- Artifacts: metadata/read/export checks apply before bytes are opened and again before publication. Task ownership alone must not widen private source material into a group/public audience. Keep original job/artifact identity and per-destination upload facts.

Existing format/size constraints and useful methods are catalogued in [runtime media](runtime-media.md). Required codecs/worker processing tools must be shipped/declared through the ordinary source/process boundary and verified; their presence is not established by a Node Docker image or a file extension.

## 9. Participation judgment without retiring the primary model

Keep two finite purposes in this release: `foreground` and `qq-participation`. This is a proposed extension to the existing model binding, not a configurable agent-role framework.

Current [ModelConnections](../../../../../../packages/companion-runtime/src/model-connections.ts#L225) captures one selected binding and enforces its model; current controller changes retire the foreground. Extend selection/binding lookup to include purpose, and isolate role-specific control/check state. A judge config save must not call `runtime.retireForeground()` or change primary selection. Retain the model-equality check within each purpose and all source/config/credential generation fences.

Use a separately configured ordinary Magpie connector/source binding for the judge with its explicit target/model/credential ownership. Reuse private `PortsFor`/authorized transport/lease machinery; never fetch a plaintext primary/DSH/ASR/TTS key or copy credentials between slots. The QQ source has a narrow `judgeParticipation` host port, not an arbitrary provider factory or raw credential access.

Judgment is a short, tool-free structured inference over the permitted group's bounded recent context and necessary public facts. It returns a validated participate/decline decision with a bounded reason; it is neither a canonical assistant reply nor action permission. Rules/probability and model-assisted mechanisms share allowlist, self/bot exclusion, cooldown, call/concurrency budget and policy checks. A stale/revoked result is discarded. On budget/error/unknown, propose no proactive send; explicit @/wake-word input remains eligible for the primary Agent and is not blocked by an optional judge failure.

A positive judgment creates one reply-only input with references to its evidence. It cannot create another judge event from its own output. Native attempts consume budget: current transport can retry, and `role` is only diagnostic metadata. A true one-attempt budget needs explicit native transport policy, not merely a short outer timeout or relabelling all work diagnostic.

## 10. Source, credential and removal lifecycle

Two ordinary protocol plugins use existing PluginManager/TaskSupervisor/PermissionKernel/ConfigService/CredentialBroker. Service registers their private ports, and starts connection work only after the source is active. Their effects own socket, heartbeat/reconnect work, callback registrations, auth renewal and in-flight upload/send handles.

Bind each live connection to owner generation, reviewed source fingerprint, Config revision, policy epoch, credential version, logical account and unique connection ID. Config/key/permission changes synchronously fence the old binding before fallible cleanup. Callbacks recheck captured connection after awaits. Drain sockets/HTTP/codec tasks and credential uses before replacement; report pending_restart/unavailable when cleanup cannot be confirmed. No new generic network SDK or global fetch hook is needed; current headless host deliberately lacks generic network and credential ports.

QQ AppSecret/access token and OneBot token have independent declared slots. Official token renewal occurs inside that source's credential lifecycle; OneBot token belongs only to its exact selected endpoint. Process-only secret behavior can match current service patterns; persistent secret storage is not assumed. Save succeeds independently from connected/applied/verified state.

Disconnect/disable cancels QQ transport and prevents further source effects, but preserves accepted canonical messages, tasks and media. Already launched service work keeps its recorded grant/material scope and may finish; source removal is not an implicit stop-all request. Delivery remains blocked while the route is unavailable.

Actual removal needs one small composition change: current service installs static registrations and supplies no installation-removal callback. Use the existing manager's uninstall flow with a persisted absent-source intent for these optional bundled modules, honored at restart, so they are not immediately reinstalled. Do not delete bundled source files or canonical user data to simulate uninstall. Reinstallation can reuse the retained Config after an explicit owner action. No plugin market or general package manager is part of this increment.

## 11. Web management: narrow service-owned APIs

Reuse existing authenticated owner HTTP/SSE, fixed Result errors, no-store, Config CAS and bounded client guards. Proposed routes are illustrative, closed and limited to the two known QQ source IDs:

| Proposed route/action | Responsibility |
| --- | --- |
| `GET /api/qq` | Bounded source/account/status summary, desired/applied distinction, compatibility and media readiness |
| `GET/POST /api/qq/{source}/settings` | Source connection metadata, whitelist/admin mapping, group policy and delivery preferences; expected Config revision; never plaintext credentials |
| `POST /api/qq/{source}/credential` | Independent target/config/key-version CAS; set/remove source secret, private ingress only |
| Existing plugin lifecycle endpoint, restricted to known sources; explicit connection control if needed | Real enable/disable/retry/remove intent and cleanup state; no optimistic connected result |
| `GET /api/qq/inputs` and `GET /api/qq/deliveries` | Bounded/cursor-based owner diagnostics, original audience and partial/unknown facts; no raw payload or secret dump |
| Explicit delivery cancel/reconcile/manual-new-send action | Cancel unattempted parts or inspect actual protocol evidence. Unknown send is never made safely retryable by changing its ID. Any deliberate new external send is previewed as a new action. |
| `GET/POST /api/qq/judge` plus explicit bounded test | Separate purpose/model/config/budget and truthful check state; zero inference on ordinary save |
| Existing fact routes extended with scope and publication CAS | Owner/admin write/read/manage only; no QQ participant receives these HTTP credentials |

Current [credential ingress](../../../../../../apps/companion-service/src/server.ts#L68) is loopback peer + Host/Origin, not arbitrary remote Web. Reusing it means full credential editing is available through the private local/forwarded owner Web entry, while remote views correctly show non-writable. Do not claim a public Web page already has full credential ingress. If full remote credential editing is required in deployment, it needs an explicit trusted TLS/management-ingress design; forwarded TLS headers alone are not proof. This proposal preserves the current boundary rather than silently weakening all model/voice credential routes.

Desktop consumes an additive bounded QQ status summary and a fixed management-entry action using the current configured service origin. It does not instantiate QQ sources or another config owner. Opening Web never puts the service bearer in a URL. Preserve dirty drafts/captured revisions, source-specific failures and current snapshot byte-budget reservation.

## 12. Proposed bounded defaults, separate from current/platform limits

These are reviewable **product recommendations**, not QQ guarantees or already implemented constants. Values can be lowered by operator policy; enforcement returns explicit quota/unsupported state rather than silently omitting selected media.

| Area | Proposed first-release budget | Basis/qualification |
| --- | --- | --- |
| Main inference | One active projection; 16 ready/yielded inputs globally, 4 per audience | Avoids cross-authority batching; stays below existing supervisor128-task and permission128-lease ceilings; queued records do not each hold a model task |
| Group recent context | Most recent30 messages or30 minutes, at most12KiB rendered text per input; explicit omission markers | Bounded locality alongside facts/tools under current64KiB control envelope; not long-term fact storage |
| Participants | Up to128 private allowlist entries and32 groups per source, bounded admin list | Within existing Config arrays/value budget; exact encoded Config remains the final bound |
| Active facts | Retain current32 active-fact/8KiB data quota initially across scopes; never drop accepted facts | Scope changes need not invent unlimited memory. Web shows truthful usage and conflicts. Increasing this later requires projector tests |
| Proactive mode | Off until enabled; then recommend60s per-group cooldown and6 proactive replies/hour/group | Includes text/media parts in transport accounting; no claim this equals platform quota |
| Model judge | One concurrent judge globally, no more than1 call/minute/group and30 admitted calls/hour globally;10s deadline,256 output tokens | Independent from primary work; attempts counted; error/unknown declines proactive response |
| Staged media | At most4 attachments/input, image8MiB each, ordinary file32MiB each,32MiB aggregate/input;2 preparation tasks;128MiB active-stage budget | Local product limits, below some official maxima; actual byte/MIME/decode checks still required; no inline-control bytes |
| Voice input | Recommend up to120s via at most6 existing20s ASR segments, sequential per recording;8,000-unit complete transcript limit | Segmentation is new work with stable IDs and unknown-call handling; existing M4 alone remains20s. Longer/oversize input fails explicitly, never truncates |
| Worker outputs | Keep existing1MiB default/8MiB aggregate maximum until an explicit execution-budget change | QQ can transport larger files without granting worker unlimited output; imported files and task outputs have distinct budgets |
| Output/connection work | One ordered sender per source-target, at most2 active media uploads per source; bounded retained diagnostics | Real text/media caps and passive quotas are protocol-specific; no blanket automatic send retry |

The mandatory-text/optional-voice default recommendation is text plus explicit image/file parts, voice off until enabled. The final long-result/voice preference remains the PRD's last product choice. Capability/codec/version readiness may block a particular operation honestly; it may not be used to relabel the full release as text-only or omit a protocol/media implementation.

## 13. Implementation ordering and acceptance implications

The smallest coherent implementation order is: scoped canonical State/migration and action enforcement; isolated Harness dispatch/continuation; independent purpose binding; two protocol sources and finite delivery facts; media staging/conversion/export; Web management and desktop status. These are internal phases of one selected release, not permission to ship only phase one.

Focused acceptance must include:

- Owner private → ordinary group member → another private user, including model/tool/native-tail traps: no retained private context, merged grant or misrouted say.
- A starts a real job, B is admitted at a subsequent supported model boundary, A's result preserves task/actor/audience; reconstruction does not start another task.
- Ordinary member cannot mutate any long-term fact, access another task/artifact or replay an admin quote; owner/admin publication is explicit and revisioned.
- Duplicate inputs/parts, source revoke/config/key replacement, noncooperative native cleanup, crash after send attempt, and removal/restart preserve actual uncertain state rather than new effects.
- Every media kind on both protocol paths, including actual image model input, complete ASR transcript, mandatory text with optional valid encoded voice, authorized binary task staging and file export. OneBot file extensions require their explicit compatibility profile.
- Judge concurrency/budget/config changes leave primary model, Agent identity and independent work untouched; judge failure cannot authorize effects or produce a feedback loop.
- Cold migration preserves IDs/receipts and makes all old data owner-private without replay. Existing Web/desktop/M4/M5 paths retain their own source lifetime and output semantics.

No acceptance above has been executed in this planning turn. Real SnowLuma/version discovery and real-account sending remain separately authorized integration work.

## 14. Focused reconsideration: retain contexts only for live inputs

Added after Parent review on 2026-11-12. **Parent did not adopt the one-`start_work`-per-input suggestion in section 4. It must not become a first-release requirement/default.** The single-global-projection/yield-reconstruction recommendation and its concurrency budget above are now candidates under comparison, not settled design. One actionable input per projection remains the isolation invariant; it does not require only one projection in the entire service.

### Comparison and recommendation

| Candidate | Benefit | Real cost / limitation |
| --- | --- | --- |
| A: destroy on yield, reconstruct from canonical state | Only one live Core; easy to discard foreign native history | Loses the still-running input's native tool-call/result tail. A regenerated call with changed arguments is a new current effect hash and can duplicate intent. Limiting work starts to compensate restricts legitimate multi-work requests. Not recommended as the default continuation mechanism. |
| B: bounded contexts for **currently processing inputs**, one active input per audience, limited cross-audience concurrency | Retains each input's tool-call IDs, receipts and native tail until that turn ends; no reconstruction merely to serve another audience; supports multiple independent work starts | Needs a small active-input map and status/application aggregation. Same-audience inputs wait for the current bounded turn. No automatic restart of an already-started input after crash/cancellation. |
| C: B plus retained-context model-step permits for same-audience responsiveness | Can pause A before its next provider call, process B in a different isolated context, then continue A's exact native tail | More coordination than B; requires cancellation-aware permit waits and a precise definition of step serialization versus whole-turn serialization. It is not supplied by the existing Harness facade. |

**Recommend B as the smallest viable implementation of the parent's alternative**, initially with a proposed cap of two live input contexts and one active context per audience. This is a product resource budget, not a proven capacity or a one-work limit. Keep all previously selected media/protocol/judge capabilities and existing multiple `start_work` calls. If R16 must apply to a later input in the *same* audience at the next model-step boundary, B alone does not establish it; use the bounded C extension described below rather than claiming it does or destroying A's context.

These contexts exist only from admission through terminal turn/disposal. There is no idle person/group cache, no per-platform permanent brain, and no user session selector. A finished context is not reused for another input. Canonical persona, memory, message/task state and product Agent ID remain shared owners.

### Checked Core, loader and provider facts

1. **Core's state is instance-owned.** Constructor allocates a separate event store, WakeBus, SessionLog, CoreState, timers, provider registry, session tracker, usage/tool logs and loop. Storage derives from `loaded.dataDir/rootDir`. The requirement for exactly one persistent receiving session is **per Core instance**, not a process-wide singleton. See [Core construction](../../../../../../node_modules/.pnpm/cortico@0.2.7_patch_hash=7fdf0b783f4465bd37ede05850748cf4a7b52ba4d7dc708ae2c9f81562243995/node_modules/cortico/src/core/core.ts#L112) and [per-Core session requirement](../../../../../../node_modules/.pnpm/cortico@0.2.7_patch_hash=7fdf0b783f4465bd37ede05850748cf4a7b52ba4d7dc708ae2c9f81562243995/node_modules/cortico/src/core/core.ts#L162).
2. **The existing factory already isolates local variables and directories.** Each `createCorticoHarness` call owns `current/lifecycle/closing`, per-generation `eligible/round/inFlight/publications`, cloned config and a random `projections/<generationId>` root. With distinct scoped ports, its native state need not be shared with another live factory instance. See [factory closure](../../../../../../plugins/harness-cortico/src/harness.mjs#L60) and [projection construction](../../../../../../plugins/harness-cortico/src/harness.mjs#L118). [SessionLog](../../../../../../node_modules/.pnpm/cortico@0.2.7_patch_hash=7fdf0b783f4465bd37ede05850748cf4a7b52ba4d7dc708ae2c9f81562243995/node_modules/cortico/src/core/session.ts#L8) owns its own ContextLog path; [run records](../../../../../../node_modules/.pnpm/cortico@0.2.7_patch_hash=7fdf0b783f4465bd37ede05850748cf4a7b52ba4d7dc708ae2c9f81562243995/node_modules/cortico/src/core/run.ts#L85) also remain under that dataDir.
3. **Known process-wide values are not Agent/context singletons.** The provider-module catalog is a shared definition array/map; each ProviderRegistry's clients/resources are instance maps. Do not register duplicate provider modules per input. Log correlation uses AsyncLocalStorage and MainLoop establishes an asynchronous anchor scope. See [provider definitions versus instances](../../../../../../node_modules/.pnpm/cortico@0.2.7_patch_hash=7fdf0b783f4465bd37ede05850748cf4a7b52ba4d7dc708ae2c9f81562243995/node_modules/cortico/src/providers/registry.ts#L30), [log context](../../../../../../node_modules/.pnpm/cortico@0.2.7_patch_hash=7fdf0b783f4465bd37ede05850748cf4a7b52ba4d7dc708ae2c9f81562243995/node_modules/cortico/src/core/log-context.ts#L19) and [round scope](../../../../../../node_modules/.pnpm/cortico@0.2.7_patch_hash=7fdf0b783f4465bd37ede05850748cf4a7b52ba4d7dc708ae2c9f81562243995/node_modules/cortico/src/core/loop.ts#L1089). This is evidence for the inspected service path, not a certification of every upstream World/provider's global behavior.
4. **tsx needs source-level lifetime ownership, not another Agent.** Current factory calls global `register()` per factory and sets the same process-wide `TSX_DISABLE_CACHE=1`; the tsx API supports namespaced registration and an asynchronous unregister handle. Recommend registering/importing native modules once per Harness source, sharing the loaded classes, then awaiting unregister only after all live input contexts have closed. Avoid making one input's disposal deactivate a loader needed by siblings or stacking an unbounded chain of hooks. The installed API's `Unregister` is `() => Promise<void>`; current factory invokes it without awaiting it, which must be accounted for in the new source-level disposer. See [current register](../../../../../../plugins/harness-cortico/src/harness.mjs#L64), [current close](../../../../../../plugins/harness-cortico/src/harness.mjs#L459) and [tsx API declarations](../../../../../../node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/esm/api/index.d.mts#L16). No loader/Core execution was performed in this review.
5. **The service model client is already request-concurrent.** `ModelConnections.clientFor` creates per-request controllers/closures and retains each promise in the binding's pending Set; a caller cancellation does not retire the common provider. Authorized model dispatch keeps native result/error variables local to `respond` and constructs its native provider inside that request's credential borrow. See [client implementation](../../../../../../packages/companion-runtime/src/model-connections.ts#L225) and [native dispatch](../../../../../../apps/companion-service/src/model-client.ts#L55). An existing [two-request cancellation regression](../../../../../../packages/companion-runtime/src/model-connections.test.ts#L317) documents the intended isolation; it was read, **not rerun**, and is not a multi-Core test. Both contexts may use the same selected primary model binding. Their grant/projection identity still needs an additional host guard because the plugin owner is intentionally shared.
6. **No single-use credential lock forces one context.** The broker tracks multiple credential uses with individual task signals and a capacity limit, rather than a single in-flight borrow. See [broker uses](../../../../../../packages/host-kernel/src/credentials/credential-broker.ts#L534). One context must not close the shared connector transport/broker; only cancel its own request. Provider/source retirement remains a deliberate shared event.
7. **Namespace native diagnostics/cache identity.** The current constant session declaration is `foreground`; native MainLoop registers `mainTrack` with that declaration ID, so two Cores would both supply `sessionId='foreground'`. Their local files/trackers remain separate, but Responses maps sessionId to `prompt_cache_key`. Supply a projection-qualified internal session ID in the injected client wrapper; leave the semantic role diagnostic separate. A cache key is not an authorization boundary and this does not prove a current data leak. See [mainTrack](../../../../../../node_modules/.pnpm/cortico@0.2.7_patch_hash=7fdf0b783f4465bd37ede05850748cf4a7b52ba4d7dc708ae2c9f81562243995/node_modules/cortico/src/core/loop.ts#L1011), [request options](../../../../../../node_modules/.pnpm/cortico@0.2.7_patch_hash=7fdf0b783f4465bd37ede05850748cf4a7b52ba4d7dc708ae2c9f81562243995/node_modules/cortico/src/core/loop.ts#L1218) and [Responses body](../../../../../../node_modules/.pnpm/cortico@0.2.7_patch_hash=7fdf0b783f4465bd37ede05850748cf4a7b52ba4d7dc708ae2c9f81562243995/node_modules/cortico/src/providers/openai-responses-compat/native.ts#L60).

**Finding:** no process-global Core/provider singleton was found that prevents the proposed small number of independent projections on this inspected path. This is source feasibility, not executed concurrency/lifecycle verification. The project wrapper, not native Core instantiation, is the main adaptation point.

### Minimum project changes for B

- One ordinary Harness plugin remains installed/selected. Replace its [single captured harness/status](../../../../../../plugins/harness-cortico/src/index.ts#L38) with a bounded map keyed by admitted input ID. Each entry owns its isolated factory/projection ports, root TaskSupervisor handle, cancellation signal and actual completion promise. Same source generation is allowed; each entry additionally has its own unforgeable live input/projection binding.
- Claim ready inputs from existing proposed State admissions only if the global context cap and audience slot permit. Use an audience Set/map for that bound; no new generic scheduler, external queue, persistent native-session catalog or idle-context cache. [TaskSupervisor.run](../../../../../../packages/host-kernel/src/tasks/task-supervisor.ts#L115) already permits multiple tasks for the same active owner and gives separate cancel/result/settled handles.
- Deliver exactly one actionable input into each Core. Context refresh, tools, output, scoped memory acknowledgements and status callbacks use its captured descriptor. Never route `ports.context()` or an async callback through a mutable service-wide current input.
- Replace the runtime's [single projection/status assumptions](../../../../../../packages/companion-runtime/src/runtime.ts#L123) with per-live-input records and a small aggregate view: finishing A cannot publish global ready while B remains busy; A's failure need not make healthy B unavailable; source-wide failure is still global. [clearProjection](../../../../../../packages/companion-runtime/src/runtime.ts#L284) currently clears all admissions and cannot be used as A-only cleanup. Preserve only owner/scope-relevant application claims instead of last-writer-wins `projectionApplied`.
- Retain native function-call/result pairing through A's whole turn. Multiple `start_work` calls are permitted under the input grant and existing resource policy. Continue canonical deduplication of actual stable effect IDs/fingerprints; retain native call ID and projection ID as provenance. **Do not change effect identity merely to impose one start, and do not treat retained context as proof of semantic exactly-once execution.**
- Once formal publications/accepted-effect receipts settle, the terminal hook only signals the outer task owner. That owner disposes the context after the hook returns, avoiding a Core-stop self-wait. Remove the entry/release its slot only after actual cleanup. No completed context is reused for another actor or route; private files that remain for diagnostics are not automatically loaded as a later conversation.
- Work results bind their original task origin and become separate restricted inputs, serialized with their audience. Independent product workers outlive the input context that started them. Do not keep an input Core alive until every background task finishes.
- Input cancel fences its own ports/provider call and closes its own Core, not siblings or accepted workers. Whole source retirement fences all entries, awaits all physical settlement, and only then unregisters the loader. Unconfirmed cleanup remains visible and occupies capacity; it cannot be treated as a free slot or quietly replaced.
- Do not auto-reconstruct/replay a started input after process crash, ambiguous stop or a failed effect. Mark its admission interrupted/unknown, retain canonical tasks/receipts and let a new authorized follow-up inspect them. Ready-but-never-started inputs are a different recovery case. This removes reconstruction-induced effect replay without reducing an input to one work.

### R12/R16 boundary and the optional C extension

[R12](../../../../11-06-unified-companion-architecture/prd.md#L22) defines one continuing product Agent with internal execution Sessions managed by the system; it does not require a single JavaScript Core instance. B complies when identity/persona/State/action policy remain canonical and all internal contexts disappear with their active input. It would violate that direction if each account/group acquired independent durable personality, memory, autonomous background loops or user-visible Session selection.

[R16](../../../../11-06-unified-companion-architecture/prd.md#L26) separates quick work acceptance from long execution and requests next-supported-step responsiveness:

- B retains the existing independent-worker behavior and lets another audience start immediately when a context slot is free, without throwing away A's live tail.
- Whole-turn serialization in the same audience means B waits until A's current turn ends; at capacity, another audience also waits. Neither is a guarantee of handling every new input at the very next inference step. State admission/position and bounded capacities must be truthful.
- If strict same-audience next-step handling is required, the smallest C variant is a **cancellation-aware wait before the next provider dispatch in the injected `ResponseClient` wrapper**, retaining A's Core and tail rather than aborting/rebuilding. A yields an audience execution permit only after the previous tool work/publications are accounted for; a spare bounded context can run B, then return the permit. Only one inference/tool step for that audience executes at a time. This is step serialization, explicitly different from one-live-context-per-audience.
- C requires a spare live-context slot and well-defined terminal/cancel wakeups; a permit wait must reject on source/input cancellation so Core.stop can actually drain. It must not hold a credential borrow while merely waiting. No raw `clearSession`, prefix swap, shared model round or unbounded suspended-Core cache is involved. The existing async model wrapper is an available insertion point, but this permit behavior is **proposed, not an existing tested API**.

The real outstanding choice is therefore **whole-turn audience serialization (simplest B) versus bounded step interleaving (C for strict same-audience R16)**. Neither requires the rejected one-work-per-input restriction. Multi-Core isolation, one-context cancellation with a sibling alive, async loader disposal, scoped status/application aggregation, multiple work calls and exhausted-capacity behavior need focused implementation verification later; none was executed here.
