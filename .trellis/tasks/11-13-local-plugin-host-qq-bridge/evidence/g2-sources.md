# G2 source-only QQ composition — focused evidence

This records the source/native slice and its local tests, not completion of the independent daemon, Agent bridge, packaged UI or the whole G2 gate. Fixtures use synthetic values and controlled local HTTP/WebSocket endpoints; no live QQ, paid model, SnowLuma or existing Agent data was used.

## One implementation

The official and OneBot private native IO, socket ownership, credential/source binding and media implementations now live once under `packages/local-host/src/qq-native/`. Service, local kernel tests and the two active local-host QA fixtures import that shared code; no old service compatibility files remain. Protocol code is imported from the actual installed QQ packages, including their narrow media-wire exports.

`QQSourceCore` owns source config revision, target-bound in-memory credential/version, binding, applied generation, native peer, state and physical retirement for both hosts. `LocalQQSourceController` adds the local control Config CAS and requires a scoped remote check for every business dispatch. The existing service `QQController` delegates source lifecycle and views to the same core, retaining its own feature/participant policy, grants and judge. The service controller went from 1,264 to approximately 750 lines, removing the duplicate source lifecycle rather than adding a parallel manager. An official source still filters its applied scenes before emitting its private callback.

The fixed `pet.local-qq-control` ordinary infrastructure owner stores only `officialEnabled` and `onebotEnabled` through ConfigService CAS and runs real supervised management tasks even while QQ is disabled. Its own installed native package is pinned and admitted; each QQ plugin still needs explicit exact-digest review. The optional fixed `pet.local-agent-link` registration uses the actual package factory, stays disabled and review-required, and declares its host-private bearer credential; activation alone does not connect. A real task under this owner successfully borrowed a synthetic in-memory broker value in the focused test.

Local source commands check Config/key versions inside their source operation. A cancelled credential command held behind actual source retirement preserves the old key and version; cancellation after key commit retains the new committed key. The old peer remains retired and a later source uses its own connection identity. Source views expose no test key.

## Fresh business checks

`withQqOperationCheck` binds a private check to a real active source task, owner/generation and signal. Each business HTTP request or OneBot action obtains a new local monotonic deadline; the source fence is rechecked and expiry is checked synchronously at the physical dispatch boundary, including inside OneBot socket `onDispatch`. The operation scope expires on exit, including for detached asynchronous work. Authentication, gateway/heartbeat and cleanup do not require a remote business grant. The legacy service binding does not require the new scope.

Controlled local tests proved separate check calls for official multipart prepare, PUT, finish, commit and send, plus OneBot action and media writes. Revocation prevented the next business request/write; a held local fence caused the deadline to expire before dispatch with zero business body. A completed official native receipt survived later source revocation. These are local callback/IO tests, not a claim that a real remote Agent grant or full G5 delivery has passed.

## Checks run

- Companion service: `node node_modules/vitest/vitest.mjs run src/qq-native.test.ts src/qq-native-extra.test.ts src/qq-controller.test.ts src/qq-controller-race.test.ts src/qq-service.test.ts` — **58 passed** across five files, including the previous immediate official HELLO test, native media, source/CAS races, and the real controlled service entry.
- Companion service: `node node_modules/vitest/vitest.mjs run src/qq-media-transfer.test.ts src/qq-delivery-transport.test.ts src/qq-ingress.test.ts` — **52 passed** across three files, including actual controlled PNG/file/voice transfer, source-loss custody, exact connection checks and native cleanup.
- Local host: `node node_modules/vitest/vitest.mjs run src/kernel.test.ts src/qq-source.test.ts` — **5 passed** across two files. This includes both actual QQ factories, explicit source trust, real sockets, local credential cancellation/commit, cleanup, and the optional actual AgentLink factory and broker lease.
- Companion-service direct `tsc --noEmit` and scoped ESLint of the changed shared/controller files passed. QA fixture syntax and direct loading of the shared native module passed after the move.
- Local-host direct `tsc --noEmit` passed before the concurrent AgentLink/management work; the latest full-package check encountered intermediate errors in separately owned `management-secrets.test.ts` and `qq-agent-link.ts`. Those files were not changed by this source slice and require their owners' final typecheck.

The independent State4/bridge integration, GUI/daemon flow, final isolated package layout, broader QA and supported target/device acceptance are separate gates. The native scope test does not claim live server authority, production QQ acceptance, or Windows-device validation.
