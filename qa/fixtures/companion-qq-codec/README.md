# Executed QQ codec Phase 0 gate

Executed 2026-11-13 on Linux amd64, Docker Engine/CLI 27.0.3, cgroup v2. Synthetic local Docker/codec evidence only: no QQ, SnowLuma runtime, account, model, ASR service, device or delivery test occurred.

## Authoritative artifacts and receipts

- [Final image/runtime lock](../../../plugins/qq-media-codec/codec-image.lock.json): image `sha256:efbbfdfd603a862fb15929e43cf9afd38241c7ca89343907460bcc7cdab6bc1f`, embedded manifest `69745cbac7496217f6d79f015d396f7ad066e0473c2fcea5e5b0e60c8aa58bdb`.
- [Source/build provenance](provenance.json): fixed public download hashes, FFmpeg release signing fingerprint, compiler and configure flags. `$QA_ROOT` denotes the isolated build root.
- [Final actual codec/sandbox receipts](acceptance.json): 18 cases, 17 codec jobs, six owned compressed-fixture jobs and one sandbox audit.
- [Final lifecycle receipts](lifecycle.json): seven focused lifecycle/tail/consumer cases.
- [Separate confirmed OOM observation](memory-oom-observation.json): prior byte-formatted runner artifact with the same Node/FFmpeg/WASM and resource settings, retaining actual `OOMKilled=true` rather than inferring it from an exit code.

## Observed results

| Path | Actual result |
| --- | --- |
| WAV, MP3, AAC/ADTS, M4A, FLAC, Vorbis, Opus | Real compressed bytes decoded to finite mono 16kHz f32le; compressed priming counts retained rather than replaced by a nominal duration |
| 120s WAV | 1,920,000 frames / 7,680,000 output bytes; every sample equals the independently generated PCM conversion |
| Six 20s spans | Six exact 320,000-frame regions; complete coverage, no overlap, all individual byte hashes retained |
| 24kHz 120s PCM→SILK | 2,880,000 frames; actual Tencent header/packets, 412,546 bytes, then real decode validation |
| SILK→16kHz | 1,920,000 frames; all six distinct generated tone regions detected in order |
| Non-aligned PCM tail | 24,001 original samples retained in 24,480 encoded samples, then 16,320 decoded samples; bounded codec frame padding, no lost tail |
| Bad/truncated/odd/>120s | Failed with no consumer publication; no silently shortened success |
| Environment/mount/network | Only HOME/LANG/UV_THREADPOOL_SIZE; runtime/input writes EROFS, owned output writable, only loopback interface |
| CPU/PIDs | `cpu.max=10000 100000`, positive throttling count; `pids.max=32`, 36 rejected forks in the retained audit |
| Memory/file bounds | Real cgroup setting and low-memory job rejection; actual fsize limit fails without publication. Final low-memory receipt is exit137 with OOMKilled=false; the separate prior record confirms OOMKilled=true. These facts are not conflated |
| Caller cancel/source revoke/close | A nonzero running PID was observed; actual container exit/removal and workspace removal awaited, jobs zero |
| Incomplete consumer/preparation | Partial return fails; a third preparation is refused; close waits real parked staging retirement |
| Long scoped consumer | The codec job timer is cleared only after actual codec process exit, so it does not impose a new 60s limit on subsequent scoped ASR work |

The final receipts have all active-job counts zero. Owned codec/fixture/audit container queries were empty after cleanup. The artifact image is retained for integration; tests do not remove the original public base or account images.

## Licensing and reproducibility boundary

SILK wrapper is MIT (`silk-wasm3.7.1`, npm SHA512 and gitHead pinned). The image also retains the Russell two-clause notice and original Skype SDK BSD-style notice with its explicit no-patent-grant text. FFmpeg7.1.2 is the selected minimal LGPL2.1-or-later build; static LAME3.100 is LGPL2-or-later. glibc and GCC runtime notices are included. Full notice byte hashes are in the runtime lock. Source locations are in provenance and the dependency/build scripts; this is not a statement that npm's MIT label covers all embedded code.

The source inputs, build recipe, observed binaries and image are pinned. This does not claim that a different compiler/base/environment reproduces the same image bytes. Default Docker Hub Node-base metadata lookup timed out; the accepted build used the already present immutable public base solely as Node24.21 runtime, with a fixed `env -i` codec entrypoint and no DSH process/data.

Early attempts exposed Docker local-log compression/max-file constraints and an FFmpeg build-component/CLI-format naming distinction. Both were corrected before the retained successful gate. No host codec fallback was used.

QQ platform/account format acceptance, perceptual voice quality, complete ASR integration, material ACL/State integration, actual PluginManager source permission composition and real send/upload receipts remain later task integration gates.
