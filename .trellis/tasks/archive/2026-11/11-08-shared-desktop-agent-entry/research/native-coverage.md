# Shared desktop acceptance evidence matrix

This matrix combines separate scoped runs and deterministic regressions; it is not a claim of one `--full` execution. Parent reports BUILD0 root `pnpm check` exit 0 and BUILD1 desktop-only build exit 0 after the narrow sidebar fix. All native runs used actual Linux Electron45, production Main/preload/views, isolated loopback scripted services and the privately patched QA Electron; work used the pre-existing Docker image. No real model or original port 4120 was contacted.

| PRD | Final evidence and assessment |
| --- | --- |
| D1: shared identity and sends | **Covered by combined native evidence.** [Business](../../../../../../qa/fixtures/companion-desktop/evidence/b371ae95-business-results.json) exercised real pet, console and web sends once each and correlated service/desktop message IDs. [Wire](../../../../../../qa/fixtures/companion-desktop/evidence/wire-e689cb86-results.json) independently observed the actual browser's own snapshot response and matched its agent, message and input IDs with the service and both desktop projections; web and console rendered the unique text. Browser task/artifact IDs were not separately sampled. |
| D2: independent work and artifact | **Covered by combined native evidence.** Business observed real Docker work running at desktop exit, service completion and same task/artifact recovery after fresh-token restart. The separate [native chooser](../../../../../../qa/fixtures/companion-desktop/evidence/b937ea94-chooser-results.json) run verified authenticated artifact bytes and actual GTK save/cancel. These are separate runs; the chooser was not repeated on the business run's recovered artifact. |
| D3: failures, stale target and retry | **Covered across native and deterministic protocol/controller/renderer layers.** [DOM](../../../../../../qa/fixtures/companion-desktop/evidence/dom-results.json) exercised bad auth, CAS and an actual in-flight A→B switch; [preservation](../../../../../../qa/fixtures/companion-desktop/evidence/preservation-results.json) exercised real SSE loss, retained confirmation and manual reconnect. [Backend review](backend-review.md#follow-up-after-the-nine-point-fix) identifies gated HTTP/source/controller regressions for stale SSE and receipts; text-client and renderer tests cover malformed/bounded responses, same-ID retry and old-handler/local-read timing. These controlled timings were not claimed as individual native runs. |
| D4: stop scopes | **Selected task covered natively; foreground semantics covered at service/test layer.** Business physically stopped only the selected Docker task while the other continued. [Foreground regression source](../../../../../../qa/probes/companion-service-recovery.test.mjs#L541) checks a foreground stop against independent work; the model was not invoked for this native stage. Windows audio/playback devices are outside this Linux result. |
| D5: preserve data and reject legacy | **Covered for the lawful Linux composition.** [Preservation](../../../../../../qa/fixtures/companion-desktop/evidence/preservation-results.json) seeded synthetic history and persona through actual FileConfigStore formats and synthetic opaque vault bytes through FileCiphertextStore, then compared each file byte-for-byte after real shared startup/connection/exit; old history/persona did not become service identity/content and named legacy roles were not active. The synthetic vault payload is not claimed decryptable. [Host policy/allowlist tests](../../../../../../apps/desktop/src/main/shared-companion-host.test.ts#L124) supplement this. |
| D6: source, credentials and drain | **Covered across native and deterministic host/file/HTTP layers.** [Source lifecycle](../../../../../../qa/fixtures/companion-desktop/evidence/source-lifecycle-results.json) observed actual source disable/re-enable/trust revoke, SSE closure and stale-send denial. DOM used actual generic Config CAS. Preservation scanned 62 regular files of its own desktop profile for generated-token raw/URL/base64/JSON forms, finding none. The backend review references deterministic credential settlement, target-generation and real rename race tests; not every such race was repeated in Electron. |
| D7: native platform and usability | **Linux text composition covered; Windows device boundary below remains.** [Baseline](../../../../../../qa/fixtures/companion-desktop/evidence/baseline-results.json) established linux-x64, two real file windows, fixed bridges and real source admission; [BUILD1 visual](../../../../../../qa/fixtures/companion-desktop/evidence/038fb5fe-visual-results.json) corrected the [BUILD0 sidebar defect](../../../../../../qa/fixtures/companion-desktop/evidence/0c3ca455-sidebar-results.json), checked minimum/wide geometry, focus, actual activation, model dialog and unchanged pet CSS/bitmap alpha. Native chooser and parent's root gate provide additional evidence. The actual `getBackgroundColor()` result is `#000000`; captured corner alpha was 0. |

Windows-only profile/page/avatar/audio admission, device behavior, native pointer/topmost/DPI and desktop compositing remain unverified on a real Windows runner. Xvfb without a compositor and Electron `--no-sandbox` do not establish those Windows or OS-sandbox properties.

## Run and cleanup boundaries

BUILD0 baseline, DOM, business, source and chooser evidence retains its own build identity; only BUILD1 visual and wire/preservation checks used the later renderer. Business initially failed due to a QA locator counting a scripted assistant echo as a user row; after cleanup it was corrected and the subset passed. Its exact passing runner hash was not captured and is not reconstructed. The chooser initially lacked private GSettings resources; a diagnostic required stopping its verified owned Electron group, and an early save attempt required a verified native Escape during cleanup. Subsequent chooser save/cancel passed with a separate isolated HOME. Preservation's first attempt used an overstrict QA timestamp equality despite an intervening valid snapshot; after cleanup the nondecreasing-confirmation assertion passed. The reports retain per-run exit, hashes and cleanup facts.

Original host HOME-listing screenshots and unnecessary diagnostic images/JSON were moved without deletion into ignored private evidence; they are not public links. No old profile or credential file was opened. No QA job remains running. A final process check found only the pre-existing unrelated Xvfb `:1`; Docker showed only a pre-existing unrelated container. The user-facing [acceptance entry](../../../../../../qa/companion-desktop-acceptance.md) is the principal QA summary. There is no implemented one-shot `--full` pass, and product source/build files were not changed by QA.

## Reviewed public QA file inventory

The following exact files are the intended safe QA/research set; ignored private tooling and diagnostics are excluded. Parent controls staging and commit.

```text
qa/companion-desktop-acceptance.md
qa/probes/companion-desktop-native.mjs
qa/probes/companion-desktop-work.mjs
qa/probes/companion-desktop-source.mjs
qa/probes/companion-desktop-visual.mjs
qa/probes/companion-desktop-chooser.mjs
qa/probes/companion-desktop-preservation.mjs
qa/probes/companion-desktop-wire.mjs
qa/fixtures/companion-desktop/connection-dom.mjs
qa/fixtures/companion-desktop/display.mjs
qa/fixtures/companion-desktop/fault-proxy.mjs
qa/fixtures/companion-desktop/lifecycle.mjs
qa/fixtures/companion-desktop/native-chooser.mjs
qa/fixtures/companion-desktop/service.mjs
qa/fixtures/companion-desktop/target-dom.mjs
qa/fixtures/companion-desktop/visuals.mjs
qa/fixtures/companion-desktop/evidence/baseline-results.json
qa/fixtures/companion-desktop/evidence/dom-results.json
qa/fixtures/companion-desktop/evidence/b371ae95-business-results.json
qa/fixtures/companion-desktop/evidence/b371ae95-shared-conversation.png
qa/fixtures/companion-desktop/evidence/b371ae95-shared-pet.png
qa/fixtures/companion-desktop/evidence/b371ae95-recovered-task.png
qa/fixtures/companion-desktop/evidence/source-lifecycle-results.json
qa/fixtures/companion-desktop/evidence/preservation-results.json
qa/fixtures/companion-desktop/evidence/wire-e689cb86-results.json
qa/fixtures/companion-desktop/evidence/wire-e689cb86.png
qa/fixtures/companion-desktop/evidence/b937ea94-chooser-results.json
qa/fixtures/companion-desktop/evidence/b937ea94-chooser-before-input.png
qa/fixtures/companion-desktop/evidence/b937ea94-chooser-path-entered.png
qa/fixtures/companion-desktop/evidence/b937ea94-chooser-after-save-click.png
qa/fixtures/companion-desktop/evidence/2e1bdea1-visual-results.json
qa/fixtures/companion-desktop/evidence/2e1bdea1-model-minimum-window.png
qa/fixtures/companion-desktop/evidence/0c3ca455-sidebar-results.json
qa/fixtures/companion-desktop/evidence/0c3ca455-minimum-sidebar.png
qa/fixtures/companion-desktop/evidence/038fb5fe-visual-results.json
qa/fixtures/companion-desktop/evidence/038fb5fe-minimum-sidebar.png
qa/fixtures/companion-desktop/evidence/038fb5fe-wide-sidebar.png
qa/fixtures/companion-desktop/evidence/038fb5fe-model-minimum-window.png
.trellis/tasks/archive/2026-11/11-08-shared-desktop-agent-entry/research/backend-review.md
.trellis/tasks/archive/2026-11/11-08-shared-desktop-agent-entry/research/native-acceptance-plan.md
.trellis/tasks/archive/2026-11/11-08-shared-desktop-agent-entry/research/native-coverage.md
```
