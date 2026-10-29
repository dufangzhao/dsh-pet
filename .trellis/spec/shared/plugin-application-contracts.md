# Executable desktop application contracts

## Scope / trigger

Use for changes to plugin activation, ordinary page contributions, application IPC, Cortico, shared profile or native input. Current product behavior is in docs/34-plugin-pet-guide.md; this spec records boundary mechanics and regressions, not another product roadmap.

## Signatures

- PluginRuntimeContext / PluginContext: optional readonly dataDirectory:string, allocated by DesktopHost with PluginDataDirectories.get({pluginId,instanceId}) only for declared files/plugin-data. Runtime authority remains owner + generation.
- SDK config.save?(task,data:JsonObject,expectedRevision:number): Promise<Result<ConfigSave>>. Optional host port keeps older in-memory fixtures source-compatible; actual workers provide it. No target owner in the request.
- ApplicationBridge: fixed getSnapshot/getHistory/saveProfile/interact/answer/startGuide/runPageAction. See packages/contracts/src/application.ts. Frozen preload facades enforce arity; Main checks the exact current trusted main-frame URL.
- app.profile@1 read/change owns canonical persona/appearance; agent.conversation@1 owns Core projection; llm.responses@1 returns complete Generation, including a nonempty successful attempts array and TokenMeters.

## Contracts / env

ApplicationAnswer is id + step + known choice + optional text. A secret input is consumed only by the credential broker path; it is never archived as a guide choice. A new step has a new id; successful action state is persisted before publishing the next step.

Core history is one monotonic cursor store. Snapshot shows a bounded latest page; getHistory({before,limit}) reaches older entries, limit1..200. Delta after returns the scanned cursor boundary, not an unscanned latest cursor. Renderer deduplicates only its memory projection by cursor and invalidates it when clear moves the cursor backwards.

Cortico public WebUiPageManifest JSON comes through existing panel contributions. Runtime/ui/worker and declared panel.entry artifacts all enter DiscoveredPlugin.files and source verification. Public metadata projection strips external client scripts/reserved builtins. Same-owner declared command actions execute in TaskSupervisor; pageId, panelId and owner generation must still match.

TSX_DISABLE_CACHE=1 selects the loader supported in-memory path so plugin runtime needs no shared global Temp transform cache. Keep cortico/* and tsx/* external in plugin ESM builds: upstream top-level await and provider-directory imports must retain their layout. Do not bundle the esbuild JavaScript API into native QA runners that compile fixtures.

## Validation & error matrix

| Trigger | Required behavior |
| --- | --- |
| missing/wrong owner or no active task on own config.save | deny; no cross-owner argument accepted |
| stale expectedRevision | conflict, preserve draft/data |
| config schema explicit full prompt bound | up to16384 code points; default remains4096;48KiB value byte budget still applies |
| source artifact changed | package-changed / review exact new fingerprint; never silently trust current discovery |
| network/credential provider setup | ask policy; local denies network and cannot mean cloud-ready |
| saved prefix candidate, Core session write fails | applied revision remains old, error reported, same candidate can retry; do not generate until acknowledgment succeeds |
| agent deliberately stopped/removed/faulted at startup | start recovery UI; migrate/attach only active generation; marker changes only after successful import |
| voiceEnabled=false | real canRecord=false; prevent new recording and cancel voice intent/capture, preserve text path |
| stale guide/update/permission choice | reject; cannot approve newer task/state |

## Good / base / bad cases

Base: fresh no-Key app starts the content-pinned page/profile/Core roles, pet guide saves canonical preferences, scripted pet input enters the same record shown by Settings.

Good: model configure_pet calls app.profile.change; provider-owned files/plugin-data lease prompts in the pet; allow commits one CAS revision; deny preserves data and acknowledged prefix.

Bad: treating successful save as successful reload, auto-trusting changed code during guide, setting a cloud source to local, keeping a second persistent DemoHistory writer, or hiding a failing setting behind defaults.

## Tests required

- SDK own save: foreign returned snapshot rejected, input copied/frozen, existing config.get fixtures unaffected.
- discovery.test: panel.entry content changed after discovery invalidates source.
- prefix-reload.test: a failed session reset keeps old acknowledged revision, blocks generation and retries same revision.
- application-backend-e2e: pet-only edits, exact stale CAS, ready-ASR voice disable, older page/delta coverage, Core clear, disabled-agent recovery and external page command/fault/config retention.
- application-model-e2e: real Core tools, exact ApprovalInbox owner/task/digest, allow/deny/replay/CAS, actual receipt-driven reply and canary exclusion.
- application-ui-acceptance: click real controls and keep native artifacts current; no media-consent bypass, no paid services. GUI CDP tests do not imply OS click-through/drag evidence.

## Wrong vs correct

Wrong: systemSegments consumes pending into current, then reload fails; UI says revisionN applied and equality guard skips retry.

Correct: systemSegments builds from pending, while current remains the last acknowledged profile. Advance current only after reload resolves, preserve failed candidate and permit retry; turn refuses generation while promptState=error.

Wrong: global snapshot-read sequence identifies a microphone session or stale async completion clears the next capture.

Correct: the active AbortController/session token owns capture across navigation; any cleanup after await must recheck that identity. Temporary history-page requests have a separate projection sequence and cannot repopulate a cleared record.
Normal startup regression: isolated --demo-acceptance checks do not cover an existing normal-profile process. Updating dist while the old main/preload/worker remains alive can mix new renderer files with the old API and registry. Before normal-launch acceptance, verify/close only the owned stale instance, preserve existing profile/vault/history, and confirm all primary page contributions plus native pet visibility using the normal profile. A repeat launch must reuse the current instance.
