# QQ voice codec choice — source evidence, no execution

Read2026-11-12/13 during planning. No dependency was installed, compiled, loaded or used to process audio.

## Selected Node component

[silk-wasm3.7.1 registry metadata](https://registry.npmjs.org/silk-wasm/3.7.1) identifies repository `idranme/silk-wasm`, gitHead `5971995be3ce05d4a1bf820fdf9d7ccdc942e945`, Node>=16.11, MIT package license and tarball integrity `sha512-mXPwLRtZxrYV3TZx41jMAeKc80wvmyrcXIcs8HctFxK15Ahz2OJQENYhNgEPeCEOdI6Mbx1NxQsqxzwc3DKerw==`.

The [published README](https://unpkg.com/silk-wasm@3.7.1/README.md) and [pinned implementation](https://github.com/idranme/silk-wasm/blob/5971995be3ce05d4a1bf820fdf9d7ccdc942e945/src/index.ts) expose:

- `encode(ArrayBufferView|ArrayBuffer,sampleRate)` → SILK data and duration in milliseconds; WAV or mono PCM16 input.
- `decode(ArrayBufferView|ArrayBuffer,sampleRate)` → PCM16 data and duration.
- `isSilk`, `isWav`, WAV metadata and `getDuration(data,frameMs)` helpers.

The implementation instantiates a WASM codec, copies complete output into a Uint8Array, and is **not a streaming/cancellation API**. `getDuration` counts blocks with a caller-selected frame duration; it is not sufficient proof of a trusted decoded duration. The [build flags](https://github.com/idranme/silk-wasm/blob/5971995be3ce05d4a1bf820fdf9d7ccdc942e945/binding/CMakeLists.txt) enable memory growth and contain no explicit project-sized memory ceiling. Do not describe Node heap flags or byte-input bounds as an OS-enforced total-memory limit.

Design therefore places the fixed codec operation in an owned resource-limited sandbox job, with bounded input/output and real process/worker settlement; no arbitrary code, network or host path from a message. The package and embedded codec notices/artifacts must be reviewed/pinned during the dependency gate, not inferred solely from npm's license label.

## Other formats and alternatives

A pinned FFmpeg executable in the same codec job is the selected general audio decoder/resampler for explicitly supported non-SILK formats. The implementation phase must produce a reproducible codec image/artifact manifest and synthetic format/cancellation/resource tests before claiming availability; no host PATH fallback or ambient installation is assumed. QQ voice export uses actual Tencent-compatible SILK, avoiding the conflicting upstream descriptions of mp3/wav/ogg voice presentation.

[silk-python0.2.9](https://pypi.org/project/silk-python/) is a documented alternative with BinaryIO encode/decode and `tencent=True`; it is not selected because this service is Node-based. The older [wx-voice](https://github.com/Ang-YC/wx-voice) requires FFmpeg/build tools and lists timeout/Windows work as TODO, so it is not treated as a ready lifecycle adapter.

These library facts do not establish QQ delivery, sound quality, deployed gateway compatibility or a universal platform duration maximum. They identify a concrete, testable codec implementation path rather than renaming bytes as audio.
