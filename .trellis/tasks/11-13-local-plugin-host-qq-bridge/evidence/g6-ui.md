# G6 desktop UI: local host management

Scope: DeepSeek-owned renderer UI only. Main/preload/contracts/daemon belong to Parent and b92/b926. This records what actually exists after this increment, and what it does not prove.

## What was built

New directory `apps/desktop/src/renderer/console/local-host/`:

| File | Role |
| --- | --- |
| `local-host-view.ts` | Pure derivations: host label/availability, source three-layer facts, disabled reasons, agent-link label. No React, no requests. |
| `local-source-draft.ts` | Local source draft/CAS/secret transitions. Same rules as the M6 server form, **different identity** (host + boot, not server connection). |
| `local-host-card.tsx` | Host card: start / attach / stop, three independent status lines. |
| `local-source-form.tsx` | One reusable form for both protocols; official and OneBot differ only in fields. |
| `local-source-trust.tsx` | Shared source-trust card used by **all three** managed sources: read / trust / revoke / allow / deny, with the actual digest, preset, cleanup and blocked facts. |
| `local-agent-link-form.tsx` | daemon→Agent target + temporary token, using the already-landed `LocalAgentLinkView`. |
| `local-host-section.tsx` | The only holder of local drafts; composes the above; all actions via the frozen `DesktopLocalHostBridge`. |
| `read-bridge.ts` | Reads `window.petLocalHost`; absent means "this machine has no local host", not a fake. |
| `local-host-view.test.ts` | 22 pure tests. |
| `local-host-card.test.tsx` | 15 render tests. |
| `local-source-trust.test.tsx` | 8 render tests for the shared trust card. |

Plus `apps/desktop/tests/browser/local-host.browser.mjs` — 25 **real DOM** checks against the built console with a programmable `window.petLocalHost` stub.

Wired into the real production entry: `pages/start.tsx` renders `LocalHostSection` after the existing read-only `QQStatusCard`, with `openServerPolicy` forwarding to the existing captured `companion.openWeb()`.

## Gap found after the first G6 pass: the GUI could not actually authorize a source

The first pass shipped a read-only `review.preset` line and a trust button, and the browser probe called `reviewSource` / `confirmSourceTrust` through the facade. That hid two real blockers, both confirmed by reading the production composition and the kernel:

1. **No `setSourcePreset` action existed anywhere in the renderer.** Production seeds all three sources with `preset: 'deny'` (`apps/desktop/src/local-host/composition.ts`), and the kernel refuses `runFor` / activation when `policy.preset === 'deny'`. A user could trust the source and still never run it.
2. **`LocalAgentLinkForm` had no review/trust/preset entry at all** — the section only passed `view`, the key value and the enable toggle. The agent-link kernel requires an explicitly reviewed and trusted source (`sourceTrust: 'review'`), so first-time Agent-link enablement was impossible from the GUI.

The probe made it look verified because it drove the facade directly; it never proved a user could click the path.

### Fix

- `local-source-trust.tsx` is a small shared card (no new state framework) rendered by both QQ forms and by the Agent-link form. It shows the **full** digest, `trusted`, `preset` (with a plain-language gloss), `cleanup`, and `blocked`; actions are `读取源码状态`, `信任这份源码` / `撤销信任`, `允许敏感操作` (allow) and `禁止敏感操作` (deny). `ask` / `local` are display-only — the host has no interactive per-request approval surface, so the UI does not promise one.
- `LocalHostSection` holds `reviews` + `reviewErrors` per `ManagedSourceSelector` (both QQ protocols **and** `agent-link`).
- `latest` is the **accepted** state, not the rendered one: `accept()` writes `latest.current = next` synchronously before `setState`, and nothing writes it during render. Without that, a new boot accepted in one microtask could be overwritten by the old boot's late mutation before React re-rendered, because the fence still compared against the previously rendered world.
- `readReview(selector)` uses a per-selector `Symbol` token; `accept()` clears every review and invalidates every token when `hostId:bootId` changes, so a late response cannot repopulate the old digest. A failed read clears that source's review and shows the real error — the stale digest is no longer actionable.
- `changeTrust(...)` reuses the existing `mutate()` (owner `ownerOf(selector)`, per-operation token, captured `{hostId, bootId, protocol}`). The command's `expectedDigest` / `expectedPermissionEpoch` come from **the review the user saw**, never from a snapshot taken after the await.
- After a successful trust/preset commit, `mutate()` does `reread()` and then one **read-only** `readReview(selector)` while still busy. That is what makes the next action carry the new epoch: `confirmSourceTrust` increments `permissionEpoch`, so reusing the old one would make the following `allow` conflict by construction. There is no fresh-retry on conflict.
- `OperationOwner.protocol` widened to `ManagedSourceSelector` so the Agent link uses the same fence (`ownerOf('agent-link')`); no generic manager was added.

No backend, contracts, Main, preload, worker, packager, `sourceCore`, Root lockfile or `package.json` change was made. No auto-trust, no auto-allow, no default-allow; every permission change is a user click, and the enable commands (`setSourceEnabled`, `setAgentEnabled`) still carry only their own revision domain — no permission field is smuggled in.

## The three states are genuinely independent

This was the point of the increment, so it is enforced by construction rather than by wording:

- `canStopHost(facts)` takes **only** local host facts. There is no Agent parameter, so no future edit can quietly gate stop behind a live server link. Stop is allowed while `starting` as well as `running` — otherwise a user whose host is stuck mid-start has no way out.
- `canAttachHost` requires `running && !attached`, so reopening the GUI offers *attach*, not a second start.
- `sourceFacts()` reports `savedLabel`, `appliedLabel` and `nativeLabel` separately; `connected` is `phase === 'ready'` only. A saved configuration with `phase: 'offline'` renders "已保存 修订 N" and "平台连接已断开" — never "已连接".
- The Agent-link line reads from `LocalAgentLinkView.phase` and never from a source.

## Draft and secret fences carried over

Same failure modes the M6 server form already learned, re-expressed for local identity:

- A dirty draft keeps the user's settings **and the revision it captured**; a clean view following forward does not lend it a new baseline (`localSourceSaveCommand` uses `draft.owner.configRevision`).
- Host restart (`bootId` change) discards the draft — that is a different world, not a newer revision.
- `LocalSourceSecretDraft` captures protocol/plugin/host/boot/config revision/credential version. Any of those changing invalidates it, so a typed key cannot be written with another target's legitimate CAS.
- Key input is disabled until the source configuration is saved (`localSecretTargetSaved`), because unsaved connection edits do not exist in the host yet.
- Secrets are cleared at dispatch; the Agent token is cleared immediately after the write call.

## Contract status at the time of writing

- **Used and landed:** `LocalHostConsoleView` / `LocalHostConsoleMutation` / `LocalHostSecretTarget` / `LocalHostSourceEnabledCommand` / `LocalHostSourceTrustCommand` / `LocalHostSourcePresetCommand` / `LocalHostSourceReview` (`packages/contracts/src/local-host-console.ts`), `LocalAgentLinkView` (`local-host-qq.ts`), `QQSourceView` / `QQSourceSettings` / `QQCredentialView` (`companion-qq.ts`).
- **Fully aligned:** the components now call the frozen `DesktopLocalHostBridge` directly. There is no private bridge type left. `start()` doubles as start/attach discovery, `stop(target)` takes the captured `{hostId, bootId}`, and `onChanged` carries no payload so every notification triggers a `getState()` reread.
- **Agent link uses `linkCurrentAgent({hostId, bootId, connectionId, expectedRevision, expectedCredentialVersion})`.** The user never types an Agent ID or State epoch; the form shows the daemon's target read-only and offers one "用当前连接" action.
- **`setAgentEnabled` sends both `expectedRevision` and `expectedCredentialVersion`, captured at the moment the click happens.** The server check is exclusive over link revision *and* key version, so taking either from a later `getState()` would let a stale click pass a check it should fail. The component snapshots both into `captured` before the async call rather than reading `agentLink` inside it.

Three shapes were taken from the real contract rather than guessed:

- `sources` is exactly two entries with `sourcesRevision` as its own CAS; the UI never derives one from `agentLink.revision`.
- Enabling a source needs **three** expected values (`expectedControlRevision` + `expectedConfigRevision` + `expectedCredentialVersion`), because desired-enabled is a separate CAS from the source Config.
- Secrets are written against a `LocalHostSecretTarget` that carries the purpose plus the revision/credential version it was captured at — there is no key value or caller-chosen owner in the target.
- `packages/local-host/src/kernel.ts` currently fails to resolve `@pet/local-agent-link`; that is in-progress work outside this scope, not a defect in these files.

## Verification actually run

```
npx vitest run src/renderer/console/local-host/   → 45 passed (3 files)
npx vitest run (full desktop)                      → 1128 passed, 121 files
npx tsc --noEmit (desktop)                         → clean
npx eslint <owned paths>                           → clean
npx prettier --check <owned paths>                 → clean
node apps/desktop/tests/browser/local-host.browser.mjs (private Chromium 156 + private libs)
                                                   → 25/25 real DOM checks passed
```

Two mutations were used to confirm the tests are not decorative:

| Mutation | Result |
| --- | --- |
| `canStopHost` drops the `starting` phase | caught (1 failure) |
| `followLocalSource` lets a clean view lend its revision to a dirty draft | caught (1 failure) |
| `setAgentEnabled` omits `expectedCredentialVersion` | caught twice — `tsc` rejects the command type, and the DOM probe fails |

Real DOM, 25/25 in `local-host.browser.mjs` (real React DOM + Playwright clicks against the built console, stub facade only):

| Check | What it proves |
| --- | --- |
| stop clickable while the Agent link is `offline` | stop is not gated by the server link |
| real stop/start clicks | state transitions from actual clicks |
| three source layers rendered separately | saved / applied / native stay distinct |
| typing enables save | real input drives the button |
| save carries the draft's captured revision (3) | draft CAS, not the newest revision |
| dirty draft survives an unrelated reread | no silent reset |
| key input blocked until the config is saved | secret target precondition |
| `bootId` swap discards the dirty draft | no cross-boot draft reuse |
| **initial state: all three sources untrusted + `deny`, zero `confirmSourceTrust` / `setSourcePreset` calls** | no auto trust, no auto allow, and the Agent-link trust entry exists |
| **each of the three sections really renders the shared card (`local-trust-*`)** | the card is wired into both forms, not just present in source |
| **read shows the full digest, `deny`, untrusted, cleanup settled** | the card renders real facts, and the request carries the captured host/boot |
| **trust sends the captured digest + epoch 0, then the UI shows 已信任 and a second read happens** | command uses what the user saw; post-commit read-only refresh |
| **allow sends the refreshed epoch 1 (not 0) and the preset becomes allow** | epoch comes from the re-read, so the next CAS matches |
| **Agent link: read → trust → allow → enable** | first-time Agent-link enablement is possible; order is trust → allow → `setAgentEnabled`, and the enable command carries no permission field |
| **OneBot reuses the same card: allow → deny → revoke** | deny/revoke restore an explicit blocked state |
| **late review across a boot swap is discarded** | no old digest, no actionable buttons, the card returns to "not read" |
| **read failure shows the real error and no trusted state** | failures are not dressed up as success |
| **trust write failure shows the real error and stays untrusted** | same, for the write path |
| **preset write failure shows the real error and keeps the old preset** | a refused allow/deny is never rendered as applied |
| **same-tick: new boot accepted, then the old boot's deferred `saveSource` returns while the repair reread is still held** | the old world is never adopted — asserted on the DOM *before* the reread can mask it; the identity trace also never returns to the old boot |
| late `start` with the old host identity | does not replace the new host |
| Agent link uses the current connection | no free-text Agent ID |
| enable link carries captured revision + key version | existing CAS domain unchanged |
| no page errors | nothing threw during the whole flow |

Two mutations confirm the new checks are load-bearing:

| Mutation | Result |
| --- | --- |
| stop invalidating per-selector review tokens on boot change | late-review check fails (stale digest becomes visible again) |
| keep reviews but drop the token invalidation | late-review check fails |
| skip the post-commit read-only refresh | 5 checks fail — the next `allow` conflicts on the old epoch |
| `accept()` drops the synchronous `latest.current = next` and the ref is written during render again | the same-tick check fails: the stale boot is adopted while the repair reread is held |

**One mutation is not distinguishable and I am not pretending otherwise.** Removing the host-identity comparison in `stillOurs` does *not* turn the late-start test red, because the unconditional `reread()` after every action re-reads the real host-2 state and repairs the display. The fence and the reread are two independent protections; the test proves the *outcome* (interface shows host-2), not that either one alone is load-bearing. Making it distinguish one of them would require a test that observes intermediate state, which static render and this stub cannot do honestly.

## What this does NOT prove

- **No IPC, no Main, no Electron.** `LocalHostSection` is only exercised through its own types; `bridge` is `null` in production until Parent wires the real facade. Nothing here demonstrates a real host starting, a socket opening, or a credential reaching the host.
- **No real QQ account, no SnowLuma, no paid model.** Unchanged from the task's prohibition.
- **Static render for the card tests only.** `local-source-trust.test.tsx` asserts markup, `disabled` attributes and wording; click ordering and epoch refresh are covered by the browser probe above, not by the static tests.
- **Production UI clicks are covered by `qa/probes/companion-local-host-desktop.mjs`, not here.** That probe runs the packaged Main/preload/daemon and now authorizes all three managed sources by real DOM clicks inside `local-trust-{official|onebot-v11|agent-link}` (read → full digest → confirm trust → allow), with only read-only `reviewSource` used to verify the resulting epoch and preset. It has **not been executed** in this increment; the browser probe above is the executed evidence.
- **Late-response fencing now follows the M6 shape.** `run()`/`mutate()` take a per-operation `Symbol` token plus a captured `OperationOwner {hostId, bootId, protocol}`; the token is checked before adopting and again after the await. `accept()` refuses a lower `state.revision` for the same host identity, and a different `hostId:bootId` is treated as a different world rather than a newer revision — there is no global counter carried across a boot.
- **Four revision domains stay separate:** `state.revision` (host projection order), `view.sourcesRevision` (desired-enabled CAS), `source.configRevision` (source Config CAS), and `agentLink.revision` (link target/enabled CAS). Each command sends only its own domain's expected value.
- **Disabled states are described, not enforced end-to-end.** The form disables the key field when the target is unsaved, but only the host can actually refuse a write.

## Frozen test ids for the packaged-GUI probe

Scope by section, then use the card ids inside:

| Section | Container |
| --- | --- |
| official QQ | `[data-testid="local-source-form-official"]` |
| OneBot v11 | `[data-testid="local-source-form-onebot-v11"]` |
| Agent link | `[data-testid="local-agent-link-section"]` |
| card itself | `local-trust-official` / `local-trust-onebot-v11` / `local-trust-agent-link` |

Inside a section: `local-source-review`, `local-source-digest` (full 64-hex), `local-source-preset`, `local-source-trusted`, `local-source-cleanup`, `local-source-blocked`, `local-source-confirm-trust`, `local-source-revoke-trust`, `local-source-allow-permissions`, `local-source-deny-permissions`, `local-source-review-empty`, `local-source-trust-error`, `local-source-preset-readonly`, `local-source-preset-locked`.

`permissionEpoch` is intentionally **not** rendered: it is an internal CAS token, not a user decision. Probes must read the new epoch from the captured `confirmSourceTrust` / `setSourcePreset` arguments.

## Open items for Parent

1. Confirm `state.revision` is monotonic per host identity. The UI drops lower revisions only for the same `hostId:bootId`; across a boot it adopts unconditionally, which is the intended behaviour.
2. Confirm whether `stop()` must resolve only after native cleanup. The UI wording ("停止宿主会断开本机 QQ 连接") assumes it does; if it returns earlier, the wording needs to say "正在停止".
