# Progress

## Current execution

Status: in_progress — implementation and real-machine acceptance done; packaged preview.11
rebuilt and passed the same five-check lifecycle probe. Pending only the operator's
decision about model mode.

The service now starts on Windows x64 in scripted mode and serves the browser text client.
Packaged desktop lifecycle passed on a locally rebuilt preview.11 package.

## Evidence

| Area | Result | Location |
| --- | --- | --- |
| Plugin host platform tolerance | 2/2 new tests pass | `packages/companion-runtime/src/plugin-host-platform.test.ts` |
| Service start/status/stop | pass on Windows 11 x64 | `evidence/windows-service-acceptance.md` |
| Text client and messages | 200 / 202, scripted replies stored | `evidence/windows-service-acceptance.md` |
| Restart persistence | 7 messages retained | `evidence/windows-service-acceptance.md` |
| Unavailable execution | `not-ready`, no fake artifact | `evidence/windows-service-acceptance.md` |
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

- Decide whether to run model mode, which needs an endpoint and key supplied by the user.
- Real QQ account, ASR and TTS trials remain out of scope for this task.
