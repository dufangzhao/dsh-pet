# Remote authority and media boundary for a local QQ host

Research baseline: `6897787`, inspected 2026-11-13; deployment/authentication follow-up updated 2026-11-14. This is a planning note, not an implemented protocol or an acceptance report. It addresses [L1–L10 and A1–A8](../prd.md). **Fact** describes inspected code; **Proposal** describes a required extension; **Confirmed decision** records the user's selected behavior.

**Confirmed decisions:** use an independent local daemon so QQ continues after desktop exit. Keep the M6 offline default: preserve canonical results and record never-attempted offline delivery as blocked; no automatic outbox/flush and no replay of accepted or unknown effects. QQ keys remain in the daemon's local process broker. GUI exit does not clear daemon memory; daemon restart requires re-entry unless an existing, proven OS-vault path is available. Magpie/ASR/TTS/codec and cloud work remain server-side for this task.

## 1. Recommended boundary

**Proposal:** keep the continuing Agent, State writer, participant policy, model purposes, canonical materials, delivery ledger and cloud execution on the server. Put both ordinary QQ adapters, their native connections, platform credentials and private upload/download references on the local host. Connect them through one authenticated, bounded, closed-purpose source bridge. Do not create a local CompanionRuntime/Core or a second conversation/delivery State database.

The useful seam is the purpose of the existing [QQDeliveryTransport.execute](../../../../apps/companion-service/src/qq-delivery.ts#L75), together with a scoped inbound material producer. Its current JavaScript arguments are **not** a network protocol: `check()`, `AbortSignal`, `AsyncIterable`, driver objects and `uploaded: unknown` cannot be serialized as authority or forwarded unchanged.

| Responsibility | Recommended owner | Existing evidence / implication |
|---|---|---|
| Agent identity, persona, scoped facts, admission, command dedup, work and delivery facts | Server | [service composition:568](../../../../apps/companion-service/src/service.ts#L568) installs one runtime and its State/provider owners. Local source operation must not instantiate this composition again. |
| Principal aliases, allowlists, member/admin rights, proactive decision and quota | Server | [M6 authority rules:35](../../../../.trellis/spec/backend/qq-platform-entry.md#L35); source events supply evidence, not a role. |
| QQ AppSecret/access token, OneBot access token, native gateway/reverse listener, platform upload references | Local host | Current [credential mutation:978](../../../../apps/companion-service/src/qq-controller.ts#L978) owns an in-process secret slot; [native ports](../../../../plugins/qq-official/src/ports.ts#L17) require host-owned authorization. These owners move, not their plaintext values. |
| Magpie foreground, participation judgment, ASR and TTS model sources/credentials | Server (confirmed for this task) | [composition:581](../../../../apps/companion-service/src/service.ts#L581) and [QQAudio consumers:343](../../../../apps/companion-service/src/qq-audio.ts#L343) already use server-owned purposes and private consumers. A QQ credential is not a model-provider key. |
| PCM decode, SILK encode and cloud JavaScript work | Server (confirmed for this task) | [codec runner:90](../../../../plugins/qq-media-codec/src/job.ts#L90) is a fixed Docker job; the PRD records the current Linux-amd64 codec constraint. Keeping it server-side avoids imposing an unselected Linux codec runtime on the Windows client. This is not evidence of a Windows codec. |
| Local plugin lifecycle, trust, permissions, Config/CAS and optional encrypted vault | Local existing host mechanisms | [desktop host:120](../../../../apps/desktop/src/main/desktop-host.ts#L120) already creates plugin-data/config owners and an optional encrypted CredentialBroker. Its presence does not mean QQ is already composed there. |

Both official QQ and OneBot v11 remain in scope, with text, image, voice and file input/output. No text-only bridge, OneBot-only shortcut, local fake codec, or server-hosted SnowLuma fallback satisfies this task.

## 2. What the SDK already provides—and what it does not

### Facts

- [RemoteRuntimeDriver:79](../../../../packages/host-kernel/src/runtime/remote-runtime.ts#L79) validates local executable/worker paths and uses `child_process.spawn` with IPC and pipes. “Remote” here means another **local process**, not another machine.
- [worker entry:13](../../../../packages/host-kernel/src/runtime/worker-entry.ts#L13) requires the local bootstrap and `process.send`. It does not authenticate a network host.
- [ControlTransport:15](../../../../packages/host-kernel/src/ipc/control-endpoint.ts#L15) is abstract enough to adapt; [ControlEndpoint:74](../../../../packages/host-kernel/src/ipc/control-endpoint.ts#L74) has bounded pending requests and a handler allowlist. The existing control JSON cap is [64 KiB](../../../../packages/contracts/src/json.ts#L28). [receive:265](../../../../packages/host-kernel/src/ipc/control-endpoint.ts#L265) enforces exact session/owner and monotonically ordered message IDs.
- [ControlEndpoint.close:484](../../../../packages/host-kernel/src/ipc/control-endpoint.ts#L484) resolves outbound requests as unavailable and aborts inbound handlers. It does **not** prove that an operation on another machine stopped or that a platform effect did not happen.
- [TaskMediaPeer:74](../../../../packages/host-kernel/src/tasks/media-peer.ts#L74) explicitly assumes lower-layer envelope provenance has already been checked. `signalFor(owner, taskId)` must resolve private, live authority; caller-supplied headers cannot grant it. It bounds streams, permits one reader, and returns credits as data is consumed.
- The shared byte budget is [256 KiB/chunk, eight unacknowledged chunks, 2 MiB buffered/stream](../../../../packages/contracts/src/media.ts#L14). [TaskMediaPeer.prepare:86](../../../../packages/host-kernel/src/tasks/media-peer.ts#L86) also bounds one peer to 64 live streams and one task to four. [FramedMediaPort:10](../../../../packages/host-kernel/src/ipc/media-port.ts#L10) frames an owned Duplex; its write callback and socket close are transport facts, not QQ receipts.
- Current [ASR media wiring:332](../../../../packages/companion-runtime/src/voice-providers.ts#L332) and [QQ transfer wiring:240](../../../../apps/companion-service/src/qq-media-transfer.ts#L240) connect two TaskMediaPeers in the same process through callbacks. They are useful algorithms and ownership examples, not an existing distributed bridge.

**Conclusion:** there is no inspected, ready-made authenticated cross-machine native-source bridge. Reuse the framing, credit, cancellation, validation and local task mechanisms, but add the missing network authentication, host/source epoch binding, fixed message vocabulary and remote-outcome semantics. Do not expose `runtime.invoke`, `host.api`, arbitrary capability calls, URLs, filesystem paths or shell commands over the network merely because ControlEndpoint can carry JSON.

## 3. Identity and authority across the boundary

### Required capture

**Proposal:** distinguish these identities rather than reusing one `connectionId` for all of them:

1. Server Agent identity and service epoch, plus the configured Agent endpoint/binding generation.
2. An owner-authorized local-host binding and a fresh daemon-process incarnation. A reported host name/ID is a correlation label, not proof of possession of a separate device credential; the first-version bearer option below does not claim device attestation.
3. The enrolled logical QQ source/account assignment, with local plugin `OwnerRef` generation, local source trust/permission epoch, config revision and credential version.
4. The authenticated bridge connection epoch.
5. The physical official gateway or OneBot peer connection ID.
6. The existing server input/material/task/delivery/part/attempt IDs and each side's actual supervised task identity.

The persisted [State epoch](../../../../plugins/state-sqlite/src/state.ts#L129) is not a process or bridge-session incarnation. A new authenticated connection needs its own fresh epoch even when the same Agent/State has restarted or reconnected.

The server accepts an account/source assertion only over an owner-authenticated bridge bound to that authorized host/source assignment. Equal plugin IDs, instance IDs, QQ account IDs or numeric generations on two machines are not equal authority. A package fingerprint reported over the link is useful captured metadata; it is not remote OS attestation. The trusted local host remains responsible for its real PluginManager/trust/PermissionKernel checks.

Prefer one active captured assignment per logical source/account. A replacement host, Agent endpoint, credential target or native connection must retire the previous assignment; it must not inherit its pending operations. Both supported protocols can still operate through their ordinary sources.

Preserve canonical native-event dedup across reconnects/restarts for the same account/event. A new bridge epoch is not permission to mint a new input ID for an old event. An inbound ACK lost after server commit is resolved by the existing State duplicate check, without another model call or material preparation. Nonunique file notices stay observations. Switching Agent must not replay buffered old events into the replacement Agent.

### Two separate authority lifetimes

**Fact:** [RuntimeInputGrant:21](../../../../packages/companion-runtime/src/input-authority.ts#L21) is already a private role/origin/signal/check object. [captureInputGrant:96](../../../../packages/companion-runtime/src/input-authority.ts#L96) validates and captures it, and [terminal events:36](../../../../packages/companion-runtime/src/input-authority.ts#L36) retain it without putting it in JSON. [QQ participant authority:397](../../../../apps/companion-service/src/qq-controller.ts#L397) currently comes from a server-local QQ feature lease; [native source capture:143](../../../../apps/companion-service/src/qq-controller.ts#L143) has a different physical connection signal.

**Proposal:** preserve that separation:

- **Server actor/work authority:** derived on the server from authenticated source evidence and current canonical participant policy. Native nickname, quoted author, QQ group rank, machine/self flags or a transmitted `role` never become authorization. The server issues the private Runtime grant; it is never reconstructed by trusting a JSON grant from the client.
- **Local native-operation authority:** the local source's actual trust, permissions, endpoint/account/config/key/native-connection capture, plus a fresh server authorization for the exact claimed operation. Its callback and signal are local objects, not a function serialized from the server.

Register the pending server admission under its captured policy check **before** the first fallible State write, retaining the [current ingress handoff ordering](../../../../apps/companion-service/src/qq-ingress.ts#L276). A bridge receive buffer or an event ID is not an input admission. Server State keeps claim, queue quotas, duplicate fingerprints and model-slot admission authoritative.

After complete verified bytes have become server-owned material and the input/work has been accepted, a socket loss or local adapter shutdown must not become an automatic cancellation of that server work. Explicit server participant/task authorization withdrawal remains effective. Local trust/source/credential retirement blocks new local IO and cannot resurrect an old local grant after deny→restore. The design must make **source availability** distinct from a deliberate server-side withdrawal of an accepted delegation; one generic `online` signal cannot express both.

### Partition limit

A server cannot instantly revoke already-dispatched native IO through a partition. Authentication does not solve this. Use a bounded dispatch authorization, current local checks immediately before native invocation, and acknowledged retirement where available. Expiry prevents **new** local dispatch under an old authorization; it does not undo a request already accepted by QQ or prove cancellation of an in-flight request. Define the clock/skew or round-trip/monotonic-time rule explicitly before implementing expiry. Never claim strong distributed revocation or `cleanup: settled` from a timeout.

Deny→restore must be sticky for every captured authority that actually observes withdrawal. Reconnection creates a new bridge epoch; it does not restore old execution rights. Captured numeric epochs need authentication and comparison with owned state, not trust in a caller's advertised “latest” number.

## 4. Minimal fixed protocol surface (proposal, not existing methods)

The following are **message families to design**, not callable SDK services that already exist:

| Message family | Minimal purpose and constraints |
|---|---|
| Bind and source status | Authenticate the owner's bridge for the selected Agent and bind the authorized local daemon/source assignment with exact account/host/process/connection epochs. Report local saved/applied/connected/cleanup separately. Binding is an owner action, not a message sender's capability or mandatory device-key enrollment. |
| Native event offer | Bounded, validated protocol evidence: event/native message identity, exact scene/target/sender, authored text, mention/self/machine evidence, quote evidence and material descriptors. No role claim, platform token, presigned URL, `file_info`, or private path. Server derives the canonical namespace and applies policy. |
| Accepted material transfer | Bind a specific input/material selection and direction to an existing supervised operation on both ends. Transfer bytes only after server policy/admission permits it. Reuse the same task while preparing, rather than spawning another ticket or per-actor registry. |
| Execute a claimed delivery attempt | Exact existing delivery/part/attempt ID, operation, immutable plan/content digest, route/native reference and captured source binding. Include a bounded authorization lifetime. No arbitrary native action name supplied by a model or renderer. |
| Progress/result/cleanup report | Report bridge receipt, possible/observed native dispatch, real native receipt and cleanup as distinct facts. A transport ACK, hash, local intent ID or successful upload alone cannot substitute for a message receipt. |
| Cancel/retire and outcome inspection | Cancel only that captured operation/binding; join actual local tasks. Outcome inspection is read-only. It must never replay a command while trying to discover its result. |

The authenticated bridge transport and source-binding handshake are new work, but a new device credential system is not automatically required. The current [Desktop connection binding:281](../../../../apps/desktop/src/main/companion-client-controller.ts#L281) and [retirement:1132](../../../../apps/desktop/src/main/companion-client-controller.ts#L1132) provide useful endpoint/generation/secret fences; its HTTP client connection is not itself a server push grant over local device resources. Keep Agent authentication separate from QQ platform and model-provider credentials. Do not expose the Agent bearer to QQ plugins or treat possession of a QQ key as bridge authorization.

### First version: existing Agent bearer can authenticate the trusted daemon

**Fact:** the inspected [server authenticator:170](../../../../apps/companion-service/src/server.ts#L170) checks one configured bearer, and [API dispatch:363](../../../../apps/companion-service/src/server.ts#L363) applies that authority to management APIs. It does not implement device-scoped credentials or cryptographically distinct host identities.

**Proposal:** the first version may reuse that existing Agent bearer in the trusted daemon's private connection owner. This is sufficient for the selected single-owner, bounded-host deployment, provided the design accepts that the daemon is within the same owner trust boundary as Desktop Main. A new device certificate, PKI, pairing-key hierarchy or per-event ticket registry is not a prerequisite.

What remains **required**, even with the shared bearer:

- Authenticate the daemon's fixed bridge connection over an authenticated, confidentiality-protected network transport; retain the bearer privately, not in URLs, public status, State, plugin payloads or media frames. Binding the byteplane to that same connection/operation is mandatory. Local test transport exceptions must be explicit.
- Authorize and capture one active host/source/account assignment, fresh daemon/bridge/native epochs, the chosen Agent endpoint/identity, and exact task/material/delivery-attempt associations. Validate the existing server claim before native dispatch. A random host ID, request ID or bearer-authenticated JSON role still grants no participant authority.
- Reject an automatic takeover of an active binding. An explicit owner rebind uses the captured assignment revision and retirement rules; it cannot reopen old accepted/unknown attempts. All sticky revocation, bounded expiry, actual cleanup and late-fact rules above still apply.

The limitation is deliberate: every holder of the same bearer has owner-level server authority. Host IDs and a closed bridge handler list cannot turn that bearer into a least-privilege device credential or prove which physical device holds it. Ordinary binding/source disable and sticky retirement remain available with the shared bearer. If independent **credential** revocation, containment of a compromised daemon apart from Main's administrative power, or mutually untrusted hosts becomes a requirement, a separately scoped host credential becomes necessary. That can be a bounded server-issued token owned by existing Config/credential mechanisms; it still does not require a new PKI or an unbounded ticket service.

### Independent connections to the same Agent

Desktop Main may retain its existing admin HTTP/SSE and M4/M5 client paths while the daemon maintains a separate QQ bridge to the **same Agent**. No full client proxy rewrite is required. Their transport connection IDs are intentionally different; compare the captured endpoint, canonical Agent identity and configuration/assignment revisions instead. A deliberate target change must fence affected old operations; an old GUI response must not change the daemon's newer binding.

The daemon owns its own Agent-authentication lifetime. [Main's current connection:583](../../../../apps/desktop/src/main/companion-client-controller.ts#L583) retains the bearer in the connection object, and its retirement clears that value and aborts Main-owned work. The daemon must not borrow that abort signal, callback lifetime or secret lease. An explicit local configuration action can supply the existing bearer value to the daemon's private broker; this is reuse of owner credentials, not reuse of Main's live connection. GUI exit/restart neither stops the daemon host nor clears its QQ/Agent process slots. A restarted GUI reads sanitized daemon status through the fixed local management boundary; it does not silently replace the daemon's target from an old saved UI value.

A fixed handler allowlist, sequential connection messages and existing attempt IDs can reject replay without an unbounded per-event ticket database. Any local correlation retained for IO should belong to the existing bounded source/task holder and include the actual local TaskHandle. Closed entries may be discarded only when the retired connection/sequence rules make replay impossible. A new local process must not accept old-incarnation commands.

## 5. Bytes and private references

### Scope-preserving pipeline

**Confirmed placement; proposed bridge:** daemon-local protocol IO → authenticated byteplane → server material/codec/ASR → server State/Core/cloud worker → server material/codec/TTS → authenticated byteplane → daemon-local protocol IO.

- Text uses the bounded control plane; oversized semantic replies retain their exact server-side text document. The explanation stub in `message.text` is not the text to synthesize or deliver.
- Images cross as actual bytes, are validated and stored server-side, and reach the selected model's real image path. A filename or a local path is not visual input.
- Files cross as bounded bytes and become the existing scoped material references. [readWorkMaterial:1049](../../../../packages/companion-runtime/src/runtime.ts#L1049) must continue checking the actual server worker handle/task ID and selection. Once material is server-ready, cloud work does not fetch a host path from the local machine.
- Encoded voice crosses to the server. [QQAudio.transcribe:343](../../../../apps/companion-service/src/qq-audio.ts#L343) already composes private ASR and codec consumers and enforces the 120-second/six-span contract. Authored ASR remains authored input; quoted ASR remains a current-input notice, not a memory cue.
- After known mandatory text acceptance, [QQAudio.exportVoice:599](../../../../apps/companion-service/src/qq-audio.ts#L599) can retain server-side TTS and actual PCM→Tencent SILK encoding. Only the encoded bytes need travel back. Keep the independent foreground/judgment/ASR/TTS provider credentials and their current ownership; moving QQ adapters does not move Magpie keys.
- Use the existing private `withAsrConsumer`/`withTtsConsumer` seams. Do not feed QQ content through public owner capture/speech APIs: the public [speech admission:293](../../../../apps/companion-service/src/speech-controller.ts#L293) deliberately restricts owner-private output, while the private [TTS consumer:392](../../../../apps/companion-service/src/speech-controller.ts#L392) supports the authorized internal use.

**Important current limitation:** [QQMediaTransfer.pull:212](../../../../apps/companion-service/src/qq-media-transfer.ts#L212) still combines source/native connection signals with the consumer, and [prepareInput:525](../../../../apps/companion-service/src/qq-media-transfer.ts#L525) performs a final `original.check()`. Remote preparation must establish a precise handoff: once the server owns verified complete bytes and the download actually joined, later server decode/ASR/material use depends on the server actor/material authority, not a disconnected local protocol socket. Merely replacing `source.driver` with a socket proxy leaves the old lifetime coupling intact.

**Additional scope check:** the current [prepareInput guard:495](../../../../apps/companion-service/src/qq-media-transfer.ts#L495) and [voice admission guard:365](../../../../apps/companion-service/src/qq-audio.ts#L365) explicitly require `origin.kind === 'qq'`; proactive admission uses `qq-proactive`. These private seams cannot simply be called remote-ready for proactive media. The design must verify the intended proactive media path using the original captured candidate authority and canonical evidence, without assigning a role from public origin fields. Test it explicitly before claiming L4 coverage; do not quietly remove media from proactive participation to make the bridge simpler.

### Reuse the byte mechanisms without trusting wire ownership

TaskMediaPeer's limits are flow-control limits, not the material size limit. Preserve [four parts, 8 MiB images, 32 MiB file/aggregate input, two preparations, 128 MiB staging and 64 KiB full text](../../../../packages/contracts/src/companion-material.ts#L15). Charge actual retained buffers/staging at both endpoints; explicitly state how aggregate reservations work across the two machines. Do not multiply storage by an unbounded number of remote peers or count a network ACK as bytes consumed by the owned sink.

Each side has its own real owner/task identity. A bridge adapter must map an authenticated operation/stream association to that side's existing live task and private signal. It may translate correlation headers at the transport boundary; it may not create a kernel owner or borrow a task by trusting `StreamHeader.owner/taskId`. Hash, total-byte count, sequence, range and descriptor checks remain mandatory. A stream close and an actual native reader/codec join are separate completion conditions.

The new server↔host link must not use JSON/base64 material bodies. This does not rewrite platform wire protocols: local [official inline upload](../../../../plugins/qq-official/src/media-types.ts#L16) uses the platform's `file_data` encoding, and local [SnowLuma media framing:161](../../../../plugins/qq-onebot/src/media-wire.ts#L161) contains its own native base64 chunk representation. Those conversions stay inside the local native adapter; they are not the bridge byteplane or canonical State.

### Keep native upload/download authority local

[Official media ports:23](../../../../plugins/qq-official/src/media-types.ts#L23) register provider presigned part URLs locally. [SnowStagedMedia:33](../../../../plugins/qq-onebot/src/media-types.ts#L33) retains a private remote path. Current [QQDeliveryOutcome.uploaded](../../../../apps/companion-service/src/qq-delivery.ts#L55) holds either private object in the service process. That field must not go on the remote wire.

**Proposal:** when a pure upload needs a subsequent send, the local task/source holder keeps the real object and exposes only a bounded opaque continuation reference. Bind it to the authenticated Agent/host incarnation/source/native connection, exact route, delivery/part, original upload attempt, permitted follow-up send attempt, and content hash/size. The reference alone grants nothing. The server must still claim the send attempt before asking the local host to redeem it. Retire it on binding change; never turn it into an arbitrary file/path reader. OneBot file `upload-and-send` remains one publication, not a continuation followed by a second send.

Incoming signed download references need the same treatment: the local native event holder retains the locator. The server receives bounded descriptors and requests only the selected part of that exact authorized event. It must not receive a presigned URL and become a generic downloader.

## 6. Once-only dispatch, unknown outcomes and recovery

**Facts:** [sender attempt:486](../../../../apps/companion-service/src/qq-delivery.ts#L486) calls State's claim before transport execution. [State attempt validation:69](../../../../plugins/state-sqlite/src/deliveries.ts#L69) prevents duplicate/reset transitions, and [recovery:567](../../../../plugins/state-sqlite/src/deliveries.ts#L567) records in-flight effects as unknown without replaying them. [sender preparation:431](../../../../apps/companion-service/src/qq-delivery.ts#L431) blocks unconfirmed input cleanup and captures a source. The drivers enforce the expected physical connection: [official:353](../../../../plugins/qq-official/src/driver.ts#L353), [OneBot:234](../../../../plugins/qq-onebot/src/driver.ts#L234).

**Proposed sequence:**

1. Server freezes canonical output/route/content and captures the registered local source binding. Local readiness or optional byte staging is not publication authority.
2. Server atomically claims the existing delivery attempt and passive quota/sequence in the only State writer.
3. Only then may a bounded execution authorization leave for that captured local host/source. Local verification binds it to one supervised native operation and one allowed operation kind.
4. Local rechecks current trust/config/key/native connection and authorization expiry immediately before native IO. Progress distinguishes receipt of the bridge command from real native dispatch.
5. Server records actual native receipts and cleanup independently. Recording a late historical fact is not permission to perform another operation.
6. Retire the operation's resources only on actual local join. Source replacement cannot silently inherit an unresolved operation.

| Interruption point | Required fact / action |
|---|---|
| Before server claim, or before the local task callback ever starts with a conclusive rejection | No native effect. Preserve the observed refusal; no fabricated preparing row or successful delivery. |
| Claim exists; command delivery/ACK is uncertain | Effect is unknown unless there is positive proof of no native dispatch. Do not resend on a new socket. |
| Local confirms native dispatch; platform response is missing | Unknown effect, separate pending/unknown cleanup. A transport timeout is not rejection by QQ. |
| A valid platform receipt is known; link/source retirement or cleanup later fails | Keep that receipt/acceptance fact. Stop later parts and optional voice as required; report cleanup uncertainty separately. |
| Bridge reconnects while the same local process still owns the old operation | Read-only, identity-matched outcome reconciliation may report the old fact. No execution rights are restored by this channel. |
| Local process restarts and the private operation/handle was lost | New incarnation; old operation remains unknown when no durable evidence exists. Do not recreate or resend it. A new boot ID by itself is not proof that every old native process/IO was cleaned up. |
| Local host stops after cloud work has accepted server-ready inputs | Join/cancel local-required work; allow original server-authorized cloud work to finish. Delivery is unavailable under the selected offline policy, not retargeted to a replacement host/account. |

Two concrete adaptations are necessary:

- The current [sender exception path:566](../../../../apps/companion-service/src/qq-delivery.ts#L566) synthesizes `cleanup: 'settled'` after a local invocation throws. That relies on the local transport contract. A remote adapter must return an explicit unknown-cleanup outcome on lost communication, preserving any already-known native receipt. Neither `ControlEndpoint.close()` nor a network request promise settling proves local native cleanup.
- The current State writer freezes most fields of a settled attempt. If same-incarnation reconnect must merge late, authenticated receipt evidence after the server classified an attempt unknown, design a narrow monotonic evidence-enrichment path for the **same claimed attempt/binding/content**. It must not reopen the attempt or allocate another send. Without that reviewed extension, retain conservative unknown; do not pretend existing `updateDelivery` already supports arbitrary reconciliation.

Persist the captured execution target/binding and plan digest with the existing delivery/attempt truth before execution. The current public QQ account/route cannot identify a remote host incarnation. The exact private storage representation and any cold migration need design review; do not smuggle private handles into public `QQDeliveryView`, or create a parallel local delivery ledger. A legacy record with no remote binding must mean the explicit existing service-local strategy, never “use whichever host is online now.”

A bounded in-memory outcome record may survive a link reconnect while its original local owner is alive. This is not an unbounded offline command outbox. A crash without durable outcome evidence remains unknown. A new retry API, durable local receipt journal or automatic offline flush is additional product scope, not an implied property of this bridge.

## 7. Required private seams and compatibility

| Existing seam | Required change / reuse |
|---|---|
| [CapturedQqSourceBase / CapturedQqSource](../../../../apps/companion-service/src/qq-controller.ts#L138) | Separate a server-owned registered-source capture from a local concrete driver capture. Keep checks/signals private on each side; add authenticated host/source/native epochs to bridge routing. Do not serialize concrete drivers. |
| [QQIngress.launch / admission](../../../../apps/companion-service/src/qq-ingress.ts#L276) | Retain one server tracked admission through policy, create, preparation and handoff. Replace the media provider/source evidence boundary; do not run a second local admission writer. |
| [QQMediaTransfer.prepareInput](../../../../apps/companion-service/src/qq-media-transfer.ts#L483) and its driver-based capture | Factor the finite authorized material-pull interface so server preparation can consume a registered remote producer. Separate completed byte custody from transport liveness. Preserve quote flags and actual ASR notes. |
| [HostMaterialStore.withMaterial](../../../../apps/companion-service/src/material-store.ts#L238), Runtime work reader and reply resolver | Keep server ACL/ready/hash/real-file checks. Export authorized bytes through the bridge; never export `storageKey` or artifact paths as local filesystem authority. |
| [QQDeliverySource / Request / Outcome](../../../../apps/companion-service/src/qq-delivery.ts#L49) | Add a remote source implementation with fixed operations, private continuation references, target pinning and explicit remote-disconnect uncertainty. Preserve the existing service-local implementation as an explicit strategy. |
| [sourceFor(account)](../../../../apps/companion-service/src/qq-controller.ts#L800) | Currently selects a local in-process driver by protocol/account. Remote attempts must use the captured enrolled assignment, not a later lookup that can select a replacement host. |
| [Config/credential mutation](../../../../apps/companion-service/src/qq-controller.ts#L978) and [current server composition](../../../../apps/companion-service/src/service.ts#L596) | Split local source configuration/credentials/lifecycle from server policy/judgment controls. Existing server QQ credential endpoints cannot transparently proxy secrets “through the server” and still satisfy local ownership. |
| Desktop local host / shared composition | Preserve the existing [no second Agent source restriction](../../../../apps/desktop/src/main/shared-composition-policy.ts#L4). Local QQ factory/private-port composition is new work; merely enabling the generic plugin default does not supply the required native ports. |

Compatibility must be deliberate: preserve known local service-source identities/commands/receipts, keep old unknown effects non-replayable, and make deployment mode and configuration owner visible. Do not silently reinterpret old server protocol settings as local settings or automatically copy old QQ secrets to another machine.

## 8. Minimum proofs before the actual-account trial

These are planned gates, not executed results of this research.

1. **Two real process/machine boundaries:** one server State/Core, one local source host, no shared material path. Controlled official and OneBot peers authenticate at the local host. Assert the same Agent ID, no local Core/State writer and no generic remote `runtime.invoke` route.
2. **Secret and source separation:** canary platform secrets, official presigned URLs/`file_info`, and Snow remote paths remain local. Scan server Config/State/events/model input and bridge control captures. A registered host cannot claim another account/host generation; nickname/quoted “owner” gives no role.
3. **Atomic inbound handoff:** hold actual server `createInput` completion, deny then restore policy, and assert sticky refusal/zero primary dispatch. A never-started local/server callback creates no ghost input. Media early receipts do not hold the native heartbeat consumer.
4. **All four media on both protocols:** real byte/hash validation for text document, image, encoded voice and a 32 MiB file; actual server codec and synthetic ASR/TTS providers. Verify authored versus quoted transcript separation, worker input bytes and protected result attachment bytes. Platform-required encoding occurs only at the local edge.
5. **Backpressure and bounds:** stalled receiver, duplicate/out-of-order chunks, wrong hash/length, unregistered stream, wrong owner/task mapping and over-budget concurrency fail explicitly; in-flight buffers stay bounded. Cancellation joins each owned stream/native/codec task rather than merely resolving a control request.
6. **Completed-byte independence:** disconnect after server bytes/hash and download settlement but before ASR/Core/work completion. With the server actor grant still valid, complete the intended remote processing. Disconnect before complete bytes instead leaves failed/unknown preparation and zero false-ready input.
7. **At-most-once native effect:** sever before claim, after claim/before local ACK, after native dispatch, after known receipt/before cleanup, and after cleanup/before server ACK. Reconnect repeatedly and restart the local host. Assert actual native call counts, preserved receipts, separate cleanup and zero automatic resends of unknown/accepted attempts.
8. **Lease/partition honesty:** revoke server policy or local trust/config/account/Agent binding around dispatch. Old captures never gain replacement authority. During a partition verify the declared bounded authorization behavior and expiration; do not assert immediate remote revocation of already-started IO.
9. **Text/voice ordering:** exact long Unicode/CRLF text and required file acceptance precede optional TTS. Pure upload or a transfer ID does not pass the text gate. Voice failure retains accepted text; unknown text suppresses later media.
10. **GUI exit versus daemon stop and cloud work:** hide a pet view, exit/restart Desktop Main, stop the daemon, disable/remove a QQ source and lose a socket as distinct events. QQ continues across GUI exit without clearing daemon credentials or replacing native connections. Main admin HTTP/SSE and daemon bridge independently confirm the same Agent; a stale GUI target/save result cannot retarget the daemon. Explicit daemon/source stop joins owned native cleanup; an unconfirmed old source blocks safe replacement. Accepted cloud work still finishes under its original audience/permissions; unavailable local delivery does not choose another host/account.
11. **Legacy mode and migration:** existing service-local fixtures still exercise their explicit strategy. Old fingerprints and unknown outcomes remain preserved; missing new host-binding fields cannot activate a remote sender.

## 9. Confirmed scope and first-version defaults (2026-11-14)

- **Independent daemon:** selected by the user. Desktop exit/restart does not end QQ operation. Explicit daemon shutdown is a separate lifecycle action and still must join its owned work.
- **Offline delivery:** retain M6 behavior. Canonical server results remain; a never-attempted reply with no local source is blocked. There is no automatic outbox or reconnect flush. Accepted and unknown effects are never replayed.
- **Credentials:** QQ keys stay in the daemon's process broker; GUI exit does not clear them. Daemon restart requires key re-entry unless an existing OS-vault path is actually demonstrated. Do not add plaintext persistence/synchronization or imply that an optional vault in the desktop baseline is already available to the daemon. The same ownership rule applies to the daemon's private Agent-bearer copy: no restart persistence is assumed.
- **Compute:** existing Magpie purposes, ASR/TTS, codec and cloud work stay server-side. Platform IO and platform secrets are local. Local codec/model execution is not part of this first version.
- **Bridge authentication:** reusing the owner's existing Agent bearer is a viable first version within the trusted single-owner daemon boundary, with the mandatory bounded host/source/task/target capture in section 4. Independent device credentials remain an optional separation mechanism unless the product requires narrower authority or independent credential revocation; no new PKI is implied.

No source, test, lockfile, runtime process, SnowLuma installation, original4120 data, real QQ account or paid model was changed or exercised for this note.
