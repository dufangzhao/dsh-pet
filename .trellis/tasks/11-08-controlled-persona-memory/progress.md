# Controlled persona/memory: final handoff

Status: implementation and selected-scope acceptance complete; pending final inventory/local commit approval, then Trellis archive and journal. Branch `feat/controlled-persona-memory`, base `feat/shared-desktop-agent-entry` at `cab4d79`. The broader Agent roadmap remains open for voice/platform work. Only this child is ready to close; unrelated tasks remain untouched.

## Delivered behavior

Existing core Config owns editable name/persona; SQLite v2 owns bounded active facts, memory/row revisions, origin, atomic receipt/event mutations and nonresurrecting replay. Profile uses Config CAS/readback without a cross-store command saga. Saved state and actual foreground application are separate facts. An explicitly disabled Harness stays disabled; ordinary edits preserve identity/history/work/connector/key.

Host-bound current-user admission preserves the M1 natural explicit request and ordinary no-key requests, with host-located verbatim evidence. Model semantic selection remains model-dependent, never owner-confirmed. Owner-form and current-turn paths are separate so remember does not stop itself. Forget removes active facts/context authority, not transcripts/logs/backups. New startup refuses silent v1 migration; the explicit locked upgrade verifies a complete backup before changing metadata/version. Original4120/data/credentials were not read, migrated or restarted.

## Executed checks

| Gate | Actual result |
| --- | --- |
| Initial `pnpm check`, `bash-7dd7a603539f45e2` | All types/package tests passed (desktop933/service49/text204); stopped at one old QA wrapper dropping the new profile argument. |
| Corrected QA and static checks | Wrapper forwards that argument, original lifecycle assertions retained; single case passed. `bash-4cb53391190140aa` rootQA139 passed/4 explicit-image skips, then lint identified3 unused browser-test comments. Parent removed only those comments. |
| BUILD0 `bash-57e8a432a0344f09` | Lint/format/full production build exit0. This completes the segmented root gate; the original command is not relabeled exit0. |
| Final service `8ce0f15275af495e` | 51/51 passed, including2 real Config precommit/postread-failure cases; no production changes for the QA wrapper. |
| Separate `bash-41d48e00976b4103` | Core4 plus real Docker/service18 with0 skips passed; no live upstream model. |
| Final frontend focused checks | Types/lint/format, text204, renderer54files600, actual component DOM20, rail DOM5 and actual App/client+controlledHTTP7 passed. These are not service E2E. |
| Final target build `bash-ca391612b4af4cca` | Lint/format/text-client+desktop build exit0. Parent verified six backend/service/Main/preload/worker/admission hashes unchanged from BUILD0; only expected UI artifacts changed. |

All parent jobs were collected. QA jobs and owned service/browser/Electron/Xvfb/container instances are closed. Private verified Electron RPATH/GTK/Xvfb tooling was reused without broadening the product worker environment; actual Linux evidence does not prove Windows devices/compositing or OS sandboxing.

## Actual acceptance and fixes

[The single QA report](../../../qa/fixtures/companion-persona-memory/acceptance.md) owns the A1–A8 to PRD C1–C8 mapping, exact safe artifact list, run hashes and limitations. Actual runs passed built-entry v1 upgrade/old-source exclusion/rollback/ABA, natural7 Core cases, real Docker work-result refusal, worker continuity, service restart/Harness persistence, production web/Electron forms, and actual HTTP committed-response loss/same-ID replay after correction/forget/recreate/restart. Final UI report `build1-ui-b76ad918-fd40-42ee-87f7-9dad1d853082.json` passed long names at880/1100, quiet disabled empty forms, keyboard/title behavior, actual desktop→web full-profile/application updates and dirty old-CAS409→explicit-rebase→new-CAS success. Pet bitmap/DOM transparency passed; its getter was honestly recorded as `#000000`.

Concrete product fixes retained: ledger lookup before new-admission quota; common wire ID grammar; nullable memory baseline0 handling; frozen forget/retry without losing an unrelated draft; per-operation release ownership across targets; truthful read failure and saved/applied labels; real profile detail-read owners; long-name rail sizing; validation independent from error display. Source-backed backend/frontend specs capture the final rules once. Native tool `TypeError` refusal is distinct from the host structured `permission-denied` boundary.

QA-only corrections are recorded separately: old harnessPorts signature, unused lint comments, old origin-label expectation, excessive test timeout, inactive-shell selector, background-color string expectation and saved-versus-applied timing assumption. None justified a product fallback. Historical reports keep their actual runner/build fingerprints and failure status.

## Ownership and remaining bookkeeping

- GPT e0fde1d1: shared/backend/state/Harness/API/Main/protocol/migration and backend specs; frozen.
- DeepSeek5b732855: single shared form, web/desktop integration, meaningful browser regressions and frontend specs; frozen.
- QA a23c750a: scoped probes/fixtures, authorized old seed/peer/wrapper updates, actual integration/evidence; frozen.
- Parent: PRD/context/review/gates, minimal lint cleanup, operator guide, final records. c9fa334f prepares exact commit inventory only.

[Operator guide](../../../docs/37-persona-and-memory.md), [contract](implementation-contract.md), [QA report](../../../qa/fixtures/companion-persona-memory/acceptance.md) and [commit plan](commit-plan.md) are the review entry points. Finish only with exact selected files; failed/intermediate diagnostics stay out of the work commits. No new model budget, account access, publication or trial-root migration is implied.
