# Shared voice input — implementation contract

Status: retained planning/review record for M4 (started2026-11-09). Implementation and executable declarations now exist. The current maintained contract is [shared voice code-spec](../../../../spec/backend/shared-voice-input.md), which links directly to authoritative source signatures and validation boundaries. Do not update or copy the historical declaration sketches below as a second schema. [Design](design.md) explains the decisions; [plan](implement.md) retains its C1–C12 references. Executed scope is maintained in [acceptance](../../../../../qa/fixtures/companion-voice-input/acceptance.md).

## C1. Terms and invariants

- **Capture intent:** one explicit recording attempt, identified by captureId. It is neither a canonical message nor a logical work task.
- **Client binding:** one authenticated web connection generation or Main connectionId, plus the confirmed service Agent. A clientId is a fresh opaque UUID for that binding, not authentication or Agent identity.
- **Provider binding:** one active source generation, package fingerprint/policy epoch, committed provider Config revision and credential version. Public bindingId is an opaque equality token for that exact binding, not authority by itself.
- **Final transcript:** bounded text from a successfully completed ASR operation. It is not user input until the owner-selected finish/send flow dispatches an ordinary message.
- **Message intent:** the existing immutable CompanionMessageCommand. It has its own commandId and canonical receipt; never equate it with captureId, supervisor taskId or an execution Session.

One current capture/ASR per client binding; at most four active service captures overall, no new queue/scheduler. Busy Agent/work is not capture busy. Begin does not stop foreground, work or playback. Default finish mode is send; preview is optional. No partial result, cancellation, catalog read, provider save or source reload submits a message.

Audio and unfinished transcripts are transient process memory. No SQLite schema/version change, new history table, PCM log, localStorage/IndexedDB recording or audio artifact is introduced. Accepted canonical messages retain existing state/receipt/memory semantics.

## C2. Sources, capabilities and Config

All three roles use ordinary PluginManager registration and existing desired-active/removal controls. Names here are proposed new identifiers, not presently implemented APIs.

| Source | Provides | Consumes / native host grant | Config identity and behavior |
| --- | --- | --- | --- |
| pet.shared-voice (service) | companion.voice.input@1 / input, JSON describe | capability-use companion.voice.asr@1; plugin-data read-write | default instance: providerRef and finishMode; immediate preferences, no Core reload |
| pet.asr-magpie (service) | companion.voice.asr@1 / magpie, JSON describe; features.nativeAsr=1 | plugin-data read-write; credentials key asr-api-key; private target-bound ASR transport | default instance: baseUrl/modelRef/authMode/protocol; provider-only reload |
| pet.audio-capture (desktop) | input.audio.capture@1 / renderer, JSON describe | microphone | empty Config schema version1; actual Linux/Windows runtime source, console samples |

Service manifests declare actual portable runtime targets, initially linux-x64/win32-x64; add other platforms only with packaging evidence. No old Windows ASR/talk-key/source is admitted by changing its platform or the shared forbidden list. Only the now-real audio-capture ID leaves the shared forbidden list, after its actual manifest/entry/lifecycle are implemented. voice-chat/local Core stay forbidden.

Each JSON describe method declares methodPermissions: service sources require plugin-data read; audio-capture description requires no device permission and declares an explicit empty methodPermissions list. Description never opens a mic, loads a model or probes a gateway. Host-private operations acquire authority independently; a successful describe is not permission to dispatch native work.

Config schemas have additionalProperties:false and these exact fields:

```ts
type VoiceFinishMode = 'send' | 'review';
interface VoiceFeatureConfig {
  providerRef: string; // installed pluginId/providerId; default pet.asr-magpie/magpie
  finishMode: VoiceFinishMode; // default send
}
interface VoiceAsrSettings {
  baseUrl: string; // normalized /v1 gateway API base; max2048 units
  modelRef: string; // empty initially, otherwise exact full gateway ID, max128 units
  authMode: 'local-client-id' | 'gateway-key';
  protocol: 'mimo-native'; // only execution codec used in this increment
}
```

Provider defaults: baseUrl=http://127.0.0.1:3425/v1, modelRef='', authMode=local-client-id, protocol=mimo-native. No environment's discovered model becomes every user's default. The feature/provider Configs have version1 and use existing expectedRevision CAS. Binding invalidation is scoped to these owners; neither text model configuration nor pet.companion-client baseUrl/token is edited.

The provider's pure settings projector is the single model/codec eligibility authority at Config save/binding construction: empty model is allowed for catalog; a nonempty selection must be a full non-group vendor/mimo-* dedicated-ASR reference supported by the chosen codec. C5 candidate selectability calls that same helper, never a second UI validator. This establishes owner-configured structural eligibility, **not** proof the vendor/model is installed or advertised for every key. There is no inference or mandatory catalog round trip during save/begin/transcribe; Magpie authoritatively enforces current model/account/key permission when called. Native transport requires input.modelRef===the committed captured selection and builds vendor/bare-model/path only from that selection; mismatch refuses before credential/network use. Catalog is permitted with modelRef='' under the same valid gateway/auth binding.

Provider save fences old captures immediately after successful CAS, before fallible reload/drain. Same-target model changes can retain that provider's credential slot; target/auth-mode changes rotate it. No replacement binding becomes usable until old raw operations settle. A failed CAS leaves the old healthy binding unchanged. Changing finish preference affects new captures, not the mode already printed on an active capture's finish control. Changing the selected provider fences that feature's outstanding captures; private dispatch must match the selected provider as well as hold capability-use. A finish-preference-only save does not cancel a legitimate captured operation.

## C3. Browser-safe declarations and projections

New declarations belong in packages/contracts/src/companion-voice.ts, with fixed desktop additions in desktop-voice.ts. Runtime validators use existing AJV/closed guards; root exports stay browser-safe/type-only where required. Use the existing KernelError/Result and CompanionMessageCommand rather than redeclaring them.

All ids use the existing public ID grammar/max128 units unless otherwise stated; revisions are nonnegative safe integers, timestamps Unix milliseconds. ProviderRef is an installed pluginId/providerId selector, not a URL. Gateway modelRef is opaque: do not apply the command-ID regex to it, and do not construct it from a display label.

```ts
type VoiceFinal = { kind: 'final'; text: string } | { kind: 'no-speech' };
type VoiceSourceState = 'ready' | 'disabled' | 'unavailable';
type VoiceReadiness = 'unconfigured' | 'configured' | 'unavailable';
type VoiceReason = 'feature-disabled' | 'provider-disabled' | 'source-unavailable'
  | 'model-unconfigured' | 'key-required' | 'unsupported-protocol' | 'cleanup-pending';
interface VoiceProviderView {
  providerRef: string; label: string; synthetic: boolean;
  source: VoiceSourceState; configRevision: number;
  settings: VoiceAsrSettings; bindingId: string | null;
  credential: {
    available: boolean; writable: boolean; version: string;
    source: 'none' | 'memory' | 'environment' | 'local-client-id';
  };
  readiness: VoiceReadiness; reason: VoiceReason | null;
}
interface VoiceView {
  version: 1;
  feature: { source: VoiceSourceState; configRevision: number;
    providerRef: string; finishMode: VoiceFinishMode };
  providers: readonly VoiceProviderView[]; // max4 installed registrations
}
interface VoiceCandidate {
  modelRef: string; label: string; role: 'asr';
  classification: 'metadata' | 'known-name';
  protocol: 'mimo-native' | null;
  selectable: boolean; reason: 'unsupported-protocol' | null;
}
interface VoiceCatalog {
  providerRef: string; bindingId: string;
  candidates: readonly VoiceCandidate[]; // ASR candidates only; max64 + final byte guard
}
```

A nonnull bindingId may exist for an active saved gateway with no selected model so that catalog discovery is usable; inference readiness remains unconfigured until model/codec/auth are complete. Configured means the current source/config/auth shape allows an explicit attempt; it does not mean recognized speech, authorized inference or verified quality. No verified/healthy badge is derived from catalog200. Keys/raw Config/private native references never appear. Desktop forces credential.writable=false. VoiceView stays <=16KiB; catalog <=48KiB UTF-8 including Result. If a complete normalized ASR catalog cannot fit, fail quota-exceeded rather than silently omit or claim completeness. No cached success after a current failed fetch.

The existing companion snapshot and DesktopCompanionState remain unchanged. Separate voice reads avoid a duplicate canonical snapshot and leave their64KiB/80KiB budgets intact.

## C4. HTTP and management DTOs

Reuse server bearer/origin/no-store/error handling **before** parsing JSON or binary. All JSON requests/responses remain <=64KiB; responses follow Result<T>. Use exact keys. Save does zero inference. Credential ingress uses the existing credentialIngressAllowed predicate; it is not made public by forwarded TLS headers.

| Method/path | Request | Success |
| --- | --- | --- |
| GET /api/voice | none | 200 VoiceView, including disabled/unconfigured facts |
| POST /api/voice/settings | {expectedRevision,providerRef,finishMode} | 200 VoiceView after feature Config CAS |
| POST /api/voice/provider | {providerRef,expectedRevision,settings:VoiceAsrSettings} | 200 VoiceView with saved facts; configured != applied if cleanup failed |
| POST /api/voice/credential | {providerRef,expectedRevision,expectedCredentialVersion,value:string\|null} | 200 VoiceView; null deletes current process slot; no durable secret-bearing receipt |
| GET /api/voice/catalog?providerRef=...&bindingId=... | exact installed ref/current equality token | 200 VoiceCatalog; same saved target/auth as inference |
| POST /api/voice/captures | VoiceBegin | 201 VoiceTicket; no model call |
| GET /api/voice/captures/{captureId}?clientId=...&agentId=...&serviceEpoch=... | matching transient ownership | 200 VoiceCaptureResult |
| POST /api/voice/captures/{captureId}/audio | binary with fixed ownership/sample headers below | 200 VoiceCaptureResult after actual ASR settlement |
| POST /api/voice/captures/{captureId}/cancel | {clientId,agentId,serviceEpoch} | 200 settled cancelled/result state; never a foreground/work stop |

Feature lifecycle uses existing service plugin enable/disable operations, not a second enable API. Disabled feature does not expose a live binding; the settings view can show saved nonsecret facts through existing host-owned management authority. Provider selection accepts only registered ordinary native-ASR providers. Secret writes are rejected403 outside private ingress; there is no desktop relay for that route.

Provider gateway target uses the M1 URL policy: no userinfo/query/fragment, normalized base including API path, HTTPS except exact loopback HTTP; local-client-id is loopback only. Same-origin fixed codec suffixes are appended to the saved API base, not accepted from an HTTP request. AuthMode=local-client-id sends public client identifier magpie-dsh-pet; gateway-key borrows only this provider's process slot. User-Agent is fixed dsh-pet-voice/1, never AstrBot. Catalog and ASR use the same selected credential policy; unauthenticated research catalog results do not override actual configured key restrictions.

Downstream voice/provider failures do not invalidate a healthy service bearer/SSE connection. Capture operation failures return serviceHTTP200 with phase=failed and fixed error. Catalog downstream failures return serviceHTTP200 Result{ok:false,error}, including provider auth-failed/permission-denied; the voice route catches these before the server's generic error-to-HTTP mapping. Only the service's own authorization/origin gates emit401/403. Voice consumers display the provider failure without disconnecting the text client or replacing its snapshot. Request validation/CAS errors retain normal400/409 handling; no second error taxonomy is added.

The provider slot binds providerRef + full normalized baseUrl/path + authMode, with fresh process/slot generations. Reuse the existing broker/redactor/private-lease pattern, with key asr-api-key and an independently managed slot. No text/DSH/AstrBot key import or forwarding, no new cipher/plaintext file. Environment seeding, if exposed as a composition option, requires an explicit matching voice base URL and never reads another application's environment/profile. Config/key changes fence catalog and ASR results independently of text auth.

## C5. Catalog classification

Fetch only the saved gateway's GET {baseUrl}/models?kind=all. Maximum private response1MiB, at most512 rows,30s; forbid redirects and non-JSON/malformed data/id fields. Normalize only actual returned IDs, bounded to128 UTF-16 units and without controls/whitespace. Labels are display-only, capped at80 code points; never shorten routing IDs. Discard raw gateway body after normalization; no public account/quota/provider-settings route is queried.

Classification is shared pure provider code, not UI inference:

1. Inspect provider_type, serves, kind in that order, recognizing the reference's exact aliases: speech_to_text/transcription/asr/stt→ASR; text_to_speech/speech/tts→TTS; embedding/rerank/image/video/decision→other. Explicit chat/audio-understanding metadata remains chat even if it accepts audio. Conflicting explicit task roles are unavailable, not guessed.
2. If no task role is known, inspect only the final model-name component, case-normalized. Use the reference's bounded token expression for asr/whisper/transcribe/transcription/sensevoice or tts. Do not match arbitrary substrings, generate model names or turn input_modalities.audio into ASR. Otherwise preserve chat/unknown and exclude it from ASR choices.
3. Normalize TTS/other only to filter them out; do not add TTS API, settings, model methods or UI. For ASR rows, this increment supports qualified non-group vendor/mimo-* references with a dedicated ASR name and protocol=mimo-native. Other actual ASR candidates return selectable=false/unsupported-protocol; there is no silent protocol/model fallback.

The reference host's xiaomi/mimo-v2.5-asr is a known local candidate. It is not compiled as a global default. Catalog success is not an inference check, and state/key failures never turn into an empty successful catalog. Compare bindingId again after fetch; old results cannot populate a replacement's picker.

## C6. Private ordinary-provider/media seam

New host-only declarations live in packages/companion-runtime/src/voice-input-types.ts and a small source-bound registration/controller module; public declarations do not import host-kernel.

```ts
interface NativeAsrInput {
  modelRef: string;
  format: { encoding: 'f32le'; sampleRate: 16000; channels: 1 };
  samples: number;
  audio: MediaReadEndpoint; // exact task-owned, single-consumer reader
}
type NativeAsrFinal = VoiceFinal; // browser-safe final/no-speech union, imported once
interface NativeAsrBinding {
  catalog(signal: AbortSignal): Promise<readonly VoiceCandidate[]>;
  transcribe(input: NativeAsrInput, signal: AbortSignal): Promise<NativeAsrFinal>;
}
interface VoiceAsrPorts {
  authorizedMagpie(baseUrl: string): AuthorizedMagpieAsrTransport;
  bind(binding: NativeAsrBinding): () => Promise<void>;
}
// The transport is host-only, target/model bound; no arbitrary URL/header/method API.
interface AuthorizedMagpieAsrTransport {
  catalog(signal: AbortSignal): Promise<unknown>;
  mimoAsr(input: {modelRef: string; wav: Uint8Array}, signal: AbortSignal): Promise<unknown>;
  close(): Promise<void>;
}
```

The feature factory createSharedVoicePlugin(portsFor) also returns an ordinary PluginDefinition; it owns the bounded transient records and binds only the following private flow methods. The application HTTP adapter owns parsing/auth and the provider controller owns Config/credential management, not another feature store.

```ts
interface VoiceInputNative {
  begin(input: VoiceBegin): Promise<VoiceTicket>;
  result(key: VoiceResultKey): Promise<VoiceCaptureResult>;
  upload(key: VoiceResultKey, samples: number, pcm: AsyncIterable<Uint8Array>,
    signal: AbortSignal): Promise<VoiceCaptureResult>;
  cancel(key: VoiceResultKey): Promise<VoiceCaptureResult>;
}
interface SharedVoicePorts {
  bind(feature: VoiceInputNative): () => Promise<void>;
  recognize(providerRef: string, bindingId: string, samples: number,
    pcm: AsyncIterable<Uint8Array>, signal: AbortSignal): Promise<VoiceFinal>;
  currentAgent(): Promise<{id: string; acceptsInput: boolean}>;
  validateBegin(input: VoiceBegin): Promise<void>;
}
```

Implementation refinement: catalog candidates are provider data; the host stamps providerRef/bindingId after checking the current binding, so a provider cannot invent those public authority-correlation fields. validateBegin is the host's checked feature-revision/provider-binding admission before device permission; it performs no network/model call. The trusted runtime adapter implements recognize using the C6 provider task/media pair; the feature never receives a raw gateway transport or secret. Add the protected companion-host consumer's explicit companion.voice.input@1 use permission for native route dispatch, then acquire the feature's own source/config lease before calling the bound flow. No root authority is silently inherited by arbitrary SDK calls. Feature disposal fences all its records and drains them; HTTP routes become unavailable, while the existing management view can still describe disabled saved facts.

A factory createMagpieAsrPlugin(portsFor) returns an ordinary PluginDefinition, like the existing native model connector. It must register the catalog-capable binding with an empty model; unlike the text connector's model-empty early return, only transcribe is then not-ready. Missing auth blocks actual I/O, not access to nonsecret saved settings/credential provisioning. Service composition passes a checked VoiceAsrRegistration (manifest/directory/definition/preset/enabled/hostCredentials plus providerId and pure config projector). The host derives owner/generation/fingerprint/revision/policy; callers never supply those as authority. A fixture registration has the same interface and explicitly synthetic metadata.

The feature acquires capability-use companion.voice.asr@1 under withSourceAuthority. Private provider dispatch separately acquires its files/plugin-data read lease, then a supervised broker credential borrow for the exact asr-api-key source/target. authorizedMagpie rejects a base URL that differs from the current committed provider target or its credential-slot binding; it cannot manufacture authority for another URL. Every awaited admission/return/callback rechecks the captured binding. Activation can register private ports but starts no request. The async disposer fences immediately and awaits all actual operations and broker drains. Consumer cancellation cancels only that operation, not other clients' provider binding.

**Media adapter:** inside that provider task, derive {streamId,taskId,owner}; create paired existing TaskMediaPeer reader/writer endpoints with signalFor restricted to the exact live task. Wire receive/control through the kernel's existing frame/credit/end messages. Call grantInitial only after both endpoints exist. Repacketize HTTP chunks on4-byte sample boundaries into <=6400-byte PCM frames, preserve at most3 carry bytes, validate finite[-1,1] values and sample total. Await writer.end/credits and the real provider return; close both peers in finally. Do not let an HTTP header choose owner, taskId or stream reference.

The service SDK's openInput/openOutput remain unavailable for generic plugins. Readiness still rejects unsupported resources/microphone/generic network permissions. This provider's fixed host-native transport is explicitly registered, as with M1; no wildcard SDK fetch, network allow-all, worker, model-download adapter or legacy ASR admission is added. Native operations return null through TaskSupervisor JSON and retain actual values/errors privately. Await raw provider work, credential uses and TaskHandle.settled, not only result.

## C7. Capture DTOs, binary format and bounds

```ts
interface VoiceBegin {
  captureId: string; clientId: string; agentId: string;
  expectedFeatureRevision: number;
  providerRef: string; bindingId: string;
  finishMode: VoiceFinishMode;
}
interface VoiceTicket {
  version: 1; captureId: string; clientId: string; agentId: string;
  serviceEpoch: string; bindingId: string; finishMode: VoiceFinishMode;
  encoding: 'f32le'; sampleRate: 16000; channels: 1;
  chunkSamples: 1600; maxSamples: 320000; expiresAt: number;
}
type VoiceCapturePhase = 'awaiting-audio' | 'transcribing' | 'retiring'
  | 'final' | 'empty' | 'cancelled' | 'failed';
interface VoiceCaptureResult {
  ticket: VoiceTicket; phase: VoiceCapturePhase;
  samples: number; cleanup: 'pending' | 'settled';
  outcome: VoiceFinal | null;
  error: KernelError | null; completedAt: number | null;
}
```

VoiceFinal is declared once in companion-voice.ts and imported into the private alias. No native media object crosses the public result.

| Boundary | Exact initial bound |
| --- | --- |
| PCM format | finite little-endian Float32 mono16000Hz,1600 samples/frame, max320000 samples/20s |
| Clip raw bytes | max1,280,000; max6400 bytes in one renderer→Main frame, final partial frame allowed |
| Kernel media | existing256KiB chunk ceiling,8 unacknowledged frames,2MiB buffered/stream; never enlarge |
| MiMo private codec | WAV PCM16 mono16000Hz max640044 bytes; JSON body including base64 <=1MiB |
| ASR response / transcript | private response <=64KiB; final trimmed string <=COMPANION_MAX_TEXT=8000 UTF-16 units |
| Timing | device arming30s requests cancellation, clip20s, upload body15s, ASR40s, client upload request60s |
| Capture lifetime/result retention | begin ticket120s before upload; final result120s in RAM; max32 retained terminal records, oldest evicted |
| Service/client concurrency | four active captures overall; one active capture/ASR per clientId, no queue |
| Public/Main voice projection | VoiceView16KiB; catalog48KiB; capture result64KiB (the existing JSON ceiling); separate DesktopVoiceState24KiB |

Reuse/move the existing capture sample constants into one neutral contracts source; old local-ASR exports forward them, rather than create new literal owners. The actual AudioContext rate must match16000; otherwise report audio-format. No pretend resampling. MIME=application/octet-stream for completed f32le upload, with fixed X-Pet-Voice-Client, X-Pet-Voice-Agent, X-Pet-Voice-Epoch and X-Pet-Voice-Samples headers. Values must exactly match the ticket; sample header is canonical decimal0..320000, body length must equal samples*4. Reject extra ownership query parameters and malformed/duplicate ownership headers. Bearer stays in Authorization, never a URL.

Read the binary body incrementally after authorization; HTTP chunk boundaries need not be sample boundaries. Do not increase MAX_BODY or send PCM/base64 through supervisor JSON/preload snapshots. Provider-required data URL lives only inside the private bounded HTTP codec. Intermediate buffers have separate explicit clip/codec bounds; the2MiB media budget is buffered stream credit, not a claim that all JavaScript heap allocations sum to2MiB.

## C8. Service admission, idempotence and cancel

Begin validates current feature/provider/source, captured binding and canonical agentId before any device opens. Busy Agent passes; unavailable/quiescing interaction or invalid binding refuses explicitly. Duplicate captureId with identical begin fields returns its current ticket while retained; changed fields conflict. Another active capture for the same client conflicts. No native model request happens at begin, settings save, catalog or status read.

The begin record holds a feature-owned supervised lifetime until upload/cancel/expiry. Request completion after begin does not abort it. Service shutdown/feature withdrawal/provider invalidation cancels it. Idle abandoned tickets expire without inference. ticket.expiresAt is the upload-admission deadline; clear that timer when upload is admitted. A completed result instead expires120s after completedAt, so recovery does not incorrectly discard a retained result because its original upload deadline passed. No per-client credential/auth claim is inferred from clientId: the existing service bearer remains authentication; clientId/ticket are operation correlation within the current private-owner service.

Only one audio upload is admitted for a capture, atomically before consuming bytes. A duplicate upload never starts a second model call: return conflict and direct the client to the retained status read. No audio request is automatically replayed after timeout/disconnect. A zero-sample finish is empty/no-speech with zero model calls. Nonempty audio is not locally guessed silent by a new VAD heuristic.

After complete validated input, transition to transcribing and run exactly one provider operation. Never fetch catalog lazily as part of transcription. The upload has a55s absolute operation deadline from admission, including body/media/authority/codec/network; body reads get at most15s and native ASR at most min(40s,remaining operation time). Client timeout stays60s. Catalog has its separate30s explicit request budget, never30+40 inside the upload. Actual cleanup may outlast a cancelled deadline and remains pending/unknown, not a successful result.

Publish final/empty only after raw work and leases settle and binding/feature ownership remain valid. Before recording a final result, serialize the complete proposed Result envelope and require <=64KiB UTF-8; on overflow record failed/quota-exceeded with outcome=null, not an inaccessible oversized final or truncated text. Status reads use that same bounded stored result. Missing/malformed response, stale binding or failure is not a successful empty transcript. Result text is transient; the server does not call runtime.message.

Cancel atomically sets the cancellation fence first, aborts input/native operation, closes media and joins actual release. It publishes cancelled only after settlement; before then status is retiring/cleanup=pending. A final committed ASR result may be retained as the actual completed result if completion won; client cancellation still suppresses any not-yet-dispatched message. Cancel cannot erase an accepted message or cancel work. A client HTTP disconnect before response completion cancels its upload/ASR; use response close/aborted state, not only IncomingMessage.aborted after the body has already ended.

If the ASR response is lost, the client performs one explicit/coalesced status recovery with the same capture/client/Agent/epoch; a final retained result can be consumed once by the same live local intent. A transcribing result is pending, not failure or permission to upload again. Missing/expired capture or service restart is unknown/unavailable; do not recover by another paid call. Clear raw PCM after the upload attempt ends. No persistent audio/retry queue or new durable command kind is added.

## C9. Desktop/browser capture and fixed bridge

Desktop implements a separate frozen window.petVoice facade. Only the trusted current console main frame may call it; pet calls are rejected in this increment. It uses a render-captured DesktopCompanionTarget and never substitutes latest.current as a dispatch target.

```ts
interface DesktopVoiceState {
  version: 1; revision: number; connectionId: string | null;
  phase: 'idle' | 'arming' | 'recording' | 'finishing' | 'transcribing'
    | 'retiring' | 'error';
  captureId: string | null; samples: number;
  cleanup: 'settled' | 'pending'; error: KernelError | null;
}
```

The browser-safe facade below maps methods to fixed channels voice:desktop:v1:<method>; changed is invalidation only. T aliases the existing DesktopCompanionTarget, not a new target definition. Every request checks the trusted current console frame, exact keys/arity and this target. No credential write, arbitrary URL/path or raw IPC API is exposed.

```ts
type T = DesktopCompanionTarget;
type CaptureKey = {captureId: string};
type VoiceResultKey = {captureId: string; clientId: string; agentId: string; serviceEpoch: string};
type VoiceSettingsCommand = {expectedRevision: number; providerRef: string; finishMode: VoiceFinishMode};
type VoiceProviderCommand = {providerRef: string; expectedRevision: number; settings: VoiceAsrSettings};
interface DesktopVoiceBridge {
  readonly version: 1;
  getState(): Promise<Result<DesktopVoiceState>>;
  onChanged(listener: () => void): () => void;
  readVoice(input: T): Promise<Result<VoiceView>>;
  saveVoiceSettings(input: T & {command: VoiceSettingsCommand}): Promise<Result<VoiceView>>;
  saveAsrProvider(input: T & {command: VoiceProviderCommand}): Promise<Result<VoiceView>>;
  readAsrCatalog(input: T & {providerRef: string; bindingId: string}): Promise<Result<VoiceCatalog>>;
  begin(input: T & VoiceBeginSelection): Promise<Result<VoiceTicket>>;
  readCaptureResult(input: T & VoiceResultKey): Promise<Result<VoiceCaptureResult>>;
  captureReady(input: T & CaptureKey & {sampleRate: 16000}): Promise<Result<null>>;
  pushAudio(input: T & CaptureKey & {sequence: number}, payload: Uint8Array): Promise<Result<null>>;
  finishCapture(input: T & CaptureKey & {frames: number}): Promise<Result<VoiceCaptureResult>>;
  cancelCapture(input: T & CaptureKey): Promise<Result<DesktopVoiceState>>;
  reportCaptureError(input: T & CaptureKey & {reason: CaptureErrorReason}): Promise<Result<DesktopVoiceState>>;
  reportCaptureReleased(input: T & CaptureKey): Promise<Result<null>>;
}
```

Use the existing CaptureErrorReason union. Management command aliases also type the C4 JSON requests. Main capture state has no PCM/secret/transcript history and returns idle after final ASR handoff; client-local ready/review/submitting/uncertain phases belong to the one voice intent/outbox, not another Main authority state.

VoiceBeginSelection is Omit<VoiceBegin,'clientId'|'agentId'>. Desktop begin forwards the feature revision, providerRef, bindingId and finishMode captured in the caller's rendered view; Main adds only its actual client/Agent identity. It must not reread the latest view and silently replace those preconditions. A stale rendered provider/model/mode is refused by service admission before a device lease or microphone opens. Begin uses the caller's fresh captureId for idempotent begin/recovery, obtains the service ticket, starts a pet.audio-capture owner task with microphone lease, binds current console frame/source/connection and returns the ticket. The neutral renderer module calls getUserMedia only after this. captureReady must succeed before connecting source to worklet. Main validates sequence, <=6400 bytes, finite samples, total and exact owner on each push, and acknowledges only actual bounded acceptance. Finish verifies frame count and a sealed complete clip; no ASR upload until tail/acks have completed and renderer release is confirmed. reportCaptureReleased settles the microphone task, not the whole voice intent. finishCapture checks recorded release plus the still-current source/frame/client, rather than requiring a microphone lease that has legitimately ended; this avoids a release-versus-finish deadlock. Main then uploads its private owned clip through the exact captured service connection.

Extend the existing DesktopCompanionController with a **host-private voice service adapter**, not a public arbitrary transport. It delegates the fixed voice reads/saves/begin/upload/result/cancel helpers inside the existing source.withToken leases and captured connection work set, and notifies capture retirement before replacement. New operations join connection.work so disconnect/source withdrawal waits real HTTP cleanup. Client-ID generation is private and fresh per connection binding. Original text token/config/one SSE owner are unchanged.

Retirement has one cleanup-only exception to the current-target fence: reportCaptureReleased for the exact retained retiring record may acknowledge its original connectionId/captureId from that record's still-trusted console frame even after service auth/source fencing. It closes only that device task; it cannot grant permission, upload, send text, mutate a replacement view or acquire a new token. A replacement frame or unknown/cleared record is rejected. Without this narrow path, normal retarget would reject the very release acknowledgement it is waiting for. Source retirement retains that single record until release/framegone; tests must prove old release has zero service I/O and cannot affect a new capture.

Extend the existing driver stop wrapper for the exact capture-source stop callback; await Main release and runtime session.stop even if either fails. Owner signals revoke mic authority immediately. An inactive/changed source/frame cannot send a new frame or receive a successful release on a replacement intent. Electron permission request/check handlers accept only media/audio for this exact bound live console frame and deny camera/other frames. Add a microphone-readiness branch only for the real audio-capture source and the installed native capture adapter in the current mvpReadiness wrapper; old demoReadiness recognizes microphone only for legacy voice-chat. Do not relax other adapters or claim an existing Linux device from adapter installation. Console hide during sampling requests cancellation; console close/framegone cancels the unsubmitted pipeline. Do not make deny-all into allow-all.

The neutral browser module has a synchronous startCapture(ticket,events,{workletUrl}) handle with finish():Promise<{frames:number;samples:number}>, cancel():Promise<void> and released:Promise<void>. Events are ready(sampleRate):Promise<void>, push(samples):Promise<void>, failed(reason):void and limitReached():void; there is no callback that waits for server ASR before device release. Register before awaiting getUserMedia. Reuse mixing/finite checks, tail flush and serial acknowledgements. Finish stops tracks, flushes/acks, awaits graph/context release and returns counts; the owner then reports release and calls finishCapture. At20s, limitReached invokes that same finish action. Before begin, visible helper text beside the control (also linked with aria-describedby) must say “最多20秒，到时结束并发送” in send mode or “最多20秒，到时结束并预览” in review mode; only “开始录音” with no notice does not authorize hidden timeout sending. That text follows the ticket's captured mode throughout recording. Cancel discards without finish/upload. A late stream is included in release. Old Demo exports adapt this neutral module for retained experiments/tests; production imports no old hook/controller.

Permission pending is not cancelled by aborting a fetch or local flag. A late granted stream must be stopped before released resolves. Main may observe frame destruction as physical device-owner disappearance. Otherwise report retiring/cleanup-pending and keep another capture unavailable until actual release; the30s arming deadline requests cancellation but does not fabricate settlement. Kernel cleanup timeout can leave pending_restart, not successful disable.

On web, the same browser module owns tracks above page navigation, with browser secure-context/user permission. A server ticket still governs ASR admission; it is not a web microphone permission. Current HTTP LAN text access is insufficient for mic; no insecure-origin flag is a product solution. Console/window closure or connection retirement fences the local intent, disposes capture and aborts upload; send a ticket cancel only while the old authorized connection remains usable, otherwise idle ticket expiry/HTTP close performs server cleanup.

## C10. Final text, preview and existing outbox

Local phases are independent of model/work state. Once the matching final result arrives with cleanup settled, one current intent atomically chooses preview or message dispatch. On send mode, freeze {commandId,text} once, mark submitting before entering the existing message path, and recheck render-captured connection/Agent at admission and return. No audio generation method, new message endpoint or model instruction is used.

Source check: [web submit](../../../../../plugins/text-client/src/client/client.ts#L142) has accepted/uncertain/failed/skipped outcomes, and [its reducer](../../../../../plugins/text-client/src/client/state.ts#L105) keeps multiple entries keyed by commandId; it has no one-message lock. [Main command admission](../../../../../apps/desktop/src/main/companion-client-controller.ts#L559) also permits distinct IDs, coalesces the same in-flight ID, conflicts on a changed same-ID payload and refuses a new entry at16 pending items (message and stop combined). Do not invent a blanket rule that one unknown text command prevents all voice input.

Add an explicit-intent entry point alongside web submit(text): submitIntent(command:CompanionMessageCommand,target:{clientId:string;agentId:string}):Promise<SubmitOutcome>. The voice adapter captures that target at begin; CompanionClient creates a fresh private clientId at each connection generation and checks the supplied target at admission and settlement. It uses the same sendMessage transport, outbox reducer and receipt reconciliation with that connection's AbortSignal. Never dispatch against a newer #transport after an await. Ordinary text submit can delegate with the current target captured synchronously, preserving its same-text retry behavior. Same-ID/different-payload refuses before dispatch without replacing the old entry. Voice holds one local in-flight submission promise, so repeated finish/result recovery cannot dispatch it twice. Desktop uses the existing sendMessage path with an explicit ID. Do not use the web same-text retry heuristic for a different spoken utterance: equal distinct utterances have different IDs; an explicit retry of the same uncertain message retains its original ID/payload.

A blocked actual admission (offline/stale target, Main pending capacity, or an existing consumer-specific submission lock) leaves final text locally ready and **not submitted** with the concrete reason. It neither overwrites an old command nor pretends a message is uncertain when no HTTP began. Keep one such owned voice draft; no automatic queue/retry when a slot opens. The owner explicitly sends it when ready or discards it before recording another; typed input remains independently usable. Test another uncertain text entry unchanged while a distinct voice entry is accepted, and the full-Main-capacity case with zero new HTTP plus retained voice text.

Before dispatch, capture cancel/retarget/feature withdrawal suppresses final/review submission. After dispatch, cancellation is message uncertainty/ordinary foreground or selected-work control, not a rollback claim. A late ASR result cannot create an intent after cancellation. If canonical inputId confirmation precedes a dropped/late receipt, preserve existing outbox settlement; no pending resurrection or guessed receipt.

Preview is one transient editable voice draft, bounded by COMPANION_MAX_TEXT and tied to its capture/client/Agent. It preserves a pre-existing typed composer draft. An edited preview freezes a new message intent; once attempted, changed text must use a new ID. Retargeted preview can remain visibly stale/read-only for recovery, but never auto-send/copy to another target. Provider Config changes fence in-flight ASR; a final text already delivered before the change remains a user-owned draft, while source/client retirement still forbids automatic submit. No background refresh overwrites draft text.

Zero samples/empty returned content becomes no-speech and submits nothing. Missing content, content of the wrong type, reasoning_content-only or tool calls are asr-failed, never user transcription. A provider transcript beyond the existing text budget is quota-exceeded, not silently truncated. Nonempty final text is trimmed once and enters the same M3 explicit-memory/user-message admission as typed input; partials and provider commentary never do.

## C11. Codec and error mapping

For MiMo, retain modelRef=vendor/mimo-* in config/view. Parse the first slash only; validate the nonempty selected vendor component and dedicated-ASR remainder, reject group and unsupported voiceclone/other protocols. Percent-encode the vendor as one path segment. Native POST target is {savedBase}/magpie/native/{vendor}/v1/chat/completions; JSON model is the bare remainder. For the observed reference that is bare mimo-v2.5-asr, not an extra magpie/ prefix.

Convert validated f32le samples to RIFF/WAVE PCM16 mono16k, then bounded data:audio/wav;base64 inside user message content [{type:'input_audio',input_audio:{data:...}}], model=bare ID,max_completion_tokens=1024. No persona/history/tools/system reasoning or general audio-understanding prompt is injected. Read only choices[0].message.content as a final string. Reject reasoning-only/tool/incomplete/malformed output and raw secret echoes using decoded redactor checks. Do not forward provider error bodies, URLs, keys or user audio to errors/logs. Redirects are refused; cancellation joins body/reader/socket settlement before a replacement is used.

| Condition | Public result / submission |
| --- | --- |
| Wrong service bearer / foreign Origin | existing401 auth-failed /403 permission-denied; no ticket/model |
| Invalid frame/type/PCM/header/arity | invalid-input or audio-format; no model, no text |
| Stale client/Agent/epoch/binding/CAS or another active client capture | conflict/stale-owner as appropriate; never retarget |
| Feature/provider disabled, missing key/model, unconfirmed cleanup | not-ready with fixed view reason; no inference |
| Provider401/403,429,network/deadline | auth-failed,rate-limited,network/timeout; no second route/model |
| Provider400/404/unsupported native response | unavailable/asr-failed; no fake empty success |
| Valid empty string / zero samples | empty + outcome no-speech, no message |
| Missing/wrong content, reasoning-only, tools | asr-failed, no message |
| Clip/body/catalog/transcript budget overflow | quota-exceeded, cancel and drain |
| Cancel/source withdrawal while work outstanding | retiring/pending until physical settlement; then cancelled/error, no late submit |
| Missing retained ASR result after crash/expiry | unknown/unavailable recovery, no re-upload |
| Lost message response after actual dispatch | existing uncertain outbox, same-ID explicit retry; no new command |

Use existing fixed error taxonomy; adjust the existing asr-failed display text to a provider-neutral message rather than introducing raw messages or a second error hierarchy. That copy change preserves the code's meaning for old local providers.

## C12. Evidence and acceptance boundary

Implementation must establish: real controlled gateway HTTP request/body/headers, actual TaskMediaPeer credits/owner/cancel, Config/credential CAS fencing and raw settlement, production web worklet/static asset and Electron Main/preload permission paths, source disable/removal, same-Agent text/receipt/memory continuity, thinking plus independent work, late getUserMedia, and message uncertainty across retarget. [Implementation plan](implement.md) owns the test list and commands.

Synthetic PCM/fixture transcripts prove transport/control only. The final real short-audio check needs an explicitly approved/supplied public test clip or deliberate microphone action, exact service/gateway/model/auth target and a bounded budget: one ASR request with at most3s of approved audio, max_completion_tokens1024 and the40s provider deadline, no automatic retry or TTS, and harmless test speech rather than tool-triggering instructions. If not separately authorized, mark live effect unverified rather than fabricate a usable-recognition claim. No private account/config/persona/provider screenshot or original4120 data is consulted to manufacture a check.
