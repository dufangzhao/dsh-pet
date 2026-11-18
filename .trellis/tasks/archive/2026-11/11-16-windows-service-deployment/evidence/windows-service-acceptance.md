# Windows service acceptance

Date: 2026-11-17. Machine: Windows 11 Home 10.0.26200, x64, 18 logical processors,
31.5 GiB, non-elevated user, Developer Mode off. Node 26.13.0 from the repository
tool cache, Electron 45.0.0.

## Packaged desktop lifecycle

`apps/desktop/package-portable.mjs` could not run on Windows because its `run()` helper
spawned `pnpm` by name. It now resolves `process.env.npm_execpath` and runs it with the
current Node when `command === 'pnpm'`; otherwise it fails with an explicit message.

`qa/probes/companion-local-host-windows.mjs` accepts `--executable=<absolute Pet.exe>`.
With an executable it launches the packaged app with `--user-data-dir` and expects
`app.isPackaged === true`; without one it keeps the development behaviour.

`Pet-Windows-x64-0.1.0-preview.10` was assembled on Windows (3745 files, 455687677 bytes,
PE `Pet.exe`, `Start Pet.cmd`, `package-report.json`, no symlinks). The packaged probe
reported `Windows-packaged-lifecycle-passed` with all five checks:

- Windows-production-Main-preload-start-private-directory-and-role-guards
- actual-three-source-DOM-trust-and-allow-authenticated-native-OneBot-ready
- GUI-process-exited-independent-native-source-still-answers-ping
- GUI-reopen-same-host-boot-source-key-and-idempotent-start
- server-absent-explicit-stop-completes-and-closes-native-peer

Evidence: `qa/fixtures/local-host/evidence/windows-bc95c26e-85eb-4df3-b28a-bdf1a8e6812f/report.json`.

This validates the packaging mechanism and the packaged GUI lifecycle. It is not the
original preview.9 ZIP: that artifact was built on the Linux machine and its
`2c63ca...` hash cannot be reproduced here. The rebuilt package is labelled preview.10
(preview.11 after the service changes) and must not be presented as preview.9.

`Pet-Windows-x64-0.1.0-preview.11` was then assembled from the current source (3746 files,
455692024 bytes, `sourceContent 7fcd457cd6e3a6f88d2d4e8fa149d1e186c958d5c68d28d91c355e0843fb6571`).
The same probe passed again and its report records `packaged: true`,
`packageVersion: 0.1.0-preview.11`, `hostId e106f123-...`, `bootId ef1118a5-...`.
Evidence: `qa/fixtures/local-host/evidence/windows-1569f47c-874a-4469-8f90-d7840d2d1721/report.json`.
The distributable folder was zipped to `Pet-Windows-x64-0.1.0-preview.11.zip`
(188590904 bytes, SHA256 `dfa39aba9fcb88294bb42b302c0ac5f23e800d77a966a7fb0f50e1090f9b3805`).

## Service on Windows

Before the fix the service exited at creation because the plugin host rejected every
plugin whose manifest did not list the current platform. `pet.cloud-exec`,
`pet.qq-media-codec` and `pet.text-client` are Linux-only; the first two remain so.

Changes: tolerate non-protected `not-ready` rejections and skip their enable; guard the QQ
codec enable; add `win32-x64` to `pet.text-client`; add `COMPANION_STOP_FILE` and
`SIGBREAK` shutdown; add `apps/companion-service/local.mjs` with `start|status|stop`.

Verified on the real machine:

- `local.mjs start` -> `Started: http://127.0.0.1:4120 (pid 7976)`;
  `status` -> `Agent: ready`, `Unavailable on this host: pet.cloud-exec, pet.qq-media-codec`.
- `GET /` -> 200 `text/html; charset=utf-8` (414 bytes). An unauthenticated state request returned 401.
- `POST /api/messages` -> 202; snapshot contains the user message and the scripted
  assistant reply.
- `POST /api/model/test` against the local Magpie gateway (`http://127.0.0.1:3425/v1`,
  model `codex/gpt-6.1-sol`, `local-client-id` auth) -> `verified`, `evidence: network`,
  `elapsedMs: 3517`.
- In `model` mode, `POST /api/messages` returned a real model answer (not the scripted
  text) before restart; after `local.mjs stop` / `start` the saved mode still applied
  (`Mode: model; model connection: applied; model foreground: enabled`) and a second
  message was answered with `OK`.
- `POST /api/messages` with `创建文件任务` -> task created then `status: failed`,
  `error.code: not-ready`, no artifacts. Unavailable execution is reported honestly.
- `local.mjs stop` -> `Stopped (pid 7976)`, process gone, pid file removed, log has no
  cleanup failure.
- Restart with the same data directory -> 7 messages retained (State4 SQLite).

## Windows desktop and browser share a live Agent

On 2026-11-18 (Asia/Shanghai), an isolated Windows desktop profile ran the packaged
`0.1.0-preview.11` with Electron 45.0.0. The visible desktop and Edge connected to the
same local service at `http://127.0.0.1:4120`. Magpie verified the configured
`codex/gpt-6.1-sol` connection over the network in 3,210 ms before the run.

- The desktop settings form and browser each accepted the operator token through their
  normal controls. The desktop identified model mode, and Edge showed `模型回复 · Magpie`.
- A message sent from the pet's composer and its real reply appeared once in both the
  desktop conversation and Edge. The probe matched the assistant's owner origin to the
  user message ID and confirmed that the pet held the same reply ID.
- The pet's menu exited the original desktop process (PID 14488). With it closed, Edge
  sent another message and received a real reply from the same Agent.
- The new desktop process (PID 40688) restored the saved service address and required the
  token again. After reconnecting, both exchanges retained their message IDs and appeared
  once in the desktop state. The existing unavailable execution task showed `失败` and
  offered no file to save.

All seven probe checks passed. See the [local verification report](../../../../.cache/pet-shared-agent-3qEcOD/verification.json).

## Windows desktop and Edge complete a task and save its file

On 2026-11-18 (Asia/Shanghai), preview.11 and Edge used an isolated scripted Linux Agent
on Docker Desktop, bound to `http://127.0.0.1:4121`. Docker Engine 29.6.2 ran the worker
without network access, with a read-only root, UID/GID `65534:65534` and two mounts,
`/job/code.mjs` and `/work`.

1. The isolated Agent reached `ready` and rejected an unauthenticated state request.
2. A request sent from the pet composer created and completed a real Docker file task.
   The desktop conversation and Edge both showed completion.
3. With two jobs running, the stop button in desktop settings cancelled the selected job.
   Edge showed the cancellation and the other job remained running.
4. The pet exited while the other job was running. Edge stayed connected to the same Agent,
   saw the job complete and downloaded the exact artifact bytes.
5. Relaunch restored the address and required the token again. Settings recovered the same
   Agent, task and artifact IDs. The owned Windows save dialog returned a cancellation and
   then saved the file to the selected path on the next attempt. Both copies matched the
   39-byte server artifact, SHA256 `c99f37438c667c3faddab50ea6614c9606842f3effdc688cb38b6882471570ae`.

All five checks and test resource cleanup passed. See the [local verification report](../../../../.cache/pet-shared-work-Lv2bES/verification.json).

The Docker 29 CLI can omit an empty `Config.Volumes` field. Cloud execution now reads that
field with `index` and accepts only null or an empty object. The existing Docker execution
and materials suites passed 16/16. A real image declaring a `VOLUME` was rejected before
worker creation, with no job records or receipts. The test Agent and its workers shared
an owned daemon-side `/tmp` tree so their private bind mounts worked on this engine.

The QQ codec admission check had the same Docker 29 failure. On the same engine,
`CodecDockerRunner.create` incorrectly returned `not-ready` for a test image with the
expected manifest and entrypoint and no declared volumes. With the correction it
admitted that image and rejected a declared volume and a mismatched manifest pin.
The image assembly probe reads the same optional field. The codec plugin test passed
1/1. The OneBot and official QQ protocol suites each passed 44/44. Actual codec jobs
and QQ delivery require the pinned Linux image and an authorized QQ test peer.

## Gates

- `pnpm -r typecheck` -> exit 0.
- `pnpm lint` -> exit 0; `pnpm format:check` -> all files formatted.
- `pnpm companion:build` -> exit 0.
- New `packages/companion-runtime/src/plugin-host-platform.test.ts` -> 2/2 passed.
- `pnpm --filter @pet/companion-runtime test` -> 9 failed / 57 passed. All 9 are in
  `src/runtime-inputs.test.ts`, which drives `@pet/cloud-exec`; the same single test fails
  on the untouched baseline. Pre-existing Windows/Docker gap.
- `pnpm --filter @pet/companion-service test` -> 117 failed / 254 passed. The failures are
  concentrated in QQ audio/media transfer (Linux SILK codec), material-store symlink
  (`EPERM` for a non-elevated Windows user), migrate-v3 `fsync`, and model timeouts.
  `src/main.test.ts` fails identically on the untouched baseline.

## Limits

- Scripted and local-Magpie model modes verified. No remote paid model endpoint, API key,
  real QQ account, ASR or TTS was used.
- The service is a detached foreground-style process, not a Windows service; a reboot
  stops it until `local.mjs start` runs again.
- Cloud execution stays unavailable on this host, so file/artifact tasks fail by design.
