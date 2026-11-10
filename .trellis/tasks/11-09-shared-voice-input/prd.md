# Shared explicit voice input

Status: parent-reviewed and activated for implementation on2026-11-09 after completed model text, shared desktop and controlled persona/memory stages. Runtime/voice acceptance remains to be executed; no device/audio model call has occurred. [Parent requirements](../11-06-unified-companion-architecture/prd.md) retain the eventual full-duplex goal; this first utterance-input slice is not labeled duplex.

## Goal

The owner can record a bounded utterance from the existing web/desktop surface, transcribe through an explicitly configured ordinary provider and submit final text to the same continuing Agent. Reuse canonical message/receipt/history/memory/work ownership; no local Core or second conversation database.

## Evidence and proposed scope

[Backend research](../11-06-unified-companion-architecture/research/voice-entry.md) and [UX research](../11-06-unified-companion-architecture/research/voice-ux.md) locate the reusable renderer microphone/worklet, Main supervised permission/ticket/ack path and old ASR providers. The old voice-chat orchestration invokes a local Agent and cannot be reenabled wholesale. Main is desktop authority/lifetime owner; renderer does actual sampling. Web uses browser permission and requires a secure context.

Parent performed a read-only `GET http://127.0.0.1:3425/v1/models` on2026-11-09: HTTP200, six advertised models with text/image input metadata, no advertised audio modality. This was catalog discovery, not inference or proof that gateway audio endpoints are absent. Public pinned Magpie source exposes bounded file transcription; the installed audio model/provider/key availability remains unconfirmed. No account/profile files or credentials were read.

- V1 Reuse/extract existing capture and tail-flush code with neutral types and one capture owner, retaining actual frame/sequence/sample/source/task checks and finite limits. Explicit screen controls work independently of model thinking; provider-specific busy remains honest.
- V2 Use a separate bounded binary audio plane and ordinary transcription provider. Preserve64KiB control JSON/80KiB Main budgets; no JSON sample arrays, global permission relaxation, fake platform or implicit legacy reenable.
- V3 Per the user's2026-11-09 clarification, all model roles initially connect through Magpie, including ASR/TTS. Keep replaceable provider boundaries, but do not select direct cloud or local ASR as a substitute for this chosen integration. Research the AstrBot agent plugin's supplier-audio catalog supplementation and actual routing before defining the voice catalog/API. Provider/model/format and audio egress must be explicit; generic text catalog absence alone is not speech unavailability, and text connectivity alone is not speech readiness. No implicit reuse/import of text or DSH credentials.
- V4 Normal finish stops capture, flushes acknowledged tail and transcribes. The first-slice default action is clearly labeled finish-and-send; a review/draft option preserves editable transcription before sending. The visible control states that the20s cap automatically finishes in the captured send/review mode. Only final accepted text produces one ordinary message command; uncertain retry retains its immutable command ID/payload, changed text is a new intent. Partial text never triggers tools/memory independently.
- V5 Cancel discards that pending capture/transcription and joins actual release, with no late submit. Disconnect/retarget/source withdrawal fences old bytes/permission/provider results; accepted messages/work are not erased by later audio cancellation. Do not equate capture, playback, foreground or selected-work stops.
- V6 First slice does not add automatic TTS, background listening, global keys, wake words or claim full-duplex/latency/recognition quality. Spoken output and measured streaming/barge-in remain later increments. Do not block capture merely because the Agent is thinking or silently abort foreground on mic start.
- V7 Both surfaces reuse existing UI shells, explicit permission/readiness/error states and target ownership. Original4120, old private data and accounts remain untouched. Development uses synthetic PCM and controlled peers unless a specific real provider/device check is separately established.

## Acceptance draft

- [x] Q1 Real browser/production Electron synthetic capture uses actual permission, worklet, fixed bridge/media paths; finish/cancel/late-permission release are measurable and no legacy Core activates.
- [x] Q2 Controlled ASR/provider validates actual binary bounds/format/auth/cancel and returns a final result through the existing same-Agent message command with no duplicate effect.
- [x] Q3 Model thinking and independent work continue according to current runtime semantics; capture/provider busy and each stop action remain distinct.
- [x] Q4 Retarget/disconnect/withdrawal cannot move old audio or transcripts into a new target; cancelled input is not submitted, accepted work is preserved.
- [x] Q5 Real web/desktop UI reflects capture/transcription/error/finish/review states, preserves drafts and uses current permission/secure-context facts. No synthetic-device result is called real hardware or recognition-quality evidence.
- [x] Q6 The selected real-provider path is validated only with an authorized model/route and supplied or explicitly approved test audio; otherwise the delivered scope must explicitly remain an unconfigured adapter with controlled-peer evidence, not a claim of usable recognition.
- [ ] Q7 Focused/root/native checks, exact capability/format/error specs, operator instructions and Trellis records are complete for the selected scope.

## Material decision before convergence

User clarified on2026-11-09: all model roles first connect through Magpie, and the reference was prior work in the separate AstrBot workspace. Parent located that workspace's `astrbot_plugin_magpie`3.0.0 source and Magpie0.1.3225 discovery-only patch; no private configuration, persona JSON or provider screenshots were read. The plugin registers separate LLM/ASR/TTS provider types and classifies exposed model rows, while the patch makes an AstrBot-specific discovery switch/catalog response; it does not require automatically rewriting AstrBot choices. MiMo uses a Magpie native forwarding adapter rather than the ordinary audio wire protocol.

Parent then performed a read-only reference-client catalog request (`GET /v1/models?kind=all`, documented `AstrBot-Magpie/2.0` User-Agent): HTTP200 and11 exposed rows, including real refs `xiaomi/mimo-v2.5-asr`, `xiaomi/mimo-v2.5-tts` and `xiaomi/mimo-v2.5-tts-voicedesign`. ASR classification may require the plugin's known role fallback when `serves` is absent. These are actual discovery facts, not an inference/quality test. The missing-reference question is resolved.

Parent also verified the same complete-catalog request using independent identity `dsh-pet-source-research`: HTTP200 with19 rows, including the same three MiMo refs without audio `serves`/`kind` annotations. The current deployment already supplies the candidates without impersonating AstrBot. This resolves the independent discovery prerequisite: use the normal complete catalog with this project's identity and scope, prefer explicit role metadata, then apply narrowly documented known-role classification to returned rows. Preserve full gateway refs and only convert vendor/bare wire model at the MiMo native codec boundary. Do not infer ASR merely from an audio-capable chat model's input modalities.

The first slice does not need a new catalog compatibility patch, a gateway restart, AstrBot's toggle/configuration or new models merely to begin implementation. The current refs are this installation's verified candidates, not defaults for every installation or proof of invocation rights/recognition quality. No running Magpie/AstrBot configuration, installation or restart is authorized by this research. Exact ASR/TTS formats, scoped keys and real-provider validation remain part of the upcoming design/acceptance contract.
