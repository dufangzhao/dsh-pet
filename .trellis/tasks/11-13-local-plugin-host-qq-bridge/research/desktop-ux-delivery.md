# Local plugin host and remote Agent: desktop delivery research

Read-only planning, 2026-11-13, against HEAD `6897787` (branch `feat/qq-platform-entry`). **No product, test, lock, build or service change**; no real QQ account, SnowLuma, paid model, original-4120 data or test server was touched. This note answers the questions in [the PRD](../prd.md) that the repository can answer, and names the ones only the user can decide.

## Conclusion

**The desktop already has the right local machinery and none of the QQ wiring.** `DesktopHost` is a real plugin host with a real `ConfigService` CAS over `FileConfigStore`, real trust/permission control, real lifecycle and real IPC. What is missing is not a host — it is that **no QQ plugin is admitted to it**, and the QQ IO code that would run there currently lives inside `apps/companion-service`.

**Lifecycle is now decided (user, 2026-11-14): the local host runs independently and QQ keeps working after the desktop exits.** So the work is **an independent local host + one narrow native port + a bridge + attach-not-spawn UI** — not a new runtime, but also not "admit the plugin and go":

1. Admit `qq-official` / `qq-onebot` (+ their IO) as ordinary plugins under a host process that outlives the GUI.
2. **Solve the worker boundary** (§2.5): a socket and its callbacks are not JSON, so either a narrow native host port owns them, or the source runs in-process. This is the actual blocker.
3. Add a bounded bridge so the local source talks to the remote Agent, with a captured connection id checked before dispatch and after await.
4. Give the local source its own config/credential surface, reachable from the desktop, with the **host** owning the credentials that must outlive the GUI (§4.4).
5. Separate the three controls — close view / quit app / stop host — and make reopening attach to the existing host rather than spawn a second one (§4.1–§4.2).
6. Keep server-owned policy server-owned, and label which CAS each surface writes.

**The single most important correction to the current product story:** the existing server-Web QQ panel must not be described as local management. It manages *server* slots. The desktop's read-only QQ card is genuinely wired: its "open Web" action reaches a frozen preload → IPC → Main facade that was exercised by a real production-Electron probe (§2.3).

## 1. What the desktop actually has

| Capability | Where | State |
| --- | --- | --- |
| Local plugin host | [desktop-host.ts:43](../../../../apps/desktop/src/main/desktop-host.ts#L43) | Real: manager, configs, permissions, data dirs, lifecycles. Today it runs **inside** the desktop process — L11 requires it to outlive the GUI (§4). |
| Local Config with CAS | [desktop-host.ts:196](../../../../apps/desktop/src/main/desktop-host.ts#L196) | Real `ConfigService` over `FileConfigStore`; `pet.profile` has an extra presentation-only guard |
| Trust | [desktop-host.ts:259](../../../../apps/desktop/src/main/desktop-host.ts#L259) | Real: `permission.isTrusted(snapshot.owner)` |
| Enable/disable/restart | [console-plugin-request.ts:54](../../../../apps/desktop/src/main/console-plugin-request.ts#L54) | Real: reads local config, then `manager.enable(identity, config.value.data)` |
| Plugin page (UI) | [plugins.tsx:163](../../../../apps/desktop/src/renderer/console/pages/plugins.tsx#L163) | Real enable/disable + trust + restart-needed, in the console's recovery views |
| Config page (UI) | [plugin-config.tsx:24](../../../../apps/desktop/src/renderer/console/pages/plugin-config.tsx#L24) | Real Schema-driven form, CAS save, dirty guard |
| Local preload bridges | [preload/index.ts:69](../../../../apps/desktop/src/preload/index.ts#L69) | `pet`, `petCompanion`, `petVoice`, `petSharedSpeech`, `petLocalPresentation`, `petHost`, `petConsole`, `petSettings` |
| QQ read-only card | [qq-status.tsx:58](../../../../apps/desktop/src/renderer/console/pages/qq-status.tsx#L58) | Real, mounted on the start page |

### 1.1 The decisive negative fact

`apps/desktop/src/main/builtin-admission.json` admits **17 plugins** — `pet.agent-cortico`, `pet.asr-cloud`, `pet.asr-local`, `pet.avatar-default`, `pet.builtin-speech`, `pet.chat`, `pet.companion-client`, `pet.llm-provider`, `pet.page-appearance`, `pet.page-conversation`, `pet.page-persona`, `pet.page-start`, `pet.profile`, `pet.speech-output`, `pet.system-tts`, `pet.talk-key`, `pet.voice-chat`.

**No QQ plugin is admitted.** The desktop also never imports `apps/companion-service`. So today there is no path by which a QQ source could run locally: the code that would run it is on the other side of a package boundary that the desktop does not cross.

### 1.2 Where the QQ IO actually lives

| Module | Contents | Portability |
| --- | --- | --- |
| [qq-official-io.ts](../../../../apps/companion-service/src/qq-official-io.ts) | `ws` client, token/heartbeat/identify/resume/message/upload encoders, `createQqAuthority`, `CapturedQqBinding` | Node-only, depends on `CompanionPluginHost` **interface** and `@pet/host-kernel` `SecretRedactor` — not on the service runtime |
| [qq-onebot-io.ts](../../../../apps/companion-service/src/qq-onebot-io.ts) | Reverse-WS server, echo correlation, `createQqAuthority` | Same shape |
| [qq-controller.ts](../../../../apps/companion-service/src/qq-controller.ts) | Policy/controller authority, plugin enable | **Server-side authority — stays** |
| [qq-delivery.ts](../../../../apps/companion-service/src/qq-delivery.ts) | Ordered parts, attempts, receipts | **Server-side truth — stays** |
| [qq-ingress.ts](../../../../apps/companion-service/src/qq-ingress.ts) | Admission into Core | **Server-side — stays** |

The IO modules are the movable part in principle — they take a host-shaped dependency rather than the service runtime. But "host-shaped" is not "drop-in", and §2.5 records the actual blocker.

## 2. The four surfaces, and which one owns what

The PRD's L7 asks for one understandable flow. There are four **data owners**, which is a fact; how many screens that becomes is a **product proposal**, not a technical constraint.

That distinction matters because the desktop already edits server-owned data today: [persona.tsx:71](../../../../apps/desktop/src/renderer/console/pages/persona.tsx#L71) saves the server profile and upserts server facts through the same companion bridge. So "server-owned" does not mean "may only be edited in a browser". A desktop surface may host a server-owned form; what it must not do is pretend a local save is a server save.

The owners:

| Data | Owner | Examples | Recommended home this phase |
| --- | --- | --- | --- |
| **Agent link** | server | baseUrl, token, connection state, Agent identity | desktop start page (exists) |
| **Local QQ source** | local host | protocol, account, listen host/port/path, local credential, enable/disable, local applied/connected | **desktop** (does not exist) |
| **Server participant policy** | server | allowlists, principal aliases, group policy, judge budget | server Web (exists) — **recommendation: keep Web-first this phase**, because the M6 forms and routes are already there and it is the least new code |
| **Server delivery facts** | server | attempts, receipts, unknown outcomes | server Web (exists) |

L7's "one flow" is therefore satisfied by **labelling**, not by collapsing screens: each surface states which CAS it writes, and the local card states that admission policy lives on the server. Splitting into four screens is one way to do that; a single desktop page with clearly separated sections and two independent CAS baselines is another and is cheaper. Nothing in the code forbids the latter.

### 2.1 What the existing QQ client modules already give us

`plugins/text-client/src/client/` holds ~3190 lines that are **already written and tested**:

| Module | Lines | Reusable for local management? |
| --- | --- | --- |
| [qq-form.ts](../../../../plugins/text-client/src/client/qq-form.ts) | 668 | **Yes** — pure state machine: drafts, CAS capture, owner identity, judge draft, lost-update prevention. No HTTP. |
| [qq-policy-edit.ts](../../../../plugins/text-client/src/client/qq-policy-edit.ts) | 204 | **Yes** — pure: per-account allowlist isolation, actor keys, id parsing |
| [qq-group-settings.tsx](../../../../plugins/text-client/src/client/qq-group-settings.tsx) | 319 | **Yes** — one editor used for both global and per-group |
| [qq-allowlists.tsx](../../../../plugins/text-client/src/client/qq-allowlists.tsx) | 388 | Server policy only (allowlists are server-owned) |
| [qq-judge-form.tsx](../../../../plugins/text-client/src/client/qq-judge-form.tsx) | 308 | Server policy only |
| [qq-protocol.ts](../../../../plugins/text-client/src/client/qq-protocol.ts) | 223 | **Server routes only** — must not be reused for local |
| [qq-panel.tsx](../../../../plugins/text-client/src/client/qq-panel.tsx) | 1083 | **Split it** — see §2.4 |

The pure modules (`qq-form`, `qq-policy-edit`) carry the fences the PRD's L7 asks to preserve: captured draft baselines, `(audience, key)` row identity, two-CAS judge revisions, secret drafts bound to a saved target, per-account allowlist isolation. They are transport-agnostic by construction — `qq-form.ts` has no `fetch` and no React.

**This is the answer to "avoid another 1100-line form":** the split already happened during M6 (four focused components out of the panel), and the remaining panel is a *composition* of them plus the server-only sections. A local form reuses the same four pieces with a different transport.

### 2.2 What the local form needs that does not exist

The local source form needs fields the server form does not have, because the server never binds a socket:

- OneBot `listenHost` / `listenPort` / `path` — these exist in `QQOneBotSettings` and the M6 panel shows them, but on the server they describe the *server's* listener. Locally they describe the user's machine.
- Local credential write/clear, bound to the local `ConfigService` revision and the local credential version.
- Local `saved` / `applied` / `connected` facts, read from the local host — **not** from the server's `QQView`.

The last point is the one that must not be faked: the server's `QQView.sources[].phase` describes the **server's** source. After the move there is no server source, so the desktop must show local phase from the local host, and the Agent-link state separately.

### 2.3 The read-only card is actually wired (corrected)

An earlier draft of this note claimed `openWeb` was missing from preload. **That was wrong**, and the reason is worth recording because it is a trap for the next reader: `preload/index.ts` does not name `openWeb` explicitly, but it hands the whole channel map to a factory.

[companion-bridge.ts:31](../../../../apps/desktop/src/preload/companion-bridge.ts#L31) builds the bridge by iterating `Object.entries(DESKTOP_COMPANION_IPC)` and generating one method per entry. `openWeb` is in that map ([desktop-companion.ts:106](../../../../packages/contracts/src/desktop-companion.ts#L106)), so it is exposed automatically. Reading only `preload/index.ts` and concluding "not exposed" is exactly the mistake of not following the factory.

The chain was verified end to end in production Electron, not just in source: [the M6 probe report](../../../../qa/fixtures/companion-qq-desktop/evidence/eec1249c-c314-4364-9586-db18fc78dc56/report.json) records `readonly-native-facade-subset-passed` with checks for the real service snapshot through production Main/preload, a fixed Web IPC facade with no URL/token argument, and stale/replaced targets refused. Its stated limit is that `shell.openExternal` is spied inside that owned process — OS browser launch is not verified.

So the desktop card is **not** broken, and this note makes no claim that it needs fixing.

### 2.4 Reducing the panel rather than growing it

Recommended split for the local work (reuses M6 components, adds no new generic framework):

```
LocalSourceCard            (new, desktop)     — protocol select, account, listen*, local credential,
                                                enable/disable, local saved/applied/connected
  └─ uses qq-form.ts        (existing, pure)  — draft/CAS/owner/secret fences
  └─ uses connectionFacts() (existing)        — same phase wording as the server card

ServerPolicyPanel          (existing, Web)    — allowlists / aliases / groups / judge
  └─ QQAllowlists, QQAliasEditor, QQGroupSettingsEditor, QQJudgeForm  (all exist)
```

**Recommendation, not constraint:** keep allowlists out of the local card *this phase*, because they are server policy and the Web form already exists. That is a cost/confusion argument. If a later phase wants them on the desktop, the existing `QQAllowlists` component can be mounted there unchanged — the data owner stays the server, and the form would write through a server route, exactly as persona already does.

### 2.5 The real blocker: a private port cannot cross the desktop worker boundary

"Move the IO module and admit the plugin" is **not sufficient**, and the reason is a concrete one:

`DesktopHost` runs plugins in a **worker**, and the worker protocol is JSON. [worker-protocol.ts:3](../../../../packages/host-kernel/src/runtime/worker-protocol.ts#L3) imports `JsonValue` and every message is validated as JSON ([worker-protocol.ts:12](../../../../packages/host-kernel/src/runtime/worker-protocol.ts#L12)). A QQ IO module needs things JSON cannot carry:

- a live `WebSocket` / `net.Server` socket,
- callbacks invoked by that socket,
- private port objects (`OfficialGateway`, `OfficialIo`, the OneBot reverse-WS acceptor).

So the QQ IO cannot simply be handed a `CompanionPluginHost` and run inside the existing worker. Two honest shapes:

| Shape | What it needs | Cost |
| --- | --- | --- |
| **Narrow native host port** | A small host-side composition that owns the socket and exposes a bounded, serializable request/response surface to the plugin (the plugin describes *what* to send; the host does the sending and reports the actual receipt) | One new narrow port on the desktop side; the protocol logic stays in the plugin |
| **Run the source in-process** | Host the QQ IO outside the worker (in Main), accepting that it then has Main's lifetime and privilege | Less plumbing, but the source no longer benefits from worker isolation |

Neither is "another plugin system". Both keep the existing kernel, manager, CAS and lifecycle. The choice is an architecture decision that belongs with the implementation phase, not this note.

**Consequence for the recommendation:** the phrase "reuse `DesktopHost`" is accurate for trust, CAS and lifecycle, and **inaccurate** for "the QQ plugin can just run there". That gap is the substance of this task.

## 3. Fences that must survive the move

These are already implemented and must not be re-invented:

| Fence | Current mechanism | Risk after the move |
| --- | --- | --- |
| Draft vs latest | `QQSourceOwner` / `sameSourceOwner` (protocol + pluginId + instanceId + connectionId, **not** revision) | A local restart changes the connection identity; dirty drafts must drop, not silently re-base |
| Secret ownership | `SecretDraft` / `JudgeSecretDraft` capture provider + target + both CAS revisions | The local credential must bind to the **local** config revision, not the server's |
| Two-CAS judge | `QQJudgeDraft.policyRevision` + `.configRevision` | Judge stays server-side; do not move it locally |
| Late closures | `currentOwner` ref + `client.#qqTransportFor(expectedConnectionId)` | The bridge must do the same: a captured connection id, checked before dispatch **and** after await |
| Per-account isolation | `replacePrivateFor` / `replaceGroupsFor` | Server-side only, but the rule generalises if a local form ever shows two accounts |

The bridge needs its own version of the last one: `expectedConnectionId` must be part of every local→remote call, and a mismatch must produce `stale-owner` **without dispatching**, not a late rejection.

## 4. Host process model: independent local host (decided)

**User decision 2026-11-14 (PRD L11 / A9): QQ keeps operating after the user explicitly exits the desktop application.** An independently running local host, with its own stop action. This section is now the UX and mechanism consequence of that decision, not a comparison.

### 4.1 Three things that must never be confused

This is the whole of L11 in UX terms, and each needs its own wording and its own control:

| Action | What it stops | What it must NOT stop |
| --- | --- | --- |
| **Close / hide the pet window** | a view | the local host, QQ, or cloud work |
| **Quit the desktop application** | the GUI process | the local host, QQ, or cloud work |
| **Stop the local host** | local QQ sources and local-only effects | the Agent, cloud work, identity, server state |

The third one is the new control. It must be reachable and honest:

- **Available even when the server is offline.** Stopping a local host is a local action; requiring an Agent connection to perform it would strand the user with a host they cannot stop. So the stop control must work with no server link — it cannot be gated behind a live `connectionId`.
- **Waits for actual native cleanup** before it reports success. "Stopped" means the socket is closed and the source is unavailable, not that a command was queued.
- **Says what survives**: accepted cloud-eligible work continues; the local source becomes unavailable and its effects are not claimed to have happened (PRD L8).

### 4.2 Reopening the GUI must attach, not spawn

L11/A9 require that restarting the UI does **not** spawn a duplicate host. The mechanism is a single-instance discipline for the host, with the GUI as a *client* of it:

- The host owns its own process identity and its own lifecycle. Starting a second host while one is running must fail or attach, never run two.
- The GUI on launch **discovers** an existing host and attaches. Only if none is found does it offer to start one.
- A9's acceptance is exactly this: exit the desktop, observe QQ still working, restart the UI, observe it attached to the same host rather than a second one.

### 4.3 Two connections to the same Agent

The user's decision is that the desktop's existing server connection and the local host's device link are **two uses of the same Agent**, not one shared socket. That is also what the code supports without rewriting M4/M5:

`DesktopCompanionController` holds **one** connection ([companion-client-controller.ts:200](../../../../apps/desktop/src/main/companion-client-controller.ts#L200), `#connection: Connection | null`). Its `connectionId` is the identity every voice/speech/task fence compares against. So:

- **Do not** try to multiplex two roles onto that one field — every existing fence would have to be re-reasoned.
- **Do** run two instances/roles: the GUI's existing client (unchanged M4/M5 behaviour) and a separate host-side link. They share the Agent and the server, not a socket.
- This avoids inventing a "unique socket" and avoids rewriting the M4/M5 clients, which the user explicitly ruled out.

### 4.4 When the user must supply what

The token boundary is the part most likely to be built wrong, because "quit the desktop" and "stop the host" are different actions with different lifetime implications:

| Secret | Entered where | Lifetime | Must survive GUI quit? |
| --- | --- | --- | --- |
| Service token (Agent link) | GUI connect form, or host enrolment | GUI session for the GUI link; host-owned for the device link | **The host's copy must survive.** Quitting the GUI must not clear the token the host uses to stay connected. |
| QQ platform credential (AppSecret / OneBot token) | local host config | host-owned | **Yes** — QQ keeps running after the GUI exits. |
| Judge model key | server policy (Web) | server | n/a locally |

The failure this prevents: a user quits the pet window, and the daemon silently loses its Agent link because the token lived in GUI memory. The daemon must hold its own credential reference, provisioned through the host, not borrowed from a window that may not exist.

### 4.5 What the local card shows

The local QQ card's facts are **independent** of the Agent link, and must be labelled as such:

```
Local host        [running | stopped | starting | failed]     ← host process
Local QQ source   [saved rev N | applied rev M | connected | offline]  ← local source
Agent link        [connected | offline | not configured]      ← server
```

Three independent lines, three independent CAS/authority statements. The card must not derive one from another: a running host does not imply a connected source, and a connected source does not imply a live Agent link. Stopping the host must visibly move the source line to unavailable while the Agent link line is unchanged.

### 4.6 Where server policy is edited

Unchanged from §2: **Web-first this phase**, because the M6 forms and routes already exist. The desktop may host a server-owned form later — `persona.tsx` already proves that is possible — but nothing in this decision requires it, and adding it now is cost without a driver.

## 5. Windows-first delivery: what actually exists

| Question | Fact |
| --- | --- |
| Published release? | **No.** `git tag` is empty; there is no `apps/desktop/release`; no `electron-builder` / `electron-forge` / `@electron/packager` anywhere. |
| GitHub main? | `origin/main` is at `500aeba`; this branch is **37 commits ahead**. Main does not contain the QQ work at all. |
| Installer? | **No.** `apps/desktop/package.json` has `version: 0.0.0`, scripts `typecheck`/`test`/`build`/`start`, and `start` runs `node start.mjs` which spawns the workspace `electron` binary. |
| What `build` produces | `dist/main`, `dist/preload`, `dist/renderer`, `dist/runtime` — an unpackaged tree, not a distributable app. |
| So a source archive is | **not** a user deliverable. It needs Node, pnpm, a workspace install and a dev build. |

### 5.1 A defensible minimal package path

For a Windows-first local trial the smallest honest deliverable is:

1. `electron-builder` (or equivalent) producing a **portable/unpacked Windows directory** with the `dist/` tree + a pinned Electron runtime — no installer, no signing.
2. A `package.json` version bumped off `0.0.0` and stamped into the build so the UI can display it.
3. First-run reachability: the app must start, show the Agent-link form, and state clearly that no server is configured — **without** requiring SnowLuma to be installed for the app to launch.
4. The local QQ source card must be reachable from the production entry **before** any QQ plugin is enabled, so the user can see "not configured" rather than an absent feature.

**Linux artefacts are not Windows verification.** The codec image is Linux-amd64 Docker ([PRD §Existing evidence](../prd.md)); a Linux Electron run says nothing about whether a Windows user can start the app, bind a local port, or write a credential to the Windows config store.

### 5.2 What "actual UI acceptance" should mean

Not screenshots of a dev server. Minimum honest evidence:

- Launch the packaged build on the target OS, from a clean user profile.
- Connect to a real (scripted) remote Agent; show Agent identity and that **no local Core** started.
- Configure and enable a local QQ source; show local `saved` → `applied` → `connected` separately from the Agent link.
- **Quit the desktop application and observe QQ still operating** (A9). This is the acceptance that distinguishes the decided lifecycle from the old in-desktop one.
- **Restart the GUI and observe it attached to the existing host**, with exactly one host process — not a second one.
- **Stop the local host while the server is offline**, and confirm the control works and reports real native cleanup.
- After host stop: accepted cloud work continues, the local source shows unavailable, and no local effect is claimed to have happened.
- Restart the host; show the local config persisted and the credential still bound to its target.

## 6. What still needs the user

**Lifecycle is resolved** (2026-11-14): independent local host; explicit desktop exit does not stop QQ (L11/A9). §4 is written against that decision.

Two items remain, and neither blocks the UX above:

1. **Distribution**: a portable Windows-first, versioned build is acceptable as a **final-review proposal** — no signing and no public release are in scope. What still needs confirming at review time is the exact artefact form (portable directory vs single-file) and where it is hosted for the trial.
2. **Where server policy is edited**: keep it Web-first this phase (recommended, §4.6). Adding a desktop surface later is possible without changing data ownership, but is not required by any current decision.

Everything else in §1–§5 is answerable from the repository.

## 7. Limits of this note

No product code, test, lock, build or service file was changed. No real QQ account, SnowLuma instance, paid model, original-4120 data or test server was contacted, and no new native run was performed.

Three claims in the first draft were wrong and are corrected above rather than deleted, so the reasoning is auditable:

- `openWeb` **is** exposed — `companion-bridge.ts` iterates the whole IPC map (§2.3). I had read only `preload/index.ts` and missed the factory. The M6 production-Electron probe already exercises that facade.
- "Four owners ⇒ four screens, and the desktop may not host a server form" is a **proposal**, not a constraint — the desktop already edits server persona and facts (§2). Keeping policy Web-first this phase is a cost recommendation.
- "Reuse `DesktopHost`" is accurate for trust/CAS/lifecycle but **not** for running the QQ IO unchanged: the worker protocol is JSON and cannot carry sockets or callbacks (§2.5). A daemon reuses the same kernel, so its real cost is process supervision and a management channel, not a second trust model (§4).
- An earlier draft presented lifecycle as an open comparison. It is decided (§4), and §4 is now written as consequences rather than a trade-off table.

The commit/tag/release facts in §5 were read from the local clone's `origin/main` and working tree; I did not query GitHub.
