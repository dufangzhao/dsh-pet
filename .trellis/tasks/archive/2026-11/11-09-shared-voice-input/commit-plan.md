# M4 work-commit plan

Status: user confirmed the complete plan. Work commits executed in order: `b58c9958a6a2f029490a2dbfc52cd58565738a91` and `c1583c179283624a06d5f091dfc480a3b3da968a`. No push. This document retains the reviewed pre-archive file grouping.

The selected scope is verified; see [acceptance](../../../../../qa/fixtures/companion-voice-input/acceptance.md) and [operator guide](../../../../../docs/38-shared-voice-input.md). Code/spec comes first, acceptance/operator/task records second; task archive and session journal commits follow via Trellis. No remote push.

## 1. feat(companion): add shared Magpie voice input

117 paths. Deleted tracked paths are marked `[delete]`.

```text
.trellis/spec/backend/index.md
.trellis/spec/backend/shared-voice-input.md
.trellis/spec/frontend/index.md
.trellis/spec/frontend/project-patterns.md
apps/companion-service/build.mjs
apps/companion-service/package.json
apps/companion-service/src/server.ts
apps/companion-service/src/service.ts
apps/companion-service/src/voice-client.ts
apps/companion-service/src/voice-controller.ts
apps/companion-service/src/voice-http.ts
apps/companion-service/src/voice.test.ts
apps/desktop/package.json
apps/desktop/src/main/builtin-admission.json
apps/desktop/src/main/companion-client-controller.test.ts
apps/desktop/src/main/companion-client-controller.ts
apps/desktop/src/main/companion-voice-service.test.ts
apps/desktop/src/main/companion-voice-service.ts
apps/desktop/src/main/desktop-host.ts
apps/desktop/src/main/index.ts
apps/desktop/src/main/mvp-readiness.test.ts
apps/desktop/src/main/mvp-readiness.ts
apps/desktop/src/main/shared-composition-policy.ts
apps/desktop/src/main/shared-voice-capture-host.ts
apps/desktop/src/main/shared-voice-controller.test.ts
apps/desktop/src/main/shared-voice-controller.ts
apps/desktop/src/main/shared-voice-host.test.ts
apps/desktop/src/main/shared-voice-permission.test.ts
apps/desktop/src/main/shared-voice-permission.ts
apps/desktop/src/main/shared-voice-request.test.ts
apps/desktop/src/main/shared-voice-request.ts
apps/desktop/src/main/windows/console-window.ts
apps/desktop/src/preload/index.ts
apps/desktop/src/preload/shared-voice-bridge.test.ts
apps/desktop/src/preload/shared-voice-bridge.ts
apps/desktop/src/renderer/console/console-app.tsx
apps/desktop/src/renderer/console/demo/capture-worklet.test.ts
apps/desktop/src/renderer/console/demo/capture-worklet.ts
[delete] apps/desktop/src/renderer/console/demo/capture-worklet.url.d.ts
apps/desktop/src/renderer/console/demo/microphone.test.ts
apps/desktop/src/renderer/console/demo/microphone.ts
apps/desktop/src/renderer/console/demo/worklet-env.d.ts
apps/desktop/src/renderer/console/pages/app-pages.test.tsx
apps/desktop/src/renderer/console/pages/conversation.tsx
apps/desktop/src/renderer/console/pages/start.tsx
apps/desktop/src/renderer/console/pages/voice-card.tsx
apps/desktop/src/renderer/console/use-console-voice.test.ts
apps/desktop/src/renderer/console/use-console-voice.ts
apps/desktop/src/renderer/console/voice-desktop.test.ts
apps/desktop/src/renderer/console/voice-desktop.ts
apps/desktop/src/renderer/console/voice-worklet.url.d.ts
apps/desktop/src/renderer/shared/use-companion.test.ts
apps/desktop/src/renderer/shared/use-companion.ts
apps/desktop/src/renderer/voice-bridge.d.ts
packages/companion-runtime/src/core-plugin.ts
packages/companion-runtime/src/index.ts
packages/companion-runtime/src/plugin-host.ts
packages/companion-runtime/src/voice-input-types.ts
packages/companion-runtime/src/voice-providers.test.ts
packages/companion-runtime/src/voice-providers.ts
packages/contracts/src/audio-capture.ts
packages/contracts/src/companion-voice.ts
packages/contracts/src/desktop-voice.ts
packages/contracts/src/index.ts
packages/contracts/src/local-asr.ts
plugins/asr-cloud/package.json
plugins/asr-cloud/src/transcription.ts
plugins/asr-magpie/build.mjs
plugins/asr-magpie/package.json
plugins/asr-magpie/plugin.json
plugins/asr-magpie/src/config.test.ts
plugins/asr-magpie/src/config.ts
plugins/asr-magpie/src/index.ts
plugins/asr-magpie/tsconfig.json
plugins/audio-capture/build.mjs
plugins/audio-capture/package.json
plugins/audio-capture/plugin.json
plugins/audio-capture/src/browser.test.ts
plugins/audio-capture/src/browser.ts
plugins/audio-capture/src/capture-worklet.ts
plugins/audio-capture/src/index.ts
plugins/audio-capture/src/pcm-wave.ts
plugins/audio-capture/src/worklet-env.d.ts
plugins/audio-capture/src/worklet-protocol.ts
plugins/audio-capture/tsconfig.json
plugins/shared-voice/build.mjs
plugins/shared-voice/package.json
plugins/shared-voice/plugin.json
plugins/shared-voice/src/index.test.ts
plugins/shared-voice/src/index.ts
plugins/shared-voice/tsconfig.json
plugins/text-client/build.mjs
plugins/text-client/package.json
plugins/text-client/src/client/app.tsx
plugins/text-client/src/client/chat.tsx
plugins/text-client/src/client/client.ts
plugins/text-client/src/client/protocol.ts
plugins/text-client/src/client/request.ts
plugins/text-client/src/client/voice-form.ts
plugins/text-client/src/client/voice-guards.ts
plugins/text-client/src/client/voice-input.css
plugins/text-client/src/client/voice-input.tsx
plugins/text-client/src/client/voice-protocol.ts
plugins/text-client/src/client/voice-sampler.ts
plugins/text-client/src/client/voice-settings.tsx
plugins/text-client/src/client/voice-transport.ts
plugins/text-client/src/client/voice-web.ts
plugins/text-client/src/protocol.ts
plugins/text-client/src/voice-input-ui.ts
plugins/text-client/tests/browser/voice-app.browser.mjs
plugins/text-client/tests/browser/voice-input.browser.mjs
plugins/text-client/tests/render.test.mjs
plugins/text-client/tests/voice-form.test.mjs
plugins/text-client/tests/voice-sampler.test.mjs
plugins/text-client/tests/voice-web.test.mjs
plugins/text-client/tests/voice.test.mjs
pnpm-lock.yaml
```

## 2. test(companion): record shared voice acceptance and guidance

64 paths. Deleted tracked paths are marked `[delete]`.

```text
.trellis/tasks/11-06-unified-companion-architecture/prd.md
.trellis/tasks/11-06-unified-companion-architecture/research/voice-entry.md
.trellis/tasks/11-06-unified-companion-architecture/research/voice-ux.md
.trellis/tasks/11-06-unified-companion-architecture/task.json
.trellis/tasks/11-09-shared-voice-input/check.jsonl
.trellis/tasks/11-09-shared-voice-input/commit-plan.md
.trellis/tasks/11-09-shared-voice-input/design.md
.trellis/tasks/11-09-shared-voice-input/implement.jsonl
.trellis/tasks/11-09-shared-voice-input/implement.md
.trellis/tasks/11-09-shared-voice-input/implementation-contract.md
.trellis/tasks/11-09-shared-voice-input/prd.md
.trellis/tasks/11-09-shared-voice-input/progress.md
.trellis/tasks/11-09-shared-voice-input/research/qa-preparation.md
.trellis/tasks/11-09-shared-voice-input/research/voice-input-ux.md
.trellis/tasks/11-09-shared-voice-input/task.json
docs/38-shared-voice-input.md
qa/fixtures/companion-voice-input/acceptance.md
qa/fixtures/companion-voice-input/controlled-magpie.mjs
qa/fixtures/companion-voice-input/evidence/468f3b01-Web-catalog-selected.png
qa/fixtures/companion-voice-input/evidence/468f3b01-before.json
qa/fixtures/companion-voice-input/evidence/468f3b01-native.json
qa/fixtures/companion-voice-input/evidence/468f3b01-web-consent-denied.png
qa/fixtures/companion-voice-input/evidence/468f3b01-web-finished.png
qa/fixtures/companion-voice-input/evidence/468f3b01-web-recording.png
qa/fixtures/companion-voice-input/evidence/4b165c6c-before.json
qa/fixtures/companion-voice-input/evidence/4b165c6c-native.json
qa/fixtures/companion-voice-input/evidence/4b165c6c-targeted-cancel-awaits-real-stream-delivery.png
qa/fixtures/companion-voice-input/evidence/4b165c6c-targeted-catalog-880x600.png
qa/fixtures/companion-voice-input/evidence/4b165c6c-targeted-provider-stale-baseline-retains-draft.png
qa/fixtures/companion-voice-input/evidence/4b165c6c-targeted-real-20s-auto-finish.png
qa/fixtures/companion-voice-input/evidence/4b165c6c-targeted-review-edited-not-submitted.png
qa/fixtures/companion-voice-input/evidence/4b165c6c-targeted-review-explicitly-sent.png
qa/fixtures/companion-voice-input/evidence/4b165c6c-targeted-terminal-auth.png
qa/fixtures/companion-voice-input/evidence/4b165c6c-targeted-terminal-rate-limited.png
qa/fixtures/companion-voice-input/evidence/5f655739-before.json
qa/fixtures/companion-voice-input/evidence/5f655739-desktop-failure.png
qa/fixtures/companion-voice-input/evidence/5f655739-desktop-recording.png
qa/fixtures/companion-voice-input/evidence/5f655739-native.json
qa/fixtures/companion-voice-input/evidence/62621ec4-Web-catalog-selected.png
qa/fixtures/companion-voice-input/evidence/62621ec4-before.json
qa/fixtures/companion-voice-input/evidence/62621ec4-desktop-catalog-selected.png
qa/fixtures/companion-voice-input/evidence/62621ec4-desktop-finished.png
qa/fixtures/companion-voice-input/evidence/62621ec4-desktop-recording.png
qa/fixtures/companion-voice-input/evidence/62621ec4-native.json
qa/fixtures/companion-voice-input/evidence/62621ec4-web-consent-denied.png
qa/fixtures/companion-voice-input/evidence/62621ec4-web-finished.png
qa/fixtures/companion-voice-input/evidence/62621ec4-web-recording.png
qa/fixtures/companion-voice-input/evidence/checkpoint-5f655739.md
qa/fixtures/companion-voice-input/evidence/final-62621ec4.md
qa/fixtures/companion-voice-input/evidence/final-targeted-4b165c6c.md
qa/fixtures/companion-voice-input/evidence/final-web-468f3b01.md
qa/fixtures/companion-voice-input/evidence/native-observers.mjs
qa/fixtures/companion-voice-input/evidence/q6-live-20261110.json
qa/fixtures/companion-voice-input/evidence/targeted-cases.mjs
qa/fixtures/companion-voice-input/generate-wav.mjs
qa/fixtures/companion-voice-input/synthetic-audio.mjs
qa/fixtures/companion-voice-input/synthetic-tone-16k.wav
qa/probes/companion-voice-input-controlled.mjs
qa/probes/companion-voice-input-fixture.test.mjs
qa/probes/companion-voice-input-live.mjs
qa/probes/companion-voice-input-native.mjs
qa/probes/companion-voice-input-peer-fixture.test.mjs
qa/probes/companion-voice-input-provider-auth.mjs
qa/probes/companion-voice-input-worker.mjs
```

## Unrecognized changes

None. Private credentials/audio/browser tooling, local gate logs and the31 SHA-preserved intermediate diagnostics are ignored and excluded. Only the listed safe fixtures/final evidence are in this batch.

## Bookkeeping after confirmation

1. Stage and create both work commits in the listed order, without amend or push.
2. Mark the remaining record criterion complete, archive only `11-09-shared-voice-input`, and repair task-local relative links for its archived location.
3. Record the stage journal using the two work-commit hashes. Keep the parent roadmap and the other unfinished tasks open.
4. Continue with the next Magpie TTS increment under the existing roadmap authorization.
