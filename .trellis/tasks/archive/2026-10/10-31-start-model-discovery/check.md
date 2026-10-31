# Verification

Workspace gate passed. Native isolated Start flow passed seven query/test/save/late-result cases with actual IPC, task ownership, credential leases and pet permission choices; controlled provider responses only. Evidence lives in qa/start-model-settings/README.md; visual preview deletion verified through the existing six-scene browser check.

Native first-use exposed an implicit-assumption/test-fixture gap: the runtime previously issued credentials lazily while the new host query expected an existing session. Centralized that first-use operation in CredentialBroker.clientForHost and removed the duplicate runtime client map; host-first then runtime regression is covered. Do not reissue a client at the same generation.

The separate native fixture error was a cross-layer response-mode mismatch: selected Responses diagnostics are unary JSON, browser diagnostics are streamed. Corrected the fixture from actual wire mode; did not change transport to satisfy a fixture or add a product fallback. Extra source-loader diagnostics were removed after separating their QA-only loader failure from the business path. Canonical application spec records the owner and wire-mode contracts.
