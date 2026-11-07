# Cloud execution provider handoff

## Delivered boundary

`plugins/cloud-exec` is an ordinary `@pet/plugin-sdk` `definePlugin` package: `pet.cloud-exec`, provider `docker`, capability `execution.javascript@1`, methods `execute` and `reconcile`. Both methods declare process and plugin-data access; the parent host authorizes invocation. The runtime and declared Docker launcher worker use the content-pinned `dist/index.mjs` bundle. No scheduler, image pull, dependency installation or unrestricted host execution is added.

The public Node-side types are exported from `plugins/cloud-exec/src/types.ts` through the package entry. The execute result shape is unchanged:

```ts
execute(task: PluginTask, input: JsonValue): Promise<Result<CloudExecutionResult>>

// CloudExecutionRequest
{
  executionId?: string;                 // product State task.executionId; otherwise PluginTask.taskId
  code: string;                         // dependency-free JavaScript ES module
  files?: Array<{ path: string; content: string }>;
  outputs?: Array<{ path: string; mediaType?: string }>;
  timeoutMs?: number;                   // may lower, never raise, configured limit
}

// CloudExecutionResult
{
  jobId: string;
  status: 'exited' | 'cancelled' | 'timed-out' | 'unknown';
  exitCode: number | null;
  stdout: string;
  stderr: string;
  logsTruncated: boolean;
  settled: boolean;
  artifacts: Array<{
    path: string;                       // declared job-relative output name
    relativePath: string;               // UUID/artifacts/output-name
    mediaType: string;
    sizeBytes: number;
  }>;
  error: KernelError | null;
}

DockerExecutor.reconcile(input?: CloudReconcileRequest): Promise<Result<CloudReconcileResult>>
// Ordinary provider: reconcile(task: PluginTask, input: JsonValue), same Result payload.

// CloudReconcileRequest
{ after?: string; limit?: number }
// CloudReconcileResult
{
  receipts: Array<{ executionId: string; result: CloudExecutionResult }>;
  nextCursor: string | null;
}
```

Execution IDs accept 1–200 ASCII alphanumeric/dot/underscore/colon/hyphen characters, starting with an alphanumeric character. Duplicate execution IDs with the same normalized request return the original pending or durable receipt; a different request returns `conflict`. Config reloads do not alter the request fingerprint. The parent should always pass the durable State execution ID, never mint a replacement identity during recovery.

`Result.ok` means a receipt is available, not that code succeeded. Inspect status, exit code, settlement and error. Normal nonzero exits retain the real exit code. Artifact refusal retains status/logs with `error: invalid-input` and no published descriptors. A verified zero exit remains a completed effect when stop races with it. Missing Docker/image returns `unavailable` without a host fallback.

`execute` awaits actual completion and cleanup. The parent admits independent root TaskSupervisor work and captures the plugin result inside its work closure. Await physical `TaskHandle.settled` before recording confirmed termination: logical cancellation can resolve earlier.

## Durable records and explicit recovery

Each job has a protected host-only `.records/<jobId>.json` below the trusted workspace root. The directory is service-owned mode 0700; record files are service-owned mode 0600 regular files with one link, opened with `O_NOFOLLOW` and a 64 KiB read limit. Recovery rejects symlinks, unsafe ancestors, malformed records, unexpected mount paths, unsupported versions and conflicting execution identities. The record contains version, execution ID, request fingerprint, complete activation owner token, TaskSupervisor task ID, job UUID, fixed container name, actual full container ID when known, exact expected bind mounts, declared outputs, original bounded configuration and the final result receipt. Metadata and receipts never enter a container.

Writes use an exclusively created temporary file, file fsync, atomic rename and directory fsync. The executor persists intent before Docker create and its verified full ID before start. On exit it collects checked artifacts and saves a result checkpoint before removing the container, then saves confirmed settlement. A crash after create but before the ID checkpoint can still locate the fixed name and verify the full ID; a crash after removal but before final settlement can use the result checkpoint. Existing retained artifacts are accepted on a collection retry only after the regular-file/no-symlink/link-count/size/content checks match the stopped workspace source.

On service startup or provider re-enable, the parent pages `reconcile` from `{}` (or `{limit: 1}`) until `nextCursor === null`, ingesting every receipt by execution ID with stable artifact IDs. The cursor is the last scanned job UUID in lexical order. Default limit is four records; accepted limits are 1–8. Each call reads/recovers at most that many records and keeps receipt payloads within a 48,000-byte JSON budget, below the kernel's 64 KiB ceiling. A page can be shorter due to the byte budget. Repeating the same cursor re-delivers stored receipts; no receipt acknowledgement deletes files. Current executor-owned active calls are skipped and continue normally.

Before admitting new code, `execute` performs one bounded recovery page if needed and requires every persisted non-active record to have been verified and settled. Larger histories require the explicit startup pagination above. An invalid record, unknown ownership or unsuccessful cleanup blocks new execution. Skipping an invalid record with `after` cannot bypass this admission gate. Reconciliation does not rerun code, reconstruct a process or replay an effect.

For each nonterminal record, recovery follows these rules:

1. Inspect its persisted full ID, or use the fixed name only to locate a candidate when the ID checkpoint is absent. Require the exact owner token, job, execution and task labels, fixed name and complete expected bind-mount set, including read/write flags and propagation. Derive the expected bind sources from the trusted root and job UUID; metadata cannot authorize arbitrary host paths.
2. Stop only a matching full-ID container, using a one-second grace period and bounded kill escalation. Reinspect the same identity and mounts before removal. No prefix deletion or cross-generation sweep occurs.
3. An already exited zero-status container proves completion. Preserve its exit status, bounded logs and verified artifacts. A running orphan is stopped; a nonzero recovered result remains `unknown` because the interrupted effect cannot safely be assumed failed or replayed. Confirmed cleanup is `settled: true`.
4. If Docker confirms absence and there is a prior result checkpoint, preserve that evidence and finish settlement. If no terminal evidence exists, persist `status: unknown`, `exitCode: null`, `error: unavailable`, `settled: true`: absence proves resource cleanup, not effect success. An inaccessible daemon or ownership/mount mismatch is `unknown`, `settled: false` and blocks admission. A mismatch never authorizes touching that container.
5. Keep receipts and job directories for idempotent re-delivery. The parent owns durable product-state ingestion and authorized artifact references. A receipt with unsettled cleanup is not permission to admit new work merely because the reconcile call itself returned `ok`.

SIGKILL still bypasses in-process deadlines and disposal. Orphans are now reclaimed by explicit fresh-executor reconciliation. Until the service restarts and calls recovery, no independent expiry service exists. Use a single writable service instance per data/workspace root.

## Configuration and retained artifacts

Only owner/config context supplies `dataDirectory`, image and resource settings. Requests cannot choose commands, mounts, host paths, network or resources.

| Setting | Default | Accepted bounds |
| --- | --- | --- |
| `image` | Required | Installed trusted Node image reference, at most 255 ASCII characters |
| `workspaceDirectory` | `jobs` | Restricted relative POSIX path below `ctx.dataDirectory` |
| `timeoutMs` | 30000 | 100–300000 ms |
| `maxLogBytes` | 4096 | 256–4096 combined returned stdout/stderr bytes |
| `maxArtifactBytes` | 1048576 | 1024–8388608 aggregate retained artifact bytes |
| `memoryMb` | 128 | 64–512 MiB; swap limit equals memory limit |
| `cpus` | 0.5 | 0.1–2 |
| `pidsLimit` | 32 | 16–64 |

All settings reload the plugin. At most four distinct execute calls are active; excess calls return `quota-exceeded` without a queue. Code is at most 16 KiB UTF-8, up to 16 text inputs total 24 KiB, and at most 16 outputs can be declared. Paths use nonempty ASCII segments starting with an alphanumeric character; traversal, absolute/hidden segments, backslashes and control characters are rejected. Existing ancestors must be real directories. The backend targets Linux with a Docker daemon that sees the service filesystem.

For artifact lookup, the host obtains the owner-scoped plugin data directory, computes `workspaceRoot = path.join(dataDirectory, config.workspaceDirectory ?? 'jobs')`, and resolves the returned `jobId/artifacts/<output>` location below that root. The authorized artifact service rechecks containment, real path and regular-file/no-symlink status before copying/opening and publishes its authenticated artifact ID. Client input cannot supply a host path.

Each UUID directory holds `code.mjs`, `work/` and retained `artifacts/`. Only `work/` and the read-only code file are mounted. Collection runs after stopping all container processes; it rejects symlink files/ancestors, hardlinks, nonregular files, escaped paths and aggregate output-size overflow. It opens sources with `O_NOFOLLOW`, verifies device/inode/size, exclusively creates retained files and fsyncs their content. Disposal and recovery do not delete job directories.

## Docker controls and remaining limits

The fixed invocation resolves a configured tag to an installed image ID, rejects anonymous image volumes and runs `node /job/code.mjs` without a shell or automatic image pull. No service-state, credentials, Docker socket or other host directory is mounted, and host environment variables are not forwarded. Containers use a nonroot UID, no network, a read-only root filesystem, dropped capabilities, no-new-privileges, bounded memory/CPU/PIDs/file descriptors, a per-file size limit, a 16 MiB noexec tmpfs and bounded Docker logging. Docker 27's local driver requires `compress=false` with `max-file=1`. Docker retains a rolling 32 KiB log window; returned logs are additionally capped to the configured combined byte budget, including UTF-8 replacement expansion. Truncation describes available Docker logs, not proof that all earlier bytes survived the rolling window.

Containers carry `pet.cloud-exec.owner` (plugin/instance/generation/random activation token), `.job` (job UUID), `.execution` (durable execution ID) and `.task` (TaskSupervisor task ID) labels. Every stop/kill/remove uses the verified full ID and exact expected mounts. Docker client waits are bounded; cleanup can extend beyond a requested execution deadline.

Aggregate writable-job disk quota and retention/garbage collection remain explicitly deferred. Per-file size, execution time, memory/CPU/PIDs, output artifacts and logs are bounded; many files and retained workspaces can still consume aggregate disk. Operator filesystem quotas/retention remain deployment work. Docker shares the host kernel; these tests do not establish VM-level isolation or hostile-kernel containment. Atomic receipt checkpoints do not establish replicated storage or universal power-loss durability.

## Verification evidence

The implementation touched only `plugins/cloud-exec/**` and this handoff. No dependencies were installed, no root/lockfile/runtime/contracts files were edited and no commit was made.

Environment: Node `v26.13.0`, Docker client/server `27.0.3`, Linux. The installed image was inspected without pulling: `1panel/deepseek-harness:0.2.0-rc.2`, ID `sha256:a9975a0df83b07f6ef3a57098174a8303cb0e322570e1d2f175ceba33f417a72`, anonymous image volumes `null`. The API has no image default; real tests require an explicit `PET_CLOUD_EXEC_IMAGE`.

Exact commands run from the repository root, using installed local binaries:

```sh
docker image inspect --format '{{.Id}} {{json .Config.Volumes}}' 1panel/deepseek-harness:0.2.0-rc.2
./node_modules/.bin/tsc --noEmit -p plugins/cloud-exec/tsconfig.json
./node_modules/.bin/eslint plugins/cloud-exec
./node_modules/.bin/prettier --check plugins/cloud-exec .trellis/tasks/11-07-text-agent-foundation/research/cloud-exec.md
node plugins/cloud-exec/build.mjs
node --import ./plugins/cloud-exec/tests/source-loader.mjs --test plugins/cloud-exec/tests/*.test.mjs
PET_CLOUD_EXEC_IMAGE=1panel/deepseek-harness:0.2.0-rc.2 PET_CLOUD_EXEC_DOCKER_TEST=1 node --import ./plugins/cloud-exec/tests/source-loader.mjs --test plugins/cloud-exec/tests/*.test.mjs
docker ps -a --filter name=pet-cloud-exec- --format '{{.ID}} {{.Names}} {{.Status}}'
```

Focused typecheck, ESLint, formatting and build pass. Ordinary tests pass 4/4 with 11 explicit Docker skips. The opt-in real suite passes 15/15, zero skips. It covers ordinary plugin execute/reconcile and fallback identity, security/resource/mount controls, real artifacts, targeted cancellation, timeout/nonzero/bounded text and binary logs, artifact attacks, awaited disposal, SIGKILL orphan recovery after the original deadline, full-ID checkpoint absence, completed-effect recovery after artifact publication, durable no-repeat receipts, execution-label/mount/symlink metadata refusal, missing-container uncertainty, post-removal result preservation, cursor re-delivery, and admission blocked until all nonterminal recovery pages complete. The final container list is empty.

The dependency-free source loader uses actual contracts error factories and SDK source. These are package/local real-container checks. Integrated service/client reconnect and product-state receipt ingestion, paid model behavior, live cloud rollout and full-workspace checks remain parent-owned acceptance evidence.
