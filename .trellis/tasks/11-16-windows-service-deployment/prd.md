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

- [ ] Windows-supported plugins admit and start through the actual plugin host; unsupported optional capabilities have a truthful unavailable state.
- [ ] Authenticated HTTP text input produces an explicitly scripted response; unauthorized requests fail, and state survives graceful stop/restart.
- [ ] The browser and desktop can attach to the Windows service using its real authenticated endpoint; task failures never claim successful execution without a backend.
- [ ] Local start/status/stop work as an ordinary Windows user and cleanup is confirmed. A final ready deployment remains available on loopback with discoverable local instructions.
- [ ] The independently assembled Windows desktop starts as packaged, survives GUI exit with the same local daemon, reattaches without a second host, and explicitly stops its OneBot peer.
- [ ] Appropriate Windows tests, QA probes, typechecking, lint, format and builds pass; platform-specific exclusions and remaining limitations are recorded accurately.

## Limits

No Windows service-manager installation, auto-start registration, system Node upgrade, Docker installation, real QQ login, paid inference, microphone/speaker trial, Git push or public publication is authorized by this task. Testing a newly rebuilt package closes only that artifact's lifecycle check; the original preview9 hash remains unverified unless its exact bytes are obtained.
