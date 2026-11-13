# Runtime media and participation-model research

Recorded 2026-11-12. Read-only source inspection; only this research file was written. No model, service, device, external endpoint or account was called; no test was executed. This supplements [runtime entry research](runtime-entry.md), not a replacement architecture review.

## Confirmed scope and conclusion

Current [PRD Q1/Q7–12](../prd.md#L11) selects both official QQ WebSocket and OneBot v11; allowlisted private users and selected groups; restricted participant tools/own tasks; private-by-person and group-by-group visibility with explicit public facts; configurable group participation; optional Magpie participation judgment; **text, images, voice and files in the first release**. Media is not an optional later milestone.

Existing mechanisms are reusable, but none establishes end-to-end QQ media readiness:

| Required path | Existing reusable mechanism | Missing integration |
| --- | --- | --- |
| Image input | Cortico structured image content and blob-to-image serialization | Canonical attachment references, checked download/storage, audience-scoped resolution, actual model image capability and Harness projection |
| Image/file output | Binary task artifacts and checked file streaming | Formal reply attachment association, audience authorization, protocol upload/send receipts |
| Voice input | Shared M4 ASR with source/credential/media lifetime | QQ download/decode/resample, external-message correlation and source-authorized ASR entry |
| Voice output | M5 canonical assistant admission and bounded PCM synthesis | QQ export consumer, encoding/container handling, upload/send ownership and receipt |
| Participation judgment | Native `ResponseClient`, source leases and Magpie transport | Independent purpose/model binding and budget; current selection is foreground-only |

## 1. Cortico supports image content; the product path is still text-only

### Verified facts

- The installed dependency is Cortico **0.2.7** ([package declaration](../../../../plugins/harness-cortico/package.json#L21)). Its resolved package is the patched pnpm installation. Dependency links below use the existing `plugins/harness-cortico/node_modules/cortico` symlink to that inspected source.
- The product's model interface is `ResponseClient.respond(Request, options)`, retaining native request/response/options/attempts. It is not restricted to a string request by this facade. Its `role` and `sessionId` options are metadata, not a product role selector. See [native facade](../../../../plugins/harness-cortico/src/harness.d.mts#L9).
- Native Responses schema supports `input_image` with `image_url`/detail and `input_file` with filename/file_data/file_url. Native Chat mapping converts `input_image` to an `image_url` part; file input requires inline `file_data`. See [generated input definitions](../../../../plugins/harness-cortico/node_modules/cortico/src/protocol/open-responses/generated.ts#L11) and [Chat mapping](../../../../plugins/harness-cortico/node_modules/cortico/src/providers/transport/native-input.ts#L28).
- Responses serialization preserves structured content; it can also resolve context image blobs into data URLs when `media.enabled()` and `media.read(handle)` are supplied. Automatic blob promotion is **images only**, not arbitrary audio/files. See [Responses serialization](../../../../plugins/harness-cortico/node_modules/cortico/src/providers/transport/responses-input.ts#L93) and [media rendering](../../../../plugins/harness-cortico/node_modules/cortico/src/providers/transport/history.ts#L25).
- Cortico events support blobs; new bytes are interned into its log attachment store. `modelFacts.accepts(mime)` consults provider facts or the provider's `multimodal` flag. See [event contract](../../../../plugins/harness-cortico/node_modules/cortico/src/core/types.ts#L30), [Core blob admission](../../../../plugins/harness-cortico/node_modules/cortico/src/core/core.ts#L481) and [model MIME gate](../../../../plugins/harness-cortico/node_modules/cortico/src/core/core.ts#L456).
- The symbol `ChatClient` in the inspected Cortico source is the ConsoleWorld peer/name/language record, not this service's model transport. That upstream console accepts up to eight images, 8 MiB each, JPEG/PNG/WebP/GIF, and submits image blobs. These are **upstream console limits**, not current dsh-pet/QQ limits or an authorization model to copy. See [ChatClient/image parser](../../../../plugins/harness-cortico/node_modules/cortico/src/worlds/console/world.ts#L147) and [console blob submission](../../../../plugins/harness-cortico/node_modules/cortico/src/worlds/console/world.ts#L451).

The current project does not wire those capabilities through:

- `CompanionMessageCommand`/`CompanionMessage`, State acceptance and `HarnessInput` carry text, not media parts/references. Harness validation is closed to `{id,text,kind,taskId?}`, bounded to 60,000 serialized bytes; ordinary control JSON remains 64 KiB. See [message DTOs](../../../../packages/contracts/src/companion.ts#L49), [command DTO](../../../../packages/contracts/src/companion.ts#L129), [State validation](../../../../plugins/state-sqlite/src/validation.ts#L101) and [Harness validation](../../../../plugins/harness-cortico/src/boundary.mjs#L74).
- The service Harness pushes only its JSON text envelope into Core, projects historical messages as text, and configures no `multimodal` flag. Its persona `blobs.put` throws and `get` returns null; Core log blobs exist upstream, but cannot become the product's canonical media authority across disposable Harness generations. See [Harness provider config](../../../../plugins/harness-cortico/src/harness.mjs#L132), [persona/blob stub](../../../../plugins/harness-cortico/src/harness.mjs#L284) and [event submission](../../../../plugins/harness-cortico/src/harness.mjs#L417).
- The actual Magpie client is a **ResponsesProvider**, not a Chat Completions client. Its factory supplies no `media` resolver. Explicit native `input_image` parts can be represented, but adding only `context.blobs` would not make this transport resolve them. Also, provider replay uses `options.context` when present, so changing only `request.input` while leaving an older context is insufficient. See [Magpie provider](../../../../plugins/model-connection-magpie/src/native-provider.mjs#L12), [Responses provider options](../../../../plugins/harness-cortico/node_modules/cortico/src/providers/openai-responses-compat/native.ts#L15) and [context precedence](../../../../plugins/harness-cortico/node_modules/cortico/src/providers/transport/native-input.ts#L22).
- Current `ResponsesConnectionSettings` has only baseUrl/model/authMode; it has no image-capability metadata. Neither model name, configured status nor native type support proves the selected Magpie model can interpret an image. See [settings](../../../../packages/contracts/src/companion-model.ts#L6).
- Formal `say` and `HarnessOutput` are text-only. A Markdown URL in text is not an authorized media-send instruction. Existing tasks can produce binary images/files, but no formal reply attachment contract selects them. See [say schema](../../../../plugins/harness-cortico/src/boundary.mjs#L27) and [output facade](../../../../plugins/harness-cortico/src/harness.d.mts#L58).

### Minimum candidate extension

Keep bounded attachment metadata/references, original message ordering, source/audience and receipt linkage in canonical State; keep binary bytes outside control JSON. A source-owned media store/download boundary resolves only permitted material into native image parts or an explicitly wired media resolver. Refresh/rebuild must reconstruct from canonical references, not private Core blob history. Image-only messages need deliberate admission: current nonempty-text requirements must not be satisfied by silently pretending a generated placeholder is user text.

Expose/check actual model input capability and fail visibly when unavailable; do not replace image understanding with fabricated captions. Add formal output attachment references tied to the same audience/effect identity as text. Provider input types do not supply image generation, document extraction or protocol upload by themselves.

## 2. QQ voice to M4 ASR

### Verified facts and limits

- `NativeAsrBinding.transcribe` consumes `{modelRef,format,samples,audio}`; format is **f32le, mono, 16 kHz**. `VoiceAsrProviders.recognize(consumer,ref,bindingId,samples,pcm,signal,timeoutMs)` already checks an active consumer, selected/current provider, source/config and both capability/config-read leases; it creates the existing task media channel. This is a useful host-private seam for a QQ source. See [native types](../../../../packages/companion-runtime/src/voice-input-types.ts#L15) and [authorized recognition](../../../../packages/companion-runtime/src/voice-providers.ts#L230).
- Current maximum is **20 seconds / 320,000 samples / 1,280,000 raw bytes**; provider validation also enforces it. Media frames are at most 1,600 samples. See [format constants](../../../../packages/contracts/src/audio-capture.ts#L3) and [provider media validation](../../../../packages/companion-runtime/src/voice-providers.ts#L322).
- The shared capture path offers `begin/result/upload/cancel`, one active operation per clientId and at most four active captures. A matching `captureId` deduplicates begin, but an already-started upload must not be submitted again; results are retained for 120 seconds. Upload-body deadline is 15 seconds, operation 55 seconds, ASR 40 seconds. See [capture implementation](../../../../plugins/shared-voice/src/index.ts#L121), [upload](../../../../plugins/shared-voice/src/index.ts#L188) and [budgets](../../../../packages/contracts/src/companion-voice.ts#L15).
- Magpie ASR converts verified float PCM into PCM16 WAV via `pcmWave`, then calls its fixed MiMo route. It returns final transcript/no-speech, rejects tool calls/truncated output, and limits transcript to 8,000 UTF-16 units. It does **not** decode arbitrary compressed QQ audio. See [codec and transcription](../../../../plugins/asr-magpie/src/index.ts#L14).
- ASR produces a transcript result, not a canonical user message. Current UI submits the result through the normal immutable message intent; no durable audio store is supplied by M4. ASR credentials remain the provider-owned `asr-api-key`, independently provisioned. See [M4 source/submit contract](../../../spec/backend/shared-voice-input.md#L28).

### Minimum candidate extension

Add a bounded QQ attachment download and decode/resample step before calling the existing ASR seam. It must own temporary bytes, process/decoder lifetime, source revocation and the external input identity. Submit the final transcript once with the original participant/audience/media provenance; decoding or ASR failure is not successful input acceptance. Do not invoke local microphone capture to process a received recording.

A narrow host port may call the existing provider recognition seam under the QQ consumer's declared ASR authority, or mediate the shared capture path. `VoiceController` currently dispatches as companion-host, and clientId is correlation rather than QQ principal authentication; directly calling it without the QQ source/audience boundary would skip that new authority. See [controller dispatch](../../../../apps/companion-service/src/voice-controller.ts#L293).

Compressed format coverage, download byte limits and recordings longer than 20 seconds require explicit design against the selected protocol evidence. Do not silently truncate to 20 seconds or call existing ASR support proof of complete QQ voice handling.

## 3. Formal reply to M5 TTS and QQ voice output

### Verified facts and limits

- M5 service is separate from Pet playback. `SpeechBegin` references canonical `{messageId,eventSequence}` plus Agent/epoch/client/binding/revision. Service verifies exact canonical message and assistant role; callers do not provide replacement text. See [begin contract](../../../../packages/contracts/src/companion-speech.ts#L154) and [canonical admission](../../../../apps/companion-service/src/speech-controller.ts#L260).
- `SpeechOutputNative` exposes `begin/reserve/attach/status/cancel/close`; attach is a one-consumer claim. `SpeechController.audio(key,signal,consume)` keeps the actual `SpeechAudioConsumer` inside authorized lifetime and awaits settlement. A QQ export consumer can reuse this host-private streaming seam without an Electron player. See [native output types](../../../../packages/companion-runtime/src/speech-output-types.ts#L92) and [audio callback](../../../../apps/companion-service/src/speech-controller.ts#L443).
- Produced format is **PCM16LE, 24 kHz, mono**, not a QQ voice file. Current HTTP returns application/octet-stream with the speech metadata header. There is no encoded file/artifact export API. See [format/budgets](../../../../packages/contracts/src/companion-speech.ts#L17) and [binary output route](../../../../apps/companion-service/src/speech-http.ts#L150).
- Whole replies are sliced into at most four segments, each at most 4,000 code points; stream cap is 128 MiB per segment, a cumulative counter rather than an allocated buffer. At most four utterances are active, with one active utterance per client. Sequential segments and actual drain/terminal checks are required. These limits are not platform upload allowances. See [speech constants](../../../../packages/contracts/src/companion-speech.ts#L29), [shared output admission](../../../../plugins/shared-speech/src/index.ts#L163) and [segment progression](../../../../plugins/shared-speech/src/index.ts#L262).
- Existing automatic playback is **Pet-only and opt-in**; its future-event baseline/no-offline-replay policy is a desktop product decision. The service can synthesize independently, but has no QQ audience authorization. Credentials remain separately owned `tts-api-key`. See [M5 contract](../../../spec/backend/shared-speech-output.md#L29).

### Minimum candidate extension

A QQ source must first authorize the formal message's audience, then create its own stable output intent and consume all required PCM segments into a bounded encoder/spool. Verify synthesis, encoding and actual resource release, then perform the platform-specific upload/send and record its remote outcome. Preserve separate facts for canonical reply, generated audio, exported bytes, platform acceptance and uncertain send.

Do not claim PCM is already an uploadable recording, reuse Pet's player/opt-in as QQ consent, or multiply consumers of the same claimed segment. If Pet and QQ both consume one reply, independent output intents can incur independent synthesis unless an explicitly designed reusable media artifact exists. Codec availability, duration/file limits and multipart output must be validated without dropping selected voice support or silently summarizing long replies. The previous one-shot live TTS authorization is consumed.

## 4. Task files/artifacts: useful binary output, no audience-aware material intake

### Verified facts and limits

| Boundary | Actual current constraint |
| --- | --- |
| Task `files` | Array of `{path,content:string}`; no binary/ref upload input |
| Executor input budget | At most 16 files, **24,576 UTF-8 bytes total**; code at most 16,384 bytes |
| Harness tool schema | At most 16 inputs/outputs; each input string maxLength 24,576, but executor total-byte cap still applies |
| Declared output artifacts | At most 16; configured **1 MiB default, 8 MiB maximum aggregate** retained bytes |
| Paths | Relative, at most 240 characters, safe components; no arbitrary host path |
| Worker environment | Docker only, network none, read-only container filesystem, writable assigned `/work`, code mounted read-only |
| Desktop download consumer | 64 MiB maximum, authenticated fetch with 120-second deadline; does not raise the executor's 8 MiB output cap |

Sources: [task/executor types](../../../../plugins/cloud-exec/src/types.ts#L3), [input/config validation](../../../../plugins/cloud-exec/src/boundary.ts#L28), [Harness tool schema](../../../../plugins/harness-cortico/src/boundary.mjs#L29), [Docker restrictions](../../../../plugins/cloud-exec/src/executor.ts#L313), [desktop save](../../../../apps/desktop/src/main/companion-artifact.ts#L32) and [download transport](../../../../plugins/text-client/src/client/protocol.ts#L223).

- Input files are written as strings. A model-generated base64 string is not an existing binary material-ingest contract. The network-disabled worker cannot fetch a QQ URL. A configured Node image also does not establish availability of document/image/audio processing tools. See [workspace creation](../../../../plugins/cloud-exec/src/workspace.ts#L26).
- Artifacts are collected after container processes stop. Retention validates contained paths, real directories, regular files, no symlink/hardlink, stable inode/size and total budget, then saves private retained bytes. `mediaType` is declared metadata, not content validation. See [artifact retention](../../../../plugins/cloud-exec/src/workspace.ts#L58).
- Kernel provider permissions authorize process/files for the plugin owner; they do not represent the QQ person/group. See [execution method permissions](../../../../plugins/cloud-exec/plugin.json#L14).
- `StoredArtifact` is `{id,taskId,name,mediaType,sizeBytes,provider,relativePath}`; `getArtifact` accepts only ID. HTTP artifact reads use the global operator bearer, check provider root/path/file size, and stream bytes. There is **no principal/audience check** before that read. Same issue applies to direct task-detail reads. See [State artifact methods](../../../../plugins/state-sqlite/src/types.ts#L52), [download route](../../../../apps/companion-service/src/server.ts#L363) and [path-safe open](../../../../apps/companion-service/src/server.ts#L117).

### Minimum candidate extension

Authorize material references at intake, context/model use, task submission, task inspection and export. Bind task origin/owner and permitted audience to existing canonical state. Stage only the caller's currently visible attachments into the assigned worker namespace through a checked binary material bridge; never grant the whole download directory or use the operator bearer as the user's authority.

Reuse the path/stream/retention primitives, but add an audience-aware host reader/export port before bytes leave the service. A QQ user must not retrieve another user's artifact merely by ID or because a global snapshot listed it. Group-visible source material, task ownership and artifact publication are separate checks under Q8/Q9; deriving work from a private file must not automatically make its output public. Sending a protected artifact URL without an authorized upload/export path is not functioning file delivery.

## 5. Optional participation judge through Magpie, without another Agent

### Verified facts

- `ModelConnectionPortsFor(context)` supplies `authorizedResponses(baseUrl)` and `bind({model,client})`; the ordinary connector owns config/transport and disposers. `ResponseClient` requests can be tool-free, bounded and structured without constructing Core or a new Session. See [ports](../../../../packages/companion-runtime/src/model-connection-types.ts#L10) and [connector factory](../../../../plugins/model-connection-magpie/src/index.ts#L25).
- Current `ModelConnections` has **one selected connector**. Its `sourceCurrent` requires that selection, and `clientFor(consumer)` captures it and rejects any `request.model` different from the binding's model. `options.role='participation-judge'` cannot select another model. See [selection fence](../../../../packages/companion-runtime/src/model-connections.ts#L88) and [client/model guard](../../../../packages/companion-runtime/src/model-connections.ts#L225).
- Model controller configuration is foreground-oriented: profile has one modelConnection/modelMode; changing the applied connector retires/recreates the foreground. A participation check must not temporarily switch this global selection. See [selection/foreground lifecycle](../../../../apps/companion-service/src/model-controller.ts#L156).
- Source-owned credential slots bind connector ID plus full normalized base URL/auth mode, with independent process/key versions. The native client borrows `model-api-key` through CredentialBroker, preserves native values/attempts and awaits actual work. Config/source/revoke fences are reusable. See [slot/transport construction](../../../../apps/companion-service/src/model-controller.ts#L95) and [authorized model client](../../../../apps/companion-service/src/model-client.ts#L18).
- Existing native calls allow a 180-second source task; normal native HTTP may retry with delays of 1/4/10 seconds. Diagnostic calls suppress those retries, but that flag also labels attempt purpose. A single `respond` is not inherently one network attempt or an adequate participation budget. See [source deadline](../../../../packages/companion-runtime/src/model-connections.ts#L255) and [native retry behavior](../../../../plugins/harness-cortico/node_modules/cortico/src/providers/transport/response-http.ts#L109).

### Minimum candidate extension

Add a small **purpose-bound model binding** for participation judgment alongside the foreground binding, using the existing source/Config/credential/task machinery. It needs explicit connector/target/model selection and an independently authorized credential binding; do not extract or silently reuse a foreground/DSH/ASR/TTS key. The secret stays inside the selected connector's borrow, not the QQ plugin's config or judge prompt. Extending binding selection is necessary for a separately chosen judge model; the present API cannot be advertised as already role-aware.

Run judgment as a bounded source-owned inference operation, not `runtime.message`, a new Core or a persistent conversation. Supply only the allowed group's recent context/material projection; request a small validated decision with no tools/effect authority. The decision gates whether to ask the existing Agent to respond; it must not become a formal assistant message, write facts or inherit a previous privileged user's identity. Config/rules/source changes fence stale decisions.

Budget must cover admitted calls, concurrency, rate/window limits, input/output size, deadline and native attempts; desired defaults and failure behavior remain design decisions under Q11. If a participant action is later requested, its input identity and permissions are checked separately. Rule/probability mode and model-assisted mode can remain independently selectable without duplicating Agent state.

## Planning implications

- All four media kinds remain in first-release scope. The gaps above require implementation and per-protocol acceptance, not a text-only release relabelled as media-ready.
- Existing State references, source-bound binary I/O, ASR/TTS and model leases can be composed. Required additions are narrowly scoped media/provenance/authorization and role binding, not a second bot framework.
- Platform-specific formats/limits, image-capability evidence, file extraction/processing availability, export retention, long-audio handling and exact output policy must enter the reviewed design. No limit from Cortico's console, desktop downloads or M5 streaming should be silently reused as a QQ limit.
- The PRD's open item asking text-first versus media was still present when read, although Q12 settles that choice. Parent was notified; this research did not edit the PRD.
- Future checks should demonstrate image bytes reaching the selected model; real compressed-audio conversion through existing ASR; complete canonical replies exported to valid voice media; binary file intake/authorized task/export; cross-person/group refusal; and judge calls that leave foreground model/identity/tasks unchanged. None was run in this research turn.
