# G0 two-process bridge/native feasibility

Executed2026-11-14 after the final immediate-HELLO source fix/freeze. **Probe exit0; feasibility assertions passed. G0's full production integration is not closed.** The source and QA hashes listed below were equal before and after the final run.

Entry: [companion-local-host-bridge.mjs](../../../../qa/probes/companion-local-host-bridge.mjs). Dedicated fixtures: [server](../../../../qa/fixtures/local-host/bridge-server.mjs), [local](../../../../qa/fixtures/local-host/bridge-local.mjs), [controlled native peer](../../../../qa/fixtures/local-host/bridge-native.mjs), [shared fixture utilities](../../../../qa/fixtures/local-host/bridge-common.mjs).

## Actual composition and authority

Two Node processes ran: server PID2828605 and local PID2828618, local boot `e8bbbef8-3266-40a1-8fb3-415ca4588f81`. The server used real CompanionPluginHost/permission tasks, the real State3 plugin and HostMaterialStore. The local process used production `createLocalPluginKernel`, explicit exact source review, both real QQ factories, existing authorized native I/O and real credential/source leases. Its only plugin owners were `pet.qq-official/default/2` and `pet.qq-onebot/default/2`; its root contained configuration/plugin-data, no local Core or State database.

`createAgentBridgeServer`/`connectAgentBridge`, ControlEndpoint and TaskMediaPeer carried the actual authenticated loopback control and credited bytes. Every `signalFor` lookup used a private mapping to a real live TaskHandle/lease; an unknown task reference was refused. The canonical `checkRemoteAuthority` helper performed fresh RPC checks, while the server handler checked the actual existing State claim, immutable part/route/hash, captured local source metadata and the original server task. Wire owner/task labels did not allocate authority. Process IPC carried startup/stop/reconnect coordination only, not delivery bodies, material bytes, native private upload refs or an alternate business path.

The input/message plans were **explicit QA operator-managed State seeds**. They are not proof of native QQ ingress, participant grant issuance or Core interaction. Local outcome/continuation records were bounded holders for actual operation results, not a local State writer or command outbox. The actual native peers were controlled localhost HTTP/WS endpoints, not real QQ accounts.

## Passed observations

| Observation | Actual evidence |
| --- | --- |
| Both local protocols active | Official token/gateway HTTP and immediate HELLO/Identify/READY WS; authenticated OneBot reverse-Universal connection under the second real factory |
| Claim precedes publication | The controlled native HTTP peer queried real State when each of7 business requests arrived and found the matching claimed attempt |
| Lost bridge reply after native acceptance | Platform request accepted once as `native-message-1`; local outcome retained before the bridge response was deliberately lost |
| Same-boot fact-only inspection | A new bridge session inspected the original binding/task/attempt; it returned accepted/settled with actual native ID, `workPending:false`, `cleanupFailed:false`; old native effect count stayed1 |
| No replay from an old attempt | Exact duplicate State claim returned `claimed:false`; forced repeat execute was rejected without another native publication |
| Honest State3 boundary | State remained terminal/unknown. Attempting late accepted-fact enrichment produced the expected real `conflict`, explicitly leaving G1 unpassed |
| New independent claim | A distinct operator-seeded claim published after same-boot reconnect; this proves primitive/native feasibility, not the production QQDeliveryController hold fix |
| Two-stage image | A98394-byte valid PNG crossed TaskMediaPeer, real official inline upload and a separately claimed native send; actual `native-file-1` and `native-message-4` |
| Exact byte identity | Uploaded PNG bytes equalled the original and SHA-256 `e49f4fc51abe5a0251c36b45f7e272aa2c6df91b0ca4a6fc4d68cfa8e305c193` |
| Private continuation | Native `file_info` stayed in the local operation/native peer; the bridge carried only its opaque continuation and public facts. Reconnection could not redeem an old-session continuation |
| No header-created stream authority | A fabricated task/stream reference was rejected before stream creation |
| No private-reference projection | Both bridge JSON directions were scanned for private file-info/QQ-secret canaries;0 matches |

Final controlled totals: **5 publications,2 uploads,7 State-claim observations at actual native I/O,56 fresh checks**. The feasibility fixture connects the existing adapter's repeated `check` boundaries to the fresh helper;56 is a measured count, not a claim about final G5 authorization placement/performance. No authorization cache was added.

## Cleanup

Local pendingWork0 and permission leases0; all seven retained operation handles were physically settled. Local process exited code0/signal null. Server bridge/native sockets, State and owned tasks were closed; the final temporary root `/tmp/pet-bridge-g0-PsecCV` was resolved, its actual parent/prefix verified, and removed only after join. No background job remains.

One earlier failed readiness run retains `/tmp/pet-bridge-g0-yZ7ACU` for diagnostics because its initial process-control cleanup acknowledgement timed out. That exact spawned child was terminated and its exit awaited; no process is being identified by a prefix now. The retained directory was inspected without deletion: realpath equals that path, uid/gid1000/1000, device64514, inode323631, directory=true, symlink=false. Later fixture cleanup races exit against a pending control reply and joins correctly. Other completed run roots were removed after cleanup.

## Production dependency / still-open gates

- **G1:** State4 private durable execution binding, local-task bind-once persistence, same-attempt monotonic enrichment and cold migration are absent. The State3 conflict above must not be reported as an enrichment pass.
- **G3:** No production remote QQ source/participant facade is wired. Operator seeds do not establish native ingress→private grant→Core behavior.
- **G4:** Production raw-staging custody and original actor lifetime switching before codec/ASR are not yet available. This outbound verified-byte exercise is not that custody/revocation gate.
- **G5:** No production RemoteQQDeliveryTransport/full sender integration is installed. The controller-wide cleanup latch/remote hold-release behavior, actual delayed native cleanup and corresponding new-input recovery remain to be proved through that production path. The lost-reply case here drops the bridge response after actual local native settlement; it is not a held-unsettled-native cancellation proof.

These limits follow the Parent-approved G0 QA seam. No RuntimeInputGrant/terminal was fabricated, no false material-ready flag was used, and no production/State/controller/lockfile was changed by this QA work.

## Regression exposed during composition

The first immediate-HELLO runs exposed a real official gateway race: the old I/O awaited WebSocket open before installing its owned frame reader, allowing the first HELLO to be lost. Parent/a76 fixed the production seam and removed the existing fixed20ms test delay. This probe retained immediate HELLO throughout. Subsequent runs with the frozen fix reached both real source-ready states; no sleep/retry was introduced. Fixture-only corrections included root package import resolution, explicit State capability binding, proper provider KernelFault unwrapping and the actual native request `attemptId`.

## Reproduce / static checks

From the workspace root:

```bash
node qa/probes/companion-local-host-bridge.mjs
node node_modules/eslint/bin/eslint.js --no-ignore qa/fixtures/local-host/bridge-*.mjs qa/probes/companion-local-host-bridge.mjs
node node_modules/prettier/bin/prettier.cjs --ignore-path /dev/null --check qa/fixtures/local-host/bridge-*.mjs qa/probes/companion-local-host-bridge.mjs
```

The owned QA files also passed Node syntax and scoped whitespace checks. The final run compared hashes before and after the live probe; equality and the probe both exited0. No root dependency/lock edit, source build, live gateway, paid model, Docker work, old4120 data, SnowLuma/AstrBot operation or commit was performed.

| Frozen file | SHA-256 |
| --- | --- |
| Official I/O | `6e91e17729086c299cef2b230a90dd8d2d3cfa2766fa613283df2037fd1364ca` |
| Local kernel | `96d301b465ead117405ed09dd800cc992e27fe11df54fee00178b8f23b700336` |
| Bridge handshake | `4f8fd4d237d950a6759423e5b9682b2f52403bab1db8432358509e1fbf84648e` |
| Bridge channel | `3e95004067f60bbbba8b45a05723d31a9bababcb6eecd7f700258a616df897ab` |
| Authority helper | `a696e9944b7290bb42d6b99461cd0654d0e4b42ed33e70f2896c36eb737ac485` |
| QA common | `4bb952a986e7100386cff8cdd9d88aaf4638bd338ba98e1cfe15a69a05d5ae25` |
| QA local | `f4a30202a0e3902e8024536b7d3e446c36a0b3b92b9d2c1a54e2a79907f177cd` |
| QA native | `d4cbd45a32928e75c3f7d00b499cd80dde9259e91eb9ca34426b517e18ee584b` |
| QA server | `f4f2239c39299f13f26bb71fe1e92f9d10e53c8a85d3c63d260b912129a95814` |
| QA probe | `4800a4e0a1cf3eb234efdbbbc259ad9c55c96cb83d9616b3b83595b5c12d8923` |
