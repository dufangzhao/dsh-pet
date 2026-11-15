# Local plugin host and remote Agent bridge

## 1. Scope / Trigger

Read this when changing the independent daemon, its desktop controls, the authenticated QQ bridge, or portable package assembly. The server owns the one Agent, State, participant policy, model execution and media processing. The daemon owns platform drivers, native sockets and process-only platform credentials. A GUI management connection is not the lifetime owner of the daemon.

Use the existing [QQ admission/material/delivery specification](qq-platform-entry.md) for server authority and canonical State behavior. This document defines the extra process and transport boundaries; it does not replace that specification.

## 2. Signatures

The executable contract authorities are:

| Boundary | Authority |
| --- | --- |
| Closed bridge methods, runtime identity, original source and task references | [Bridge contracts](../../../packages/contracts/src/local-host.ts) |
| Source offers, projected QQ evidence, material selectors and host-selection CAS | [QQ bridge contracts](../../../packages/contracts/src/local-host-qq.ts) |
| Native console commands and exact guards | [Console contracts](../../../packages/contracts/src/local-host-console.ts) |
| Fixed Console-only preload facade and IPC names | [Desktop facade](../../../packages/contracts/src/desktop-local-host.ts) |
| OS identity shape | [Process identity](../../../packages/contracts/src/local-host-process.ts); shape validation does not prove process exit |
| Actual source lifecycle and task-bound native I/O | [Shared source core](../../../packages/local-host/src/qq-source.ts), [native operation scope](../../../packages/local-host/src/qq-native/qq-operation.ts) |
| Native provenance/death proof | [Owned-process helper](../../../packages/local-host/src/owned-process.ts) |
| Once-only local execution and original-attempt reconciliation | [Local execution owner](../../../packages/local-host/src/qq-execution.ts), [server delivery manager](../../../apps/companion-service/src/qq-remote-delivery.ts) |

`GET /api/local-host` returns the authenticated owner's bridge view. `POST` accepts only `LocalHostQQSelectionCommand` and returns the resulting view. The desktop's fixed TextClient functions return a newly constructed selection-receipt projection; unvalidated source metadata is not passed through that projection.

## 3. Contracts

- One selected host and one active authenticated bridge belong to the server Agent/epoch. Source offers freeze their original binding and process identity. Owner/task/role labels received over the wire do not create a kernel task, participant grant or permission lease.
- Each endpoint privately maps transport references to actual supervised task handles. A positive business check follows durable original-task binding. Every native business dispatch obtains a fresh server check; its local monotonic deadline is checked synchronously at dispatch after any local awaits. Do not cache permits or serialize local deadlines as authority.
- Input materials use closed event-part or scoped observed-file selectors. Local native URLs, response objects and platform credentials stay local. All required raw parts must reach verified server custody before codec/ASR; subsequent processing uses the original server actor. See the [media implementation](../../../apps/companion-service/src/qq-media-transfer.ts).
- A process identity is captured natively for the original daemon and once-bound with its first execution task in private State JSON. A new report cannot fill an old missing identity. Recovery obtains actual same-profile OS evidence through the native helper, checks an authenticated original-reference challenge, and invokes only the cleanup transaction. It preserves unknown effects and known receipts; it never executes or replays the old operation.
- The local rendezvous and HMAC management capability remain in the protected native profile. Renderer gets only a public identity/view. Credential setters internally use real management tasks and the explicit sensitive binary lane; control JSON, argv, inherited environment and change notifications do not carry credential values.
- GUI shutdown detaches management. Explicit stop waits for actual resource cleanup and records failure honestly. After successful cleanup, the stop response's physical write must settle before closing its transport or exiting. Suppress view-change hints while stopping, because views are no longer available and those hints compete for the terminal reply's write budget. A closed peer may finish the write join; settlement does not assert that the remote application consumed the response. Failed kernel cleanup still preserves failed state and discovery. Saved configuration, desired enablement and live platform connection are independent facts.
- The rendered interface must expose review, explicit trust and permission-preset controls for each managed source, including the Agent-link plugin. Trust and allow are separate owner actions. Refresh the source review after a successful change to obtain the actual new permission epoch, and discard reviews from an old host/boot. Native API tests alone do not establish that users can reach these controls.
- `linkCurrentAgent` uses the existing native personal-connection token lease and captured Agent identity. It projects `{hostId,bootId}` for exact target-only reads. An explicit link may select another host once using the captured server revision; a conflict is not retried with a fresh revision. Selecting the already-selected host needs no POST. A same-target local Config no-op must retain its original key CAS; a changed target must return its own commit receipt. Later failures do not erase known committed local facts.
- Windows helper code outside an embedded C# here-string uses PowerShell comments (`#`), never JavaScript/C# `//`. PowerShell can parse `//` as a command and fail only at execution; parser success and Linux package/hash checks do not prove initialization. Preserve native owner/DACL/reparse checks and do not repair the application-data anchor's ACL to compensate for a script failure.
- Portable assembly occurs in a verified copied workspace, with the original frozen lock and one physical installed copy of each shared package. Factories and SDK/kernel objects must resolve from the same installed layout that was reviewed. Preserve both PowerShell helpers beside their actual modules. Use a product executable name so Electron enters packaged mode; the fixed Linux worker launcher supplies only the application's own library directories while retaining the kernel's clean environment. Source-only archives, checkout symlinks and Linux binaries renamed as Windows are not runnable target artifacts.

## 4. Validation and Error Matrix

| Trigger | Required result |
| --- | --- |
| Wrong frame/role or renderer-selected process/socket/task authority | Reject before native I/O; exact Console methods only |
| Extra keys on a target-only read or malformed closed selector | `invalid-input`; project the intended target rather than widening the guard |
| Changed host boot, owner generation, key version or native connection | Reject the stale operation; do not borrow a newer binding |
| Stale Config/control/key revision or changed host selection | `conflict`; retain any actual earlier commit receipt, without retry/takeover |
| Disabled/untrusted source, expired participant grant or denied business check | Zero subsequent business dispatch; original known facts remain reportable |
| Missing authenticated host or unavailable remote source | Explicit unavailable result; no service-local fallback |
| Package root/digest changed | Fence the source; do not review one directory and run another bundled factory |
| Process still live, unverified profile/namespace, denied OS query or old missing stamp | No death proof and no recovery release |
| Wrong recovery challenge, original task, content hash or process identity | Reject; retain the exact old hold |
| Physical cleanup failed or is still pending | Preserve failed/unknown cleanup; logical cancellation is not confirmed termination |
| Windows helper fails to execute its own code or returns an unknown diagnostic | `internal`; fixed QQ startup-error copy, never assume that the user lacks authorization |
| Windows helper reports an allowlisted owner/DACL/reparse denial | `permission-denied`; preserve all native checks and do not echo raw exception text |

## 5. Good / Base / Bad Cases

**Good:** the GUI exits, the original daemon and platform connection remain alive, and a new GUI attaches to the same boot/key. With the Agent offline, the user can still stop that daemon locally and await actual cleanup.

**Base:** the server's selected host is disconnected. New remote deliveries are unavailable; completed canonical server materials remain reusable. Ordinary default service-local mode is selected explicitly and retains its legacy fingerprints.

**Bad:** a new daemon announces a new boot and the server treats that announcement as proof that the old operation stopped. Without the original once-captured OS identity and positive native resource evidence, the old attempt stays held.

## 6. Tests Required

- [Kernel/source tests](../../../packages/local-host/src/kernel.test.ts) and [source lifecycle tests](../../../packages/local-host/src/qq-source.test.ts): actual factories, exact trust digest, captured Config/key/source CAS and cancellation around real retirement.
- [Management network tests](../../../packages/local-host/src/management-network.test.ts): actual authenticated control plus sensitive bytes, disabled-source credential handling, invalid stream identities and GUI detach preserving committed credentials. The [stop-ordering regression](../../../packages/local-host/src/management.test.ts) must hold the physical response write and prove that it settles before the shutdown it triggers; a kernel cleanup failure must remain a failure.
- [Owned-process tests](../../../packages/local-host/src/owned-process.test.ts): real child capture/live/exit observations, exact private profile and namespace, rejected fabricated WeakMap proofs. Windows structure checks must not be described as Windows execution.
- [Windows private-directory tests](../../../packages/local-host/src/windows-private-directory.test.ts): reject executable `//` lines outside embedded C#, distinguish known ACL denial from script failure without echoing stderr, and run real directory/file initialization on Windows. The Windows-only case is explicitly skipped on other platforms.
- [Bridge integration](../../../apps/companion-service/src/qq-local-host.test.ts): actual local kernel/source to real server Core/State, original grants, same-event reconnect suppression, exact material bytes/native completion and scoped observed-file lookup. Register the exact terminal-event or observed-receipt wait before sending the native event, then read State once for the canonical assertion. A context-only observed receipt has no input ID, so match its event key. Repeated runtime State polling creates actual authorized task round trips and integrity checks; it can starve the work being tested. Do not compensate by caching trust or weakening authority. Failed or unrun cases remain pending in [G3 evidence](../../tasks/11-13-local-plugin-host-qq-bridge/evidence/g3-bridge.md).
- [Delivery integration](../../../apps/companion-service/src/qq-remote-delivery.test.mjs): original-task binding, known late facts, pending native reader lifetime, initialization/report ordering and actual old-process exit without replay. State's canonical tests must preserve all current non-cleanup facts during cleanup-only settlement.
- [Desktop controls](../../../apps/desktop/src/main/local-host-controller.test.ts): exact target projection, captured selection/key CAS, same-target no-op and known commit receipts after later failure.
- [Production GUI probe](../../../qa/probes/companion-local-host-desktop.mjs) and [layout resolution probe](../../../qa/fixtures/local-host/production-resolution.mjs): actual packaged Main/preload/daemon, independent module resolution and strict object equality, GUI physical exit/reattach/offline stop. Use the actual target runtime; Linux acceptance does not establish Windows acceptance.

Stage evidence belongs in the existing [task progress](../../tasks/11-13-local-plugin-host-qq-bridge/progress.md), not duplicated as acceptance claims here.

## 7. Wrong vs Correct

**Wrong:** pass the entire handoff command into an exact target-only console read, catch `invalid-input`, then loosen the guard. **Correct:** pass only the captured host and boot identity; keep the handoff's connection and CAS fields at their own boundary.

**Wrong:** infer remote termination from a failed RPC or a new boot, clear every sender hold, and resend. **Correct:** reconcile only the original immutable attempt with known facts or positive native cleanup evidence; new independent work may proceed only after that hold is actually settled.

**Wrong:** build GUI and daemon with inlined factory/SDK copies, or ship the development-named Electron runtime and assume packaged mode. **Correct:** verify the installed physical roots and runtime objects, use the product entry/executable names, and run the independently assembled artifact before declaring the package usable.
