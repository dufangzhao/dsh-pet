# Original-controls final integration handoff

Task `in_progress`, branch `feat/original-start-controls`, goal revision 3 active. Integration is complete and frozen; parent owns final review/local commit/archive/goal. No frontend/main/contracts/harness edits by integration, no paid/live account calls or additional agents.

## Accepted evidence

- [Base native report](../../../qa/screenshots/original-controls/start-lab-1793296307496-9b1e65c4/acceptance-report.json): PASS 10/10, 27 screenshots, source digest `1c00dc6a50142d52c312ec00fd6733e61d2076d6d8495781c3490e29f12f62e8`, three clean exits 0/signal null/forced false, no renderer errors/remote origins. Parent collected QA jobs.
- Workspace gate `bash-df91ff8735dc4006` collected exit 0. [Complete output](../../../qa/screenshots/original-controls/start-lab-1793296307496-9b1e65c4/workspace-check.log): desktop 523/52 files; contracts 302, SDK 100, host 207, contract-tests 286, llm-provider 13, agent-cortico 1; QA 120 passed/1 skipped/0 failed; types/lint/format/build passed. This gate preceded the isolated CSS/probe delta. No later broad gate/build was started by integration.
- [Final steady delta](../../../qa/screenshots/original-controls/collapsed-1793300116862-5ff40377/acceptance-report.json): PASS, source digest `a4909a9eb71aeb7f5c492bc01b26fcda7d95e6230cacc28751da0f5fd0274297`, 6 screenshots, one clean exit, no errors/remote origins. At 1200×800/880×600 the rail settled to 72px; all three theme modes work by pointer/keyboard with fully visible labels/hitboxes/2px focus+2px offset. A also reported 43 focused tests+format pass. The earlier nonsteady passed delta is preserved but does not own final closure.
- [Independent visual followup PASS](research/visual-review.md): original component vocabulary confirmed, avatar/narrow-scene blockers closed, no P1/P2. Provider-name wrapping is optional refinement.
- [Merged source evidence](../../../qa/screenshots/original-controls/start-lab-1793296307496-9b1e65c4/integration-evidence.json) verifies all 47 current fingerprints; only probe and settings-shell CSS differ from base. Combined fingerprint digest `1b5fa316313c277f137d9b6c05cc3c00156982128a06f422985b8003e978cc4a`.

## Deliverables and cleanup

Canonical docs: [review](../../../qa/original-controls-review.md), [guide](../../../docs/34-plugin-pet-guide.md), [QA status](../../../qa/plugin-application-status.md), [skill validation](../../../qa/replica-redesign-skill-results.md), this progress file. Skill validation passed; no new independent forward-test claim.

Derived real-window comparisons: [light](../../../qa/screenshots/original-controls/start-lab-1793296307496-9b1e65c4/overview-light.png), [dark](../../../qa/screenshots/original-controls/start-lab-1793296307496-9b1e65c4/overview-dark.png), [before/current normal+boards](../../../qa/screenshots/original-controls/start-lab-1793296307496-9b1e65c4/original-controls-before-after.png), with [source manifest](../../../qa/screenshots/original-controls/start-lab-1793296307496-9b1e65c4/comparison-manifest.json). Representative base/delta light/dark/minimum images were inspected.

[Published CAS cleanup audit](../../../qa/screenshots/original-controls/start-lab-1793296307496-9b1e65c4/failed-capture-cleanup.json): exactly 57 failed-run PNGs removed (4,971,440 bytes), six failed reports retained, zero failed PNGs remain in the six allowed run directories. All 44 checked retained images unchanged, including base/final/superseded accepted evidence, derived comparisons and key predecessor images.

All product owners and QA are frozen. Root owns the independent review-open job `bash-31c9e28a6fdd444a`; it is intentionally running for the user and is not an unclosed QA job. Only parent final review/commit/archive/goal actions remain.
