# Progress

## Current execution

Status: completed and archived on 2026-11-18. The Windows service and rebuilt preview.11
passed packaged local-host lifecycle, local Magpie model persistence, and the shared
conversation across the pet, settings and Edge. The Windows service stayed ready when the
desktop exited, and the reopened desktop recovered the two model exchanges after
reconnecting. A separate Linux execution host passed the Windows desktop and Edge task and
artifact checks.

## Evidence

| Area | Result | Location |
| --- | --- | --- |
| Plugin host platform tolerance | 2/2 new tests pass | `packages/companion-runtime/src/plugin-host-platform.test.ts` |
| Service start/status/stop | pass on Windows 11 x64 | `evidence/windows-service-acceptance.md` |
| Text client and messages | 200 / 202, scripted and model replies stored | `evidence/windows-service-acceptance.md` |
| Restart persistence | messages retained, model mode re-applied | `evidence/windows-service-acceptance.md` |
| Model connection | Magpie `verified`, 3517 ms, `evidence: network` | `evidence/windows-service-acceptance.md` |
| Packaged desktop and Edge | 7/7 checks passed, including Magpie replies after desktop exit and recovery by message ID | [Windows shared Agent evidence](evidence/windows-service-acceptance.md#windows-desktop-and-browser-share-a-live-agent) |
| Task and artifact on Linux through Windows clients | 5/5 checks passed, including selected cancellation, completion after desktop exit and native save | [Windows task and artifact evidence](evidence/windows-service-acceptance.md#windows-desktop-and-edge-complete-a-task-and-save-its-file) |
| Native Windows execution | `not-ready`, no artifact | `evidence/windows-service-acceptance.md` |
| Packaged desktop lifecycle | 5/5 checks passed (preview.10 and preview.11) | `qa/fixtures/local-host/evidence/windows-bc95c26e-85eb-4df3-b28a-bdf1a8e6812f/report.json`, `qa/fixtures/local-host/evidence/windows-1569f47c-874a-4469-8f90-d7840d2d1721/report.json` |
| Preview.11 ZIP | 188590904 bytes, SHA256 `dfa39aba...f9b3805` | `.cache/release/Pet-Windows-x64-0.1.0-preview.11.zip` |
| Typecheck / lint / format / build | pass | `.cache/checklogs/windows/` |

## Decisions

- `pet.text-client` is declared `win32-x64`; it has no native code. `pet.cloud-exec` and
  `pet.qq-media-codec` stay Linux-only rather than pretending Docker or SILK works.
- A non-protected plugin rejected as `not-ready` no longer aborts service creation; a
  protected plugin or a different rejection still aborts.
- Shutdown uses `COMPANION_STOP_FILE` because a detached Windows process has no SIGTERM.
- Deployment is a detached process managed by `local.mjs`, not a Windows service.

## Remaining

- Real QQ delivery needs an authorized test peer and recipient. The codec admission check
  passed on Docker 29.6.2. Real media jobs need the pinned Linux image. This machine lacks
  the image and its pinned base. The Docker Hub request for that base timed out.
- Windows enumerates a microphone array and speakers. The verified local Magpie text
  gateway did not list `xiaomi/mimo-v2.5-asr` or `xiaomi/mimo-v2.5-tts` when queried
  with the corresponding clients. Physical audio acceptance needs an available route
  and a supervised device trial.
- The Windows deployment gate is recorded above. Commit review and `/finish-work` completed
  on 2026-11-18.

## Handoff

- The Windows development handoff lives at `docs/41-windows-development-handoff.md`.
- The task is archived at `.trellis/tasks/archive/2026-11/11-16-windows-service-deployment/`.
- Real QQ delivery, the pinned Linux codec image and physical audio remain outside this
  task; continue them in `11-13-local-plugin-host-qq-bridge` when an authorized peer,
  image and audio route are available.
