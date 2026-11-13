# Host-private worker material input

The service composition can use `createCloudExecPlugin({ readMaterial })`. The default `PluginDefinition` keeps the existing text-file behavior and rejects nonempty material selections when no reader is installed. [The exported types](src/types.ts) are the single signature source.

`CloudExecutionRequest.materials` contains only `CompanionMaterialSelection` values: opaque `materialId` and safe worker-relative `inputName`. It carries no source path, URL, bytes, MIME override, claimed hash, or authority. The private reader receives the actual `PluginTask`, logical `executionId`, and one immutable selection, and calls/awaits `consume` exactly once with verified size/hash, an async byte stream and a current-authority `check()` function. The reader owns closing that stream and must settle when the supplied task signal aborts.

## Runtime binding

`CompanionRuntime.executeTask` synchronously stores the handle returned by `CompanionPluginHost.runCapability`. `TaskSupervisor.invokeCapability` enters the provider in a subsequent microtask and preserves that handle's `taskId`. The host reader must locate the existing `ActiveWork` by logical execution, require `work.handle.taskId === request.task.taskId`, and recheck its captured participant/audience/material permission and cancellation state. Knowledge of `executionId` or `materialId` alone authorizes nothing. No additional ticket or grant registry is needed. The service material store resolves protected bytes from that checked authority; it must not translate a model-supplied remote or local path into a filesystem read.

The callback is an explicit trusted-host port, not part of SDK JSON. Cloud-exec verifies byte integrity and destination ownership; the runtime/service callback remains responsible for actual principal, audience, current policy and material-store authorization. Focused callback fixtures are not evidence that the parent composition has installed those checks.

## Copy and lifecycle

Selections use the canonical task-material count bound. Input names may not collide with, contain, or be contained by another input file name. The existing string files retain their 24 KiB aggregate budget. Materials plus text input bytes have a separate 32 MiB aggregate budget; individual materials also obey the canonical file limit. Output artifact limits remain unchanged at the configured 1 MiB default / 8 MiB maximum.

Copy starts in the fresh job's `work` directory before publishing Docker create intent. It uses exclusive no-follow file creation, bounded 64 KiB copies, exact size and streaming SHA-256 verification, and current-authority checks around reads/writes. The task, plugin lifetime and execution timeout reach the reader's signal. Any failed or cancelled copy joins its actual in-flight work, verifies the precise created file paths/inodes, and removes this copy's material files, including files already staged earlier in the same request. Existing text/code and job directories are retained. After successful execution, existing workspace/artifact retention and crash-reconciliation rules apply; this addition introduces no job-directory garbage collector.

A nonempty material selection list contributes its IDs/names to the existing execution fingerprint. Absent or empty `materials` preserves the previous fingerprint byte-for-byte. Repeated identical execution returns the existing pending/terminal result without reading materials or running code again. Changed selections under the same execution ID conflict. Recovery never re-reads materials or replays the command.

## Focused verification

Run from this package directory using existing workspace tools:

```sh
node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node ../../node_modules/eslint/bin/eslint.js src tests
node ../../node_modules/prettier/bin/prettier.cjs --check src tests package.json material-input.md
node --import ./tests/source-loader.mjs --test tests/boundary.test.mjs tests/materials.test.mjs
PET_CLOUD_EXEC_IMAGE=sha256:a9975a0df83b07f6ef3a57098174a8303cb0e322570e1d2f175ceba33f417a72 PET_CLOUD_EXEC_DOCKER_TEST=1 node --import ./tests/source-loader.mjs --test tests/*.test.mjs
```

The 2026-11-13 focused run passed 22 offline cases and 38 cases with real Docker enabled, including the existing lifecycle/recovery tests. The actual binary job read a 2 MiB binary input alongside unchanged text, generated its expected SHA/size artifact, and executed its append effect exactly once across concurrent and completed retries. Filesystem tests copied and verified exactly 32 MiB and rejected aggregate overflow before consuming the excess stream. Negative cases cover missing reader, guessed execution with a mismatched task handle, path/name collision and symlink destinations, incorrect hashes/sizes, skipped/double/swallowed callback consumption, grant revocation, and cancellation before/during copying. Actual timeout/cancellation fixtures confirm source settlement, removal of staged bytes, and no created container.

The Docker run used the already installed immutable image above, its fixed Node entrypoint, network disabled, read-only runtime and only existing job mounts. No image pull, dependency install, account/network/model call, host execution fallback, or original service-profile access was used. These are local material/executor tests; QQ transport ingestion and production participant/audience integration remain the parent owners' acceptance work.
