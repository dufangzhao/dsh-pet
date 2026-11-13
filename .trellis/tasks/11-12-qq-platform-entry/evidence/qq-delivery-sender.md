# Frozen QQ delivery sender — controlled component gate

2026-11-13, Asia/Shanghai. Final focused run at10:52: **20/20 tests passed** (5.51s); owned-file ESLint, Prettier and scoped diff whitespace checks passed. Service typecheck previously passed at10:37; the final run reports only concurrent `qq-media-transfer` references to the not-yet-declared `findMaterial` State method. No delivery-owned diagnostic was reported. Parent owns that integration.

## Owned code

- [qq-delivery.ts](../../../../apps/companion-service/src/qq-delivery.ts): supervised terminal delivery, private transport contract, actual State claim/update, per-route/reference ordering, grant/connection cancellation and additive voice gate.
- [qq-delivery-plan.ts](../../../../apps/companion-service/src/qq-delivery-plan.ts): stable IDs, Unicode/CRLF-preserving inline splitting, full-origin union and required image/file/text attachment planning.
- [qq-delivery.test.ts](../../../../apps/companion-service/src/qq-delivery.test.ts): real Host/TaskSupervisor/State/material store with controlled transport and trusted audio-port fixtures.

No runtime, State, contracts, ingress, actual native adapter, source manifest or lockfile was changed by this slice. No real QQ/model/codec operation or original4120 data was used. Native adapter and real codec correctness are separate gates; the positive audio fixture tests sender ordering and reference/byte handling, not SILK encoding.

## Integration contract

`QQDeliveryController` receives host/runtime/materials/audio, current policy, a `sourceFor(account)` capture, optional explicit official-active permission and an error observer. `enqueue(event):void` is the production listener: it returns before upload/TTS; native work is owned by the existing TaskSupervisor. `onTerminal(event)` awaits the complete outcome for controlled callers/tests. `close()` cancels and joins pending native tasks and reporting work. The original `RuntimeInputGrant` comes from the private terminal event; no public origin-derived role or owner fallback exists.

`QQDeliverySource` captures account, exact connection ID, source signal/check and a private transport. `execute(request,signal,progress)` receives a required `expectedConnectionId` and a private `check()` callback for every native/range/chunk boundary. It returns actual dispatch/receipt/cleanup facts; the promise must join actual native/key work. Opaque uploaded handles never enter State/SSE. Actual correlation/transfer IDs may be attached as progress; they are not fabricated message IDs.

Parent's first claim atomically reserves the full passive batch and assigns final unique sequences across every batch sharing the native message/event reference. Sender uses `claim.delivery`, never a guessed per-batch sequence. The readonly remaining budget determines optional-voice unavailability before any native send. A zero remainder creates a truthful blocked plan. Ordinary and late work replies are not silently converted to wire-active mode.

## Behavior established

- All ordered formal message IDs and full origins survive into the frozen plan. Semantic text documents are read through the authorized material store; explanatory stubs are never substituted for the complete body.
- Text joins with the shared separator. At most two1024-unit inline parts preserve exact Unicode/CRLF boundaries; larger text becomes an explicit notice plus exact UTF-8 document under64KiB. Required attachments remain ordered parts; unsupported kinds fail explicitly.
- Empty/owner-private output is skipped. Failed input cleanup and unavailable sources do not send a complete batch. Preparation failure produces a scoped notice/error observation, not a fake delivery or a global Core stop.
- Every upload/send/compound operation is State-claimed once. Rejected/unknown work stops later parts; repeated terminal events do not resend known or uncertain batches. OneBot text/file compound operations retain staging transfer facts without inventing chat IDs or a second file send.
- Every mandatory text part must be conclusively accepted before voice preparation. Voice failure/disabled consent/insufficient allowance preserves accepted text and records incomplete voice. A passive-window deadline also cancels ongoing optional synthesis.
- A known native receipt remains on its original attempt even if authority subsequently fails. The failure stops later parts; it does not rewrite confirmed acceptance to unknown. Local cleanup uncertainty is retained and blocks a clean controller-close claim.
- A QQ policy commit snapshots pending tasks and synchronously starts every captured grant predicate before awaiting leases. A slow first lease cannot hide another actor's deny→restore. Voice-off is taken from the exact committed config and aborts only voice; unrelated probability changes do not cancel valid text.

## Executed focused commands

From `apps/companion-service`:

```bash
node node_modules/vitest/vitest.mjs run src/qq-delivery.test.ts --maxWorkers=1
node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node ../../node_modules/eslint/bin/eslint.js src/qq-delivery.ts src/qq-delivery-plan.ts src/qq-delivery.test.ts
node ../../node_modules/prettier/bin/prettier.cjs --check src/qq-delivery.ts src/qq-delivery-plan.ts src/qq-delivery.test.ts
```

Tests cover multisay/Unicode, exact long-document contents, actual compound transfer/echo facts, unknown-no-resend, half-success text with TTS count0, voice failure and success ordering, private upload handle containment, required/optional quota preflight, cross-batch passive sequence reservation, unavailable source/failed cleanup, expired ordinary output, duplicate terminal and nonblocking enqueue, downgrade cancellation with actual join, voice/probability controls, source reconnect without reselection, forged-text rejection by State, scoped preparation notice, late known receipt, passive voice expiry and parallel grant rechecks.

## Source hashes

| File | SHA-256 |
| --- | --- |
| Controller/transport contract | `b6e6677e5ccb2063ee25a809ba8b8bc74e6288bbfa386c31cc26e69bc58440fd` |
| Plan helper | `c196d1fa74c93972c881a1722958b4bf30eeac93eae8bf2f1571d33265c14865` |
| Focused tests | `4eec12cad099c969d37e0e3c5e0453062aaea8c249a6a10c973885709de2dcfb` |

Parent/c4 own actual transport composition, protocol upload/send implementation and complete end-to-end acceptance. No background job remains.
