# Service recovery regression probes

The focused suite is `qa/probes/companion-service-recovery.test.mjs`; supporting fixtures live only in `qa/fixtures/companion-service/`. It leaves the existing five-case HTTP/Docker service probe intact. All profiles use fresh retained `companion-recovery-*` temporary roots. No desktop data, model account, paid API, package installation, product source, root manifest, or lockfile is changed by these tests.

## Run contract

Run only while the parent has frozen the service/runtime/plugin source. The service deliberately fingerprints its actual packages; concurrent source edits invalidate a live host's authority and are not a valid test of recovery.

```sh
node --test --test-reporter=spec qa/probes/companion-service-recovery.test.mjs
PET_CLOUD_EXEC_IMAGE=1panel/deepseek-harness:0.2.0-rc.2 node --test --test-reporter=spec qa/probes/companion-service-recovery.test.mjs
```

The first command exercises six non-Docker regressions and explicitly skips the three real Docker cases. The second exercises all nine cases against the already configured local Docker image; it does not pull or install anything. The injected ResponseClient uses native Cortico 0.2.7 response and generation-attempt shapes from the existing Cortico gate and runs the real service-owned Core.

## Coverage and fences

| Scenario                                 | Required observation                                                                                                                                                                              | Actual boundary                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Task commit visible before create return | Query and stop the committed task before HTTP admission returns; cancellation survives release and duplicate commands                                                                             | `host.call(createTask)` returns from the real SQLite transaction, then waits on a deferred fence               |
| Running write delayed                    | Query and stop the accepted task while `running` persistence is pending; no external execute dispatch                                                                                             | Deferred fence before the real running-state call                                                              |
| Running write fails                      | The original accepted logical task becomes failed with the real persistence error; work drains and duplicate start preserves identity                                                             | One injected call failure before SQLite writes `running`; external execute boundary is counted                 |
| Stop write fails                         | Failed application does not permanently consume command identity; retrying the same ID persists requested stop and converges on cancellation                                                      | Failed first cancel-requested write while create return remains fenced                                         |
| Lifecycle command fails                  | Same command retries actual disable; unknown target is rejected on every retry and creates no command receipt                                                                                     | One rejected PluginManager disable through real HTTP and host lifecycle validation                             |
| Disposer rejects                         | Real Cordis cleanup leaves `pending_restart`; repeated harness replacement stays unavailable and never enables the alternate harness                                                              | Additional rejecting Cordis effect on a fresh activation of the actual registered Cortico definition           |
| Service SIGKILL; Docker later exits      | The same durable root/image reconciles the original execution and artifact, without replaying the append                                                                                          | Dedicated service subprocess process group; real owned Docker container and file-release fence                 |
| Service SIGKILL; Docker still running    | Recovery stops and removes the exact owned orphan, preserves its original effect/artifact and reports unknown honestly                                                                            | Real running container with append-once output and bounded release loop                                        |
| Input B during unresolved inference A    | B plus the actual start_work receipt enters the very next Core inference before onIdle-ready; B is answered while real Docker work is running; foreground reconstruction does not cancel the work | Native controlled ResponseClient, real Core, authorized HTTP, real service TaskSupervisor and Docker execution |

The three crash/reconciliation passes compare durable cursor, messages, task identity, artifact identity and execution metadata. Repeated reconciliation may not create additional business results or churn the event cursor. Both crash cases retry the original task command and verify there remains exactly one executor record.

## Ownership and cleanup

Every host closes in `finally`. Fences always release before shutdown; controlled model requests reject on cancellation so Core can drain. Subprocesses use a dedicated process group containing the exact spawned service and its Docker CLI children; SIGKILL targets that group and leaves Docker's independent container available for the recovery proof. Cleanup never sweeps Docker by a shared prefix. It reads this fresh profile's private `.records` metadata, verifies expected absolute workspace/code mounts and exact labels/full container ID through `inspectOwned`, then removes only that verified container. Temp roots, state, records, artifacts and per-process logs remain as evidence.

Watchdogs bound model requests, HTTP, state observation, service cleanup, process readiness/exit and the effect scripts. Short polling observes conditions; no long sleep establishes ordering.

## Execution evidence

The parent confirmed source stability on 2026-11-07. Syntax checks passed, and all owned files were explicitly formatted with Prettier's repository ignore file bypassed (QA and Trellis files are normally ignored).

- **Final configured-image rerun after the parent's state fix: 9 passed, 0 failed, 0 skipped**, exit 0, 15.60 seconds. Both real SIGKILL recovery paths, three repeated reconciliation passes per path, and the real HTTP/Core next-inference/live-Docker case pass.
- **Parent's focused SQLite evidence regression: 1 passed**, exit 0, 375 ms total; run with the existing `pnpm exec vitest run src/recovery.test.ts` binary from `plugins/state-sqlite`.
- Offline run before the fix: **6 passed, 3 explicit Docker skips**, exit 0, 3.48 seconds.
- Initial configured-image run before the fix: **8 passed, 1 failed**, exit 1, 14.99 seconds. That failure exposed the defect described below; the exited-container and real HTTP/Core cases already passed.
- All owned files pass explicit `eslint --no-ignore`, `prettier --check --ignore-path /dev/null`, and Node syntax checks. No model account/API, package installation or paid cloud service was needed. This worker changed only its new QA/fixture/research files, leaving product source, root files, lockfile and the existing service probe untouched.

Final retained evidence roots:

| Case                          | Durable profile                  | Resource verification                                                                                         |
| ----------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Exited Docker recovery        | `/tmp/companion-recovery-0CSxy1` | Original/restarted service PIDs `110848`/`111081` absent; one settled executor record; exact container absent |
| Running Docker recovery       | `/tmp/companion-recovery-u8ICjN` | Original/restarted service PIDs `111214`/`111379` absent; one settled executor record; exact container absent |
| HTTP/Core/live Docker input B | `/tmp/companion-recovery-Jcu8Ou` | In-process service closed; one settled executor record; exact container absent                                |

The suite verifies the same logical task/execution and original artifact across recovery, `once\n` effect content, duplicate task-command identity, stable artifact IDs, no duplicate messages/results and no event-cursor churn. Exact process/container absence was checked again after all tests finished. No source freeze is still needed: every test host has stopped.

### Resolved product defect: unknown recovery dropped verified artifact enrichment

The initial running-container crash case failed at the recovered logical task's artifact assertion. Historical evidence remains under `/tmp/companion-recovery-Jjuc4n`:

| Evidence                                          | Actual value                                                                                                          |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Logical task                                      | `c3af877e-96d6-41a8-8691-fe8a7fcdc3b8`                                                                                |
| Stable execution                                  | `exec-9b56d813147b2bfe020179f085026f58d93d6bbee4dabdb8`                                                               |
| Product SQLite state after recovery               | `unknown`, `exitCode: null`, `artifacts: []`, unavailable error; artifact table empty                                 |
| Private record                                    | `plugin-data/pet.cloud-exec/jobs/.records/dfe85157-6be4-4fc0-9d32-0fbbffe05a61.json`                                  |
| Executor's durable result for that same execution | `unknown`, `exitCode: 137`, `settled: true`, `error: null`, one verified `effect.txt` artifact (5 bytes)              |
| Actual retained output                            | `plugin-data/pet.cloud-exec/jobs/dfe85157-6be4-4fc0-9d32-0fbbffe05a61/artifacts/effect.txt` contains exactly `once\n` |
| Resource cleanup                                  | Exact container `pet-cloud-exec-dfe85157-6be4-4fc0-9d32-0fbbffe05a61` is absent                                       |

`SqliteState.#recover` first marks the previously running task `unknown`. `CompanionRuntime.reconcileExecution` found that task by its correct execution ID and tried to persist the executor's verified result. The old guard in `SqliteState.#updateTask` (line 442 in the failing source) returned early for current `unknown` plus next `unknown`, before applying artifacts, exit code and error. This lost product access to already retained evidence even though the executor correctly settled/removed the orphan. The failure was reported promptly to the parent; this worker did not patch product files.

The parent changed the transition guard to permit same-status evidence updates for `unknown`/`interrupted` while still blocking regressions to nonterminal states, and added the focused SQLite recovery regression. The full nine-case rerun and that focused test both pass. Repeating reconciliation leaves durable cursor, messages, task and artifacts unchanged, so the product-state owner now preserves and deduplicates verified recovery evidence.

## Additional lifecycle regressions

The parent requested four focused scenarios after startup/configuration/state-recovery changes. They are implemented separately in `qa/probes/companion-service-lifecycle.test.mjs` and reuse the existing isolated HTTP fixture:

| Scenario                                | Observable proof                                                                                                                                                                                                                                                                                                           |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stored text/harness withdrawal          | On restart, the real definitions are never activated before publication; the first public UI read returns 404; explicit restore re-enables the text view and Cortico with the same Agent ID                                                                                                                                |
| Image and unchanged configuration       | An explicit configuration-only image survives omission and identical explicit options across restarts; execution/profile data and revisions remain equal; a stored cloud withdrawal wins over the saved image and prevents activation                                                                                      |
| State disabled across restart           | Authorized GET `/api/plugins` remains available while snapshots return 503; reusing the disable command ID to enable returns conflict and closes the temporary writer; an independent real SQLite instance acquires the same exclusive lock; valid API restoration preserves Agent ID and facts while text stays withdrawn |
| Fixture admission and return to Cortico | A deferred fence holds the actual fixture publication; switching while input is pending returns conflict; the committed attributed answer drains to ready; retrying that same switch command ID returns to Cortico without replaying messages or losing facts                                                              |

```sh
node --test --test-reporter=spec qa/probes/companion-service-lifecycle.test.mjs
```

The image reference `qa.invalid/companion-config-only:probe` is deliberately a configuration fixture. These four tests submit no execution code, create no Docker jobs, perform no image pull, and establish no Docker/backend availability claim. The separate nine-case suite above owns actual Docker proof. Activation observers delegate unchanged to the real definitions and do not edit source bytes or fingerprints. All startup/shutdown paths retain the isolated evidence root and use watchdogs/finally cleanup.

After the parent confirmed stable source and client artifacts, the lifecycle suite passed **4/4, zero failures/skips**, exit 0, 3.715 seconds. No build command was run. Every service was closed in `finally`, and the test process exited normally. Static Node syntax, explicit ESLint and Prettier checks also pass.

| Passing case                                                | Retained isolated profile        |
| ----------------------------------------------------------- | -------------------------------- |
| Stored text/harness withdrawal before activation            | `/tmp/companion-recovery-PyMtkM` |
| Image persistence and stable revisions                      | `/tmp/companion-recovery-kdg0oS` |
| State recovery, conflict rollback and stable Agent identity | `/tmp/companion-recovery-5LsspH` |
| Fixture drain to ready and return to Cortico                | `/tmp/companion-recovery-3ElKzK` |

No additional product defect was found. The new test file is picked up by the existing QA test glob, requiring no root script or lockfile change. This follow-up changed only the additional lifecycle probe and this research record; the earlier nine-case probe and fixture helpers remain intact.
