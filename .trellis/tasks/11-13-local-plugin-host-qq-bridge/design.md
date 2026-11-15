# Independent local plugin host and remote QQ bridge

Planning design, not implemented behavior. Product requirements are [the PRD](prd.md); code evidence is in [local host](research/local-host.md), [remote authority/media](research/remote-authority-media.md), [transport primitives](research/transport-reuse.md) and [desktop delivery](research/desktop-ux-delivery.md). Baseline: M6 work through `6897787`.

## 1. Selected ownership and execution shape

The user selected an **independent local host**: exiting the desktop GUI does not stop QQ. Closing a pet view, quitting the GUI and stopping the local host are three different actions. Explicit host stop must work even when the Agent is unreachable and must await actual native cleanup. No automatic OS-start installation is included in the first preview.

| Owner | Responsibility |
| --- | --- |
| Server Agent | One identity/persona, participant policy and grants, State, observations/facts, model purposes, canonical material, cloud work and immutable delivery claims/facts |
| Independent local host | Existing kernel/plugin lifecycle and source permissions, local QQ Config/CAS and secrets, both protocol drivers/native IO, private platform references, bounded native staging and actual effect/cleanup observations |
| Desktop GUI/Main | Existing personal client/capture/playback and presentation, plus trusted local-host management and source forms; no local Core or conversation State |
| External local SnowLuma | QQ login and OneBot transport; installed/configured by the operator, not bundled or logged in by this product |

Foreground/judgment/ASR/TTS/codec and cloud execution stay in their existing server roles for this increment. This does not move platform secrets to the server. Authorized message/material bytes necessarily reach the selected server model/work paths; local hosting is not a promise that all conversation content stays on the PC. Windows does not need a new local Docker codec just to use QQ.

## 2. Reuse, composition and process lifetime

### Kernel composition

Use the same contracts, PluginManager, ConfigService, permission/credential/task/media machinery. Do not start CompanionRuntime, Cortico or SQLite State in the local host.

The baseline technical path is a core-less, fixed-source composition of the existing in-process `CompanionPluginHost` machinery, with the reviewed QQ factories supplied their private ports. It must explicitly reuse local user trust/preset/config semantics rather than inherit the service's unconditional initial trust. A narrow shared helper or local composition option may be lifted from DesktopHost; another plugin standard or a duplicate permissions framework is not allowed.

This is **not** merely adding QQ to DesktopHost discovery: the default QQ exports deliberately return not-ready, and the current runtime worker only receives serialized host methods. Private callbacks/sockets/iterators cannot be sent to that worker. Gate0 must prove the chosen native composition with both factories and real kernel permissions before broad implementation. Unknown/user JS remains subject to the existing worker/trust boundary; it is not admitted to the trusted in-process QQ composition automatically.

Extract the portable QQ native/source plumbing from the service into one shared package where needed. Keep its purpose-bound endpoints, redaction, source/key capture, DNS pinning, media router and actual joins. The service's existing local-source mode can call the same implementation; do not copy it into the desktop.

### Independent process

Build a separate headless-local-host entry using the packaged runtime. An Electron host mode is the initial packaging path so the existing local runtime/native-security environment can be reused without a browser window. The GUI attaches to an existing compatible host or starts that exact bundled executable/entry with fixed arguments; it accepts no renderer-supplied command/path.

Use a single-instance ownership lock per host profile, separate from the GUI lock. Discovery/management information is placed in a private same-user profile directory and includes host identity, fresh boot identity, protocol/package version and a scoped management endpoint. A PID or an unauthenticated localhost response alone is not proof of ownership. Attach, stop and upgrade must check the captured host boot/version and wait for real settlement. A failed disposer remains pending_restart; a new host/source cannot silently replace it.

The local management plane is native-only and closed-purpose. Authenticate attach with a fresh per-boot management capability in a protected same-user rendezvous record; it contains no Agent bearer or QQ credential. Main reads it natively, checks the captured boot/protocol/package and uses only the fixed private endpoint. The capability is never projected or accepted from a renderer-supplied URL, and is retired with that host. Fail closed if the local record/endpoint cannot be protected; SensitivePeer alone is not peer authentication.

Main retains exact frame/role/arity checks. The same user's trusted GUI can inspect host status, manage local Config/trust/keys, bind the Agent and stop the host. No CORS/browser-accessible general command server is introduced. Reuse bounded control framing and the existing dedicated sensitive-pipe discipline for entered secrets, mapping each sensitive reference to a real daemon task. Agent/QQ values do not enter ordinary plugin control JSON, discovery records, snapshots or logs.

The Agent-link token and QQ keys are owned by the daemon's broker/lifetime after an explicit user handoff. They outlive GUI exit. Keep the current temporary-key semantics for QQ: daemon restart requires keys again unless an explicitly verified existing secure-vault path is selected; no plaintext key persistence or credential import is added. GUI and daemon failures must say whether Config is saved, a key is present, a source is applied and a link is actually live.

## 3. Two Agent connections, one Agent

Keep the existing DesktopCompanionController's management HTTP/SSE and M4/M5 behavior. The daemon has a separate, narrow QQ-host connection. These serve different purposes and do not create two Agents, two State writers or two business snapshot owners.

Both target the same explicitly selected normalized origin, Agent ID and State epoch. Local host status is its own local projection; the personal business snapshot stays with Main's existing reader. On GUI reopen, attach the same daemon and show its binding. The GUI's previous process-only management token may need re-entry as before; that must not clear the daemon's token or disconnect QQ.

Switching the GUI to another Agent does not retarget the daemon. An explicit daemon rebind uses the current GUI/daemon expected revisions and captured identities, retires old device operations before replacement and clears target-bound credentials as appropriate. Old input/native-reference/command/result buffers are never forwarded to the new Agent. Cloud work already accepted by the old Agent remains there.

## 4. Network bridge and authentication

Add a dedicated authenticated host upgrade at the existing Agent origin, plus bounded owner management/status routes. Endpoint names below are proposed contracts to declare once in code, not existing SDK methods:

| Plane | Closed purpose |
| --- | --- |
| Owner HTTP host selection | Read/configure the selected local host and source assignments using the existing owner bearer and CAS |
| Daemon bridge upgrade | Authenticate the existing Agent bearer, verify the expected Agent identity, negotiate protocol/version and bind a fresh connection/host-boot context |
| Source registration/status | Offer only known QQ protocol/source/account identities and actual local source/native-peer generations; cannot grant participant roles |
| Input offer/admission | Transfer authored text, separate quote evidence and safe material descriptors with real native basis; server derives canonical identity and authorization |
| Material control/bytes | Request only the current authorized candidate/input/material or frozen output part, with actual stream/task ownership, sequence, credits, size/hash and cancellation |
| Claimed delivery execution | Execute only the server's already-claimed exact plan/part/operation under the captured source and current local permission |
| Outcome/status reconciliation | Report actual native facts or inspect the same operation; never re-open a business effect |

V1 reuses the operator's existing bearer rather than introducing PKI or a new permanent device credential registry. The daemon is within the same trusted-owner boundary as Main. **This bearer is still owner-level; hostId is correlation/binding, not independent device authentication.** Do not advertise per-device credential isolation/revocation against a compromised owner daemon. A dedicated scoped-device credential is separate future work if that trust model changes.

Use the protected configured channel (HTTPS/WSS or an explicitly configured loopback/SSH path), header-only credentials, no redirects and no token URLs. One active selected local host and one instance of each QQ protocol are the first preview scope; no automatic multi-device availability routing or takeover. Source assignment changes are explicit and bound to the existing Config/policy owners.

After authentication, capture host ID, host boot, bridge session, approved source/account, local plugin/config/permission/key generation and exact native connection. Neither an OwnerRef nor a task ID received in JSON grants authority. Each endpoint maps authorized messages into its own actual tasks/signals. Reuse ControlEndpoint/TaskMediaPeer where suitable with **static handler tables**, never expose runtime.invoke, arbitrary HTTP, filesystem paths, commands or capability names.

Retain the shared64KiB control and256KiB media-chunk limits and credit8 flow. Limit active material preparations to2 and live bridge media streams to4, with explicit per-endpoint staging budgets no larger than the current128MiB. Bound input/operation records and JSON/frame queues; cancellation and protocol failure release only resources whose real settlement is observed. No unbounded concat, generic retry loop or offline outbox.

## 5. Canonical input and material custody

The local mapper keeps native credentials, CDN/authenticated references and raw segment private paths. Across the bridge send only safe identity/text/quote fields, metadata and scoped opaque local references. Opaque references are not grants: bind them to the captured Agent/host/session/source/native peer, event, index and purpose.

The server recomputes/validates the canonical event identity and applies the existing private/group/principal/policy rules. Nicknames, group role fields and a local host's advertised role do not authorize owner/admin actions. Keep the stable native event/intent independent of host boot, bridge connection, ephemeral reference and host observed-at time; the existing duplicate fingerprint must not change on reconnect.

Track the input under its actual server grant before the first State await, as M6 now does. Only an authorized preparation requests bytes from the exact local event/source. The local task separately checks its real local trust/source/key and remote operation scope. Unauthorized/duplicate events do not trigger download, ASR or inference.

Define an explicit **server-owned raw staging custody cut before codec/ASR**, not after final voice metadata or transcription. First complete every required part's actual local native read/reader join, bounded stream EOF, byte/hash verification and owned server staging commit, while the original server actor/candidate authority remains valid. A lost bridge or an advertised byte count is not EOF. Use a private verified custody proof, not a JSON ready flag; a source-only postflight failure cannot erase that positive committed fact.

After that cut, retain the preparing input and run server decode/ASR/canonical material creation under the same original server actor/candidate authority and server task lifetime. Do not carry the old local socket/signal or call originalSource.check() through codec/ASR or at the final preparation return. This is not promotion to owner authority. Server participant revocation/cancellation still aborts processing, and source/native cleanup remains separately truthful.

Raw verified staging is **not yet a ready MaterialRef**: duration/format and final metadata may still require decode, and no model/worker receives a premature ready reference. Publish ready materials/input only after that processing succeeds. G0/G4 must cut the bridge after raw custody but before decode/ASR, prove processing continues without another local download, and separately prove a server actor withdrawal still stops it.

Preserve observations as data. Identity-less OneBot group-file notices remain bounded non-action resources with native file evidence; later authorized work can request a fresh same-account/group lookup. Do not treat a remote path as a host file or invent an event ID. A ready canonical material is reused without a new native download. Quoted transcription is a separate current-input note, not authored memory text.

Fix the identified proactive-media boundary while generalizing this seam: current prepareInput/QQAudio direct-kind checks do not naturally accept qq-proactive. Introduce a host-private candidate authority tied to the exact original observation/actor/server policy, with reply-only rights. Do not put a fake actor/role into public proactive metadata or drop selected media. Judge and proactive quotas remain authoritative server SQL before any paid intent.

## 6. Frozen delivery and local native effects

Keep server multisay/full origins, semantic full-text documents, State quotas/sequence reservations and text-before-voice behavior. A new work-result delivery may select the currently authorized logical source when first prepared; an already frozen delivery/claimed attempt cannot retarget after reconnect/account/host replacement.

Before native IO, State owns the immutable plan and claim. Persist a **private execution binding** for remote deliveries: exact authenticated host/boot/bridge/source/native peer and plan identity. It is evidence/selection, not a serialized grant. It must be part of the remote intent and immutable across retries. On the first positive per-request authority check, bind the actual local kernel task reference once to that existing claimed attempt before returning permission to start IO; later checks, outcomes and cleanup evidence must match it. This adds no second job table and cannot mutate the frozen route/plan. Legacy service-local deliveries retain their old absent-binding fingerprint and are not inferred to be remote.

This persistence/enrichment changes State's private durable contract: use an explicit stopped full-root **format3→4** migration (older supported migrations compose to4). Preserve legacy IDs, commands/fingerprints, audiences, tasks, facts and receipts; legacy bindings remain service-local. No live schema patch and no historical input/send/voice replay. Original4120 is not migrated by development.

Only after the claim and local preflight may a local operation consume the plan. Local native source/key/permission checks remain independent of the server participant grant. Classify the purpose at the native boundary: source connect/auth/heartbeat obey local consent; content lookup/download requires the current input/candidate/material authority; upload/publication requires the claimed delivery authority. Closing already-owned readers, sockets or native staging is cleanup-only and must not require a live Agent check or grant new business IO. If local credential/permission withdrawal prevents required cleanup, report that failure rather than reacquiring authority. Before each external QQ upload/publication request, perform a fresh bounded server check for the exact claimed attempt, route/part/content hash and current authenticated bridge. Content retrieval uses the corresponding tracked input/candidate/material preparation scope from §5, not an invented delivery claim; it follows the same fresh-check rule for its own exact request. Reject a check that takes over5seconds from the local request or exceeds the server's remaining eligibility/claim budget; do not cache an authorization for later native calls. Local checks also remain at chunk boundaries. Cancel on observed retirement. Gate0 must demonstrate that a lost/delayed check cannot start a new request while honestly preserving the possibility that an already dispatched request finishes after a partition.

Upload success returns a public receipt plus an **opaque continuation**, not file_info/remotePath/COS URL. Keep the raw staged object in a bounded local operation-owned map. Redemption requires the same authenticated host/session/native peer, exact route, parent upload, following claimed send/part/hash and live local permission. New session/boot/account cannot use the old continuation. OneBot file/text publishing is still one upload-and-send operation, not a staging ID followed by another file send.

If native accepted while a later authority/bridge/cleanup step fails, preserve accepted facts and report cleanup independently. Bridge disconnect is cleanup unknown, not settled. Patch both the sender's local-exception assumption and its global cleanup-failure latch for the remote strategy.

Distinguish a failure to drain resources physically owned by the service from an unconfirmed remote attempt. The latter is a hold on the exact captured source/native-task binding, not a permanent global sender failure: unrelated sources continue, while reuse/replacement of the uncertain source waits. Release that hold only when the same claimed attempt/local task has actual settled-cleanup evidence, or after an explicit same-host owned-resource recovery proves the previous process/staging resources are gone. A new boot, Config revision or reconnected socket alone is not evidence. The old effect may remain unknown and is never replayed. The hold is lifecycle/capacity attached to the existing claim, not another delivery ledger.

Server shutdown joins its own tasks/streams/sockets and preserves remote uncertainty in State rather than waiting forever or claiming the remote host stopped. A true service-owned physical drain failure retains its existing error behavior. Failed local-host cleanup still retains its actual local slot and blocks unsafe replacement. G0 must show lost acknowledgment→same-boot fact-only reconciliation→a new input publishes successfully, with the old native effect still exactly once; also distinguish actual restart recovery from merely announcing another boot.

A lost bridge response becomes unknown; do not retry accepted/unknown operations or synthesize optional voice again. Before optional synthesis, also recheck that the same frozen local source is presently usable; text acceptance does not authorize a replacement source or prove an offline host can publish. Record a known native outcome inside the bounded local operation owner before attempting its RPC response; ControlEndpoint.close clearing pending replies must not discard that fact. Same-process reconnect reports it through the **current authenticated reporting envelope**, with the original immutable execution binding/task/attempt in the payload. That reporting permission cannot execute the old command or redeem its continuation. This is retained fact reconciliation, not an offline command outbox. Add one narrow State enrichment path for the same existing claimed attempt and execution binding: monotonic public receipt/cleanup evidence only, conflict on contradictory IDs, no new claim, no reopening the controller/voice gate and no new effect. After process/recovery without actual evidence remain unknown. No second authoritative local delivery database or restart replay queue is added.

Offline not-yet-attempted replies keep M6 behavior: retain State/output and record blocked/unavailable with an explicitly non-dispatchable logical-source target, not a fabricated live peer or inferred legacy-local binding; no automatic backlog delivery. If cloud work completes after a source has legitimately returned, a newly prepared result can use that current authorized same-account source. Missing local-native capability never stops the whole continuing Agent or unrelated cloud work.

## 7. User flow and actual ownership

1. Start the local application; attach/start the version-compatible independent host without duplicate instances.
2. Connect the desktop management client to the Agent as today, then explicitly bind/authorize the daemon to the same captured target. Show local host, local QQ source and remote Agent-link states separately.
3. Configure QQ source/account/listener/credentials locally and explicitly enable it. The default is disabled; changing Agent/account/source invalidates old dirty/key/operation ownership as applicable.
4. Manage server allowlists/principals/group policy/judge/delivery through the existing server-Web flow. A desktop link must open the correct captured Agent root without credentials in the URL. GUI placement is not policy ownership; embedding that server editor later needs no second truth.
5. Quit the desktop GUI: host/QQ/link remain. Reopen: attach the same host, retain its active link and do not borrow an old GUI connection ID for management.
6. Stop the local host explicitly: locally cancel/join native work even if the Agent is offline. Show failed/unknown cleanup truth; cloud tasks already admitted continue.

Use captured daemon boot, local config revision, server connection/assignment revision and secret version for their own domains. Do not reuse a projection revision as CAS or let a clean reread lend a typed key another target's versions. No generic local secret getter, renderer URL dispatcher or remote privilege inferred from local JSON.

## 8. Local delivery and compatibility

First review proposal: Windows-x64 versioned **portable application**, not a source archive, installer/signing project or automatic GitHub release. Include the actual runtime, required production dependencies, both host/GUI entries, reviewed plugin artifacts, version/protocol metadata and a launcher; no server data, personal configuration, tokens or SnowLuma binaries. Reuse current build tools and locked artifacts where possible.

Gate0 must prove resource/dependency resolution outside the checkout and package the correct target runtime/native dependencies; copying Linux node_modules or changing process.platform is not verification. Controlled Linux two-process/native acceptance validates the mechanism on a declared supported target. Produce an honest Windows candidate and reserve actual Windows-device/account acceptance for the later joint user trial if no Windows execution environment is available. No claim of verified Windows native execution can come from static manifests or Linux screenshots.

The service-local M6 strategy is explicit for retained data/controlled compatibility; it must not silently activate as a fallback when the user's selected local host is absent. Keep ordinary owner service APIs usable when the bridge/local QQ feature is disabled. Only private format/bridge/source projections change; existing personal visibility, voice/speech, task and old command contracts retain their regression coverage.

## 9. Proof-first rollout

Implement in [the ordered plan](implement.md). Begin with core-less host/factory permissions, independent process lifetime, real authenticated two-process transport/bytes and one actual claimed native effect with a lost reply. Resolve a contradiction at that gate, not by adding a fake in-process grant, generic RPC, local State, or text-only fallback. Then extend both protocols/media/policy/UI/package and run whole-scope review.

No actual QQ account, paid model, existing SnowLuma connection, original4120 data, public publish/push or OS service installation is included. Stop only the owned empty4121 development instance when implementation would invalidate its loaded artifacts; use fresh isolated roots for every State/bridge migration test.
