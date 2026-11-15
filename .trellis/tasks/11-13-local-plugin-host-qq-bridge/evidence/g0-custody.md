# G0 server raw-input custody primitive

Scope: the approved G0 raw staging primitive in the existing service material store. This report does not establish the G4 whole-input transfer/codec/ASR handoff, proactive candidate authorization, a two-process media integration, or any live QQ/account/paid-model behavior.

## Implementation and ownership

The existing `HostMaterialStore` owns raw and canonical bytes. Raw staging reuses its exclusive file creation, SHA-256/write path, captured directory/inode checks, NOFOLLOW verified read, host file permission tasks and budget. It adds no State writer, alternate material store, content cache or public ready reference.

Private API:

```ts
store.stageRawInput(
  { expectedSizeBytes: number | null, expectedSha256: string | null },
  source: RawInputSource,
  originalServerActor: RuntimeInputAccess,
): Promise<RawInputCustody>

store.withRawInput(custody, async (info, chunks, serverSignal) => { /* consume entirely */ })
store.releaseRawInput(custody): Promise<void>
```

`RawInputSource` contains a private `body` iterator, native-success/actual-reader-join `settled` promise, local `signal`, `check()` and cleanup-only `cancel()`. These are live host objects, not fields accepted from control JSON. Expected size/hash are assertions checked against measured bytes, not proof of custody. The minted handle is checked by object identity inside the same store and cannot be serialized as a grant. It has no duration, MIME, ready boolean, role, path or storage key. It never calls `State.putMaterial`.

The handle captures the original private server actor's scope/check/signal. Later reads cannot substitute another actor and never consult the old local source. Host file authorization still applies. Releasing a handle fences/joins actual consumers and cleans only its recorded inode; it remains cleanup-only after participant withdrawal. Closing the store joins real readers/writers and releases its raw files without deleting existing canonical materials or unrelated files.

## Producer completion contract and custody cut

1. Server composition derives the original actor/candidate access privately and keeps its server-task lifetime independent of the local socket. Origin/role metadata does not construct this access.
2. A caller retains cleanup responsibility for sources rejected before a staging slot is admitted. An admitted staging call owns cancellation/join, including refusal by the host file permission boundary.
3. The producer must yield the actual bounded native bytes. Its successful iterator EOF plus fulfilled `settled` must mean successful native completion and actual native reader join. A cleanup-only cancellation promise must not be supplied as successful `settled`; cancelled or failed native reads reject it, even if an adapter returned `done`.
4. The store measures every byte, enforces the file/staging limits, computes SHA-256, observes EOF and awaits that successful native join. Source checks apply during acquisition. After positive EOF/native join it does not call source postflight checks or retain that source in the handle.
5. The server then syncs/verifies the owned file, commits it exclusively in its existing staging directory and rechecks the original server actor. Only that positive commit mints custody. A later source-only postflight failure cannot roll back the committed handle. Actor/task withdrawal still stops processing.
6. G4 must stage **all required raw parts** and retain their positive handles before declaring the whole input independent of the local source. A single part's handle does not prove a complete input. G4 separately owns actual codec/ASR/ready-material publication and the private proactive-candidate seam.

The same existing128MiB reservation covers retained raw files and owned verification/consumer buffers until actual release, with two active preparations. Raw handle slots are bounded by the existing four-part limit times two preparations (eight); empty inputs cannot create an unbounded handle registry. The primitive does not add a per-input aggregate grant or infer the four-part whole-input cut itself.

## Executed controlled evidence

Executed2026-11-14 (Asia/Shanghai) using direct Node entries, fresh isolated temporary roots, real `SqliteState`, actual `CompanionPluginHost`/TaskSupervisor/file-permission machinery and real cancellable local `ReadStream` file descriptors. The two-part control additionally holds an actual server task; later file consumers retain its original actor/task signal rather than the local read signals.

| Control | Observed result |
| --- | --- |
| Legacy canonical store behavior | All16 original image/full-text/State/ACL/path/hash/cancellation/budget cases passed after shared write/read extraction |
| Two raw parts, then local disconnect | Both exclusive raw files/hash proofs committed first; both local sources aborted; both original-server-actor consumers read exact original bytes with no further source checks |
| Successful native join, source-only postflight/cancel refusal | The real file reader had completed and joined before source availability was withdrawn; custody still committed/read correctly, despite a controlled source-only cancellation exception |
| Actor withdrawal at the same native-join boundary | Original actor predicate rejected without requiring its signal to abort; no custody or raw/canonical object remained |
| Disconnect before full bytes | No custody; source cancellation did not resolve the held reader callback as settled; store close waited for the actual gate and all host work/leases drained |
| Adapter turns cancellation into `done` | Actual native `finished(reader)` rejected; iterator `done` alone did not mint custody, even with nullable expected size/hash |
| Wrong expected hash / wrong expected length | Both rejected before custody with owned staging cleanup |
| Original actor revoked during processing | Consumer stopped; release fenced and waited for the held actual consumer; cleanup still worked after actor withdrawal |
| Forged/serialized custody / raw disk tamper | Serialization refused, copied object identity was rejected, and modified file bytes were rejected before the consumer callback |
| Host file grant denial | The supplied native reader was cancelled and actually joined, with no staging file or leftover supervisor work |
| Bounded retained handles / close | Eight live empty raw parts were accepted, the ninth rejected, release made a slot reusable, and close deleted only its raw inodes while preserving an unrelated staging canary |

The two raw vectors were14 and7 bytes, deliberately opaque rather than valid decoded voice:

| Vector | SHA-256 |
| --- | --- |
| Encoded-looking opaque bytes | `39a8e0b8fccf4ab8f7324eca442b43885f1fe3ee3a8c9abbacb8e06f2e7ab4d4` |
| Non-UTF8 binary | `36e9a3a92bd4d219e310dfa2e250ebdff4c1656fd7069fb6444fd4d9970a9413` |

Neither vector became a ready `MaterialRef`; the raw operations made zero State-port calls. No duration, image/audio validity or transcript is claimed for these vectors.

Validation receipts:

- Final full material-store file:27/27 passed (16 legacy plus11 custody controls),3.42s at07:38. This includes the strengthened source-only-postflight control with the explicit cancellation exception; the earlier focused1/1 is not an additional case.
- Exact command: `node apps/companion-service/node_modules/vitest/vitest.mjs run src/material-store.test.ts --root apps/companion-service`.
- Service TypeScript and scoped ESLint/Prettier passed at07:32 after postflight strengthening. The final07:38 full-service type recheck was blocked solely by the concurrently edited State dispatch missing `getDeliveryExecution`, `bindDeliveryTask` and `enrichDeliveryAttempt` ([State dispatch](../../../../plugins/state-sqlite/src/state.ts#L357)); this slice did not edit that owner’s files. Final scoped ESLint, Prettier and diff whitespace independently passed after the final full27-case run, rather than being hidden behind the unrelated type failure.

## Limits and remaining integration

These are primitive-level controls. The local producer is a real controlled file reader, not an authenticated remote QQ-native reader. G4 still owns all-required-part orchestration, bridge/native successful-read evidence mapping, direct/proactive candidate capture, actual codec/ASR, ready input/material publication and the disconnect cut across the complete pipeline. There is no local Core/State or alternate grant minting here. Live-process opaque custody is not restart reconstruction: this primitive does not replay inputs, recreate handles from disk, or delete unidentified crash leftovers.

The Parent-owned dependency repair completed before the new gates ran. This slice did not install dependencies, change pnpm configuration/locks, run another runtime/server, modify original4120, operate real QQ/SnowLuma/AstrBot, call a paid model or commit code. Root Vitest absence was not used as evidence of deletion; each scoped command used the package-declared runner.
