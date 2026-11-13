# QQ platform entry contracts (M6)

## 1. Scope / Trigger

Use for official production QQ WebSocket or authenticated OneBot v11 reverse-Universal entry, participant policy, scoped State/Core/work, materials, judgment, delivery, or personal-surface integration. These ordinary plugins share the existing Agent, selected Harness, kernel and SQL writer; an account/group/context is not another Agent or a second bot runtime.

This is the canonical M6 code-spec. Reuse [service](companion-service.md), [model](model-connections.md), [memory](persona-memory.md), [ASR](shared-voice-input.md), [TTS](shared-speech-output.md) and [Desktop](desktop-companion.md) contracts for unchanged mechanisms. Executed scope and outstanding integration belong to [task progress](../../tasks/archive/2026-11/11-12-qq-platform-entry/progress.md#implemented-gates--2026-11-13) and its linked evidence, not to a declaration of whole-product or real-QQ acceptance here.

## 2. Signatures

Canonical declarations stay in source; do not reproduce the schema/API catalog in clients or another spec.

| Boundary | Actual source / entry |
| --- | --- |
| Public facts and guards | [origin](../../../packages/contracts/src/companion-origin.ts), [material](../../../packages/contracts/src/companion-material.ts), [QQ](../../../packages/contracts/src/companion-qq.ts): `CompanionInputOrigin`, `QQAccountRef`, `QQReplyReference`, `QQDeliveryView`, page guards and limits |
| Single writer / scope / migration | [State method types](../../../plugins/state-sqlite/src/types.ts), [scope](../../../plugins/state-sqlite/src/scope.ts), [format3 upgrade](../../../plugins/state-sqlite/src/schema.ts), [cold migration](../../../apps/companion-service/src/migrate.ts): `migrateCompanionData({dataDirectory,backupDirectory})` returns `fromVersion:1|2,toVersion:3` |
| Private participant authority | [input-authority.ts](../../../packages/companion-runtime/src/input-authority.ts): `RuntimeInputGrant {origin,role,signal,check()}`; `RuntimeInputAccess {scope,signal,check()}`; terminal output retains the original private grant |
| Runtime admission and work | [runtime.ts](../../../packages/companion-runtime/src/runtime.ts): `dispatchReadyInput(id,grant):Promise<{queued:boolean}>`, `recheckInputAuthorities()`, `setInputPorts(ports)`, `onInputTerminal(listener)`, `readWorkMaterial(request,consume)` |
| Input-owned native context | [Harness ports](../../../plugins/harness-cortico/src/harness.d.mts): `queueSignal(inputId)`, `bindInput(input,contextId):Promise<HarnessInputBinding>`, `binding.terminal(value)`; [ModelPermit](../../../plugins/harness-cortico/src/model-permit.ts): `run(signal,operation)` |
| Policy and source capture | [policy](../../../apps/companion-service/src/qq-policy.ts), [controller](../../../apps/companion-service/src/qq-controller.ts), [ingress](../../../apps/companion-service/src/qq-ingress.ts): participant resolution, committed-policy observation, private grant issuance, source lifecycle and bounded admission |
| Native protocol ports | [official ports](../../../plugins/qq-official/src/ports.ts), [OneBot ports](../../../plugins/qq-onebot/src/ports.ts), [native binding](../../../apps/companion-service/src/qq-native-types.ts), [I/O outcome](../../../packages/companion-runtime/src/qq-io-types.ts): private authenticated connections, physical signals/settlement and one-attempt native operations |
| Semantic bytes / worker bridge | [material store](../../../apps/companion-service/src/material-store.ts): `withMaterial`, `resolveInput`, `storeFullText`, `resolvePetCanonicalText`; [input ports](../../../packages/companion-runtime/src/input-authority.ts) and [reply resolver](../../../apps/companion-service/src/reply-materials.ts) bind authorized material/artifact selections |
| Independent judgment | [model purpose](../../../packages/companion-runtime/src/model-connection-types.ts), [judge](../../../apps/companion-service/src/qq-judge.ts), [judge context](../../../apps/companion-service/src/qq-judge-context.ts): `foreground` versus `qq-participation`, private context/check and persisted budget attempts |
| Frozen delivery | [plan](../../../apps/companion-service/src/qq-delivery-plan.ts), [sender](../../../apps/companion-service/src/qq-delivery.ts), [transport](../../../apps/companion-service/src/qq-delivery-transport.ts), [SQL ledger](../../../plugins/state-sqlite/src/deliveries.ts): `QQDeliveryTransport.execute(request,signal,progress):Promise<QQDeliveryOutcome>` |
| Audio consumer / codec | [QQAudio](../../../apps/companion-service/src/qq-audio.ts): `transcribe(input,access)`, `exportVoice(input,access)`; [codec ports](../../../plugins/qq-media-codec/src/index.ts), [codec jobs](../../../plugins/qq-media-codec/src/job.ts) |
| Public management / composition | [closed HTTP routes](../../../apps/companion-service/src/qq-http.ts), [service composition](../../../apps/companion-service/src/service.ts); [fixed Desktop facade](../../../packages/contracts/src/desktop-companion.ts): `openWeb({connectionId})`, snapshot `qq?:QQStatus` |

## 3. Contracts

### Canonical identity, visibility and migration

- Storage identity remains `{pluginId,instanceId}`; live native source authority additionally captures generation, source/policy/config/credential state and physical connection identity. `QQAccountRef`, audience, role labels and material IDs are serializable facts, not private grants or permission leases.
- [Format3](../../../plugins/state-sqlite/src/schema.ts) adds scoped columns/indexes and input/material/observation/delivery/judgment ledgers. Facts use `(audience_key,key)`. SQL visibility applies before row/byte limits; ordinary conversation reads default owner-private, facts also include explicit public rows, and own-work filtering includes principal. A protected management read is deliberately broader; it does not enlarge an input's action or automatic-playback authority.
- Normal open does not upgrade old roots. Cold migration holds the existing exclusive writer lock, verifies a new nonoverlapping full-root backup before mutation, and upgrades 1 through 2 to 3 or 2 to 3 transactionally. It preserves Agent/epoch, message/task/execution/artifact IDs, original commands/fingerprints and receipts; old content is classified owner-private with legacy provenance. It neither launches work nor sends historical QQ replies. Downgrade restores the stopped full-root checkpoint.
- `resolveQQParticipant` admits exact protocol/account/scene/sender namespaces, with group identity included where required. Empty allowlists admit nobody. Explicit aliases choose stable principals; names, quoted authors, group rank and machine/self events confer no role. Group audience stays group-scoped even for an owner/admin principal. Members have restricted tools/own work; owner/admin memory authority is separate from readable scope. Promotion never upgrades a captured lower grant.

### Admission, context and physical work

- [Mapping](../../../apps/companion-service/src/qq-input.ts) separates a host-namespaced `eventKey` from actual nullable native `event_id`; official `d.id` and signed OneBot message IDs retain their native meaning. Quote text/reference are bounded evidence, separate from current authored text. A nonunique group-file notice is a scoped resource observation, not a fabricated message ID, actionable input or proactive trigger.
- State owns `preparing → ready → active` and terminal/cleanup facts. Exact duplicates do not consume another admission or repeat an effect. [Input limits](../../../plugins/state-sqlite/src/inputs.ts) bound preparing/ready to16 globally and4 per audience; the Harness lazily starts contexts only when a real slot is available (default2, hard max4), and claims active input at `bindInput`, not queue admission.
- Each context owns its Core, native tool tail, current input and private bound ports. One FIFO [ModelPermit](../../../plugins/harness-cortico/src/model-permit.ts) wraps the actual primary `respond` before model/credential use. A parked tool await retains its native result/tail while another input can infer; do not destroy/yield/replan the first context or impose one work per input. Release the native permit only after that response's actual native/credential work joins; reclaim a context slot only after its Core retirement joins. Failed context cleanup is not a free context slot.
- [Runtime context](../../../packages/companion-runtime/src/runtime.ts) supplies exact current materials/notes separately from bounded historical rows; history0 does not erase current input data. Quoted notes, resource descriptions, old messages and work-result events are not new remember instructions. Natural memory admission uses current authored text plus captured owner/admin role/evidence; models do not supply owner flags or offsets.
- Accepted work captures its own participant grant and exact task/execution/material selections. `readWorkMaterial` checks the actual active supervisor task identity, execution, selection, ready reference/hash, pending work and current authority; input/Core retirement does not revoke that accepted work by itself. The reader/consume callback remains within actual work lifetime. No participant/model JSON chooses an arbitrary URL, host path or another execution's reader.
- Committed policy data is observed synchronously through `ConfigurationCommit.data`. Checks start for all affected inputs/work without waiting behind another actor's slow lease. Denial becomes sticky on the captured grant, so deny→restore cannot revive it. Transport retirement and participant revocation are distinct. New input admission is already tracked under its captured grant before the first SQL await and stays owned through preparation/commit/dispatch. A source task whose callback never starts creates no ghost admission; an early preparing receipt does not release its actual work. Work startup retains the winning captured authority across its SQL-admission→native-launch handoff; a pending/running row alone grants nothing.

### Configuration and independent purpose

- ConfigService remains the only CAS writer. Its bounded typed structural dialect is narrower than public JSON Schema: [shared-QQ build](../../../plugins/shared-qq/build.mjs) projects actor unions/patterns into supported storage structure and validates the generated definition. Do not install public `oneOf`/pattern-heavy QQ schemas unchanged as Config. Canonical strict guards still run at feature/controller boundaries; a structural Config save is not semantic authority.
- QQ protocol settings, policy and judgment model source have separate owners. [ModelConnections](../../../packages/companion-runtime/src/model-connections.ts) selects/binds by purpose; judgment reuses the native Magpie factory/authorized client under its independent source and `model-api-key` slot, not the foreground slot/value. Policy owns judge provider selection/budgets; the provider owns flat `{baseUrl,model,authMode}`. Combined UI save uses policy/config CAS; credential writes use config/credential-version CAS. Settings success does no inference and does not prove connection/application/verification.
- Judgment reserves its durable attempt/budget before a bounded no-tools call using exact current candidate plus scoped group/public context. Missing/unknown usage is not zero cost. A positive decision grants no owner/admin tools. No environment/DSH/AstrBot credential import or foreground-model switch is implied by enabling QQ.

### Material and complete semantic text

- [HostMaterialStore](../../../apps/companion-service/src/material-store.ts) owns protected physical bytes; State owns canonical metadata/ACL. Recheck scope, ready/cleanup state, immutable reference, actual size/hash and directory/file identity. Signed references, native `file_info`, tokens and remote staging paths stay private. A remote path returned by OneBot is not a host file path.
- Use [canonical bounds](../../../packages/contracts/src/companion-material.ts): four input parts,8MiB image,32MiB file/aggregate input, two preparations and128MiB staging. An image reaches the selected model as actual checked image bytes; a filename or capability label is not multimodal support. Worker binary inputs use assigned names and the existing execution namespace, not public command base64 or another file server.
- The local [28KiB complete-message budget](../../../plugins/state-sqlite/src/types.ts) includes origins/quote/material metadata. Even a legal8000-unit body can require `content.kind='text-document'`; its `message.text` is an explanation, not the semantic body. Full UTF-8 text is bounded at64KiB and must be read through the authorized material resolver. Consumers must not silently clip or synthesize the explanation stub.

### Frozen delivery, quota and audio

- Terminal publication retains all ordered formal message IDs/full origins and the original private grant. Freeze exact route/reference, text representation, content, required image/file/text attachments, optional voice intent, attempts and available native part count before sending. Shared `QQ_REPLY_TEXT_SEPARATOR` joins multisay. Inline parts preserve Unicode/CRLF; otherwise use explicit notice plus exact full-text document. A required text attachment is not the mandatory semantic document.
- Every upload/send/compound effect is State-claimed once. [Passive SQL facts](../../../plugins/state-sqlite/src/deliveries.ts) aggregate across batches for the same account/scene/target/native basis, prefer native message ID over event ID, preserve the earliest expiry, use SQL time, reserve full-batch capacity and allocate globally unique `msgSeq` at the first atomic claim. Use the returned frozen plan. A readonly remaining0 produces blocked0 only with nonpending outcome, error and no attempts; no fake allowance1. First claim still rechecks expiry/capacity. Ordinary/late replies never silently become wire-proactive sends.
- `isQQDeliveryPartAccepted` is the shared effect predicate: pure upload/transfer is not text acceptance; native send needs a real message receipt. OneBot file `upload-and-send` is one publication, not upload plus a second send. Public transfer/file/message IDs report their actual meaning. Never substitute a path, content hash or local intent UUID for an upstream message ID, or invent an upstream sequence; a real transfer correlation remains a separate fact.
- Mandatory text must be conclusively accepted with settled native cleanup before optional TTS. Rejected/unknown text stops later media; voice failure preserves accepted text and records partial failure. Accepted remote effect, actual local dispatch/receipt and cleanup are independent facts. Preserve a known receipt after a later source revoke; do not rewrite it as unknown. Unknown effects never automatically retry/resend; local cleanup failure cannot claim physical settlement.
- [Native adapters](../../../apps/companion-service/src/qq-delivery-transport.ts) carry captured `expectedConnectionId`; [drivers](../../../plugins/qq-onebot/src/driver.ts) and [official driver](../../../plugins/qq-official/src/driver.ts) reject a replacement even for the same account. Physical connection signals abort synchronously; actual `settled`/close and credential use are still joined. Activation binds private ports; it is not authorization to connect/listen/borrow keys.
- [QQAudio](../../../apps/companion-service/src/qq-audio.ts) reuses `VoiceController.withAsrConsumer` and `SpeechController.withTtsConsumer`, with actual private streams, provider/source checks and key leases retained through consumption. Decoded120s voice uses at most six existing20s ASR spans; M4/M5 per-request bounds remain unchanged. Output uses complete semantic text after the text gate, then actual PCM→SILK encoding. Mono/codec/MIME metadata is not owner authority or proof of bytes. Resolve image/manifest identity from the actual [codec pin](../../../plugins/qq-media-codec/codec-image.lock.json) and verified jobs, never invented IDs/extensions or a host/vendored fallback.

### Personal surfaces

Main filters personal projection and checks explicit owner-private before speech FIFO; the public service speech lookup checks it again. Global administrative readability never authorizes automatic Pet output. Scope-filtered event sequences may skip; strict monotonicity and malformed-frame fencing remain, without a contiguous `+1` assumption. Desktop reads bounded `snapshot.qq` through its existing reader and opens only the captured service Web root through the fixed trusted-frame/current-connection bridge. Web owns QQ management. Full-text Pet synthesis uses the private resolver installed in [service composition](../../../apps/companion-service/src/service.ts), not a public arbitrary-reader API.

## 4. Validation & Error Matrix

| Condition | Required behavior / boundary |
| --- | --- |
| Empty/nonmatching allowlist, self/machine, forged role/namespace, missing private grant | Refuse participant admission/action with fixed permission/input failure; no inherited owner or new effect |
| Same key/command with changed normalized payload; stale Config/key CAS | Conflict; preserve the original intent and current saved facts |
| Foreign scope/material/task, stale actual task identity, replaced connection | Permission/stale-owner/conflict before native work; no lookup under a guessed broader scope or current transport |
| Old store opened normally; unsafe/unverified cold backup | Not-ready/conflict or failed migration; preserve old data and do not replay work/sends |
| Queue/context/media/message/JSON or passive quota overflow | Explicit quota failure; no overwrite, origin truncation, semantic clipping or fabricated allowance |
| Canonical text document without authorized resolver, wrong bytes/hash or wrong audience | Not-ready/invalid-input/permission refusal; never use the explanation stub |
| Zero passive remainder, expiry, mandatory text rejected/unknown | Block before later effects; no automatic proactive fallback, voice generation or prefix replay |
| Known receipt followed by source failure or cleanup error | Retain acceptance and separate cleanup/error facts; stop later parts and join actual work |
| Secret/presigned reference in a public projection; wrong raw DTO/page shape | Fixed refusal; validate summaries with page guards, not full-view guards; never publish raw native exceptions |

Reuse existing KernelError and native Result layers. Exact source/request error distinctions live in the linked guards/controllers; do not add an error hierarchy to make all layers identical.

## 5. Good / Base / Bad Cases

- **Base:** all QQ sources/policy are unconfigured or disabled; canonical owner service still operates and readonly status makes no connection/account claim.
- **Good:** A's native tool await retains its Core tail, B infers under the same FIFO permit, and multiple A work effects keep their exact task/execution identities after A's context retires.
- **Good:** remove an actor while its State work admission is pending, then restore it; the old captured grant remains revoked and cannot launch native execution.
- **Good:** a group shares a file without a unique message ID; retain scoped resource evidence, later bind its verified material to an authorized current input, with no fake message/proactive trigger.
- **Good:** text part1 is accepted, part2 is unknown; keep the complete canonical result and known receipt, record partial/unknown delivery, make zero voice calls and do not resend part1.
- **Bad:** admin global read becomes personal context/auto-speech; a quote becomes a memory cue; a JSON origin, mono artifact or valid MIME is treated as a grant; a gateway remote path is read locally.

## 6. Tests Required

| Source-backed gate | Assertion points |
| --- | --- |
| [State format3](../../../plugins/state-sqlite/src/format-three.test.ts), [migration](../../../apps/companion-service/src/migrate.test.ts) | Scoped filtering before limits, old IDs/fingerprints/retries preserved, one writer/verified backup/rollback, no historical effects |
| [Runtime inputs](../../../packages/companion-runtime/src/runtime-inputs.test.ts), [Harness tests](../../../plugins/harness-cortico/tests/harness.test.mjs), [real SDK proof](../../tasks/archive/2026-11/11-12-qq-platform-entry/evidence/phase0-context-proof.md) | Input-owned Core/tail, cancelled parked permit makes zero model calls, lazy admission/real join, multiple work effects, policy handoff and work reader after input retirement |
| [Policy](../../../apps/companion-service/src/qq-policy.test.ts), [controller races](../../../apps/companion-service/src/qq-controller-race.test.ts), [ingress/service](../../../apps/companion-service/src/qq-service.test.ts) | Empty lists, exact actor/aliases, no role promotion, immediate parallel/sticky revoke, real frame→State→Core→frozen output and zero duplicate dispatch |
| [Model bindings](../../../packages/companion-runtime/src/model-connections.test.ts), [judge](../../../apps/companion-service/src/qq-judge.test.ts) | Independent simultaneous purposes/config/key retirement, no primary switch, durable budget/event dedup, no tools/private facts, true usage/unknown outcomes |
| [Material store](../../../apps/companion-service/src/material-store.test.ts), [transfer](../../../apps/companion-service/src/qq-media-transfer.test.ts) | Actual image/full-text bytes, ACL/hash/path/inode, current material/quoted-note separation, exact observation/resource lookup, no repeated ready-material download |
| [Delivery budget](../../../plugins/state-sqlite/src/delivery-budget.test.ts), [sender](../../../apps/companion-service/src/qq-delivery.test.ts), [adapter](../../../apps/companion-service/src/qq-delivery-transport.test.ts) | Cross-batch passive reservation/unique sequences/SQL expiry, blocked0, native claim ordering, full text, text-before-voice, compound one-send, known receipts and cleanup uncertainty |
| [Official](../../../plugins/qq-official/src/driver.test.ts), [OneBot](../../../plugins/qq-onebot/src/driver.test.ts), [native I/O](../../../apps/companion-service/src/qq-native.test.ts) | Actual captured connection/physical abort and join, no old socket retarget, large streams/ranges/hashes, private upload refs/remote paths, no invented native IDs |
| [QQ audio](../../../apps/companion-service/src/qq-audio.test.ts), [codec evidence](../../../qa/fixtures/companion-qq-codec/README.md) | Actual pinned encode/decode,120s/six exact spans, real streamed ASR/TTS/leases, semantic document bytes, actual resource/cancel cleanup |
| [Main](../../../apps/desktop/src/main/companion-client-controller.test.ts), [FIFO](../../../apps/desktop/src/main/shared-speech-controller.test.ts), [public speech](../../../apps/companion-service/src/speech.test.ts), [central guards](../../../packages/contracts/src/companion-qq.test.ts) | Personal-only projection/queue, scoped cursor gaps, fixed Web opener, document resolver/hash, same-key fact scopes, page summary and effect predicates |

Latest scoped results and limitations are recorded in [progress](../../tasks/archive/2026-11/11-12-qq-platform-entry/progress.md); do not sum overlapping counts or treat controlled peers/Docker/Chromium as real account/media acceptance. Final whole-project and product acceptance remain separate gates.

## 7. Wrong vs Correct

```ts
// Wrong: a pure-upload receipt or a forged send slot can release the voice gate.
const textAccepted = part.send?.outcome === 'accepted';
// Correct: operation/content/receipt semantics are centralized; cleanup is checked separately.
const textAccepted = isQQDeliveryPartAccepted(part);
```

Wrong: derive a private grant from `origin.principalId`, alias a file notice to `event_id`, select the latest socket after an await, or use `message.text` for a text-document. Correct: keep the original host grant and native reference distinct, recheck the captured physical source, and resolve the exact authorized semantic body before immutable planning/synthesis.
