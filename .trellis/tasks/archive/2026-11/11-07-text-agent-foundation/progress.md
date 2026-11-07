# Text foundation — implementation and acceptance complete

The user approved implementation on2026-11-07. Branch: `feat/text-agent-foundation`, base `500aeba`. Engineering work and PRD A1–A9 verification are complete. The user approved the exact three local work commits plus child archive/journal on2026-11-08. The approved work commits are `1a7b082`, `8fc76f7` and `9d86962`. The child is `completed` and archived under `.trellis/tasks/archive/2026-11/11-07-text-agent-foundation`; the parent remains `planning`. No push, public deployment or paid model calls are authorized or performed.

## Delivered

- Browser-safe companion contracts; independent Node service; reusable companion runtime using the existing PluginManager, TaskSupervisor, PermissionKernel and ConfigService/FileConfigStore.
- Ordinary SQLite state, Docker execution, real Cortico and text-client plugins; a distinct deterministic Harness fixture.
- Independent task admission with durable correlation, exact cancellation/settlement, stable identity/explicit facts, authenticated HTTP/SSE/artifacts, source-scoped model transport, and safe-boundary reconstruction/switching.
- Durable execution/container records and exact-owner/mount reconciliation after SIGKILL, without replaying code. Unknown-to-unknown recovery preserves verified partial files and exit evidence.
- DeepSeek UI with strict DTO guards, token only in memory/header,20s JSON request timeout,45s byte/heartbeat watchdog, true offline/unknown state, target stop, artifact download and usable390px layout.
- Human-readable scripted replies keep machine receipts/model-only event instructions out of ordinary chat while preserving internal attribution.
- Operator guide/deployment templates, executable Trellis spec, reproducible probes, final screenshots and QA report. Old desktop source behavior/data preserved; only portable test fixtures and a generated bundle digest changed in its area.

## Final evidence

Authoritative overview: `qa/companion-acceptance.md`; operation: `docs/35-text-agent-foundation.md`; concrete code contracts: `.trellis/spec/backend/companion-service.md`.

- **Final `pnpm check` exit0**, including all workspace typechecks/tests, root QA, ESLint, format, service build and desktop build. Job `bash-c0db5a50a83a4c50` collected. Existing Vite large-chunk warning is not a failure.
- Service protocol/recovery14/14 real HTTP/Core/SQLite/Docker scenarios plus lifecycle4/4; no failures. Covers inputB+receipt before onIdle with real independent Docker work, admission/stop races, persistence fault/retry, pending_restart exclusion, running/exited SIGKILL recovery, no append replay or cursor churn, stored configuration/disables and state-authority restoration.
- Cloud execution15/15 real Docker; state15/15; source authority10/10; model transport9/9; Harness8/8; real Core gate4/4; client68/68.
- **Final delivered-version browser22/22**, including real UI assignment→Docker file→authenticated26-byte download, stop→actualcancelled137 with unrelated task retained, actual proxy-blackhole detection~45s, backend completion while offline, reconnect, and1440/390 layouts with clickable input and readable Chinese. No page/console errors.
- Final three PNGs under `qa/screenshots/companion/` were read with read_image by child and parent. Report `research/browser-acceptance.md` records exact mechanics/limits. Playwright setOffline does not cut existing SSE and was not used as sole disconnection proof.
- Built dist/main.mjs actually starts/authenticates and exits0 on SIGTERM. Tests used isolated temp profiles; no old desktop data was opened.

## Environment and resources

Node26.13.0 / pnpm11.24.0 / Docker27.0.3 on Linux x64. Test image `1panel/deepseek-harness:0.2.0-rc.2`, sha256:a9975a0df83b07f6ef3a57098174a8303cb0e322570e1d2f175ceba33f417a72, already present; no image pull.

Every parent-managed test/download job has been collected. Every preview was stopped and printed `Preview closed`, including final job `bash-a5ae88bbc4234c8d`; no preview is intentionally left running. Test-owned containers were cleaned by exact identity. Temporary evidence profiles are retained.

Browser executable: `/tmp/dsh-pet-playwright-browsers/verified-headless-1248/chrome-headless-shell-linux64/chrome-headless-shell`. Browser test environment: `LD_LIBRARY_PATH=/tmp/dsh-pet-browser-libs/usr/lib/x86_64-linux-gnu`, `FONTCONFIG_FILE=/tmp/dsh-pet-browser-fonts.conf`. Official ZIP verified/extracted; libraries/fonts downloaded and unpacked into /tmp without system installation. Browser no-sandbox is not OS isolation evidence.

## Administrative handoff

The historical160-path inventory and approved3-commit plan are in `commit-plan.md`. The actual local work commits are `1a7b082` (architecture), `8fc76f7` (text foundation) and `9d86962` (portable fixtures). No unrecognized files were found; the two pre-existing workspace journal paths belong to session bookkeeping. Generated desktop admission update is only the ASR worker hash/bytes (+173 from additive empty contracts init module).

The user supplied the required one-shot confirmation on2026-11-08. All3 work commits are complete. The parent verified the exact archive paths and ran `task.py archive --no-commit`; this child is now completed and archived under `.trellis/tasks/archive/2026-11/11-07-text-agent-foundation`. Archive link/metadata maintenance precedes the parent's single archive bookkeeping commit, then the implementation journal with the3 actual work hashes. The architecture parent remains `planning`, with its child basename relationship preserved. No unrelated task is archived; no push or amend.

## Limits

Private single-operator service, one state writer, bounded recent UI projection, one real Harness plus fixture, JavaScript execution reference backend. Restart reconciliation verifies/stops orphans; there is no independent hard expiry while service stays down, aggregate workspace quota, automatic retention or HA. No live paid provider/public-account/cloud rollout, voice/duplex, Live2D or QQ/Bilibili integration is claimed. These are documented once in the service guide.
