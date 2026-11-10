# Shared voice input contract

## 1. Scope and trigger

Read this when changing shared voice sources, native ASR, capture lifetime, service voice routes, Main/preload, or their web/console consumers. Voice is an explicit utterance input to the existing Agent. It does not create another Core, durable audio store, message queue, or credential registry. Starting/cancelling capture must not stop unrelated foreground thinking, work or playback.

The initial production provider is Magpie with the bounded MiMo ASR codec. TTS and full duplex are separate increments. Operator steps are in [the voice guide](../../../docs/38-shared-voice-input.md); executed scope is in [acceptance](../../../qa/fixtures/companion-voice-input/acceptance.md).

## 2. Canonical signatures

Do not copy DTO definitions into consumers or keep another editable schema here. These source modules are authoritative:

| Boundary | Source and entry |
| --- | --- |
| Format, limits, synchronous operation | [audio-capture.ts](../../../packages/contracts/src/audio-capture.ts): `AudioCaptureTicket`, `AudioCaptureEvents`, `AudioCaptureOperation` |
| Service selection, ticket, result, configuration and budgets | [companion-voice.ts](../../../packages/contracts/src/companion-voice.ts): `VoiceBegin`, `VoiceBeginSelection`, `VoiceTicket`, `VoiceCaptureResult` |
| Fixed console facade | [desktop-voice.ts](../../../packages/contracts/src/desktop-voice.ts): `DesktopVoiceBridge`, `DesktopVoiceState` |
| Neutral device implementation | [browser.ts](../../../plugins/audio-capture/src/browser.ts): `startCapture(ticket, events, options)` |
| Checked native provider/media ports | [voice-input-types.ts](../../../packages/companion-runtime/src/voice-input-types.ts), [voice-providers.ts](../../../packages/companion-runtime/src/voice-providers.ts) |
| Public HTTP boundary | [voice-http.ts](../../../apps/companion-service/src/voice-http.ts), [voice-controller.ts](../../../apps/companion-service/src/voice-controller.ts) |
| Client guards and requests | [voice-guards.ts](../../../plugins/text-client/src/client/voice-guards.ts), [voice-protocol.ts](../../../plugins/text-client/src/client/voice-protocol.ts) |
| Renderer transport/owner | [voice-transport.ts](../../../plugins/text-client/src/client/voice-transport.ts), [voice-input.tsx](../../../plugins/text-client/src/client/voice-input.tsx) |

The fixed routes are GET `/api/voice`, GET `/api/voice/catalog`, POST `/api/voice/settings`, POST `/api/voice/provider`, POST `/api/voice/credential`, POST `/api/voice/captures`, and the capture status, audio and cancel routes defined in the HTTP module. No arbitrary native URL, model, credentials or transport is accepted through capture operations.

## 3. Contracts and authority

### Sources and credentials

- `pet.shared-voice`, `pet.asr-magpie` and `pet.audio-capture` are ordinary registered sources. Reuse PluginManager, TaskSupervisor, PermissionKernel, FileConfigStore, CredentialBroker and TaskMediaPeer.
- The protected host consumer explicitly needs `companion.voice.input@1`. Provider/model/source/grant/config/credential generations are checked by the host. Generic SDK media/native access remains unavailable.
- Provider settings use the existing normalized URL policy: no userinfo/query/fragment; HTTPS except exact loopback HTTP. `local-client-id` is loopback-only and uses the public identifier `magpie-dsh-pet`; User-Agent is `dsh-pet-voice/1`.
- The `asr-api-key` process slot is independent of text/DSH/AstrBot credentials and bound to the full normalized target/auth mode. Target/auth changes clear it; model-only changes preserve it. Desktop cannot write it.
- Config/credential writes use captured CAS baselines. A preference or key success cannot replace a dirty provider draft. Host-only committed Config observations may synchronously fence provider selection; do not expose raw Config in SDK/SSE. Finish-mode-only changes preserve an existing capture.
- Empty model allows current-binding catalog reads, but not inference. Use `kind=all`, explicit role metadata then the bounded known-name classifier. The same pure settings projector decides codec/model eligibility. TTS is excluded; unsupported ASR candidates remain nonselectable. Catalog success is not an inference check.

### Capture and result

- f32le, mono,16kHz; chunks at most1600 samples, clip at most320000 samples/1,280,000 bytes. MiMo's PCM16 WAV/data URL exists only inside its bounded native codec.
- One active capture/ASR per client binding; at most4 active service captures. Terminal results retain metadata/transcript for120s, up to32 records. No implicit queue or audio persistence.
- A fresh client binding represents one authenticated connection generation and canonical Agent. `captureId` deduplicates identical begin intent; changed fields conflict. `VoiceBeginSelection` carries the rendered feature revision/provider/binding/mode. Main adds actual client/Agent identity, never replaces selection with a fresh view.
- Main owns the trusted console frame, microphone task and completed desktop clip. Renderer owns sampling. Pet frames have no microphone owner or relay.
- `startCapture` returns its operation synchronously. `ready` must settle before frames. Finish stops tracks, asks for a tail, waits END and every actual frame ACK, and waits actual resource release before ASR. Normal finish continues accepting its tail; only cancellation/failure drops it.
- Cancellation fences immediately, but cannot pretend pending getUserMedia or context closure is complete. Old exact frames may send cleanup-only release ACKs after retarget; those ACKs cause no new permissions, HTTP or text.
- A service ticket does not grant browser device permission. Web checks secure-context/API availability before admission, then requests the real device after explicit action. Native permission stays Main-owned.
- One accepted binary upload invokes ASR once. Unknown upload outcome is recovered by GET on the same ticket, never re-uploaded. Final text uses the existing immutable commandId/payload outbox; changed text is a new intent. Typed draft and voice preview remain separate.
- Each bridge has its own state and revision domain. Voice operations confirm their connection through the actual companion bridge; a `DesktopVoiceState` must never be adopted as `DesktopCompanionState`.

### Budgets

| Boundary | Limit |
| --- | --- |
| Public VoiceView / catalog / complete result | 16KiB / 48KiB / 64KiB UTF-8 Result |
| Desktop voice state / existing aggregate IPC | 24KiB / 80KiB |
| Upload body / complete operation / native remainder / client | 15s / 55s absolute / min(40s, remaining) / 60s |
| Catalog | 30s; normalized candidates <=64 |
| Raw gateway catalog / MiMo request | 1MiB each; raw catalog rows <=512 |

Check a complete result's encoded size before publishing terminal state. Overflow produces a retrievable quota failure; do not truncate a transcript or publish an unreadable result. Raw cleanup may outlive a deadline and remains pending until settled.

## 4. Validation and error matrix

| Condition | Required behavior |
| --- | --- |
| Wrong frame/target/binding/source/selection | Refuse before device/credential/network use; no retarget to latest state |
| Nonfinite/misaligned/incorrect count PCM | `audio-format`; no partial successful result |
| Zero samples or no final speech | Empty/no-speech result; no empty message |
| Body, concurrency, transcript or projection overflow | `quota-exceeded`, fence and drain |
| Gateway401/403 | Voice-local `auth-failed` inside HTTP200; text bearer/SSE remains live |
| Actual service bearer/origin rejection | Real401/403; keep it distinct from provider failure |
| ASR terminal failed/error | Preserve fixed KernelError in UI; pending copy only for pending phases |
| Arming finish attempt | UI offers cancel only; exceptional finish without a summary still fences its ticket |
| Release or ACK failure | No success ACK/ASR; retain truthful cleanup failure |
| Old response/retired frame | No mutation of replacement state; only original cleanup is permitted |

## 5. Good, base and bad cases

- Good: explicit record → acknowledged full/tail frames → actual release → one ASR result → review or one normal message; ongoing work keeps its identity and single side effect.
- Base: saved empty model can discover catalog; thinking/work alone does not disable capture; a failed catalog cannot look like an empty successful list.
- Bad: using current refs to dispatch an old transcript, adopting another bridge's revision, resetting another field's dirty draft, or hiding a terminal ASR error behind “no result yet”.

## 6. Required tests and assertion points

- [Neutral capture tests](../../../plugins/audio-capture/src/browser.test.ts): deferred permission/ACK/close stays pending, partial tail is emitted **after** finish, cancellation/failure during finish rejects partial counts.
- [Service voice tests](../../../apps/companion-service/src/voice.test.ts): actual controlled native HTTP/WAV, bounded deadlines, CAS/credential/target effects, result replay, source withdrawal and text isolation.
- [Main controller tests](../../../apps/desktop/src/main/shared-voice-controller.test.ts) and [host tests](../../../apps/desktop/src/main/shared-voice-host.test.ts): real frame/source task ownership, original-frame cleanup ACK, native source drain, no replacement before actual release.
- [Consumer state tests](../../../apps/desktop/src/renderer/shared/use-companion.test.ts): voice revision999 must not replace companion revision2; stale actions do zero new-target dispatch.
- [Controlled DOM](../../../plugins/text-client/tests/browser/voice-input.browser.mjs): real controls for finish/review/cancel, failed outcomes, dirty drafts/CAS, no unsafe-context admission and bounded layout. This is not native permission evidence.
- [Production runner](../../../qa/probes/companion-voice-input-native.mjs): frozen artifacts, actual device/worklet/bridge/HTTP/tail counts, permission/source/target retirement and cleanup. Real model/real hardware are separate explicit scopes.

## 7. Wrong versus correct

Wrong: `if (closing) return` in the frame sender, while finish sets closing before requesting its tail. Correct: only abandoned/failed captures stop accepting frames; finish waits the emitted tail and its ACK.

Wrong: `voiceBridge as unknown as DesktopCompanionBridge` to reuse `settle()`. Correct: use the actual companion bridge for connection confirmation, and keep the returned VoiceView in voice state.

Wrong: apply every returned view to every field after saving one preference. Correct: advance only the saved baseline, preserve independent dirty fields, and require explicit rebase for external revision changes.
