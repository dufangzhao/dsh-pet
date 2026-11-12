# S5 standalone Web probe preparation

Historical preparation record. The subsequent standalone production Web run passed; see [final Web evidence](evidence/final-web-c5852eaf.md) and [acceptance](acceptance.md). The material below records the original preparation, including its pre-execution script hash; the final result owns the executed version and cleanup correction.

[Probe](../../probes/companion-speech-output-web.mjs) uses the actual built companion-service entry and production Web/static worklet. Existing M4 controlled ASR peer, synthetic16k WAV and actual capture observer are imported unchanged; the new M5 controlled TTS peer is configured ready but must receive no call. No M4 script/product/new generic framework was changed.

Exact command from the project root, for Parent after execution authorization:

```sh
PET_SPEECH_PULSE_TOOLS='/home/kingBZ/DeepSeek-WorkSpace/dsh-pet/.companion-data/tooling/pulse-null-d1i9P1' \
PET_SPEECH_BROWSER_EXE='/home/kingBZ/DeepSeek-WorkSpace/dsh-pet/.companion-data/tooling/browser/chromium-full-156-mirror-q6zv9a9g/chrome-linux64/chrome' \
node --import tsx qa/probes/companion-speech-output-web.mjs --run-frozen
```

Only `PET_SPEECH_PULSE_TOOLS` is mandatory; the displayed full Chrome path is already the default, and `PET_SPEECH_BROWSER_EXE` permits an explicit parent-prepared private executable. There is no desktop/Pet process or new input device source. Full Chrome launches under independent child HOME/XDG roots, explicit private Pulse/server/sink and null-only ALSA fallback. The headless mute flag is excluded so a mute/dummy-output setting is not substituted for actual null routing. No automatic media-consent flag is used. Exact-origin microphone grant is a declared prerequisite; manual prompt UI is not claimed.

Planned checks, **not passes yet**:

1. Configure a real ready TTS provider through existing authenticated service HTTP API before opening the Web page. Model, preset voice, selected binding and readiness remain configured throughout the test; no zero-call result can be credited merely to an unconfigured provider.
2. Submit ordinary text through the actual production Web composer, verify one new canonical input ID and visible formal assistant reply for the same Agent.
3. Use the actual Web capture in review mode with the existing synthetic fake-media device. Verify real getUserMedia,16000Hz AudioContext, production AudioWorklet, actual HTTP/provider/controlled-ASR path, ordered complete samples, actual track/context release and a review preview with zero message submission before Send.
4. Edit the preview and explicitly send once. Verify one new canonical message/input ID for the edited text, same Agent, visible formal reply and preserved unrelated typed draft.
5. Across those operations, browser-context request observations must show **zero `/api/speech` attempts**, zero AudioBufferSource creation/start attempts/starts and zero HTML media playback. Real ASR context/worklet observations are reported separately; they are not counted as a TTS player. The ready controlled TTS peer must show zero synthesis/catalog/rejected requests, including final cleanup checks. Unexpected external page requests are blocked and cause failure; only the isolated service origin is permitted.
6. Read-only CDP SystemInfo gives the actually launched browser PID; actual Pulse sink-input PID ancestry must show its ASR output context routed to the sole private null sink. This is software audio routing, not TTS playback or hearing evidence.

The WebAudio detector delegates native base-prototype functions and real media play unchanged; it does not construct substitutes, send acknowledgements or fake readiness. Metadata for unexpected requests is capped16 samples with separate exact total counters, so truncation never becomes a zero-activity assertion. No raw headers/keys/audio are recorded by that detector.

The runner writes before/after hashes for actual service/source/dist/protocol/plugins/worklet/Chrome/Pulse/helpers/WAV inputs; it closes browser, service, both peers, Xvfb and Pulse in finally. It checks zero sink inputs after browser closure and records actual process cleanup outcomes. Failure screenshots, if later created, still require real `read_image` inspection. Node setup API reads/writes are separate from the browser-only speech-fetch count.

Executed preparation: `node --check` and ESLint `--no-config-lookup --rule no-undef:error` on the new probe both exited **0**. Script SHA256:

`aebdf1a4f0143af10638c02f6e7e07a9763838546a50e0a3420aa6755d32b24a`

No test/browser was launched for this static validation. This probe adds only the requested S5 Web text/ASR/zero-TTS scope, not new reasoning/notice/multisay assertions or a repeat native/M2/M3 suite. No external ASR/TTS, live3425 audio request, physical speaker, original4120, user account or DSH data use is authorized here.
