# Windows Agent service (local deployment)

The companion service now starts and serves the text client on Windows x64. This is a
local operator deployment, not a Windows service: it survives the terminal that started
it only because it is detached, and it does not start at boot.

## What blocked Windows before

`CompanionPluginHost.create` installed every registered plugin and threw
`KernelFault('not-ready')` for any manifest that was `rejected`. Three plugins declare
Linux-only platforms:

- `pet.cloud-exec` — `linux-x64`, `linux-arm64`
- `pet.qq-media-codec` — `linux-x64`
- `pet.text-client` — was `linux-x64`, `linux-arm64`

The whole service therefore failed to start on Windows even when the unavailable plugin
was optional.

## What changed

- `packages/companion-runtime/src/plugin-host.ts` tolerates a `not-ready` rejection for a
  non-protected registration, records it as unavailable, and skips its automatic enable.
  A protected registration or any other rejection reason still fails creation.
  `isUnavailable(pluginId)` reports the recorded state.
- `apps/companion-service/src/service.ts` skips the QQ codec enable when that plugin is
  unavailable, instead of calling `setEnabled` on a rejected plugin.
- `plugins/text-client/plugin.json` adds `win32-x64`: the plugin only contributes a static
  client page and has no platform-specific code.
- `apps/companion-service/src/main.ts` supports `COMPANION_STOP_FILE`. A supervisor creates
  the file to request shutdown; the service removes it and closes. `SIGBREAK` also stops.
- `apps/companion-service/local.mjs` is the operator entry (`start`, `status`, `stop`).

`pet.cloud-exec` and `pet.qq-media-codec` stay Linux-only on purpose. Docker and the SILK
codec are not pretended to work on Windows.

## Run

```powershell
# from the repository root, with the project Node on PATH
node apps/companion-service/local.mjs start
node apps/companion-service/local.mjs status
node apps/companion-service/local.mjs stop
```

Defaults: port `4120`, data directory `<repo>/.companion-data/agent`, host `127.0.0.1`.
The launcher creates `operator-token` (mode 0600) on first start and reuses it. It writes
`service.pid`, `service.log`, and `stop.request` beside the token. `status` prints the
agent state and the plugins that are unavailable on this host.

Environment overrides are the same as the service: `COMPANION_DATA_DIR`, `COMPANION_PORT`,
`COMPANION_HOST`, `COMPANION_MODE`, `COMPANION_MODEL`, `COMPANION_MODEL_BASE_URL`,
`COMPANION_MODEL_API_KEY`, `COMPANION_NAME`, `COMPANION_PERSONA`.

The browser text client is at `http://127.0.0.1:4120/`; it needs the operator token for
API calls. The desktop can attach to the same service through its normal server connection.

## What works, verified on Windows 11 x64

- Service starts, `agent.status` is `ready`, `pet.text-client` is `active`.
- `GET /` returns the text client HTML.
- `POST /api/messages` is accepted and the reply is stored (scripted mode and real model
  mode both exercised).
- Messages survive a stop/start cycle (State4 SQLite).
- `local.mjs stop` ends the process through the stop file, removes the pid file, and logs
  no cleanup failure.
- Restart attaches to the same data directory and token.

## Model connection

The service runs in `model` mode through the local Magpie gateway at
`http://127.0.0.1:3425/v1`. The saved connector is
`pet.model-connection-magpie/magpie` with model `codex/gpt-6.1-sol` and
`local-client-id` auth. `POST /api/model/test` returned `verified` with
`evidence: network` in 3,517 ms; owner messages were answered by the model before and
after `local.mjs stop` / `start`, and the saved mode survived the restart
(`Mode: model; model connection: applied; model foreground: enabled`).

## Packaged desktop

A locally rebuilt portable package (`0.1.0-preview.11`, win32-x64) was assembled from this
source with `apps/desktop/package-portable.mjs`. The existing Windows probe now accepts
`--executable=<Pet.exe>` and drives the packaged binary with an isolated `--user-data-dir`
profile instead of the repository desktop build. It passed all five lifecycle checks and
recorded `packaged: true` and `packageVersion: 0.1.0-preview.11` in its report.

The original `0.1.0-preview.9` ZIP from the Linux build host is still unavailable on this
machine, so its own bytes were not re-accepted; the preview.11 rebuild is evidence for the
current source, not for that artifact.

## What does not work on Windows yet

- Execution tasks: a "create file task" is accepted but fails with `errors.not-ready`
  because `pet.cloud-exec` is unavailable. That is the honest outcome; no artifact is
  fabricated.
- QQ media: `pet.qq-media-codec` is unavailable, so audio messages report
  `source: 'unavailable'`.
- Real QQ account, ASR and TTS joint trials were not run.
- Model mode was verified only against the local Magpie gateway (`codex/gpt-6.1-sol`,
  `local-client-id`); no remote paid endpoint or API key was used.
- The service does not install itself as a Windows service and does not start at login.
  A reboot leaves it stopped until `local.mjs start` is run again.
