# Current official MiMo TTS evidence

Read-only documentation lookup2026-11-11; no inference, device or audio POST. These current vendor documents refine the earlier pinned AstrBot example, which only used non-streaming output. Example usage is not a provider capability limit.

Sources:

- [Official TTS API](https://mimo.mi.com/docs/en-US/api/audio/tts), page update2026-07-17.
- [Official synthesis guide](https://mimo.mi.com/docs/zh-CN/quick-start/usage-guide/audio/speech-synthesis-v2.5), page update2026-07-15.

## Confirmed documentation facts

- Ordinary `mimo-v2.5-tts` documents working low-latency streaming. Requests use `stream:true` and `audio.format:pcm16`; SSE audio is base64 in `choices[].delta.audio.data`.
- The official streaming example identifies the output as **24kHz PCM16LE mono**. This is a codec contract from documentation, not a local gateway/device measurement.
- Voice-design and voice-clone currently describe a compatibility stream that returns one result only after generation. Do not call that low-latency streaming.
- Target speech text belongs in the assistant message. Optional user content provides style/context and is not spoken. Ordinary TTS uses a preset voice; `mimo_default` is provider/cluster-dependent. Freeze an explicit selected voice for an utterance.
- `finish_reason` distinguishes `stop`, `length` and `content_filter`. Only natural completion can establish a completed generation; partial/filtered output must not be called a complete readout. Audio transcript/timing fields do not provide word-level heard-prefix evidence.
- Voice-design's optional `optimize_text_preview` rewrites/generates broadcast text. It defaults false and must not be enabled for O9's unchanged canonical text.

The documentation banner retires the unrelated V2.5/Pro text models; the TTS page still explicitly lists its TTS IDs. Do not infer TTS deprecation from that banner.

## Design consequences and remaining verification

Prefer evaluating ordinary MiMo's explicit streaming PCM codec before hard-splitting every64 characters or raising whole-WAV allocations. Keep bounded application text parts only when justified by the provider/text contract; kernel2MiB flow buffers are not the whole utterance size. Streaming synthesis/playback does not add full duplex or automatic interruption to scope.

The currently deployed Magpie native route must be checked for transparent SSE/flush/cancellation behavior. A future explicitly authorized short live check must verify actual audio chunks/format and timing; documented capability alone is not local inference or playback evidence. Do not silently fall back to non-streaming/re-synthesis after an uncertain request.

These pages do not establish a numeric maximum target-text length, a universal voice speed or actual WAV subtype/rate for non-stream output. Do not invent those values. The final source design must distinguish first-byte/idle/overall deadlines from intentional consumer backpressure, enforce bounded frames/total generation, and preserve the whole canonical text and at-most-once original attempts.

## Local catalog observation2026-11-12

One bounded readonly `GET http://127.0.0.1:3425/v1/models?kind=all`, using the project's public local-client identity and `dsh-pet-speech/1`, returned HTTP200 and19 rows. The TTS IDs were `xiaomi/mimo-v2.5-tts` and `xiaomi/mimo-v2.5-tts-voicedesign`. No synthesis request was sent. This confirms a concrete ordinary-model catalog option for a later scoped live check; it does not prove synthesis permission, streaming delivery or audio quality.
