# Shared desktop Agent entry

Status: implementation and scoped acceptance complete; ready for local commit and Trellis archival. The [model-backed text stage](../11-08-companion-model-text-loop/prd.md) is completed/archived with real host Magpie and Docker acceptance. This child implements the already selected independent-service ownership, not another host decision. GPT owns backend/integration; DeepSeek owns frontend.

## Goal

The existing desktop pet, desktop console and web text entry converse with the same continuing Agent and observe the same work. Closing or disconnecting the desktop leaves the service and accepted work running. Keep local presentation/audio mechanisms and preserve the existing desktop data.

## Requirements

- S1 One Main-owned, authenticated service connection supplies both desktop windows. The service owns Agent identity/persona, conversation/facts, tasks/artifacts and model settings; no local Core starts or silently takes over in this shared composition.
- S2 Owner explicitly supplies an endpoint and process-lived bearer token through the console. Keep endpoint in ordinary Config; never put the token in public state, renderer storage, URLs or logs. Pet receives the projection/actions, not credential management. No account discovery or old key import.
- S3 Pet and console can send text, show canonical replies/recent work, stop one task and save an authenticated artifact through the native chooser. Receipts, terminal outcomes, omission labels and uncertain retry retain their existing meaning.
- S4 One snapshot/SSE reader owns reconciliation. Offline shows last confirmed content/time and unknown nonterminal work; reconnect does not replay messages, speech or device effects. Switching/disabling/revoking retires the exact connection generation and drains local I/O without cancelling service work.
- S5 Preserve local appearance/theme/window movement/visibility and explicit audio/playback stop. Local preference writes must not mutate the active service persona, reload local Core or add a remote conversational interaction.
- S6 Remove shared-mode paths to legacy Core/model/OAuth/voice auto-restore and generic reenable/import/guide routes that could reintroduce a second authority. Keep old history/profile/vault files intact, with no automatic migration or fake remote equivalents for unsupported pause/history-clear/poke dialogs.
- S7 Keep current UI shells and components. Replace their data/action source and add concise connection/status/task controls; no full redesign, new plugin manager, arbitrary RPC or renderer network access. The client remains an ordinary removable source-owned plugin using existing kernel/SDK lifecycle and permissions.
- S8 Read the canonical service persona when needed through one bounded authenticated read-only profile projection; persona writes/semantic memory stay in the next child. Model settings use existing service contracts, without proxying its local-only Key write endpoint.

## Acceptance

- [x] D1 Actual pet and console plus web show one Agent ID, name/revision and service message/task/artifact IDs; sends are admitted once and cross-surface updates are visible.
- [x] D2 A real service task continues through desktop disconnect/quit and is recovered on reconnect; saved artifact bytes match service metadata.
- [x] D3 Bad token/protocol/DTO, lost stream, failed refresh and stale owner/target produce truthful states. Delayed operations cannot update a new target, silently overwrite a draft or save a retired artifact. Same-intent uncertainty cannot duplicate effects.
- [x] D4 Selected task stop leaves other work intact; foreground stop and local playback stop keep separate meanings. No disconnect-as-pause or local fake answer.
- [x] D5 Isolated-profile before/after checks preserve old history/vault/persona; shared startup and generic enable/restore paths cannot activate legacy Core. Supported local presentation and audio controls still work.
- [x] D6 Source/config/credential/connection generations and real network drain are verified through fixed Main/preload boundaries; no token/URL leakage, wildcard origins or relaxed kernel admission.
- [x] D7 Real Electron UI/bridge acceptance uses an actual declared platform and two real windows. Linux may verify the narrow shared client/text composition; Windows-specific native behavior is separately labeled and not claimed from Linux. Package/root gates pass; actual evidence/limits are recorded.

## Confirmed constraints / evidence

- [Source-backed research](../../../11-06-unified-companion-architecture/research/shared-desktop-entry.md) identifies current unconditional local controllers, mixed persona/presentation preferences, fixed preload/CSP, available service APIs and the minimal profile-read gap.
- This Linux host originally lacked an Electron binary/display server; private verified tooling was provisioned and actual native runs completed. Existing native QA targets Windows; hardcoded win32 platform or fake renderer bridges cannot establish Linux acceptance. Provisioning bounded local QA tools is implementation/verification work; do not reinterpret platform incompatibility as permission to load Windows-only plugins.
- Native platform support is scoped to the actual shared text/client composition. No broad Windows-feature port, new audio capture integration, Live2D overhaul, public deployment, multiuser pairing, legacy data migration or voice/platform automation belongs here.
- Original4120 service remains stopped at the user's request. Use isolated profiles and controlled model/HTTP fixtures for ordinary gates. Real model calls are not needed for this client integration by default.

## Completion evidence

The [stage QA summary](../../../../../qa/companion-desktop-acceptance.md) and [D1–D7 matrix](research/native-coverage.md) distinguish actual Linux native, real HTTP/file/kernel and renderer regression evidence. BUILD0 root gate passed; targeted BUILD1 sidebar rebuild/visual checks passed with identical Main/preload/worker/admission. Final independent Core4 and actual Docker/service18 passed with no skips and no real-model call. Windows-specific native/device behavior remains unverified, as allowed by this child’s explicit platform scope. Endpoint/token remain operator input; original4120/data stay preserved.
