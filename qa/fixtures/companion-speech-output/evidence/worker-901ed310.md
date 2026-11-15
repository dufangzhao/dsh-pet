# M5 Core / Docker / ASR continuity — controlled backend pass

Actual successful execution: `bash-6bf9dd1a68054276`, exit0. [Original report](worker-901ed310/report.json), [verified assertion window](worker-901ed310/assertions.json), [independent resource audit](worker-901ed310/resources.json), [frozen-scope comparison](worker-901ed310/scope.json) and [copied-file hashes](worker-901ed310/files.json) retain the evidence. All copies were checked byte-for-byte by SHA256.

## Observed behavior

During one TTS completion and one cancellation, the original third Cortico inference remained pending and un-aborted, the existing ASR request remained transcribing without abort, and the same real Docker container kept running with a progressing heartbeat. TTS did not add a user message or Core turn. The two speech intents used two reserved segments, two binary GETs and two controlled native requests, with no retries.

The completed delivery contained9600 frames /19200 bytes of deterministic PCM24k mono, with first PCM received before the held native terminal. Its SHA256 is `0566839f5260aa06098367a73967cb2de276a8bfeddedf9fae06622ecbf6acf1`. The second known-ID cancellation closed the actual native response and settled cleanup.

ASR was later released to final/settled without submitting its transcript. The original Core inference then completed. The same worker completed with one effect and artifact bytes matching the same-root output, SHA256 `e16003e8ee5e314f97adc58ad71ef65fc95d2ed202637e31017d1d6f82b93088`.

## Freeze and cleanup

[Input hashes](worker-901ed310/inputs.json), [scope roots](worker-901ed310/roots.json), [dependency snapshot](worker-901ed310/dependencies.json), [Node versions](worker-901ed310/node.json) and [image inspection](worker-901ed310/image.json) describe the executed materials. Scope covered186 roots /3270 files and159 resolved production dependency roots; files, symlinks and dependency graph were unchanged across the successful run. Scope SHA256: `901ed310f6a41d52b5daf3129e3a78070b24985f748793ac4231a407d0d1800e`. Runner SHA256: `aaf6037a91715a7b02fff918366689a8af2689b501e877db05e1e3cec3db8442`.

The existing image ID was `sha256:a9975a0df83b07f6ef3a57098174a8303cb0e322570e1d2f175ceba33f417a72`; its repository digest was recorded separately. No image was pulled and no host execution fallback was used. The exact owned container was absent after cleanup; service, peers and readers were closed. The durable task exited0, and the single cloud record was exited/settled.

The first attempt failed before a container or audio request because the runner requested65000 ms against the existing30000 ms execution limit. After complete cleanup, only the runner's test budgets were corrected to the established25000/28000 ms values. That failed attempt and complete originals are retained in the [private evidence folder](../../../../.companion-data/qa-private/companion-speech-output/worker-901ed310/); it was not overwritten as a pass.

## Scope boundary

This proves controlled headless service/Core/Docker and synthetic TTS/ASR continuity. Desktop/renderer sources, Electron playback, devices and external TTS/ASR were excluded. It is not a whole-project freeze or a claim that later changed files share this hash. The successful assertion summary is based on the runner's executed assertions, not a separate packet capture.
