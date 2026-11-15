# G0 — immediate official gateway HELLO

This is scoped source-I/O evidence, not whole-G0 completion or live QQ acceptance. All network endpoints below are controlled loopback fixtures with synthetic tokens and a test-only TLS certificate. No actual QQ account, SnowLuma, paid model or pre-existing Agent data was used.

## Change

`createAuthorizedOfficialIo.openGateway` now installs `ownedQqSocket` immediately after constructing the WebSocket, before awaiting `open`. The existing bounded message, error and close handlers therefore own frames delivered with the handshake; gateway readiness still requires the real open and post-open authority checks. Any failure or cancellation after construction goes through `owned.close()` and awaits its actual settlement. An already-retired socket cannot be returned as a ready gateway. Production URL validation, credential/source authority, handshake timeout, payload/queue bounds and postflight checks remain in place.

## Executed checks

- `apps/companion-service`: `node node_modules/vitest/vitest.mjs run src/qq-native.test.ts src/qq-native-extra.test.ts` — 35 tests passed. The new controlled test uses a real local HTTP token and gateway endpoint plus a certificate-verified local TLS WebSocket server. That server sends HELLO immediately in its connection callback, with no sleep or retry; eight independently opened source connections each reached READY and sent exactly one IDENTIFY. Two real TLS handshake tests verify rejection and cancellation wait for the actual local socket `close`, and a gated post-open authority revocation verifies that failure does not report before real owned work joins.
- `packages/local-host`: `node node_modules/vitest/vitest.mjs run src/kernel.test.ts` — 3 tests passed. Its real official factory/native source fixture now sends HELLO immediately instead of waiting 20 ms; the OneBot and source/credential cleanup assertions remain.
- Direct TypeScript checks for `apps/companion-service` and `packages/local-host` passed. Scoped ESLint passed for the changed official IO and tests.

The remote bridge/native integration probe is independently owned and must be run against the final source; these local tests do not substitute for that result. The M6 archive is unchanged.
