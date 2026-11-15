# M5 native runner and private null-audio preparation

Historical preparation record: the material below describes the pre-execution setup, not current acceptance status. The subsequent frozen production run passed; see [final native evidence](evidence/final-native-d71f3948.md) and the [canonical acceptance record](acceptance.md). No physical speaker or live model was used during the preparation recorded here.

## Prepared production runner

[companion-speech-output-native.mjs](../../probes/companion-speech-output-native.mjs) requires exactly `--run-frozen` and an explicit `PET_SPEECH_PULSE_TOOLS` private-tool directory. It reuses the existing [display fixture](../companion-desktop/display.mjs) and M4 production-entry/profile/cleanup pattern. New helpers remain in this speech fixture directory; no global framework or M4 fixture was changed.

The runner reads the actual `window.petSharedSpeech` contract from [desktop-speech.ts](../../../packages/contracts/src/desktop-speech.ts) and [companion-speech.ts](../../../packages/contracts/src/companion-speech.ts). Its actual source-backed management paths are the existing plugin lifecycle API and actual speech provider route; it does not create a generic transport or synthetic bridge. Current provider own UA was read from source as `dsh-pet-speech/1`, local client-ID as `magpie-dsh-pet`.

Prepared scenarios, **not executed acceptance results**:

1. Configure the real remote provider while the local optional source remains off; use the actual presentation bridge to retain `speechEnabled:true`. A new canonical scripted assistant reply must produce zero synthesis/context/node activity. This checks the true old flag does not opt in; it is not a prior-version profile-file migration test.
2. Real local source trust/enable and provider configuration through existing UI. Fresh baseline must not replay the default-off historical reply. Real Pet getState/onAudio observations must show the first scheduled PCM before the controlled native terminal gate is released, one assistant message/utterance, and no console AudioContext.
3. Reconnect to the same service, wait for the new connection's baseline, then check a recorded 500 ms no-replay observation window. This is a bounded observation, not a claim of observing all possible late events.
4. Stream 2,200,006 PCM bytes (>2 MiB) through the real stack. Observe actual AudioBufferSource starts/ended/stops, max six active nodes, max 64 KiB chunks, sequence order, and prior chunk frames scheduled before another chunk arrives. Verify completed segments' received/ended frames match the actual verified terminal.
5. Publish a >4000-code-point canonical reply using the existing **scripted Harness `say`** path. Populate four synthetic facts using the real memory CAS API (2048 + 2048 + 2048 + 1400 ASCII value units, within the 8192-byte memory budget), then type `偏好`. The normal scripted echo is capped at 1500 and is not used for this test. Compare each actual native request's text-unit count/SHA against contiguous slices of the returned canonical message and require complete coverage, at most four segments, one utterance identity, and no extra logical FIFO entries. No renderer publication injection, raw SQL or private state mutation is used.
6. Hold native terminals and stop during segment 2 of the long reply. No segment 3 call for that old utterance; source remains enabled and a later new formal reply can synthesize. Stop is a real UI action.
7. Same-binding partial failure followed by a new reply: controlled `length`, then `stop`, using explicit per-request fixture modes. Partial failure must not become completed; next new formal reply is still admitted without changing provider binding.
8. Actual disable drains current output and prevents future formal replies; later enable must establish a fresh baseline. Retarget fences old audio locally and does not submit old content to the new Agent. Source trust withdrawal joins local release and prevents late/future synthesis.

The [`player-observers.mjs`](./player-observers.mjs) wrapper delegates to actual AudioContext/resume/close/createBufferSource/start/stop and subscribes to actual public audio events. It does not construct a fake context, return fake success, replace the frozen bridge or send consume/ready/release ACKs. It retains counters/metadata and only live nodes, not a growing collection of PCM or AudioBuffers.

**Exact observation limits:** internal consume-ACK invocation timestamps and Main's private in-flight counter are not exposed by the public read-only bridge. The runner can establish actual chunk bounds and schedule-before-next-chunk, not label those observations as a direct trace of private ACK handlers. Node/resource windows are not a measurement of complete process RSS. Reasoning/notice exclusions, strict multiple-say-within-120ms timing, complete historical/offline migration, standalone Web zero-TTS/text-ASR, >55/120-second healthy streams, delayed device close/native release failures and all source/retarget races need separate controlled/package/integration cases. Core/Docker/ASR continuity belongs to the separately assigned worker probe and is not represented as native coverage here.

Future execution, only after Parent's full build/source freeze and explicit authorization:

```sh
PET_SPEECH_PULSE_TOOLS='/home/kingBZ/DeepSeek-WorkSpace/dsh-pet/.companion-data/tooling/pulse-null-d1i9P1' \
  node --import tsx qa/probes/companion-speech-output-native.mjs --run-frozen
```

The runner writes before/after product/runner/tool hashes, uses independent service data and child HOME/XDG roots, ephemeral loopback ports, and an isolated acceptance profile. It finally stops the real public speech pipeline before closing Electron, joins each owned service/peer/display, and closes its private Pulse instance. It records actual outcomes and cleanup failures instead of converting missing release into success. Screenshots, if later produced, still require actual `read_image` inspection before reporting acceptance.

## Authorized private software audio tools

Parent separately authorized extraction-only Pulse preparation and a no-stream null-server preflight. Tool directory: [.companion-data/tooling/pulse-null-d1i9P1](../../../.companion-data/tooling/pulse-null-d1i9P1/provenance.json) (link opens provenance).

System is Ubuntu **22.04 jammy amd64**; installed `libpulse0` is `1:15.99.1+dfsg1-1ubuntu2.2`. No Pulse/PipeWire CLI or daemon initially existed. `/dev/snd` had only seq/timer; that fact alone was not accepted as output-routing proof. System ALSA has a genuine builtin null PCM, while libpulse is also present.

Public Ubuntu packages were downloaded from `https://archive.ubuntu.com/ubuntu/` and verified through the existing signed package-index chain:

- `gpgv` with the system Ubuntu archive keyring accepted jammy and jammy-updates InRelease signatures from the Ubuntu archive 2018 key.
- Actual cached `main/binary-amd64/Packages` SHA256 matched each signed InRelease entry: jammy `12ce0797a6ed39a1fee1321985976c6b78872a8fe4c7ef2fb712f2364c9839a3`, updates `0f5849b70cfe083f5081d41cebe11b06fb1027219b89d37442aa423ce3b5a977`.
- Every downloaded deb's SHA256 matched its indexed package record before `dpkg-deb --extract`.

Only five debs, **1,306,472 bytes total**, were extracted:

| Package | Version | SHA256 |
| --- | --- | --- |
| pulseaudio | 1:15.99.1+dfsg1-1ubuntu2.2 | `b98278cb9c5afc2161297d7493fa1a85d5f8724d66e5271dd8e24591a798f15a` |
| pulseaudio-utils | 1:15.99.1+dfsg1-1ubuntu2.2 | `f156bd2c4b93272ac3bb4d8f2d2ff6131bbbe9bb30c790a8437fa66c0cebe590` |
| libtdb1 | 1.4.5-2build1 | `7caa07ad7657bebb64fdc40444d19674a6d92e2495588b75a23146874c9c1656` |
| liborc-0.4-0 | 1:0.4.32-2ubuntu0.1 | `aa00082a0d8552193f2390288bf51e6d47b516a0795137caaa690a3f04fb66f2` |
| libspeexdsp1 | 1.2~rc1.2-1.1ubuntu3 | `88e64bffabdaed0be1040e31cb1438b6430f8ccff975da895f42f45265256ca3` |

The last three were the only missing `ldd` dependencies for the daemon/core. Existing libraries were reused. `ldd` for the private daemon, pactl, native Unix protocol module and null-sink module reports zero unresolved libraries. No recommends/full audio stack, apt/dpkg installation, maintainer script, system-file change, system default sink change or user audio configuration was performed. Package-provided physical modules are never loaded by this configuration.

Actual versions: `pulseaudio 15.99.1`, `pactl 15.99.1` (compiled/linked libpulse 15.99.0). Binary hashes: daemon `b83e539626370bd700d379faf89c577a48220362ecaa12f291fa96a6d8d3130d`; pactl `db5385e6a721886ac6c4af69e4409af06b85b6cfb193e406b6eb23d4520a3c06`.

## Actually executed no-playback preflight

[Audio preflight runner](../../probes/companion-speech-output-audio-preflight.mjs), [software-audio helper](./software-audio.mjs), [raw evidence](../../../.companion-data/qa-private/companion-speech-output/evidence-archive-c5852eaf/39e6412a-null-preflight.json).

```sh
PET_SPEECH_PULSE_TOOLS="$PWD/.companion-data/tooling/pulse-null-d1i9P1" \
  node qa/probes/companion-speech-output-audio-preflight.mjs --null-service-only
```

Managed job `bash-51f506b00cba40f0` **actual exit 0**, collected. Actual private server PID **1752058**, socket `unix:/tmp/speech-null-riUOnO/native`. It was started with `-n`, its own minimum config/HOME/XDG/PULSE runtime, and only:

- `module-native-protocol-unix` on its private Unix socket;
- `module-null-sink`, unique sink **qa_speech_null**, driver **module-null-sink.c**, actual format **s16le 2ch 48000Hz**.

Actual sink-input count was **0** at both checks. No audio stream or PCM generation occurred in this preflight. No udev/physical device module, product, Electron or browser was started. The server then handled SIGTERM and exited **0**; subsequent connection to its private socket was rejected. Both download/extraction jobs (`bash-823a394377a44cea`, `bash-3465bdf0b9cf41f0`) were also collected. All owned processes/listeners/jobs are closed.

Future product execution must **re-verify** this private server's unique null sink and loaded-module whitelist. It sets explicit `PULSE_SERVER`, `PULSE_SINK`, no-autospawn client config, the self-contained [null-only ALSA config](./null-only-alsa.conf), and Electron `--alsa-output-device=null` as fallback protection. During actual output the runner must observe Pulse sink-inputs whose process IDs descend from the owned Electron PID and whose sink index equals the verified null sink. A library, CLI version, 0-input preflight or an AudioContext start is not substituted for that future live routing proof. 24 kHz AudioBuffers and the actual context/device rate remain separate observations; null output is not physical-hearing evidence.

## Executed syntax and independent fixture checks

`node --check` passed for the native runner, player observer, software-audio helper and audio-preflight runner. The native runner has not been invoked.

The controlled peer gained an optional explicit `responseModes` sequence for same-binding failure/new-reply recovery; exhausting that sequence fails instead of silently reusing a response mode. Its independent loopback self-tests now pass **26/26, actual exit 0** (475.488602 ms). All fixture listeners are closed in finally. These are fixture tests, not production/media/player acceptance.

Prepared code fingerprints:

| File | SHA256 |
| --- | --- |
| Native runner | `70bc7b514d801950d3bf33b484a450fd647b5b6ff0b5e1fe8c59837e631e80b4` |
| Software audio helper | `996ef6ca93fa79589067b9f5cc60371f85d907838137f3e43c6bbe1d38c0bed8` |
| Player observer | `4cf5553ad1887997b0836c3a06b360479c7a06c8af49c24ecf40d2824732d2e8` |
| Controlled peer | `b1f28799b711d541c764209477e1526387e3591f6b1cc617831e760285a569a7` |
| Fixture tests | `2c273222841ce8afbad1812e08a64ea4583f8aa5817e063b86d90abd41b59926` |

Q6/live TTS and physical speaker testing remain unauthorized and unperformed. No original 4120, DSH data, original HOME, old raw QA evidence or independently assigned worker probe was changed.
