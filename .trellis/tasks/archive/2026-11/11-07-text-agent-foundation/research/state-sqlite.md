# SQLite product-state provider

Implementation: `plugins/state-sqlite`, package `@pet/state-sqlite`, ordinary plugin `pet.state-sqlite`, capability `companion.state@1`, provider `sqlite`. The runtime entry is built to `dist/index.mjs`; the package exports the default PluginDefinition, `SqliteState`, `StateMethodInputs`, `StateMethodOutputs`, `StateSnapshot`, `StoredArtifact`, `UpdateTaskInput`, `AppendMessageInput`, `CommandLookup`, `RecordCommandInput`, method names and budget constants.

## Operation contract

Every capability returns a **payload** `Result<T>`. A successful capability transport therefore carries `Result<Result<T>>`; transport success alone does not establish persistence success. The typed Node class has the same synchronous methods and Result payloads, `invoke(method,input)` for untrusted JSON, and idempotent `close()`.

| Method | Input | Successful payload |
| --- | --- | --- |
| snapshot | `{messageLimit?:1..100,taskLimit?:1..100}`; defaults 50/20 | `{assistantId,epoch,cursor,hasMoreMessages,hasMoreTasks,taskDetailsTruncated,messages,tasks,facts}` |
| events | `{after,epoch,limit?:1..200}` | `CompanionEventPage` |
| acceptMessage | `CompanionMessageCommand` | `{receipt,message}` |
| createTask | `CompanionTaskCommand & {executionId?:string}` | `{receipt,task}` |
| updateTask | `{taskId,status,exitCode?,stdout?,stderr?,logsTruncated?,error?,artifacts?:StoredArtifact[]}` | `CompanionTask` |
| appendMessage | `{id,role,text,inputId?:string|null,taskId?:string|null}` | `CompanionMessage` |
| rememberFact | `CompanionFactCommand & {expectedRevision?:number}` | `{receipt,fact}` |
| getTask | `{id}` | `CompanionTask` with full bounded retained logs and all metadata |
| getArtifact | `{id}` | `StoredArtifact` |
| recover | `{limit?:1..200}` | `{taskIds,hasMore}` |
| recordCommand | `{commandId,kind,payload:JsonObject,taskId?:string|null,messageId?:string|null}` | `CompanionCommandReceipt` |
| getCommand | `{commandId,kind,payload:JsonObject}` | matching receipt with duplicate status, or null |

`StoredArtifact` extends browser-safe `CompanionArtifact` with `{provider,relativePath}`. Only this server-side lookup exposes location; snapshot/getTask omit those two fields. Paths use checked relative POSIX components; absolute paths, drives, backslashes, empty/dot/parent components and control characters are rejected. The host still authorizes each byte read and checks realpath containment in the selected execution provider's artifact root.

The host adds ConfigService-owned name/profile revision plus runtime/plugin views to produce `CompanionSnapshot`. There is no persona copy, configuration store, execution loop or scheduler in SQLite. The host supplies an absolute, stable **product-state** dataDirectory; the provider does not derive one from a view/Harness identity or import old Electron history. Accepted task requests are retained for provenance, never replayed by recovery.

## Transactions, identity and reconciliation

The version-1 schema stores identity/epoch, messages, tasks with execution IDs and requests, explicit facts, artifacts, command fingerprints/receipts and durable events. Every mutation, its command receipt and its event use one synchronous SQLite transaction. The encoded response budget is checked before commit; failures roll back the whole operation. No transaction awaits, accesses the network or executes user code. Events are only visible through committed query results; there is no second notification bus. The service can query/publish after the capability's payload Result confirms commit.

Command IDs are globally unique across message/task/fact/control intents. Fingerprints sort object keys, retain array order and include kind and the complete submitted payload. Same ID/same payload returns duplicate without another event/effect; changed payload returns conflict. Appended messages use caller-supplied stable message IDs and normalized nullable correlation. Duplicate acceptance returns the current canonical entity and the original identity, never recreates a task or message. Fact duplicates likewise return the current fact without advancing its revision.

Task completion requires actual `exitCode:0`. `cancel-requested` remains pending when a late running update arrives. Completed tasks preserve their terminal result against late stop/cancel/failure messages. A completed result with exit evidence can reconcile cancelled, failed, interrupted or unknown work; artifacts accumulate by immutable ID, and conflicting artifact identity/location rejects and rolls back the whole update. Logs are cumulative snapshots: a delayed shorter prefix cannot erase recorded output, and incompatible non-prefix output conflicts. Duplicate terminal results do not create another event. The host must report the provider's actual settled result, not TaskSupervisor's earlier logical cancellation as if it were physical exit.

`recover` is explicit and should run before new admission. Accepted records become interrupted; running/cancel-requested records become unknown because prior effects may have occurred. Completed/failed/cancelled records and artifacts remain intact. Iterate while hasMore is true. Recovery never resumes a process or reruns code, and subsequent running/accepted updates cannot reopen an uncertain recovered record. Later actual terminal evidence can resolve it.

## Lock and durability policy

Supported runtime baseline: Node **26.13.0**, built-in `node:sqlite` DatabaseSync; no ORM or native third-party driver. The database uses DELETE journal mode, `locking_mode=EXCLUSIVE`, `synchronous=FULL`, foreign keys and zero busy timeout. Opening acquires and commits an initial EXCLUSIVE transaction; SQLite retains its operating-system lock across commits until connection close. Another service/database writer is rejected even between requests. This also prevents external live read connections; use this provider's queries or stop the service before offline inspection. There is no PID file, stale lease timeout or manual lock-file deletion.

Plugin effect disposal closes the connection and releases the lock. OS process termination releases its lock; SQLite's journal handles interrupted commits on the next open. Schema version is checked in the initial transaction; unsupported versions fail instead of being silently reinterpreted. Keep the database on a filesystem supporting SQLite file locking, preserve the complete directory on a durable volume, and perform backups while stopped or with an explicitly designed backup procedure. This implementation does not establish distributed/network-filesystem writer coordination or transparent live-process migration.

## Bounded reads and records

The shared 64 KiB kernel JSON budget is unchanged. State payload Result is capped at 60 KiB, reserving transport-envelope space. The existing contracts JSON preflight checks unsafe properties, depth, key counts and encoded input size; concise guards reject unknown operation fields and invalid values.

- Snapshot metadata: hasMoreMessages and hasMoreTasks report omitted older records (whether limited by requested count or encoded bytes); taskDetailsTruncated reports shortened logs or omitted artifact entries in the included summaries. This is an explicitly bounded recent projection, not the full conversation archive. Retrieve individual task detail with getTask.
- Messages: up to the shared 8,000 UTF-16-unit text bound and 28 KiB encoded record size. Snapshot includes a newest contiguous suffix of whole messages that fits its remaining byte budget, ordered chronologically. It never turns a cut-off message into an apparently complete reply.
- Tasks: at most 100 selected recent records, with a 16 KiB snapshot task budget; summary logs are 256 encoded bytes each and at most four artifact metadata entries. `getTask` exposes all up to 16 retained artifacts and up to 12 KiB encoded stdout plus 12 KiB stderr. Truncated logs set logsTruncated. Events carry IDs/status/artifact IDs rather than repeated stdout.
- Facts: at most 32, values up to 2,048 UTF-16 units and 8 KiB aggregate encoded records. Optional expectedRevision checks the current revision (zero means absent). Quota/conflict failures leave facts, commands and events unchanged.
- Events: sequence cursor is the last scanned event, including when a byte budget ends the page; hasMore reflects a later committed event. An empty read at the current cursor preserves that cursor. Epoch mismatch or a cursor beyond committed history conflicts.
- Recovery: at most 200 records per transaction and bounded task IDs returned; repeat explicitly until drained.

## Verification status

Executed on 2026-11-07 with Node 26.13.0:

- **14 tests passed in two files** using installed Vitest 5.0.5. They cover message/task atomic dedup and changed payload conflicts; stable reply correlation; count- and byte-bounded event pages including empty-after; fact revision/count/byte quota rollback; completion/cancellation races and delayed logs; provider-relative artifact lookup and batch rollback; restart recovery; same-process and separate-process writer rejection; close/reopen; forced event-insert failure with no durable state, receipt or event publication; bounded snapshot flags and whole messages; manifest validation and plugin effect disposal/payload Result behavior.
- Conventional package typecheck passed with **zero diagnostics** after the parent established workspace links: `./node_modules/.bin/tsc --noEmit -p tsconfig.json` from the package directory.
- Conventional package tests also passed after linking: `./node_modules/.bin/vitest run` from the package directory, **14/14 tests**.
- ESLint and Prettier passed: `./node_modules/.bin/eslint plugins/state-sqlite` and `./node_modules/.bin/prettier --check plugins/state-sqlite` from the repository root.
- The standard `node build.mjs` package build passed after linking. An actual Node import of the built default PluginDefinition/named SqliteState exports plus a SQLite mutation passed.

No dependency installation was intentionally invoked by this worker. The first pnpm typecheck invocation unexpectedly auto-started install; that job was immediately cancelled before any reported download/addition. The parent later completed the workspace install. Before those links were available, temporary in-memory dependency mappings provided an initial passing check; the conventional checks above supersede that limitation. Service capability/SSE/artifact integration, the repository-wide quality gate and deployment filesystem validation remain parent integration checks. Tests use temporary isolated directories and real SQLite; no Docker, model dependency, paid API or production profile was used.
