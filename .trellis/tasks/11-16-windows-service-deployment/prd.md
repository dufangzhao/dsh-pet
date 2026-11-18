# Windows companion service and local deployment

## Goal and authorization

On 2026-11-16 the user authorized testing the packaged desktop and making the continuous Agent service compatible with Windows, including deployment on this machine. This task records that extension without changing the approved artifacts of `11-13-local-plugin-host-qq-bridge`.

## Requirements

- Run the single-Agent companion service natively on Windows x64 with Node 26.13.0 and the locked workspace dependencies, as an ordinary user.
- Preserve authentication, source trust, provider permissions, State4 transactions, explicit migration, process ownership and actual cleanup contracts.
- Support the HTTP/browser and desktop connection, persisted conversations and explicitly labeled controlled responses without external accounts or paid models.
- Declare Windows compatibility only for plugins whose implementation is supported and exercised. Optional Linux/Docker capabilities must not prevent the text service from starting; unsupported execution remains explicitly unavailable, with no host execution fallback.
- Provide repeatable local startup, status and graceful stop instructions or commands. Keep the data root outside generated builds and never print operator credentials in logs or command output.
- Use a new loopback deployment and isolated acceptance roots. Do not modify old Linux services, real QQ accounts, external model credentials or the user's existing desktop profile.
- Exercise a self-contained Windows desktop package, recording version, archive SHA256, real packaged status and lifecycle evidence. A rebuilt package must not be represented as the original preview9 ZIP.

## Acceptance criteria

- [x] Windows-supported plugins start through the actual plugin host, which reports unsupported optional capabilities as unavailable.
- [x] Authenticated HTTP text input produces an explicitly scripted response. Unauthorized state requests return HTTP 401, and state survives graceful stop/restart.
- [x] The browser and desktop attach to the Windows service through the authenticated endpoint. The [desktop and browser run](evidence/windows-service-acceptance.md#windows-desktop-and-browser-share-a-live-agent) verified shared replies, reauthentication, and the failed task state without a file.
- [x] The Windows desktop and Edge share tasks on a supported Linux execution host. The [task and artifact run](evidence/windows-service-acceptance.md#windows-desktop-and-edge-complete-a-task-and-save-its-file) verified targeted cancellation, background completion after desktop exit, and byte-identical Edge downloads and Windows native saves.
- [x] Local start/status/stop work as an ordinary Windows user and cleanup is confirmed. A final ready deployment remains available on loopback with discoverable local instructions.
- [x] The independently assembled Windows desktop starts as packaged, survives GUI exit with the same local daemon, reattaches without a second host, and explicitly stops its OneBot peer.
- [x] Windows-specific probes, typechecking, lint, format and builds passed. The [quality record](evidence/windows-service-acceptance.md#gates) lists package-suite failures and the platform limits.

## Limits

No Windows service-manager installation, auto-start registration, system Node upgrade, Docker installation, real QQ login, paid inference, microphone/speaker trial, Git push or public publication is authorized by this task. Testing a newly rebuilt package closes only that artifact's lifecycle check; the original preview9 hash remains unverified unless its exact bytes are obtained.
