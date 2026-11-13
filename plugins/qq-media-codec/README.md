# QQ media codec

A fixed, purpose-owned Docker codec source. It accepts an authorized private byte iterator; no platform URL, remote path, caller command or JSON audio payload enters the job.

## Integration

`createQqMediaCodecPlugin(portsFor)` registers the ordinary `pet.qq-media-codec` source. `portsFor(context).bind(native)` supplies the host-private binding; its disposer unbinds it. Activation binds only. The host invokes native methods after active-source permission checks, under the existing TaskSupervisor/source file and `process/codec` leases. Keep material ACL and provenance checks in the host's material owner.

Config/CAS owns exactly `imageId` and `manifestSha256`; take both from [the fixed artifact lock](codec-image.lock.json). Empty config is unavailable. Image presence, exact ID, manifest label, absent anonymous volumes and fixed environment-clearing entrypoint are checked before use. No tag resolution or automatic image pull occurs.

Native operations:

```ts
decode<T>(input: AsyncIterable<Uint8Array>, consume: (output: CodecOutput,
  bytes: AsyncIterable<Uint8Array>, signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T>
encode<T>(input: AsyncIterable<Uint8Array>, consume: (output: CodecOutput,
  bytes: AsyncIterable<Uint8Array>, signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T>
```

Await the entire operation in the authorized scope. `consume` must finish its byte iteration. Paths remain private; the output directory is removed only after the real container stopped and was removed. Failure to confirm cleanup retains the owned record, blocks reuse and makes source close fail. Source revocation and close abort the running container and join it. The codec's 60-second job clock ends at actual process exit; the six-span ASR consumer retains its own authority/lifetime.

## Formats and budgets

The canonical attachment/M4/M5 constants are imported from `@pet/contracts`, not copied as another wire schema.

- Decode Tencent SILK v3, WAV, MP3, AAC/ADTS, M4A, FLAC, Ogg/Vorbis and Ogg/Opus into mono 16kHz f32le. FFmpeg probes bytes and accepts only fixed audio demuxers/protocols, with one audio stream; it never treats a filename suffix as encoding.
- Decode completely up to 120 seconds, derive duration from real decoded frames and return at most six exact non-overlapping M4 20-second spans. Over-budget audio fails; there is no successful `-t 120` truncation.
- Encode mono 24kHz PCM16LE into actual Tencent SILK. Inspect framing and decode the emitted data to verify every frame. SILK's final 20ms frame may contain zero padding; original input samples are never dropped. Returned duration is the encoded duration.
- SDK `duration` and `getDuration()` are not trusted duration evidence. AAC/container priming may yield a different real decoded sample count from a nominal source duration; that actual count controls the budget.
- Input is bounded to 32MiB; at most two preparation lifetimes are active. Runtime/input are read-only, output is an owned temporary directory, network is none, capabilities are dropped and `no-new-privileges` is set. Defaults are 512MiB total cgroup memory with equal swap limit, 1 CPU, 32 PIDs, 64 descriptors, 16MiB tmpfs, 8MiB **per-file** RLIMIT_FSIZE and bounded logs. The fixed runner creates only its audio/result files; this is not a claim of a general filesystem/project quota.

The selected codec is Linux amd64. A missing image or unsupported Docker resource setting is unavailable; there is no ambient host codec/PATH fallback. This proves neither QQ upload compatibility nor human playback.

## Reproduce the isolated gate

Use existing Node tooling; root dependency/lock coordination remains with the task coordinator.

```sh
node qa/probes/companion-qq-codec-dependencies.mjs
node qa/probes/companion-qq-codec-build.mjs
node qa/probes/companion-qq-codec-image.mjs
node qa/probes/companion-qq-codec-acceptance.mjs plugins/qq-media-codec/codec-image.lock.json
node qa/probes/companion-qq-codec-lifecycle.mjs plugins/qq-media-codec/codec-image.lock.json
```

The scripts prepare sources/build products under `.cache/qa/companion-qq-codec`, not the host installation. FFmpeg source is PGP verified, SILK's npm SHA512 is checked, and LAME's source checksum is matched to the fixed Debian source description. Image assembly itself is offline and uses the already present immutable public Node base; its DSH entrypoint is never started and no DSH data/account is mounted.

Build artifacts and embedded license hashes are in [the lock](codec-image.lock.json); actual receipts, source versions, compiler/configure flags, licenses and limitations are in [codec acceptance](../../qa/fixtures/companion-qq-codec/README.md).
