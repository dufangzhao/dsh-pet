# Local QQ plugin host and remote Agent bridge

Status: planning; final proposal prepared for user review. Request recorded2026-11-13; independent-host lifetime selected2026-11-14. Product implementation has not started. The standing Trellis-record request covers this child task; final artifact approval is still required before task start.

## Goal

The user runs QQ adapters/SnowLuma and the desktop on their own PC, connects them to their continuing server Agent, and can quit the desktop GUI without losing QQ. Local sources keep platform credentials and native IO; the user still has one character, memory and set of ongoing work, without managing internal Sessions or another local Agent database.

## Background and evidence

[M6 acceptance](../../../qa/companion-qq-acceptance.md) established service-side protocol/media/State/delivery integration and a readonly desktop entry. It did not deliver the distributed local-plugin host now requested. [Source investigations](research/index.md) identify the reusable kernel, private-port/worker blockers and concrete authority/material/effect seams. [The design](design.md) owns proposed technical contracts, and [the ordered plan](implement.md) owns their proof and implementation sequence.

The project is [Windows-first](../../../docs/adr/0005-windows-first.md); existing controlled Linux Electron evidence is not Windows-device evidence. The codec is currently Linux-amd64 Docker. Original4120 data stays untouched; the separate development preview can be stopped at a verified safe boundary when its loaded code would be invalidated. No existing SnowLuma/AstrBot account change is authorized in this implementation phase.

## Requirements

- L1 — Preserve one server Agent, persona, scoped memory, State writer, task identity and cloud execution authority. A local source is an endpoint, not another brain.
- L2 — Both official-QQ and OneBot v11 adapters run under the local host. External SnowLuma is local where OneBot is selected. Platform secrets, native connections and private upload/download references stay with that host.
- L3 — Reuse the existing plugin lifecycle, reviewed trust, Config/CAS, credentials and task mechanisms. QQ remains ordinary removable/replaceable plugins; do not add another plugin standard or generic remote execution/HTTP dispatcher.
- L4 — Preserve M6 scope: private/group allowlists and aliases, observations/wake/proactive judgment, scoped facts and restricted own work, complete mandatory text with optional voice, image/voice/file transfer, worker binary inputs and result attachments. No text-only or OneBot-only shortcut.
- L5 — Authenticate and bind the local↔server connection to its real source/account/generations, task/stream ownership, exact retirement and actual native settlement. Serialized metadata cannot grant participant, management or device authority.
- L6 — Server policy/grants/admission, model purposes, task/material access and delivery claims/facts remain authoritative. Retain actual receipts and cleanup independently; do not replay accepted/unknown effects or retarget an already frozen attempt.
- L7 — Local source configuration, keys and enable/disable are reachable from the actual desktop production entry. Show local saved/applied/native state separately from host and Agent link. Preserve captured draft/secret CAS and target ownership rather than writing the old server slot under a local label.
- L8 — Loss of a local source must not terminate accepted cloud-eligible work or undo verified server custody of transferred bytes. Local-required effects are unavailable offline; participant authorization/cancellation remains independently enforced by the server.
- L9 — Provide a versioned usable local-client build with actual runtime/dependencies, startup/connection instructions and a controlled end-to-end entry. A source archive is not an installer, and an unpublished build is not a GitHub release.
- L10 — Complete controlled implementation acceptance before the later joint user trial. No real QQ login/business message, paid-model call or original4120 data change is included.
- L11 — User-selected behavior: QQ continues after explicit desktop-GUI exit. Provide an independent local host and a separate local stop/exit action. Hiding/removing a pet view is not stopping the host, and host stop does not cancel accepted cloud work.

## Acceptance criteria

- [ ] A1 (L1/L8) — In an actually executed supported controlled environment, fresh local host/desktop and remote Agent show the same Agent identity, committed facts and tasks, with no local Core or second State truth.
- [ ] A2 (L2/L3/L7) — Both ordinary QQ sources are locally configurable, enableable, revocable and removable through the real entry. Platform secrets do not enter server Config/State/events/model context or public projections.
- [ ] A3 (L4/L5/L6) — Controlled native private/group events from both protocols traverse the real authenticated bridge→State/Core→local native publication, including complete text and selected media/optional voice with actual byte/hash/receipt evidence.
- [ ] A4 (L4/L8) — Local image/file/voice uses the bounded authorized byteplane and server raw-custody cut before codec/ASR, then becomes ready scoped material for model/worker/result paths. No premature ready reference, notice stub, remote path or transfer ID substitutes for the actual content/effect.
- [ ] A5 (L5/L6) — Trust/permission/Agent/account changes and dropped preparation/dispatch cannot lend old work replacement authority. Lost native acknowledgments remain once-only; exact cleanup/late-fact evidence releases only the corresponding hold so new independent messages can proceed.
- [ ] A6 (L1/L8) — Cloud work completes with its original task/audience after local disconnect/stop. Offline reply behavior follows the retained rule below; a missing device does not create another Agent or claim a local effect.
- [ ] A7 (L7) — Actual desktop fields write local Config/keys, while server policy writes remain server-owned. Independent boot/connection/config/key revisions withstand delayed responses, partial saves and GUI/host restart.
- [ ] A8 (L9/L10) — Build a complete Windows-x64 portable preview with correct target runtime/dependencies and independent package-path validation. Controlled integration/native tests pass on targets actually executed. Actual Windows-device/account/paid joint checks are explicitly pending, not inferred from Linux or mocks.
- [ ] A9 (L11) — Actually exit the GUI while a controlled QQ source runs, observe the independent host continuing, reopen and attach without duplicate host/source. Explicit host stop works with the server offline, waits actual local cleanup and leaves cloud identity/work intact.
- [ ] A10 (L1/L6) — Fresh State4 and stopped migration from each supported older format preserve IDs, timestamps, scopes, legacy fingerprints and receipts. Recovery does not replay historical IO; private remote binding and same-attempt fact enrichment cannot reopen execution.

## Final-review scope and defaults

The lifecycle decision is resolved by L11. The following concrete first-preview limits preserve the existing selected behavior and are presented for approval with the full plan:

- One active local host per Agent and one source instance per QQ protocol; no automatic multi-device takeover/routing.
- Windows-x64 portable application, with GUI/host/runtime/plugins and version stamps. Installer/signing/public release and OS-autostart setup are outside this increment.
- Local source/host management in the desktop; server policy/judge/delivery keeps the current Web-first flow. Foreground/ASR/TTS/codec/cloud work stays server-side, without requiring a new local Docker codec.
- The GUI and daemon use separate purpose-bound links to the same Agent. V1 reuses the current trusted-owner Agent bearer; it does not claim independent device credential isolation.
- The daemon owns its temporary Agent/QQ key slots independently of GUI exit. Host restart requires keys again unless a separately verified existing secure-storage path is selected; no new plaintext key persistence/import.
- Retain M6 offline semantics: unattempted unavailable replies are blocked with output retained in State; accepted/unknown attempts never automatically resend. No offline command outbox.

## Out of scope

New platforms or QQ-login code; copied/bundled SnowLuma/AstrBot; automatic installation/login/credential import; another Agent/Harness or local conversation/State database; general file sync, shell/network/capability RPC, multi-tenant cloud or unrequested Live2D/full-duplex work. No automatic production deployment, push, public publication, original-data migration or live-account/paid test.

## Planning gate

No blocking product question remains beyond approving or amending the full proposal above. Repository-answerable unknowns have source-backed research and explicit G0 proofs; failure there returns to design without changing the selected behavior. All acceptance boxes remain unpassed until implementation evidence exists.
