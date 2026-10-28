# DSH-style plugin host with Cortico agent implementation

Approved boundary: retain the unified DSH-style plugin host. Cortico is supplied through a replaceable agent-runtime plugin; UI/pages, providers, tools and desktop services remain composable plugin roles. Self-iteration discovers and changes permitted plugin/configuration state through scoped interfaces, not by replacing the host with an ungoverned second framework.

Proposed revision for final Trellis review after the user clarified unified everyday interactions, Persona/full prompts, Cortico reuse and pet-first application flows. The pinned [Cortico research](research/cortico-reuse.md) supersedes the standalone page-protocol/custom agent-loop portions of the earlier plugin research. [Frontend research](research/frontend-design.md) and [selected integration notes](research/visual-direction.md) govern the visual layer.

## One agent, two human views

```text
pet text / voice / actual touch or reaction / guide or update action
 -> authenticated desktop interaction World
 -> one Cortico Core event store + persistent agent session
 -> Cortico ResponseClient / native tool dispatch
 -> authorized desktop services -> actual UI/action receipt
 -> the same event history projection
     -> pet bubble (primary action path)
     -> Settings interaction-history view (overview/editing supplement)
```

The Conversation page is a view of everyday life with the same pet. It does not create a separate bot, session, message database or settings-only chat identity. All inputs use the same World identity. Correlated archive-only events record the actual presented assistant/application response and reaction receipt; they do not wake the agent again or duplicate native transcript records. Cursor-based projection includes genuine poke/pat/drag-completed/blush-applied, guide answers, configuration results and update notices. Do not record pointer movement samples or infer an expression that never rendered.

## Cortico reuse and desktop authority

Use Core for the only agent/session/event/context/tool loop, with a small DesktopPersona for this product semantics, one desktop interaction World and the full upstream ResponseClient/provider contract. Reuse World/Persona/Provider page declarations, WebUiPageContribution/manifest and panel invoke/stream/config/prompt contracts. Withdraw the proposed new console-page DSL and page-command RPC. Do not adopt private Cortico WebUI DOM/client internals or arbitrary panel scripts in the privileged console; the custom frontend consumes public contracts through the desktop adapter, with safe declarative config/actions for external pages and audited application panels.

Keep the current PluginManager/source/generation boundaries as the single deployment and authorization decision maker; mounting/unmounting a World is delegated to Core. A Core fault withdraws the corresponding owner/page/tools. Do not simultaneously run the stock WorldAssembly enabled-state writer, launcher or npm installer. Keep host recovery/extension management available if optional pages are disabled. Build-pinned application-interface admission remains narrow and does not grant permissions or trust to arbitrary feature/provider/third-party code.

Desktop native I/O, microphone capture, ASR worker, encrypted credential broker, exact user approvals and config CAS remain reusable application services. The existing DemoController loses its model/session orchestration after cutover; retain its proven audio/cancellation adapters rather than add a second loop around Cortico. Model tools call the scoped management facade with real owner/task/target/action authority. Human pet/console adapters validate their actual source and one-shot interaction, never a caller=human wire flag.

## Page responsibilities

| Page | Shared useful functions |
| --- | --- |
| Start | Actual provider/model connection configuration, truthful key/last-request state, character palette and live preview; optional replay of the pet guide. No development checklist or independent chat. |
| Persona (人设) | Names/address/reply language/style plus the entire editable persona prompt; show complete effective prefix segments and actual application status. |
| Appearance | Original shape/palette/size choices and desktop visibility; preview remains usable when the desktop pet is hidden and reads the same values. |
| Conversation (对话) | Ordered overview of the same everyday messages, actual interactions/reactions, guide choices and application notices. Any optional input continues the same channel; no new conversation identity. |
| Voice Input | Actual recognition model/readiness and supported input/send preferences, with current host recording limit and reachable live stop/cancel controls. |

Preserve the236px sidebar,1120px maximum content, clear aligned rows, current light/dark/system roles and original pet preview. Extensions and About are quiet recovery entries. Normal UI exposes useful outcomes, not schemas, IDs, leases, hashes, channels, runtime parameters or internal framework pages.

## Pet-first guide and application actions

The original native pet and an actionable bubble must be available on a fresh profile before model credentials or optional provider activation. A local application guide runs before a paid/real provider is configured; its lines are identified as application guidance rather than fabricated model output. Users can choose/enter names, style, appearance, provider/model/key and voice options in place. Save/validate with the same service used by Settings; reflecting a selection in Settings must not require opening it. Settings is a secondary editor, and can host long-form prompt editing.

One host-owned flow state records the current step and committed results; the views do not store competing progress. Choices/inputs bind flow/step/action and current revision, are single-use and cancelable, and reject replay/stale answers. Secret entry goes directly from the trusted human input to the vault; neither raw values nor ciphertext enter events, tool arguments, prompts or transcript. Normal history records only a safe result. Interruption/restart can resume or clearly finish/cancel the real step. Skip/later remain available.

Application notices, relevant source/permission confirmations and configuration failures use the same bubble presentation. Keep at most the relevant live action prompt in front, with normal chat and queued nonurgent notices not lost; tray/settings are recovery paths when the pet is hidden/unavailable. No model may approve its own permission or cause arbitrary installation by inventing button payloads.

## Full prompt: one document and truthful application

Store the complete editable persona prompt in one canonical revisioned profile. Expose it on Persona, with clearly identified dynamic World/tool/environment segments and the complete effective prefix preview. Do not keep a hidden second personality prompt that overrides the editor. Names/style fields need declared projection semantics rather than silent competing text.

Saving updates canonical data and requests Cortico reloadSystemPrefix. The upstream reload waits for a safe boundary after the current batch, so show saved/pending/applied/failure correctly. Report applied only after its acknowledgment; subsequent generation uses that applied revision. Do not promise immediate replacement inside an already-running batch or silently interrupt the current response. Keep the edit draft on conflicts and allow explicit retry/reload. Define an adequate bounded full-prompt capacity and reject oversize text without truncation. Stock prompt-doc files, when needed, are generated projections rather than a second independent writer.

## One configuration and history authority

ConfigService/FileConfigStore and stable plugin/instance identity remain canonical for desktop settings, persona documents and committed provider selection. Cortico LoadedConfig/config-group values are runtime/public-UI projections of those commits; setConfig must route through the same schema/revision boundary. The stock .env secret reader/writer is not adopted. The full ResponseClient adapter uses existing authorized credential operations and never places plaintext in persistent config/environment/provider metadata.

One Cortico data directory owns event/session/transcript history. Import existing demo messages once with stable legacy IDs, keep the original read-only for recovery until cutover succeeds, and then stop old history writes. The user history projection queries one cursor; it does not maintain another chat database. Record incomplete/failed presentation and persistence failures honestly; upstream transcript/event methods do not establish crash-atomic delivery by themselves. Clear/reset UI must implement and describe its actual event/archive/Memory scope.

## Updates and deployment

An application update adapter reports actual available/downloading/ready/failed/completed states to the same pet interaction flow. Present real choices such as review/download, later, restart-to-apply or retry; do not install from a model-provided URL or report fake progress. The current project has no published installer/update feed: this iteration defines and verifies the adapter/bubble contract with a clearly isolated fixture, while actual download/install acceptance waits for a real packaged release source. Do not alter the running reference Coopanion or its data.

Pin Cortico0.2.7 commit cb9ddbd685bcccba1f29905098648f46a79b3862 and preserve its MIT notices. Use a verified desktop-relevant ESM build/artifact and only required provider/World closure, not the private repository root Minecraft/canvas dependency graph. The current CJS worker cannot simply import the TS/TLA Core registry. Compatibility/build/paths/ASAR/shutdown are the first execution gate before broad migration. The same scripted provider must exercise actual Core event -> tool -> result -> reply/abort behavior without external charges.

## Rollout

Follow [implement.md](implement.md): compatibility proof, frozen adapter contracts, shared-history/prompt/config consumers, DeepSeek frontend, pet-first guide/update interfaces, full native acceptance and data-preserving cutover. b9a803e remains the recoverable working baseline; no destructive reset or dual permanent agent/history writer. The architecture proposal is [ADR-0014](../../../docs/adr/0014-cortico-agent-runtime.md).
