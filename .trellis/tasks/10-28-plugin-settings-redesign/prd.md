# Pet-first desktop settings and Cortico integration

## Goal

Make the desktop pet the primary path for everyday conversation, interaction and application guidance. Settings exposes five pluggable views of the same pet and data: Start, Persona (人设), Appearance, Conversation history, and Voice Input. Reuse Cortico for the agent framework and focus custom implementation on the Electron desktop product.

## Confirmed background and constraints

The user clarified that Conversation is the record of everyday life with the pet, including genuine touches/reactions, not an independent chat. Habits is renamed Persona and includes the complete prompt. Initialization/configuration/update interaction should be completed through actionable pet bubbles wherever practical; Settings is a same-state viewing/editing supplement.

The user requested Trellis, frontend-design, DeepSeek max frontend implementation and main-session backend implementation. Preserve original branding/assets and the existing source/permission/credential/native boundaries. Cortico0.2.7 at cb9ddbd685bcccba1f29905098648f46a79b3862 has MIT LICENSE and package metadata; the reference is local Coopanion0.2.10, not an inspection of the installed0.2.13 app. Do not copy Coopanion product code or assets. Research is source-only until runtime acceptance is performed.

Existing b9a803e provides real capture/ASR, cancellation, revisioned configuration, credentials, history and an original pet. Use .trellis/spec/shared/project-baseline.md for that baseline. The pinned research/cortico-reuse.md replaces the earlier standalone page-DSL and custom agent-loop proposal.

## Requirements

- R1 — Everyday UI: fixed clear sidebar/content hierarchy with five main views and quiet Extensions/About recovery. Expose useful choices/status only; no schema editor, IDs, leases, hashes, runtime switches or debug inventories in normal use.
- R2 — Start: actual supported provider/model/key configuration, honest readiness/last-request state, pet palette/preview and guide replay. No second chat or development checklist.
- R3 — Persona/Appearance: names/address/reply language/style, the complete editable persona prompt and complete effective-prefix preview; at least two original rendered shapes/four character palettes, and supported interaction settings. Values must reach actual consumers. Text drafts survive conflicts/errors; saved/pending/applied prompt state is truthful.
- R4 — Unified everyday record: text/voice, actual poke/pat/completed drag/blush, presented pet speech/questions, guide choices, settings results and update notices appear in one ordered history. The Settings Conversation view is a projection over the same pet identity/session/events; an optional input continues that same channel. No invented reactions or second message database.
- R5 — Pluggable views: reuse Cortico public page/panel/config contracts with the existing owned source/lifecycle boundary. An external fixture can add usable config/action content without shell navigation edits. Disable/fault/remove withdraws the correct view; recovery remains reachable and configuration survives.
- R6 — Model tools: reuse Cortico tool dispatch for useful desktop/configuration operations under exact owner/task/target/action authority, through the same committed state used by human bubbles/settings. No raw host privileges, secret/ciphertext disclosure, self-approval or unreviewed code installation.
- R7 — Data/application correctness: preserve old ASR/provider/config/key/history data during migration. One configuration authority, one agent/event history authority, no permanent dual writers. Page disable/removal persists; restore does not silently grant trust. Preserve recording controls, cancellation and actual microphone release across navigation.
- R8 — Desktop quality: normal1040x740 and minimum760x560, light/dark/system themes, readable contrast, keyboard focus and reduced motion. Original pet available before a Key; no overlays covering compose/actions or horizontal overflow.
- R9 — Pet-first application flows: bubble options, ordinary text and masked secret input directly validate/save model/persona/appearance/voice choices. Opening Settings is optional, not a required guide step. No-Key onboarding works locally; actions support later/cancel/retry and reflect the same state in Settings. Update notices and decisions use the same path, sourced only from actual updater state.
- R10 — Framework reuse: one Cortico Core handles session/event/model/context/tool mechanics, with product Persona/World and full ResponseClient adaptation. Keep only necessary native/config/vault/authorization application services. Reuse public page contracts; do not create another page DSL, agent loop, extension installer or default launcher beside it.

## Acceptance criteria

- AC1 (R1,R2,R8): actual native screenshots demonstrate all five views, coherent layout/theme/minimum size and no backend-only or unsupported controls.
- AC2 (R3,R7): name/address/language/style/shape/palette and prompt survive restart and affect actual request/renderer consumers. Full-prefix preview matches the applied revision; an in-flight batch is not falsely reported updated.
- AC3 (R7): public-WAV real recording API→ASR→Cortico input→reply/history, manual/automatic ending, stop/cancel, cross-view recording and track release pass.
- AC4 (R5): real fixture config/action page, dynamic lifecycle removal/async fault/stale-owner refusal, restore and persisted disable work without modifying shell navigation or silently granting authority.
- AC5 (R6): scripted model tool calls perform a permitted desktop/config change; reject stale schema/revision/owner, unauthorized scope, mutated/late human decisions and secret leakage.
- AC6 (R7,R8): required workspace, affected strict-probe and serial Electron checks pass, with current usage guidance, local commits and Trellis records only.
- AC7 (R4,R9): chat, real poke/applied blush, local guide choice and update notice share one cursor-ordered record across pet/settings/reconnect/restart; replay neither duplicates messages nor executes historical choices.
- AC8 (R10): pinned minimal Cortico artifact runs on actual Electron/Node with scripted full ResponseClient event→tool→result→reply/abort, correct paths/provider metadata and confirmed shutdown; old reply orchestration/history writers are retired after verified migration.
- AC9 (R9): from an empty profile and no Key, users complete or skip/resume useful setup entirely inside the pet dialog; both views reflect committed values and private inputs never enter model/history. Update available/progress/ready/failure/later choices are exercised through an isolated truthful updater fixture.

## Scope boundary

This iteration includes a usable Cortico agent integration, desktop/config tools, unified interactions, full prompt editing, pluggable settings and actionable pet guidance. Arbitrary model-generated executable installation, a marketplace, borrowed assets, OS automation, global push-to-talk/TTS and full UI localization remain later work unless independently approved. The current host recording maximum is20 seconds; no unsupported controls or fake progress.

There is no published installer/update feed yet. Build/test the updater-to-bubble contract; actual public download/install acceptance requires a real packaged release source. Development uses public fake audio, isolated profiles and scripted providers, with no ambient recording, paid API calls or changes to the running Coopanion installation. The user approved implementation and explicitly retained the DSH-style unified plugin host; Cortico is the replaceable agent-runtime plugin. The task is in progress.
