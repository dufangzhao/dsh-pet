# Shared explicit voice input — implementation plan

Status: parent-reviewed implementation plan,2026-11-09. Phase0/1 now starts under the approved continued-stage scope. Commands below remain planned until their actual results are recorded. Exact interfaces and limits are maintained only in [implementation contract](implementation-contract.md); decisions are in [design](design.md), scope in [PRD](prd.md).

## Phase 0 — freeze the consumer seam (GPT + parent)

Read the current PRD and reconcile the final independent-UA catalog observation with the parent research. Freeze contract C1–C11 before parallel code work. Do not reinterpret the public upstream parser as evidence that the deployed gateway cannot list audio. No gateway patch, installation or restart is part of the first slice.

Publish browser-safe types/guards and a typed test fixture first: separate voice/provider view, ASR candidates with role/classification/protocol fields, capture tickets/results and the fixed desktop facade. There is no addition to CompanionModelConnectorView, raw HTTP bridge or TTS method. DeepSeek consumes the actual exported declarations rather than maintaining a second schema.

Verify that both ordinary sources can be disabled, described and configured without model/device calls. Proposed source files do not exist yet; avoid documenting a proposed interface as already implemented.

## Phase 1 — ordinary sources and private ASR authority (GPT)

1. Add the shared-voice feature and Magpie ASR provider as ordinary packages with actual supported platforms, closed Config schemas, explicit methodPermissions, disabled-source behavior and source fingerprints. The feature owns finish preference/provider selection; the provider owns its gateway settings and process-only credential slot.
2. Implement the C6 private source-bound registration/bind/async-dispose pattern, reusing existing ModelConnections/withSourceAuthority conventions. Do not create a second plugin manager, generic native transport registry or uncontrolled callback channel.
3. Implement a private target-bound authorized transport with existing CredentialBroker/MemoryCiphertextStore/redactor/leases. Catalog and inference use this provider's actual key policy and own UA. Add private credential-version CAS and reuse the existing ingress predicate. Do not share/import text or AstrBot keys.
4. Wire one ASR-local pair of TaskMediaPeer endpoints under a real provider task. Preserve generic headless SDK media unavailable and readiness rejection for unsupported resource/network/mic adapters. Tests must demonstrate the new path uses real media credits/owner cancellation and cannot open an arbitrary provider's stream.
5. Observe committed provider Config/key/source changes before return, fence only audio bindings, drain raw native work/broker uses/TaskHandle.settled, and refuse replacement on unconfirmed cleanup. Text auth/Core/work must remain alive.

Focused evidence: permission/capability/file/credential deny, explicit revoke and package change; two concurrent clients with one cancelled; A→B target and same-target credential/model changes; pre-lock/current-source rechecks; lifecycle disposer failure; native secret-echo checks including quote/backslash keys. Every failure must show zero unauthorized calls and no local/direct model fallback.

## Phase 2 — real Magpie catalog and MiMo codec (GPT)

Implement C5 role normalization as provider code, not UI inference. Fetch the saved-target own-identity kind=all catalog with its configured auth. Include the source-backed MiMo ASR example as a test fixture/local evidence, not a global model default. Classify TTS only for exclusion; unknown protocols remain unavailable. Keep precise current binding and bounded result checks after await.

Implement only the MiMo native ASR operation needed by C11. Reuse existing Float32 validation/WAV construction, preserve full logical model ID, encode one vendor path segment and send the bare model at the fixed native chat-completions path. Keep provider-required base64 inside the private bounded HTTP codec. Decode only final message.content; reasoning-only/tool/malformed/over-budget content does not become user input.

Use an actual controlled HTTP peer to inspect method, target path, UA, auth, WAV bytes, payload fields, response decoding, deadlines and abort/reader settlement. Include peer responses for empty speech, reasoning-only, malformed content, auth/rate-limit/unsupported model, secret echoes and oversized input/output. Source helper mocks alone do not establish a working native transport.

Regressions also cover the empty-model initial catalog path, same-binding selection/transport mismatch with zero network, provider401/403 leaving the valid service connection live, no lazy catalog request inside an ASR deadline, and full-result UTF-8 envelope overflow becoming a retrievable quota failure. No audio POST to the user's gateway occurs in this phase. Do not read its configuration/accounts to create fixtures. Standard audio/TTS code paths are later additions with actual consumers, not speculative methods.

## Phase 3 — service voice admission and binary endpoints (GPT)

Implement C4/C7/C8 routes using the existing bearer/origin/no-store pipeline before any bytes or body parsing. Keep the JSON MAX_BODY unchanged. Raw completed PCM upload has its own bounded reader, ownership headers and task-owned media handoff. Add one fixed static worklet asset route in the closed public map during client packaging; no directory wildcard.

The feature's bounded transient records correlate capture/client/Agent/provider binding and service epoch. Implement one native call per capture, result recovery without re-upload, real cleanup states and terminal eviction. No durable commands/messages are written until the client uses the existing message API.

Tests should force: duplicate begin with matching/mismatching payload, racing duplicate upload, foreign client/Agent/epoch, variable HTTP chunk alignment, tail/count mismatch, no bytes/invalid samples/overflow, socket close after upload body completion, expiry, missing record after restart, lost ASR response, cancel versus completion and provider withdrawal. Assert no message/tool/fact writes for partial/cancel/error/no-speech paths.

Keep the feature's config changes separate from model-mode control. Saving audio settings must not reconstruct Cortico, invalidate a text credential, or cancel independent work. Extend service composition/return value/close only for the new owned voice subsystem, not a new daemon.

## Phase 4 — one reusable sampler and desktop authority (GPT + DeepSeek)

DeepSeek extracts the existing renderer/worklet behavior into the neutral audio-capture browser entry under C9. GPT supplies the actual ordinary runtime manifest, Main/preload contract and lifecycle adapter. Preserve the old Demo exports for retained experiments/tests; production roots must not import old Demo/voice-chat/Core orchestration.

Desktop control and physical sampling both live in the existing console root. The pet remains text-only in this increment. Main owns the current console frame's ticket, source/mic lease, binary validation/acks, completed clip and captured service connection. Page navigation does not recreate capture; frame/window closure cancels it.

Implement scoped permission handlers and the capture-specific readiness branch, not allow-all or fake platform admission. Add the exact capture source to shared composition only once its implementation and teardown exist. Extend the existing native stop wrapper to join this source's Main cleanup and runtime disposer as it already does for the companion source.

Prove pending getUserMedia cancellation without claiming that aborting a JavaScript flag cancels the browser prompt. Release includes a late stream and AudioContext.close; unconfirmed release remains retiring/pending_restart. Finish must not deadlock waiting for an ended callback that itself waits for release. Owner/target checks belong before and after each asynchronous boundary.

Build the neutral worklet into an explicit asset for web and desktop's current bundler. Verify the production static allowlist/CSP/URL; source tests and a development-only bundle are insufficient. No inline/blob script exception or replacement GUI server.

## Phase 5 — consumers and existing message intent integration (DeepSeek + GPT)

Add screen controls to the web composer and desktop console conversation, with capture owner above page navigation. Before start, show the contract's mode-specific20s auto-end/send or preview notice beside the control and in its accessible description; test it against the captured ticket mode. Use existing styling/primitives and a small ordinary voice settings surface within existing settings flow. Do not couple it to the text model view or provider availability guessed from a label.

Follow C10 exactly: Finish and send creates one immutable existing message intent; preview preserves the typed draft. Starting/using voice does not disable typing or stop Core/work. Unknown ASR result is not unknown message receipt; recover the former without a second provider call and retry the latter with the same message command. Keep a ready-but-unsubmitted transcript if actual existing message admission is blocked; do not replace another outbox entry, overwrite a draft or create a general message queue.

GPT adds the narrow explicit-intent web submission entry to the existing client/outbox and the fixed voice Main service adapter; DeepSeek consumes both. Existing text submit behavior, canonical-before-late receipt reconciliation and stale-render zero-dispatch behavior must remain intact.

Consumer tests: finish sends once, preview edit allocates the correct intent, equal distinct utterances have distinct IDs, same uncertain intent retries unchanged, typed drafts survive every path, current pending command is preserved, full Main pending capacity leaves voice text unsent, model busy permits record, model unavailable has a concrete reason, and stale target/late permission/provider changes never send to the replacement.

## Phase 6 — serial integration and acceptance (parent)

| Layer | Required evidence |
| --- | --- |
| Provider/source unit + actual HTTP peer | C5/C6/C11 authority, real byte codec, fixed network/auth and actual native drain |
| Service + canonical state | Auth/origin, binary/memory bounds, capture idempotence, empty/cancel/error zero messages, final same-Agent message/receipt/persona/memory/work continuity |
| Browser production assets + real DOM | Actual worklet/getUserMedia permission flow with synthetic public input; finish/cancel/late prompt/review/draft/unknown/retarget and secure-context absence |
| Production Electron, serial isolated profile | Real Main/preload/console-frame permission, task/media ack/tail, window-close/source removal, no pet mic, cleanup and text connection continuity |
| Root quality gate | Affected types/tests, QA/lint/format/build, root pnpm check and required existing native/Core/Docker gates, honestly marked for actual environment availability |
| Separately authorized real short audio | Exactly approved audio origin + actual gateway/model/auth target + bounded one-call/deadline budget; no automatic retry or TTS; report real effect separately |

Use the existing package scripts and QA probe runner discovered from the repository at implementation time; do not invent a passing command or execute these gates during planning. Candidate focused packages are contracts, host-kernel media/permissions, companion-runtime, companion-service, the new voice/provider/audio-capture packages, text-client and desktop. Broaden testing after meaningful integration changes/failures, not repeated identical gates.

Native/browser device tests may use the existing fake media device with a public WAV and controlled gateway response. Keep actual authority decisions; no automatic media-consent bypass. They prove device/transport lifecycle, not real recognition, audio quality, physical speakers, OS permission on another platform or native duplex.

## File/ownership map

New source paths below are proposed implementation destinations, not inspected existing files.

| Area | Proposed implementation scope | Owner |
| --- | --- | --- |
| Public declarations/guards | contracts companion-voice.ts/desktop-voice.ts, root exports, text-client voice protocol/guards | GPT |
| Feature/provider runtime | plugins/shared-voice and plugins/asr-magpie, companion-runtime voice-input-types/registration and service voice controller/authorized transport | GPT |
| Device/browser module | existing audio-capture package becomes real runtime + browser/worklet entries, old Demo wrappers | DeepSeek sampler/UI; GPT manifest/source/permission integration |
| Main/preload | desktop voice controller/request/bridge; existing companion source adapter/work set and lifecycle/permission/readiness/static composition | GPT |
| UI | web App/console root owner, conversation controls, preview and separate provider settings; no pet capture control/TTS UI | DeepSeek |
| Acceptance/documentation | focused integration and serial native/root evidence, actual operator guide/spec pointers, current task/journal/activation | Parent |

## Completion and non-blockers

No new product/provider-choice question blocks design: Magpie, finish-and-send, own-client discovery and console-only desktop capture are concrete. A missing current inference permission, real clip consent or device availability limits the eventual live acceptance claim, not controlled implementation readiness. Any implementation discovery that invalidates a private interface must revise C-sections first and notify consumers before continuing.

Parent alone reconciles/activates task metadata and schedules implementation. This design turn does not commit, start services, install packages or read private original data.
