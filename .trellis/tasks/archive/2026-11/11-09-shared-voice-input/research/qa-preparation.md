# Shared voice input: QA preparation

[PRD Q1–Q7](../prd.md#L23) is the sole acceptance catalog; [the reviewed contract C1–C12](../implementation-contract.md) owns interfaces and limits.
This is the historical preparation snapshot before the Phase0 source-export handoff. Current results and delivered scope are maintained in the task's linked acceptance record.
This document specifies observations, not a second DTO, endpoint or bridge definition.
No product, gateway, device, microphone, model or account was used for this QA preparation.

## Evidence and run boundaries

- The first slice accepts one explicit bounded utterance into the **same Agent**; it does not implement automatic TTS or full duplex.
- Parent's independent `dsh-pet-source-research` catalog GET returned 19 rows, including the three MiMo audio references.
- That prior GET is discovery evidence only: it proves neither authorization to transcribe nor quality, latency or a successful audio POST.
- All model roles initially use Magpie; use our own identity and authorized credential scope, never AstrBot's UA, switch or configuration.
- MiMo ASR retains `xiaomi/mimo-v2.5-asr` as the logical ref; the source-backed native forwarding route ends in `/xiaomi/v1/chat/completions`.
- WAV/data-URL/base64, when required by that native codec, is bounded inside the private upstream adapter; it is not control IPC, snapshots or SSE.
- Keep the existing 64 KiB control JSON and 80 KiB desktop aggregate limits; audio travels over the actual declared bounded binary/media path.
- Existing [media budgets](../../../../../../packages/contracts/src/media.ts#L14) and [capture/worklet](../../../../../../apps/desktop/src/renderer/console/demo/microphone.ts#L25) are reuse evidence; new limits are specified in [C7](../implementation-contract.md#L189) and await source declarations.
- The AstrBot reference root is source-only research; it is not product authority or a test target.
- Future runs use isolated synthetic roots and separate browser/Electron child HOME and XDG directories; never repoint the user's profile.
- Before any future execution, freeze sources/builds, capture runner and actual product hashes, and get parent integration authorization.

## Q1 — actual capture, permission and release

- Exercise the actual web control and production Electron DOM/preload/Main path with a generated, non-personal audio fixture.
- Use a synthetic media **device**, not the physical microphone; getUserMedia, AudioContext and AudioWorklet must really execute.
- Parent checked the old referenced `zh.wav` cache path and it is absent; generate a deterministic non-personal WAV later, without downloading an ASR model.
- Desktop uses the console root as its sole sampler; observe its trusted frame, Main permission decision and live lease, then the real binary/ack path.
- No pet microphone or cross-window audio relay is part of this slice; web uses its own browser capture permission.
- A fake bridge, fake hook, mocked UI or automatic permission-accept flag cannot establish a permission/lease pass.
- Separate browser permission from service authentication: a valid browser grant does not authorize an unrelated frame, token or target.
- Prove denial with no live lease/track and no submitted message; show the actual UI reason without exposing device identifiers.
- For normal finish, stop tracks, flush a deliberately non-full tail, await ordered acknowledgements and actual renderer release; only then call `reportCaptureReleased` followed by `finishCapture` to start ASR ([C9](../implementation-contract.md#L289)).
- Verify the tail precedes completion, no frame is lost or duplicated, and release-before-finish does not deadlock or demand the ended microphone lease.
- For cancel, abandon the tail and transcription, join the actual release and observe no late submit or fake completion.
- Gate a real permission grant until after cancellation; on late resolution prove every returned track stops and no capture restarts.
- Repeat with navigation/frame destruction and source retirement; record the actual teardown of tracks, audio context, worklet and lease.
- If the new public seams cannot expose those observations without bypassing Main, report the exact missing observation and await handoff.

## Q2 — bounded Magpie transcription and one canonical message

- Feed deterministic synthetic PCM through the actual newly declared binary transport into an owned controlled Magpie peer.
- Verify the declared [C7](../implementation-contract.md#L216) f32le/16 kHz/mono format, 1,600-sample frames and 320,000-sample/20-second cap against the actual exported implementation.
- Assert accepted boundary values and adjacent over-limit cases for frame size/count, total bytes, duration, sequence and in-flight credits.
- Reject bad order, malformed or non-finite samples, wrong format, oversized bodies and incomplete data without a canonical text effect.
- Catalog must work with an empty model selection; test returned rows, role fallback, full logical IDs and codec-only bare model conversion without starting inference.
- Text/audio-capable chat metadata alone must not invent an ASR role or introduce rows not returned to this project's identity.
- Distinguish missing/rejected credentials, scope, unavailable provider, unsupported format, timeout, cancellation and malformed responses; upstream auth failures stay voice-local HTTP 200 results, not service-bearer/SSE disconnects.
- For MiMo, inspect only the controlled peer's sanitized request: actual native route, bounded RIFF/WAV data URL and selected bare model.
- A `reasoning_content`-only response is not a final transcript; empty/malformed/partial output must not become a user message.
- A complete serialized result over 64 KiB becomes a retrievable quota failure, never truncated or inaccessible success; verify one ASR per capture and status recovery without another POST ([C8](../implementation-contract.md#L232)).
- Verify the 55-second upload deadline includes body ≤15 seconds and native ASR ≤40 seconds or remaining time; the client gets 60 seconds and catalog has its own 30-second budget.
- The controlled peer returns a deterministic final text; one finish-and-send produces exactly one ordinary message command and real receipt.
- Assert unchanged Agent identity and one canonical user/history entry; verify no second Core, voice transcript database or automatic TTS.
- Unknown message outcome retains the immutable ID and payload; retry returns the prior receipt without another message or side effect.

## Q3 — foreground, worker and stop meanings

- Gate an actual controlled foreground inference; starting or cancelling capture must not implicitly interrupt the Core or replace the Agent/source.
- After final text is accepted as an ordinary message, verify the same semantics as typed text, including existing Cortico input, preemption and step policy.
- Run independent work during recording, transcription and accepted text; track the same task/execution/artifact IDs and one durable effect.
- Capture readiness and provider busy are distinct from Agent thinking; exercise the resource-specific busy response once its contract exists.
- Verify finish, cancel, foreground stop and selected-work stop remain distinct and target only their own declared operation.
- Starting or cancelling capture must not silently stop an unrelated worker or claim an accepted task was erased.
- Do not infer physical completion from a stop-request receipt; await the existing settled task/cleanup evidence.

## Q4 — target, owner and late-effect fencing

- Gate capture, binary media, transcription and final response at real boundary points, then retarget or disconnect before each is allowed through.
- Capture the original target/source/generation at admission; old frames, credentials and late results cannot reach the new Agent or create its message.
- Withdraw the feature/provider while work is pending and prove that its permission lease, stream, task and in-flight response are actually released.
- Include cancellation during a delayed provider result and a delayed message receipt; compare canonical messages, events and task identities.
- Establish each race at a known precommit or postcommit barrier: before commit there is no submission; an already accepted message remains canonical.
- Changing provider/model/settings during a capture must follow the actual captured-source contract, not silently swap the destination or credentials.
- After retarget, the exact retained old record's original trusted frame may acknowledge device release only; verify zero service I/O and no effect on a replacement ([C9](../implementation-contract.md#L293)).
- A stale or untrusted frame must not obtain Main microphone permission merely by presenting a renderer-supplied token or identity.

## Q5 — real forms, drafts and recoverability

- Drive real browser React events and the real production Electron/Main/preload windows; static render and mock-hook checks are supporting evidence only.
- Verify explicit record, recording/capacity, finishing, transcribing, optional review, result and error copy against actual state.
- Default finish-and-send is explicit and single; before start, show the captured mode's 20-second auto-finish/send or preview notice, including its accessible description ([C9](../implementation-contract.md#L297)).
- The existing text composer remains usable during capture and transcription; its ordinary submission rules still apply.
- Type a draft during capture and keep it byte-for-byte; the recognized transcript must not replace or merge into that draft.
- A distinct voice transcript uses its own command ID and can coexist with an older pending/unknown text command; do not invent a global lock.
- At an actual pre-dispatch quota/refusal, retain the ready, unsubmitted transcript, send no HTTP and do not overwrite the old command or create an automatic queue.
- Retry the older unknown message with its original ID/payload; an edited transcript is a new intent, without silently dropping either text.
- Exercise permission denial, unavailable/unsupported provider, empty result and cancel without a false success or implicit retry.
- If a transcription response is lost, preserve the actual uncertain state and retry intent; do not assume a second provider call is free or idempotent.
- Browser microphone access requires a genuinely secure context and browser permission; plain remote HTTP remains honestly unavailable.
- Check minimum desktop layout, keyboard focus, accessible labels and visible stop/retry controls without introducing a new window or page.
- Synthetic-device DOM evidence is not evidence of a physical microphone, recognition accuracy or human-audible playback.

## Q6 — scoped real-provider evidence

- No real ASR POST has occurred. The observed catalog and reference source alone cannot close this criterion.
- Agree once on the exact Magpie model, short speech fixture and single-call budget for the real experiment; finalize the separate [C12](../implementation-contract.md#L344) clip/deadline boundary at that handoff.
- Prefer a public or synthetic non-personal fixture; do not read a real microphone or credentials for this check.
- Record the model ref, format, attempt count, elapsed timing and a bounded nonsecret result, including expected words when available.
- Do not log credentials or unnecessarily retain raw audio/provider payloads.
- If usable audio or a call budget is unavailable, mark real-provider validation **not run** and report controlled-peer scope only.
- A single sample is an effect check, not a general accuracy, latency, device or language-quality claim.

## Q7 — integration gate and handoff

- Parent owns frozen integration order, affected focused checks, root gate and one final report linked back to Q1–Q7.
- Separate evidence layers: pure/controlled peer; actual synthetic-device web/native permission and DOM; optional authorized real provider/device.
- For each layer retain exact build/runner hashes, platform, inputs, outcomes, cleanup and known untested platform boundaries.
- Assert after every terminal path that owned tracks, contexts, worklets, media leases, tasks and temporary instances have actually settled.
- Reuse the prepared private Electron/Xvfb/RPATH tooling only for authorized runs, with isolated child HOME/XDG; do not use a fixed host display.
- Keep failures as failures and retain only deliberately safe evidence; never infer permission or recognition success from a source-only check.
- Record exact provider format, configuration/credential authority, error boundaries and operator instructions after the owner contract is finalized.
- Do not rerun the full previous desktop acceptance suite merely to test this slice.

## Waiting for the owner handoff

- Await the exact console-root capture/frame contract, shared types, Main permission and binary-media contracts, limits and cleanup observability.
- Await the actual provider configuration, catalog classification, native codec boundary, output/unknown semantics and supported fault-injection seams.
- The existing web outbox and desktop bridge implementations must be read again at handoff; do not invent a new command, queue or fallback now.
- These are contract dependencies, not authorization to choose a third capture owner, enlarge JSON budgets or start a product test.
