# Voice entry: next-stage UX research

Read-only research, 2026-11-09. No product edits, builds, installs, service starts, model calls, microphone access or device probing were performed. This report locates **what already exists** and what a first verifiable slice needs. It invents no DTO, provider API or backend contract; GPT owns that research separately.

Parent intent is [R3 full-duplex with presence](../prd.md#L13), bounded by [R19 text-first](../prd.md#L29) and [R20 ordering](../prd.md#L31). [R13](../../../../docs/adr/0016-cloud-service-and-pluggable-features.md#L19) requires voice to stay an independently removable plugin.

## What actually exists

| Area | Current source-backed behavior | Implication |
| --- | --- | --- |
| Shared composition | [shared-composition-policy.ts](../../../../apps/desktop/src/main/shared-composition-policy.ts#L3) **forbids** `pet.voice-chat`, `pet.asr-local`, `pet.asr-cloud`, `pet.audio-capture`, `pet.talk-key` in the shared client. | The current desktop composition has **no** capture or ASR. Any voice entry starts by deciding what may be re-admitted, not by adding UI. |
| Capture plugin | [audio-capture](../../../../plugins/audio-capture/src/index.ts#L2) is an empty shell (`export {}`); its package description still says "M3-01 填充". | The *plugin* has no implementation — but that does not mean no capture code exists (see next row). |
| Actual capture | [microphone.ts](../../../../apps/desktop/src/renderer/console/demo/microphone.ts#L19) runs `getUserMedia` + AudioWorklet **in the renderer**; [demo-controller.ts](../../../../apps/desktop/src/main/demo-controller.ts#L626) `beginRecording` issues the [DemoCaptureTicket](../../../../packages/contracts/src/demo.ts#L106) (token, 16 kHz, max/chunk samples) first. | Ownership is split: **Main owns permission and lifecycle, the renderer owns the device call and sampling.** Neither side alone is "the capture owner". |
| Legacy voice UI | [voice.tsx](../../../../apps/desktop/src/renderer/console/pages/voice.tsx#L1) exists but binds `useDemo`/`useApplication`/`useVoiceInput` and is **not mounted** by the shared console. | It is retained design material, not a working entry point. Do not revive it as-is. |
| Talk-key gesture | [gesture.ts](../../../../plugins/talk-key/src/gesture.ts#L3) is a small tested state machine: down toggles, a held release ≥250ms finishes. | Reusable as a pure rule for press-to-talk vs tap-to-toggle; it carries no session concept. |
| Playback owner | [playback-owner.tsx](../../../../apps/desktop/src/renderer/speech-output/playback-owner.tsx#L5) mounts once in the pet root and owns `SpeechPlaybackOwner`; settings windows never own playback. | One owner already exists for speaking. Interruption belongs here, not in a second player. |
| Web composer | [chat.tsx](../../../../plugins/text-client/src/client/chat.tsx#L17) is a controlled draft + submit; no audio path. | A control-style voice input can feed the same submit path without a new transport. |
| Voice contracts (legacy inventory) | [voice-input.ts](../../../../packages/contracts/src/voice-input.ts#L19) lists cloud origins and engines (`sensevoice`, `whisper-small`, `windows-sapi`, `openai`…). | **Legacy inventory, kept for reference.** The route for this project is now decided (Magpie); these direct provider entries are not the integration path. |
| Synthetic mic | [demo-ui-e2e.mjs](../../../../qa/probes/demo-ui-e2e.mjs#L66) runs Chromium with `--use-fake-device-for-media-stream` and asserts tracks are released. | A synthetic-microphone acceptance path already exists and is the honest way to test capture without a real device. |

## The honest gap

There is currently **no** voice path from either client to the shared Agent: the voice plugins are excluded from the shared composition and the only voice UI is legacy and unmounted. The text path (submit → service → message) is the one working route.

But the *machinery* is not absent. A working desktop capture chain already exists — Main issues a ticket, the renderer opens the device and emits normalized frames, Main gates it behind a permission prompt. The [audio-capture](../../../../plugins/audio-capture/src/index.ts#L2) package being empty means that chain is **not currently packaged as a reusable plugin**; it lives in the demo path. Reviving it is a packaging/admission question, not a from-scratch build.

So the first slice is not "add a microphone button". It is: admit a minimal capture + transcription provider, feed its text into the **existing** submit path, and show explicit states. Anything that claims full-duplex before that is a different, much larger project.

## Candidate first slice (recommendation, not a decision)

One Agent, one voice entry, text remains canonical. Everything below is a **proposal** to be accepted or changed; none of it is an existing product rule.

- **Control-style input, not duplex.** Hold or toggle to record, transcribe, then hand the text to the existing submit path. R3 wants full-duplex, and the runtime already allows new input to interrupt or insert into a running turn — a control-style entry is a *smaller first step*, not a claim that duplex is out of scope forever. Copy should not imply simultaneous listening and speaking.
- **Explicit states.** `recording` → `transcribing` → `thinking` → `speaking` → `error`, each with its own honest label. A failed transcription is an error, not an empty submit.
- **Interruptible playback.** Speaking can be stopped; the existing playback owner is the place to do it, not a second audio pipeline.
- **Shared content, one speaker (proposal).** Both surfaces see the same conversation, but only the surface that produced a reply speaks it. This is a UX choice to avoid double audio, not a technical constraint — the parent may decide otherwise.
- **Temporary audio (proposal).** Recorded audio would exist only long enough to transcribe, with the conversation storing text as it already does. Retention is a separate decision; no policy has been chosen.

## Decisions and remaining gaps

**Decided by the user (2026-11-09):** every model role — including ASR and TTS — connects through **Magpie**. The local-versus-cloud ASR choice is therefore **closed**, not open: neither direct cloud ASR nor a local ASR install is the integration path. The legacy engine/origin list above is retained as inventory, not as a plan. Audio egress is now a Magpie routing question. Per-utterance review is **not** a mandated gate — the child slice defaults to finish-and-send with an optional preview.

**Deferred to the exact contract, not an open product choice.** Capture ownership is split today (Main ticket/permission, renderer device call) and the shared composition excludes the voice plugins; how capture is admitted is being settled in the actual backend design, and the frontend waits for that declared seam. Role/`serves` classification for provider candidates likewise comes from the new voice/provider view rather than being inferred by the UI. Review is not a per-utterance gate: the [voice-input child](../../11-09-shared-voice-input/research/voice-input-ux.md) decides finish-and-send with an optional preview.

## Interaction shape

The control that exists today is text: a draft, a send button, a submit that survives uncertainty. Voice should reuse that spine rather than sit beside it.

A minimal flow reads: press to start (or tap to latch), speak, press to stop, see `transcribing`, then the resulting text lands **in the draft** rather than being auto-sent. That last choice matters: the user can correct a misheard word before it becomes a message, and the same submit path handles the result. Auto-send would make every recognition error a sent message.

While `speaking`, the control offers stop. Whether recording stays available during `thinking` is an **open proposal**: the text composer stays usable while a turn runs, so "recording is disabled while thinking" cannot be presented as an existing rule — it would be a new, stricter constraint that needs a decision.

Two different endings, and they must not be conflated:

- **Finish** (release the talk key / press stop to send): tracks stop, the tail frame is flushed, the audio goes to transcription, and the result lands in the draft.
- **Cancel** (explicit discard): tracks stop and the audio is dropped. Nothing is transcribed and nothing is submitted. No half-transcribed fragment may later submit itself.

Stopping **playback** is a third thing again: it stops local audio only and does not cancel the Agent's work. Those are different facts and the copy must not merge them.

## Permissions and secure-context differences

**Desktop** capture runs inside a privileged Electron window: Main issues the ticket and gates it behind a permission prompt, the renderer opens the device. The pet and console renderers deny network by CSP, so capture must not require a renderer HTTP call.

**Web** has two different constraints, and they should not be stated as one:

- **Secure context is a hard requirement.** `getUserMedia` is unavailable on a non-secure origin. A build served over plain HTTP on a LAN address has no microphone at all — a real limitation to state, not to route around.
- **A user gesture is a product constraint here, not a universal API fact.** Browsers differ on when a gesture is required, and the permission prompt is the app's real gate. Requiring an explicit record button press is a sensible product rule that also keeps the gesture question moot — but it should be described as our choice, not as what the API mandates.

The permission prompt itself cannot be pre-approved by the app on either surface.

## State vocabulary

| State | What the user sees | What is true |
| --- | --- | --- |
| `idle` | Microphone available, nothing captured | No device open |
| `recording` | Explicit recording indicator and a stop control | Device open, tracks live |
| `transcribing` | "正在转写" and no submit | Audio in flight; text not yet canonical |
| `thinking` | The existing waiting state | The service is working; no local audio. Note: text submit stays enabled while a turn runs — recording behaviour here is a **proposal**, not an inherited rule |
| `speaking` | A stop control | Local playback is active |
| `error` | The real reason, with a retry that does not auto-fire | Nothing was submitted |

A state must never be inferred from silence. "No audio for a while" is not `error`, and a transcript that comes back empty is an error rather than an empty message.

## What the acceptance can and cannot claim

A synthetic microphone (`--use-fake-device-for-media-stream`) plus a controlled PCM source proves: the device is opened, tracks are released, states advance, the transcript reaches submit, and playback can be interrupted. It does **not** prove recognition quality, real-device behaviour, latency, or that a real person was understood. Those stay explicitly unverified until a real device and a real provider are used, and the evidence must say which one ran.

## Non-goals for this slice

No wake word, no voice cloning, no always-on listening, no second audio pipeline and no new session concept. Full-duplex, barge-in and automatic TTS are **later** stages, not rejected — R3 asks for them and the runtime already permits interrupting a running turn. Provider routing is decided (Magpie), so "no default cloud upload" is no longer a pending policy question; what stays open is the audio wire format and scoped keys inside that route. The original 4120 service and its data stay stopped and unread.

## Reuse map

| Need | Reuse |
| --- | --- |
| Press vs hold semantics | [TalkKeyGesture](../../../../plugins/talk-key/src/gesture.ts#L3) |
| Speaking and interruption | [SpeechPlaybackOwner](../../../../apps/desktop/src/renderer/speech-output/playback-owner.tsx#L5) |
| Submitting text | Existing `submit` in [chat.tsx](../../../../plugins/text-client/src/client/chat.tsx#L17) and `sendMessage` |
| Engine/origin policy | [voice-input.ts](../../../../packages/contracts/src/voice-input.ts#L19) |
| Synthetic-device probe | [demo-ui-e2e.mjs](../../../../qa/probes/demo-ui-e2e.mjs#L66) |

Nothing here requires a new UI shell, router or state framework.
