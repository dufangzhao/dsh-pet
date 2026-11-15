# QQ management and material-view contracts

## 1. Scope / trigger

Use when changing QQ configuration, identity lists, judgment drafts/secrets, scoped facts, readonly desktop status or complete material views. The [backend QQ contract](../backend/qq-platform-entry.md) owns authority, native IO and persistence; this document owns the client interaction. Reuse the existing client reader, form helpers and UI kit.

## 2. Signatures

- [CompanionClient](../../../plugins/text-client/src/client/client.ts) exposes `readQQ(expectedConnectionId)`, QQ save/credential methods and delivery readers with the captured connection ID. A stale ID returns `stale-owner` before selecting a transport or dispatching HTTP.
- [QQPanel](../../../plugins/text-client/src/client/qq-panel.tsx) receives `view`, `transport` and `onView`; the existing App owns the current server view. A successful authoritative reread is published to that owner, including after a partially failed command.
- [Form transitions](../../../plugins/text-client/src/client/qq-form.ts) include `followView`, `policySaveCommand(form,view)`, `judgeSaveCommand(form)`, `adoptJudge`, `failJudge`, `rebaseOnView` and `judgeSecretValid`. Do not duplicate these transitions in components.
- [Material transport](../../../plugins/text-client/src/client/material-transport.ts) reads authenticated raw bytes by canonical ID. [MessageMaterials](../../../plugins/text-client/src/client/message-materials.tsx) renders full-text and download actions; its operation belongs to the current connection/material owner.
- Desktop uses the existing shared snapshot `qq?:QQStatus` and the fixed `openWeb({connectionId})` bridge. The renderer supplies no URL or service token to that action.

## 3. Contracts

### One server view, distinct editing domains

Saved configuration, applied revision and actual connection phase are independent server facts. A save or a nonempty secret does not mean connected. Source settings must expose actual selected fields, including OneBot host/port/path; a reverse address describes saved configuration and never contains a token.

A reread updates App's existing QQ view, not a second panel-owned copy. Idle clean drafts may follow it. Dirty drafts retain their user edits and captured CAS until an explicit recovery action. Late command responses must not directly replace a newer server view or another source's draft.

The policy editor and judge editor own distinct portions of the composed settings. A judge draft captures **both** policy and provider Config revisions together. Editing allowlists does not own a hidden old judge subset: policy follow/rebase/submit preserves the current saved judge settings while retaining visible policy edits. A successful judge save adopts only that editing domain; unrelated dirty allowlist/group edits remain.

### Secrets and connection lifetime

A secret has its own captured owner and CAS baseline even when the nonsecret form is clean. `JudgeSecretDraft` binds the selected provider, saved connection target/auth, Config and credential versions and client connection generation. A later view for B cannot provide fresh B CAS for a typed A secret. Unsaved target edits disable key writes until the connection is saved. Key input stays in component memory and is cleared/invalidated when its owner changes or it is dispatched.

The client connection generation changes on reconnect, including reconnects to the same endpoint/Agent/State epoch. Component fences compare against the **latest** owner and operation identity, not two values captured by the same old closure. Before-dispatch fencing selects the captured transport; after-await fencing rejects stale state or download side effects. Owner change resets that owner's busy/error/expanded state so an ignored A completion cannot leave B permanently disabled. Unmount/close also prevents late downloads.

React's reserved `key` is component identity, never a regular secret/form prop. Pass ordinary props such as `secretValue` for data.

### Exact identities and visible materials

Policy list replacement is scoped by all `QQAccountRef` fields. Updating A preserves B even when the same sender/group number appears under both accounts. Actor aliases include scene/sender and group where applicable. Lists, group overrides and fact rows use complete tuple keys; fact identity includes audience and fact key.

Comma/word inputs preserve raw typing until explicit parse/apply. Do not trim/filter/join the controlled value on every keystroke or silently truncate an over-limit list. The group editor is shared by defaults and overrides and exposes the real window, wake, mention, probability, cooldown and reply budget settings. Sampling applies before either proactive mode.

Owner memory management can explicitly create public facts/copies without removing the original scope. Omitted audience retains the old default payload/fingerprint. Management readability is not Pet playback eligibility.

A `text-document` explanation is not its body. Read actual UTF-8 material bytes for full text, with the shared64KiB cap; downloads use the shared32MiB cap. Check declared length and count each received chunk **before retaining it**. Reject/cancel immediately at the bound, even without Content-Length. Error responses and over-limit declared bodies are cancelled too. Token is header-only; canonical IDs are URL encoded, not treated as paths. SILK downloads do not claim browser playback.

## 4. Validation & error matrix

| Condition | Required client behavior |
| --- | --- |
| Older connection/source/op completes | No state adoption, no write through a replacement transport, no download side effect |
| Dirty judge, external policy-only update | Preserve the original two CAS baselines; require explicit review rather than overwrite the new budget |
| Typed A secret, clean view follows B | Invalidate secret; zero credential writes to B |
| Config half saved, policy CAS conflicts | Say not all steps were confirmed; reread actual saved state, preserve draft and reachable recovery; never claim zero writes |
| Required view/read is absent or malformed | Explicit unavailable/error; no connected/applied guess or empty-success content |
| List exceeds canonical limits | Show invalid input; preserve raw draft, no silent slice |
| Body exceeds actual byte cap | Cancel promptly and return quota failure, no truncated full text |
| No QQ status from an old service | Hide the optional desktop card or state absence accurately; no invented readiness |

## 5. Good / base / bad cases

- **Base:** both QQ sources are disabled, allowlists empty, and owner text management remains usable.
- **Good:** edit A's allowlist while B has the same sender/group number; B remains unchanged after real HTTP save/readback.
- **Good:** save a judgment connection, then write its key in the same open panel using the new accepted baseline; a later external retarget invalidates an already typed key.
- **Good:** A material read is held while the connection changes to B; B can start its own read immediately and A can neither replace its text nor trigger a download.
- **Bad:** borrow the latest view's CAS for old secret/draft fields, use a React reserved prop as data, compare an old closure's owner to itself, or allocate the entire response before checking a byte cap.

## 6. Required evidence

- [Independent UI canary](../../../qa/companion-qq-review-ui-5519.test.mjs): real React writable-key rendering, coupled CAS, independent editing domains, stale-source completion, typed-secret retarget and bounded streaming. It is a targeted regression, not real QQ acceptance.
- [Real service DOM](../../../plugins/text-client/tests/browser/qq-service.browser.mjs): actual save/refetch/conflict/recovery, complete source controls and public/private same-key facts.
- [Real material DOM](../../../plugins/text-client/tests/browser/qq-materials.browser.mjs): use an actual service-issued owner grant fixture, click full text and compare it with the stored body rather than the notice; compare downloaded binary SHA.
- [Desktop readonly DOM](../../../apps/desktop/tests/browser/qq-status.browser.mjs) and [production Electron probe](../../../qa/probes/companion-qq-desktop.mjs): fixed bridge/current connection and readonly source facts. The probe's shell spy verifies the exact opener call, not the operating system browser.
- Keep checks of duplicate React tuple keys source-backed unless an actual reconciliation/mutation scenario proves the behavior; static markup alone does not prove key identity.

## 7. Wrong vs correct

Wrong: key input is a bare string while `followView` refreshes its Config/credential versions. Correct: the key owns a captured target/version tuple; a new view cannot lend it another target's authority.

Wrong: `oldTransport.connectionId === oldConnectionId` is treated as a late-response fence. Correct: compare the captured owner/operation to the latest ref and require the client's expected-connection check before selecting any transport.
