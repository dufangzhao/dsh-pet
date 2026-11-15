# QQ native wire fixtures

These fixtures are synthetic and contain no real accounts, credentials, messages or usable media URLs. They exercise the independently implemented native codecs, not a live plugin, network transport, canonical admission, media codec or recipient delivery.

- [official-group-at.json](./official-group-at.json) covers QQ's stripped mention, distinct event/message/reference IDs, private attachment references, voice metadata and nested quoted content. The synthetic auth token is a canary that must not appear in the decoded projection.
- [onebot-group.json](./onebot-group.json) covers array segments, signed message IDs, opaque quote IDs, mixed media and an untrusted group role. It does not establish a product principal or administrator.

Sources and provenance are maintained in [the task's protocol research](../../../../.trellis/tasks/archive/2026-11/11-12-qq-platform-entry/research/protocol-test-plan.md) and [media research](../../../../.trellis/tasks/archive/2026-11/11-12-qq-platform-entry/research/qq-media.md). No upstream implementation was copied. SnowLuma shapes refer to the documented archive, not the user's installed version.

## Executed verification

2026-11-13: the following controlled test command passed **23 tests**, with no skipped tests:

```sh
TSX_DISABLE_CACHE=1 node --import tsx --test plugins/qq-official/src/wire.test.ts plugins/qq-onebot/src/wire.test.ts
```

Both package TypeScript checks, targeted ESLint and targeted Prettier checks also passed. Tools were invoked through existing Node entry points; no package installation was needed for the final verification. Package scaffolding is owned by the parent integration task.

Important boundaries covered by these tests:

- Official gateway control states and opaque native identities; incoming group-at events remain distinguishable even without an explicit mention segment.
- Fixed non-echoing errors, malformed frames and UTF-8 control-frame size caps; quoted content has bounded depth.
- Native token/identify/resume/heartbeat encoding; token acquisition is not gateway readiness.
- Distinct passive message/event references versus display `REFIDX` references; no random sequence selection, active-send fallback, or retry.
- Upload-only official metadata requires `srv_send_msg: false`; upload replies are not send receipts. A later unknown part does not erase an earlier accepted part.
- OneBot status/retcode/echo consistency, object-valued heartbeat status, unsafe numeric-ID refusal and preservation of large decimal strings.
- Separate self-sent/peer identity, private temporary-session source groups, file notices without fabricated message IDs, explicit unsupported segments and no CQ-string fallback.
- SnowLuma file-ID-only URL lookup despite SDK type drift; file upload defaults retain their sending semantics. A file ID, local opaque message ID, or async acknowledgement is not a human receipt or proof of all mixed-message parts.

The 64 KiB metadata/control limit, item counts and quote depth are local parser budgets, **not official QQ or SnowLuma media/text limits**. Large media transfer frames, actual source activation/cleanup, HTTP/WSS I/O, canonical authority mapping, codec execution and real-platform acceptance remain outside this phase. Only the approved production QQ WS and reverse Universal OneBot profiles will be assembled later; parsing a native protocol fact does not enable another connection mode.
