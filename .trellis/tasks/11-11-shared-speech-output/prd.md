# Shared speech output through Magpie

Status: implementation and scoped verification complete2026-11-12; commit/archive handoff remains. The user approved the final implementation summary2026-11-11 and separately approved exactly one live Magpie TTS request, now successfully completed with its one-shot marker consumed. [Parent roadmap](../11-06-unified-companion-architecture/prd.md) retains the broader Agent/full-duplex/platform goals.

## Goal

Offer a real optional built-in TTS plugin. When enabled, it automatically reads the continuing Agent's completed formal replies through the desktop Pet, including complete long replies, with independently controllable and accurately reported playback.

## Evidence baseline

[M4 acceptance](../../../qa/fixtures/companion-voice-input/acceptance.md) establishes shared web/desktop input and an authorized real ASR check; that authorization does not cover TTS. The existing desktop speech path provides reusable ownership/media primitives but has whole-buffer and immediate-idle limitations. [Source research](research/speech-output-entry.md), [UX research](research/speech-output-ux.md) and [current official MiMo evidence](research/mimo-tts-current.md) distinguish existing behavior, documented streaming capability and unexecuted local TTS/playback validation. Ordinary MiMo documents24kHz PCM16LE mono streaming; the old non-streaming example is not a provider limit.

## Requirements and user decisions

- O1 All synthesis uses the model interfaces of the configured Magpie gateway through ordinary replaceable/removable sources. Vendor documentation defines the wire codec only; product calls must not bypass the gateway and directly contact Xiaomi/another vendor. Reuse the existing kernel, tasks, permissions, media and storage ownership; no second engine, generic queue/registry or canonical audio database. Do not import text/ASR/DSH/AstrBot credentials.
- O2 A committed canonical assistant message is one logical utterance and one existing FIFO item. Audio is attached to that Agent/message and the captured playback binding; it is not another user message, Core inference or conversation history.
- O3 Stopping sound, disabling the TTS source, cancelling microphone input, stopping foreground generation and stopping independent work remain distinct. M4 mic-start does not acquire a new implicit stop-playback policy.
- O4 Configured, generating, playing, stopping, released and incomplete/failed states reflect separate actual facts. Provider `stop`/EOF is not proof of playback completion; task result or old idle state is not proof of cleanup. No software receipt proves a person heard the audio.
- O5 Preserve typed drafts, ASR preview, canonical history, ongoing work, current permission/credential checks and old-target fences. Do not dispatch old audio through a new connection.
- O6 Test source/native transport/device paths independently and label evidence precisely. Real TTS requests or physical-device checks require their own bounded authorization. Planning performs no TTS POST or playback.
- O7 **User decision2026-11-11:** TTS is a genuinely optional built-in plugin with enable/disable lifecycle. While enabled it automatically reads each newly committed formal `role=assistant` message, including Harness `say` publications. Reasoning/deltas, notices and raw tool receipts are excluded. Do not replace this with manual-only/voice-input-only behavior or collapse multiple formal messages into a guessed last reply. Enable/reconnect/restart must not replay historical/offline replies; disable fences and releases owned synthesis/playback.
- O8 **User decision2026-11-11:** first release plays only through the desktop Pet's single owner. Console provides configuration/state/stop without another player; Web keeps existing text/ASR without TTS playback. Global playback-destination arbitration is outside this slice.
- O9 **User decision2026-11-11:** long formal replies must also be read completely. Preserve the full canonical text and order, using bounded internal text parts only when needed. Old4000-code-point/2MiB whole-buffer limits must not become a short-reply-only restriction. No truncation, summary or hidden rewrite. Stop/disable cancels current output and prevents all future parts; partial failure remains incomplete instead of skipping content and claiming success.

## Approved delivery baseline

- New plugin defaults off; old default-true audition settings do not opt a user into automatic speech. Persist actual explicit source enablement in the existing ledger.
- Ordinary MiMo streaming PCM is the first codec, through the service's fixed-purpose native transport. Use one explicit preset voice, frozen for the entire utterance. Voice-design/clone, old SAPI numeric-rate mapping and hidden non-streaming/system fallback are excluded.
- Existing FIFO counts complete replies, not transport chunks. Service-owned text slicing preserves the canonical message; common replies use one native call. Audio is received and played with bounded buffers rather than retained as a whole reply. Actual limits/identity/clock declarations live in source, linked once by the [code-spec](../../spec/backend/shared-speech-output.md).
- Stop clears the current and pending speech intents while leaving the plugin enabled for future new replies. Disable turns off that future behavior as well. Hiding the existing Pet window does not itself disable TTS; actual close/disconnect/source retirement stops owned output.
- Failures and unknown outcomes do not automatically re-synthesize, re-download or switch providers. Native completion, complete transport, playback-to-tail and actual release must all be checked before reporting a completed utterance.

## Acceptance criteria

- [x] S1 Real source enable/disable/default-off and old-setting migration behave as O7. Eligible new assistant events are admitted once in order; multiple commits within one120ms UI refresh and cropped snapshots do not lose replies or cause history replay.
- [x] S2 Replies beyond the old whole-buffer limit retain complete text/order and one logical FIFO slot. Unicode/CRLF boundaries, cumulative audio greater than2MiB and bounded resident memory are verified; first PCM reaches playback before generation completes.
- [x] S3 Whole stop/disable/retarget/source withdrawal prevents later audio/parts and joins actual native/media/device work. Late responses cannot restart playback. Partial failure, unknown result and cleanup status are distinct.
- [x] S4 Conversation, Core thinking, independent work and M4 ASR retain their identities/effects while speech starts/stops/fails. Synthesis creates no extra user message or Core turn.
- [x] S5 Pet/console show actual availability, playback and release/incomplete states, with reachable controls and one player. Web retains existing behavior with zero TTS playback/request initiation.
- [x] S6 Controlled SSE/provider/backpressure/real Electron paths prove ordering and cleanup. Any later authorized live check separately verifies deployed Magpie chunks/terminal/format; no physical-hearing, full-duplex or latency-distribution claim exceeds evidence.
- [x] S7 Reviewed code-spec, operator guidance, focused/root/native checks and Trellis records complete the selected scope.

## Verified handoff

O7/O8/O9 remain the selected product scope. The approved implementation, independent review corrections, root/scoped gates,10-case controlled native run, standalone Web checks, Core/Docker/ASR continuity and one authorized live TTS check are complete within the [recorded acceptance boundaries](../../../qa/fixtures/companion-speech-output/acceptance.md). Live authorization is consumed. The14-entry context manifests and executable code-spec retain the source contracts; [implementation](implement.md) tracks final commit/archive bookkeeping. Do not reopen settled choices, repeat live requests or archive the ongoing parent roadmap.
