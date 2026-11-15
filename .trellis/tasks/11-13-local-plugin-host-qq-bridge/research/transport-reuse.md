# Existing transport primitives and missing network authority

Planning evidence, 2026-11-13. No product code or runtime operation was changed. This note complements the local-host and remote-authority research; it does not declare a working distributed bridge.

## Confirmed source facts

- [ControlTransport](../../../../packages/host-kernel/src/ipc/control-endpoint.ts#L15) is an abstract send/message/close interface. [ControlEndpoint](../../../../packages/host-kernel/src/ipc/control-endpoint.ts#L57) already bounds pending operations, validates envelopes, captures owner/session, supports cancellation and closed handler tables. Its [actual Node transports](../../../../packages/host-kernel/src/ipc/node-control-transport.ts#L45) are parent/child IPC, not authenticated network connectors.
- [Control contracts](../../../../packages/contracts/src/control.ts#L29) bound JSON to64KiB and explicitly say schemas prove shape/budget, not owner/generation/permission. `runtime.invoke` and the generic handler dispatcher must not be exposed as a public remote host API.
- [MediaFrameDecoder](../../../../packages/host-kernel/src/ipc/media-framing.ts#L25) provides bounded incremental binary framing, with4KiB JSON headers and the shared maximum payload. [TaskMediaPeer](../../../../packages/host-kernel/src/tasks/media-peer.ts#L15) provides sequence/credits and exact stream/task/owner references. Its `signalFor` must return an actual current owned task signal; a network header is not permission to fabricate one.
- [Service HTTP authentication](../../../../apps/companion-service/src/server.ts#L183) currently checks the single operator bearer. Existing SSE sends scoped canonical events to an operator client. Neither is already a capability-bearing local-device source registration protocol or bidirectional native dispatch channel.
- [ADR0016](../../../../docs/adr/0016-cloud-service-and-pluggable-features.md#L19) selected one plugin model and canonical server State, with separate device availability and real receipts. A local daemon is a candidate/complementary execution environment; explicit lifetime after desktop exit was not selected there.

## Proposed narrow reuse

Reuse the existing transport-independent framing/credit/task/lifecycle machinery where its contracts fit. Add a dedicated authenticated host connection at the existing normalized Agent endpoint, with closed source/event/material/delivery methods and an explicit local-host/connection/source generation binding. Do not tunnel arbitrary HTTP URLs, kernel methods, shell commands or raw `runtime.invoke`.

A network transport's session/owner envelope must be derived from the authenticated captured bridge context. Local plugin owner identity and server task/grant identity remain separate; both ends map an authorized stream into their own actual tasks rather than accepting an `OwnerRef` from JSON as business authority.

Local native sources own platform credentials, CDN/remote-path references, live native peers and staged upload objects. Server policy/grants/State still own admission, visibility and once-only attempt claims. Temporary local handles can refer to those private native objects only when bound to the captured host/session/source/native connection, exact route/part/attempt/material hash and purpose. They are not another durable product ledger and never enter memory/State as platform grants.

The bridge may carry only verified canonical metadata, bounded bytes and public effect facts to the server. It must not forward the M6 host-private mapped attachment URLs, `file_info`, private staging paths, credentials or callbacks as JSON.

## Limits that the design must state honestly

A broken bridge does not prove native work stopped, and a server cannot guarantee instantaneous local revocation across a network partition. Preserve dispatched/unknown/accepted receipts and actual local cleanup independently. A fresh local source must not silently inherit an old native reference or retry a previously claimed side effect. Any finite authorization/heartbeat/cancellation contract must be explicit and tested rather than described as perfect remote cancellation.

Accepted cloud work is not the lifetime of the local device. Losing a QQ source affects new device ingress/egress and local-required effects; participant authorization changes remain a separate server grant event. Already verified server material/work can continue under its captured scope.

## Minimum future proof

Use actual two-process loopback transport with the real kernel/task/media primitives, not only DTO mocks: one registered local source, one canonical cloud input/claim, real bounded byte/hash transfer, one native publication, a dropped response after native acceptance, and source/permission replacement while an actual reader/operation is held. Prove no cross-owner stream, no automatic repeat, truthful cleanup uncertainty and unchanged continuing Agent identity. Neither real QQ nor paid inference is necessary for this proof.
