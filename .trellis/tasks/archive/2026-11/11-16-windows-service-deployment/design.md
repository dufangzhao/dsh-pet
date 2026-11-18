# Design

## Baseline

Baseline is local `main` at `3cd9d89` (three Windows acceptance commits ahead of the last fetched origin). The Windows development desktop lifecycle already passes. Earlier root QA failed because the service installs Linux-only text-client/media plugins; cloud-exec additionally requires Docker and Linux filesystem semantics. These findings need verification against the actual service composition before changing declarations.

## Service compatibility

Retain `createCompanionService`, CompanionPluginHost, State4 and existing HTTP/SSE protocols. Port small Windows-specific path/process assumptions at their owning boundary. Admit text-client on Windows only after its real controlled path passes. Keep unsupported Docker execution explicit and optional; do not weaken artifact/ownership checks or substitute host JavaScript execution. Codec support must reflect its actual executable/dependency availability.

Use the existing service CLI/build as the implementation base. Local deployment should use a dedicated loopback port and data directory, a private operator-token file or the existing secure CLI input, and graceful owned-process shutdown. Prefer a small cross-platform Node launcher and Windows wrapper over a new generic service framework. No system service or startup task is needed.

## Packaged desktop

The old Linux host is online but Remote session reads failed with `REMOTE_SESSION_FAILED: Check login, capability and workspace/session identifiers.` GitHub has no release and this machine has no original preview9 ZIP. Build a distinctly identified new portable candidate from the current source, using the existing `package-portable.mjs` lock and layout audit. Fix concrete Windows packaging assumptions if encountered.

Extend the existing Windows lifecycle probe to accept an explicit absolute packaged executable. Run the package with a unique isolated user profile, real Main/preload/daemon, actual source trust controls and a controlled authenticated loopback OneBot peer. Record `app.isPackaged === true`, executable/version, source/runtime/archive fingerprints, GUI exit, unchanged daemon boot/key, and explicit stop. Never overwrite production userData.

## Ownership

Chief owns desktop packaging, the packaged lifecycle probe, deployment integration, task records and final quality gate. Windows工程师 owns scoped service portability implementation after reporting its research. Any shared root-script edits must be assigned once to avoid concurrent overwrites. No commits/push until requested; the prior three approved commits remain intact.
