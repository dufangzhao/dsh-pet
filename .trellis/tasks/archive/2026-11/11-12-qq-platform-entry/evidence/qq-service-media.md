# Whole-service media acceptance — controlled peers, real Core and containers

Executed2026-11-13 at12:37:48 Asia/Shanghai after ingress handoff freeze. **4/4 cases passed**, tests26.185s / runner27.05s. Service package typecheck, owned-file ESLint/Prettier and scoped diff whitespace checks passed.

Only [qq-service-media.test.ts](../../../../../../apps/companion-service/src/qq-service-media.test.ts) and its dedicated [fixture](../../../../../../apps/companion-service/src/qq-service-media-fixture.ts) were authored. Product code and other tests were not changed.

## Actual scope

Each case creates `createCompanionService` with a fresh owned `/tmp/qq-service-media-*` root and port0. It uses the real service composition, authenticated reverse WebSocket, HTTP owner APIs, native OneBot/SnowLuma wire encoders/decoders, Host/State/TaskMediaPeer, native Cortico Core, material storage and production delivery enqueue. No direct sender invocation substitutes for the service pipeline.

Model responses are explicitly synthetic through `options.client`, with valid native attempt structure and unknown meters; there is no paid model call. QQ and Magpie are controlled loopback peers with synthetic credentials/public local client identity. They are not real QQ accounts, the user's deployed SnowLuma, or real ASR/TTS inference. The binary/container/codec paths are real.

Exact existing images used:

- Cloud work: `sha256:a9975a0df83b07f6ef3a57098174a8303cb0e322570e1d2f175ceba33f417a72`.
- Final codec: `sha256:efbbfdfd603a862fb15929e43cf9afd38241c7ca89343907460bcc7cdab6bc1f`, manifest `69745cbac7496217f6d79f015d396f7ad066e0473c2fcea5e5b0e60c8aa58bdb`, taken from the committed codec lock. Both image IDs were inspected before the run; no image pull or replacement was performed.

## Passed chains

1. **Private image + binary file + voice ingress** — a real OneBot frame carries a valid1×1 PNG,32KiB non-UTF8 file and250ms WAV. Native Snow download frames cross the real Host byte plane into canonical material refs. The final codec decodes the recording; the localhost Magpie ASR endpoint receives actual16kHz WAV/4000 samples and returns controlled text. Core receives the transcript, all three opaque current material IDs and the exact native PNG image part. The formal reply reaches native text acceptance. Canonical material size/hash and authenticated byte downloads equal every original payload; TTS count stays0.

2. **Group text-acceptance gate and real codec output** — Core emits formal text. The controlled QQ peer holds its actual text acknowledgement; TTS and upload counts remain0. After release, the TTS HTTP handler independently reads State and verifies mandatory text acceptance before returning real PCM16/24kHz SSE data. The final Docker codec produces SILK bytes; native Snow staging verifies their size/hash, and a separate native record-send produces a message receipt. State reports accepted, and the uploaded bytes have the Tencent SILK header rather than renamed WAV/PCM.

3. **Unknown text response** — the actual OneBot reply is asynchronous/uncertain. Canonical text remains, delivery is unknown, and both TTS and media upload counts remain0. No retry or alternative send appears.

4. **Binary work and artifact publication** — the current opaque32KiB material ID is selected by a real Core `start_work` tool call. The fixed cloud image executes one copy job and writes `effects.txt` once. A filesystem marker plus Docker label inspection proves the container is running before the test briefly disconnects QQ. Reconnection waits observable source retirement before opening a new authenticated peer. Accepted work completes; a reply-only work-result context exposes only `say`, selects the actual completed artifact, and passes through the protected artifact resolver into a canonical material. Actual OneBot streaming staging receives the exact original non-UTF8 bytes and hash; `upload_private_file` publishes once with a real controlled file ID, with no extra file send. The effects oracle equals `once\n`, and the owned container is gone afterward.

The legacy `/api/artifacts` route remains owner-private and correctly returns403 for the QQ member artifact. This regression is retained. The explicitly published canonical material is200 through `/api/materials/:id`, with full byte equality. The one expected permission-denied error observation is tied to that deliberate403; no Core or transport errors remain in the positive chains.

## Cleanup and execution

Every case closes the whole service and actual peer/HTTP resources, waits for Host pending work to reach0, then resolves the temporary root and verifies its actual parent/prefix before deletion. Source reconnection uses lifecycle observation, not a fixed sleep. No original4120 data, user key, production service, real account, source override or permission bypass was used. No background job remains.

Final command, exact cwd `apps/companion-service`:

```bash
node ../../node_modules/prettier/bin/prettier.cjs --write src/qq-service-media-fixture.ts src/qq-service-media.test.ts
node node_modules/vitest/vitest.mjs run src/qq-service-media.test.ts --maxWorkers=1
node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node ../../node_modules/eslint/bin/eslint.js src/qq-service-media-fixture.ts src/qq-service-media.test.ts
node ../../node_modules/prettier/bin/prettier.cjs --check src/qq-service-media-fixture.ts src/qq-service-media.test.ts
```

No root Vitest discovery was used. Earlier focused smoke failures were fixture corrections: native Core needed a synthetic attempt/meter record; a new reverse peer needed to wait for actual old-peer retirement; and legacy artifact403 is the intended private-scope behavior. None required a product change or weakening the media/data-plane gates.

## Frozen test hashes

| File | SHA-256 |
| --- | --- |
| Dedicated fixture | `e5630b016ef8d086b2e566eb4a7fcbaf9a5d68dc75c60bf407e2c8e2952c9a2e` |
| Acceptance tests | `d950f3a94f3c5761c2505958d5f0abe95d75f46da52d30463d82119f08497ed2` |

Official four-profile transfer coverage, full frontend/desktop acceptance and actual-account compatibility remain in their owning gates. This file records the executed whole-service controlled chains only.
