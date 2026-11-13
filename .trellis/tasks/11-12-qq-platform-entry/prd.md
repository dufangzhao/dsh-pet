# Pluggable QQ platform entry

Status: implementation approved by the user2026-11-13 and task activated. The reviewed scope below is authorized; real account connections, message sends and paid-model trials still require their separately specified scope. [Parent roadmap](../11-06-unified-companion-architecture/prd.md) owns the continuing-Agent goal; [M5](../archive/2026-11/11-11-shared-speech-output/prd.md) is completed and its one-shot live TTS authorization is consumed.

## Goal and value

Make QQ an independently managed entry to the same durable personal Agent: one identity/personality and shared state, multiple authorized people and groups, correctly scoped context/work, and complete text plus selected media. Users interact with the Agent and logical tasks, not internal Harness Sessions.

## Evidence baseline

- [Runtime entry study](research/runtime-entry.md): current commands are text-only/operator-authorized; full input provenance, audience/task ownership and delivery facts are missing. Existing kernel/source/credential/task mechanisms remain the foundation.
- [Runtime media study](research/runtime-media.md): Cortico supports image parts, but this application's current input/projection does not. M4 ASR and M5 streaming synthesis require bounded attachment import/export adaptation; the extra judge needs an independent purpose binding.
- [AstrBot GitHub study](research/astrbot-qq.md): pinned adapter, actor/session/permission and lifecycle mechanics, with license and actual send-result differences. [Protocol/media study](research/qq-media.md) records current official APIs, limits/conflicts and OneBot extension gaps.
- [Platform comparison](research/platform-options.md), [existing SnowLuma lead](research/onebot-environment.md) and [Web-first UI plan](research/ui-plan.md) are supporting evidence. Source code establishes mechanics, not the user's permission choices.

## Requirements and confirmed decisions

- **Q1 — both protocols.** User selected QQ2026-11-12 and then selected both official QQ WebSocket and OneBot v11 for the first release. Each protocol is a selectable, replaceable module connecting to the same Agent. AstrBot is a design/protocol reference, not a second runtime.
- **Q2 — real plugin lifecycle.** Reuse PluginManager, Config/CAS, TaskSupervisor, PermissionKernel, CredentialBroker and the State owner. Disable/removal/configuration changes close owned ingress/egress. Add no general platform framework without a concrete contract need.
- **Q3 — durable provenance.** Persist platform/account/sender/audience/reply association with accepted input and preserve complete output/task origins. Do not send the latest global reply to the last QQ sender. Keep desktop/Web/ASR/Pet behavior within its correct audience.
- **Q4 — truthful delivery.** Distinguish canonical admission, inference/work, upload, send attempt, platform acceptance, partial result and unknown outcome. A message ID or HTTP success is not a human read/hearing receipt. No automatic duplicate sending or cross-protocol resend after an unknown outcome.
- **Q5 — explicit external authority.** Study public code without copying private accounts/configuration/keys or adding another runtime. Actual login, supplied credentials and real recipients require specific authorization. Protocol implementation must respect upstream licenses.
- **Q6 — preserve existing environment.** Keep original4120 stopped and original data/tokens unchanged during this task. Do not borrow DSH/AstrBot/model/ASR/TTS credentials; M5's consumed live authorization cannot be reused.
- **Q7 — audience.** User selected whitelisted multiple private-chat users and selected groups. Empty allowlists admit nobody. A permitted group does not make its members administrators.
- **Q8 — member actions.** Ordinary admitted members may use restricted tools and create/view/stop their own work using currently visible materials. Global configuration and cross-user management belong to the owner or explicitly authorized administrators. Each input carries its own authority; no inheritance from a previous privileged speaker.
- **Q9 — visibility.** Private context is partitioned by person, group context by group; explicitly public facts may be shared. Keep one personality and State rather than per-platform brains. Private conversations must not enter another person's/group's model context. The owner retains global management authority.
- **Q10 — group participation.** Retain recent group context; configured wake words and @ can trigger replies. Also provide optional proactive participation with user-configurable wake words, enablement, frequency/cooldown, probability/mechanism and related settings. Non-triggering observation is not a tool command or a long-term-memory grant.
- **Q11 — optional model judgment.** Both rule/probability gating and model-assisted participation judgment are selected for the first release. Judgment uses an explicitly configured Magpie model and call budget, separate from actual reply generation and action authority. Model failure must not silently switch to another model/mode.
- **Q12 — all four content types.** Text, images, voice and files are all first-release scope, including applicable download/upload, model capability and real format handling. Each needs separate acceptance. Internal implementation stages must not silently downgrade this to a text-only release. Platform limits and unsupported operations remain explicit.
- **Q13 — existing environment lead.** User believes AstrBot connects to an already deployed SnowLuma; exact version/endpoints/operation are not verified. Prefer investigating its compatibility without reading private configuration, reusing tokens, replacing it or installing a mirror. Repository-removal attribution is unverified and does not remove the OneBot requirement.
- **Q14 — management surface.** The service Web provides full QQ management. Desktop shows status and an entry link. Config/state retain one service owner; ordinary QQ participants have no management API access. The desktop link carries no operator secret in its URL.
- **Q15 — long-term memory writes.** Only owner/explicit administrators may create/change/delete/publish long-term facts. Ordinary members can use permitted context and existing visible memory but cannot mutate long-term facts, including their own-scope facts. Chat-context recording is distinct from fact mutation.
- **Q16 — text always present.** Every reply retains text. Voice is a separately enabled additional output, never a voice-only replacement. Preserve complete textual results and truthful media/part outcomes under actual delivery constraints.

## First-release boundary

The release includes both ordinary protocol modules, participant/audience provenance and grants, required State/Harness changes, four content types, independent participation judgment, Web management, desktop status/entry, lifecycle cleanup and evidence.

The following are not implicit additions: QQ client login/reverse-engineering, automatic account creation/QR onboarding, installing/replacing the existing gateway, arbitrary platform access, additional messaging platforms, multiple instances of the same protocol source, video messaging/generation, or a new generic Agent/Session/permission framework. Existing service per-plugin default instances remain the starting point; the two protocol modules do not imply arbitrary multi-account support.

Reply strategy, context/resource bounds, connection/codec/credential bindings and compatibility behavior must be concrete in design. User-adjustable mechanisms are not an excuse for unspecified behavior. Safe defaults and platform limitations must appear in the final review.

## Observable acceptance criteria

- [ ] **A1 Source independence (Q1–2):** both modules can be configured/enabled/disabled independently; inactive/unconfigured modules perform no account work. Retiring one closes its real resources and does not stop the continuing Agent or unrelated work.
- [ ] **A2 Admission/provenance (Q3, Q7):** accepted and duplicate events retain stable origin; changed-payload duplicate conflicts; account/user/group IDs are not guessed or merged by nickname/text/time. Disallowed events do not become model inputs or persistent authorized work.
- [ ] **A3 Context isolation (Q8–9):** two private users and two groups cannot see each other's private data. Mixed actors/grants/routes are not combined into an ambiguous model output. Changing a system prefix alone is not counted as removal of previous model history.
- [ ] **A4 Action ownership (Q8):** members can act on their own authorized tasks/materials, not others'; downgrade/revoke/alias changes fence stale authority. Group rank, quoted text and forged fields cannot elevate the input. Background work retains its originating actor/audience/logical reply route.
- [ ] **A5 Memory authority (Q9, Q15):** only administrator-origin actions mutate scoped/public facts, with existing explicit-intent/CAS rules. Old personal state migrates to owner-private scope without exposing it to new members or losing identity/history/work.
- [ ] **A6 Media integrity (Q12, Q16):** both protocol paths handle text/image/voice/file through bounded owned materials, actual format validation and audience-aware export. No raw PCM renamed as QQ audio, remote path read as a local file, arbitrary URL fetch or media success without a verified result.
- [ ] **A7 Model purpose (Q11–12):** image input reaches a compatible model through real media resolution; ASR/TTS use correct sources/formats. Changing/cancelling the tool-free participation judge does not retire the primary conversation model or grant tool authority.
- [ ] **A8 Configurable participation (Q10–11):** wake words/@, rule/probability and optional model judgment behave according to saved/applied configuration and budgets. Own/known-machine echoes do not cause feedback loops. Ordinary observation alone performs no privileged action.
- [ ] **A9 Delivery facts (Q4, Q16):** every formal reply has an authorized target and mandatory text. Optional voice/media can be separately partial/failed; accepted/failed/unknown is preserved per attempt/part. Whole batches are not blindly replayed after a partial/unknown send.
- [ ] **A10 Lifecycle/recovery (Q2–4):** config/key/source/connection changes reject late old-target callbacks, await actual I/O/lease cleanup and retain uncertainty where appropriate. Reconnect and recovery do not duplicate accepted work or confirmed/unknown external sends.
- [ ] **A11 Management truth (Q14):** Web controls actual source/CAS/binding/permissions/media, preserve drafts and label saved/applied/connected/accepted/unknown correctly; desktop state/link reflects the same service. No secret echo or token-bearing navigation.
- [ ] **A12 Verification/handoff (Q5–6):** controlled protocol, State/Harness/authority, media, real DOM and relevant regression gates pass. Each real-account/model test is separately bounded and authorized; unavailable materials remain explicit pending evidence, never fabricated integration success. Trellis/spec/operator records complete the stage.

## External material and researched limitations

No product-selection question remains from the recorded decisions. The actual SnowLuma version, configured connection mode, credentials and permitted real test users/groups are still later integration material; they are not permission to inspect an existing account. Development can use controlled endpoints, while real-account acceptance remains pending until those materials and authorization exist.

Official documentation has unresolved details/conflicts about some media formats, passive windows and maximum text/audio presentation. OneBot ordinary files depend on implementation extensions. The design/test plan must state validated facts, application budgets and unverified compatibility separately; it cannot replace a selected feature with a guessed capability or hidden fallback.

The design, execution plan and both19-entry context manifests were reviewed/validated; the complete summary received explicit user approval2026-11-13 and task activation succeeded. Material changes to the approved behavior require a renewed planning review; routine implementation choices do not.
