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
- `GET /` -> 200 `text/html; charset=utf-8` (414 bytes).
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
