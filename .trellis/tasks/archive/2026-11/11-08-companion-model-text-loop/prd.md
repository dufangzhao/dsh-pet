# Useful model-backed text companion

Status: implementation and acceptance complete, including the owner's actual host Magpie/model useful-task scenario. Final integration and phase bookkeeping are recorded in the QA summary and progress; the task is ready for archival. The user authorized ordered implementation and Trellis records for each stage on2026-11-08. This stage follows the completed [text foundation](../11-07-text-agent-foundation/prd.md); it does not reopen independent ownership or text-first decisions.

## Goal

Let the owner configure and verify a real model connection, then use the continuing Agent to complete a bounded useful text/file task while retaining conversation, explicit preferences, independent work and truthful failure/stop state.

## Confirmed scope and facts

- The host service at http://10.1.0.7:4120 has been restored using the same private launch configuration/token and durable profile. Its four existing messages, completed task and original file survived the host reboot and were verified.
- The first foundation has native Responses transport, source-owned credential borrowing, real Cortico and Docker, authenticated HTTP/SSE, a private web text client and stable product state. Real provider configuration is currently CLI/options-only and the visible service is scripted.
- The user approved progression: model-backed text use, shared desktop/web Agent, controllable persona/memory, then voice and individual platform adapters. GPT owns backend/integration; DeepSeek owns frontend/design.
- Existing desktop data and this host-trial profile must remain intact. Development must not edit fingerprinted sources beneath a live host; use a retained committed runtime checkout for the public trial and separate profiles for development/tests.

## Requirements

- M1: Magpie is the default builtin model-connection plugin. The owner can identify its configured model and the result of an explicit connection check without treating a saved key or provider presence as a successful call. Its configuration belongs to the connection plugin, not the Cortico Harness.
- M2: A real authorized model connection completes conversation plus one bounded file/code task; short chat can proceed during independent work and only the selected task is stopped.
- M3: Model/provider change is a controlled safe-boundary operation. Preserve identity, facts, logical work, correlation and receipts. Model failures do not silently become scripted replies.
- M4: Model secrets are accepted through an explicit operator path, never exposed in browser reads, URLs, logs, state projections, artifacts or git. Do not silently reuse DSH credentials or introduce plaintext fallback credential storage.
- M5: Users can replace Magpie by supplying another model-connection plugin implementing the same narrow contract. Keep the existing ordinary plugin model and native structured transport/source semantics; do not add a second task runner, gateway implementation or generic configuration framework.
- M6: Provide one reproducible practical acceptance scenario using owner-supplied text or generated files; preserve existing offline/unit/Docker gates and label synthetic checks separately from live-provider results.
- M7: Keep trial runtime and development code isolated, preserve the selected profile and record each stage in Trellis. The user previewed the restored service and explicitly asked to stop it; it is now stopped, with data/token and stable runtime retained. The current task is separate from later shared-entry, memory and voice/platform work.

## Acceptance

- [x] A1 Owner can distinguish unconfigured, configured, validating, verified and failed model states through actual outcomes; secrets never appear in reads.
- [x] A2 Actual host Magpie0.1.3225 / codex/gpt-6.1-sol completed preference/chat and a real Docker file task with receipts, exit0,52/34-byte downloads and total25; B was answered while the task still ran. See [live evidence](../../../../../qa/companion-live-magpie-result.json).
- [x] A3 New input during work remains responsive at the existing step boundary; stop/reconnect/model replacement retain authoritative task outcomes and data.
- [x] A4 Wrong key, unsupported endpoint/model, transport hang and revoked source produce truthful fixed errors, not fake readiness or hidden fallback.
- [x] A5 Server restarts retain nonsecret configuration and canonical identity/facts/results; credential availability and required operator setup remain explicit.
- [x] A6 Browser and cross-layer tests plus final patched-dependency full quality gate pass. Live A2, controlled protocol checks and browser evidence remain separately recorded with their actual bounds.

## Outside this stage

Full multi-provider routing/billing, marketplace, full task board, bulk filesystem/browser automation, semantic memory, old history migration, voice/duplex, QQ/Bilibili accounts and public posts. Existing Desktop/DSH entry integration belongs to the following child stage.

## Connection decision and remaining external input

The user selected Magpie as the builtin default on2026-11-08, with user-authored connection plugins able to replace it. This selects the application adapter boundary; Magpie's separate Go gateway process is not copied into the core. The first implementation connects to an explicitly configured Magpie endpoint. Bundling/managing an additional gateway process is not required for this stage.

The owner subsequently identified the actual host gateway at127.0.0.1:3425 and asked us to inspect it. Its public local client identity was used without copying DSH credentials. A bounded short diagnostic and a separately bounded8-generation/180-second useful-task acceptance passed after the documented Magpie stream compatibility repair. The main live scenario took39.038s; a second optional live cancellation task was skipped within that budget, retaining the separate existing Docker/controlled-service evidence. No account configuration or gateway process was changed.
