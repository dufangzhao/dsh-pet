# One-shot live MiMo TTS review — executed once, do not rerun

**Current status:** the user approved this exact check, and it completed successfully once on2026-11-12. The exclusive marker is consumed. See the [executed result](evidence/live-mimo-43147468.md); this document is not permission for another call.

The remainder preserves the pre-execution proposal and guard rationale for [the script](../../probes/companion-speech-output-live.mjs). Creating it, passing guard tests, controlled-native permission, prior M4 ASR permission and a catalog GET did not authorize the live request; a new explicit user approval was obtained.

## Exact approval scope

| Item | Fixed proposal |
| --- | --- |
| Gateway | `http://127.0.0.1:3425/v1` |
| Native route | `POST /v1/magpie/native/xiaomi/v1/chat/completions` |
| Logical / wire model | `xiaomi/mimo-v2.5-tts` / `mimo-v2.5-tts` |
| Preset voice | `冰糖` |
| Exact text | `你好，我是你的桌宠。现在正在测试语音朗读。` |
| Text SHA256, UTF-8 without appended newline | `db0f6f6af82b8f1992bb5e8b41a276910296d35730466de552983266d88d9732` |
| Native request / segments | At most **one native POST / one segment**, no retry or fallback |
| Active native window | **60 seconds**, from the single native dispatch, then abort |
| Accepted/persisted effective PCM | At most **1,048,576 bytes**; exceeding the cap aborts and fails |
| Auth / identity | Only public loopback client ID `magpie-dsh-pet`, own UA `dsh-pet-speech/1`; no imported keys |
| External text model calls | **0**; existing controlled Core client produces the exact formal assistant message |
| Playback | **None**: no Electron, browser, AudioContext, Pulse client stream or speaker |
| Artifact | Dedicated private test WAV only; complete promotion requires verified terminal, actual cleanup and unchanged input hashes |

The fixed native JSON is:

```json
{"model":"mimo-v2.5-tts","stream":true,"messages":[{"role":"assistant","content":"你好，我是你的桌宠。现在正在测试语音朗读。"}],"audio":{"format":"pcm16","voice":"冰糖"}}
```

Accept is `text/event-stream`, JSON request MIME. The original native Response/body is returned unchanged to the real product codec. No synthetic terminal, tee reader, whole-WAV fallback, style rewrite or new product configuration endpoint is introduced.

The script uses actual `createCompanionService` with the existing controlled Core injection seam (source-backed actual service, not the desktop production artifact). All message/configuration/utterance/reserve/audio/status/cancel operations use the existing real public HTTP/protocol path. Formal message IDs/event sequence come from the real Core commit and public event stream; there is no direct state append or SQL. Service listens on a new random 127.0.0.1 port with a new private data directory and HOME/XDG roots. Original 4120 and DSH/AstrBot/ASR credentials are untouched.

## Exact commands for review

Safe, read-only description (already executed; makes no request and imports no product):

```sh
node qa/probes/companion-speech-output-live.mjs --describe
```

**Audit copy of the already-used command. Do not execute again; the one-shot authorization and marker have been consumed:**

```sh
PET_SPEECH_LIVE_SCOPE_SHA256='96624ddfa6778e258b69289eefb4d5dc82bfc9ee429defe8b3c67a0f7f5c693b' \
PET_SPEECH_LIVE_SCRIPT_SHA256='3f497a3d9b0332ce8d9279be5ac25a1b807433edf5fce05c9f47737ebe27c79e' \
node --import tsx qa/probes/companion-speech-output-live.mjs \
  --run-authorized --approval-reference '<new exact user approval message/time reference>'
```

Script SHA256: `3f497a3d9b0332ce8d9279be5ac25a1b807433edf5fce05c9f47737ebe27c79e`.
Scope SHA256: `96624ddfa6778e258b69289eefb4d5dc82bfc9ee429defe8b3c67a0f7f5c693b`.
Any reviewed-script change invalidates the command's script hash. CLI target/model/voice/text/budget/retry overrides are rejected. These opt-ins are guards against accidental execution; they do not independently verify or replace actual human authorization.

## Duplicate and unknown-outcome protection

Before importing/creating a product service, configuring a gateway or arming any fetch, the script exclusively creates (`wx`, mode 0600, fsync) this fixed marker:

`.companion-data/qa-private/companion-speech-output/live-attempt-mimo-tts-bingtang-v1.json`

The marker is never automatically deleted or reset, even when setup fails before a paid call, the response is lost, the process crashes, or cleanup remains unknown. A second claimant is rejected before service creation. A global fixed-purpose fetch guard delegates unchanged actual requests but permits only the new service's `/api/*` origin and the one approved native URL/body/UA/public-ID request. A second native invocation is refused before delegation; the public audio GET is likewise single-consumer and cannot be replayed. No gateway catalog call occurs in the live script. Status is read once after successful audio EOF; failed/unknown audio is not re-GET or re-synthesized.

For a later second experiment, Parent must obtain a new explicit approval and intentionally revise the attempt scope/version. This script supplies no marker-reset option and should not be rerun after an unknown result.

## Generation, cleanup and artifact facts

Only product-verified natural `stop`, exact produced/drained/received frame/byte agreement, `nativeSettled=true`, successful transport cleanup, whole completed/settled state, one native delegation and one audio GET can set generation verified. Raw PCM is streamed to a private `test.partial.wav` while hashing; it is renamed to `test.wav` only after successful cleanup and unchanged source fingerprints. Any failure/unknown outcome retains an explicitly partial/unconfirmed artifact, never presents it as complete sound.

Approval/loader refusal before a marker is reported as `not-run-approval-required`. A prior marker is `attempt-marker-refused-no-new-request-prior-outcome-unknown`. Any setup/report exception after marker creation is `attempt-failed-or-unknown-no-retry`, with safe marker/native-count/cleanup facts even when report persistence fails. The actual report writer is covered by a controlled filesystem test; post-marker exceptions are never relabeled as an unattempted run.

The hash fields are explicitly `listedSourceHashesBefore/After/Unchanged`: they cover only the listed source/lock/helper files, **not** the full transitive dependency/build freeze. Parent must retain the outer complete execution-scope snapshot separately. Native upstream SSE audio-event/stop timing is explicitly unproved by this script; response headers, public PCM chunk/EOF times and product-verified terminal are distinct evidence.

The 60-second fence aborts active HTTP/read work; bounded cancel and service-close cleanup can follow. Failed/unconfirmed service close is recorded, keeps the egress fence active, leaves the artifact partial and terminates only the owned one-shot process after writing its report. The exclusive attempt stays consumed.

A consumer cap cannot guarantee how much the provider computed, buffered or billed before/after abort. One local Magpie native POST does not prove a single vendor-internal attempt. The script explicitly makes **no claim that API cancellation guarantees supplier billing stops**. Codec rate/channels follow the fixed raw PCM contract/header; no raw header or physical measurement independently proves them. Reported HTTP PCM chunks are not relabeled upstream SSE network-chunk counts. There is no device-ready/playing/heard claim or latency distribution from this generation-only check.

## Actually executed preparation checks

Only syntax, safe description and [offline guard tests](../../probes/companion-speech-output-live-guard.test.mjs) were run:

```sh
node --check qa/probes/companion-speech-output-live.mjs
node --test qa/probes/companion-speech-output-live-guard.test.mjs
```

Result: **actual exit 0, 8/8 passed**, 308.395567 ms. Tests use an in-memory fake delegate solely to test guard admission/budgets, plus a private temporary filesystem marker to test exclusive creation; they are not product/native/provider evidence. They cover missing/old approval, altered script/scope/text/voice/model/stream/auth/target, marker race/unknown retention, one actual delegation maximum, response identity preserved, no repeated audio GET, abort signal propagation, bounded WAV header and CLI no-approval refusal. The safe describe/missing-approval child processes do not import a product or open listeners. The real fixed attempt marker was checked absent after preparation.

No live gateway access, real TTS POST, product service, speaker/browser/native playback or actual audio generation was performed in this preparation. Dedicated live outputs do not exist yet. The separate controlled-native authorization and runner are independent.
