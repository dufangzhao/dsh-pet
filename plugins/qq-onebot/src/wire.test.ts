import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Result } from '@pet/contracts';
import {
  ONEBOT_WIRE_MAX_BYTES,
  decodeOneBotActionReceipt,
  decodeOneBotFrame,
  encodeOneBotAction,
  type OneBotResponse,
} from './wire.js';

const fixture = JSON.parse(
  readFileSync(
    new URL('../../../qa/fixtures/companion-qq/protocol/onebot-group.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>;
function value<T>(result: Result<T>): T {
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}
function frame(input: unknown): ReturnType<typeof decodeOneBotFrame> {
  return decodeOneBotFrame(JSON.stringify(input), '10001');
}
function response(data: unknown, status = 'ok', retcode = 0, echo = 'call-1'): OneBotResponse {
  const parsed = value(frame({ status, retcode, data, echo }));
  assert.equal(parsed.kind, 'response');
  if (parsed.kind !== 'response') throw new Error();
  return parsed;
}

test('OneBot group array preserves text, signed IDs, opaque quotes and media references', () => {
  const decoded = value(frame(fixture));
  assert.equal(decoded.kind, 'message');
  if (decoded.kind !== 'message') throw new Error();
  assert.equal(decoded.message_id, -42);
  assert.equal(decoded.message_seq, 17);
  assert.equal(decoded.isSelf, false);
  assert.equal(decoded.group_id, 20001);
  assert.deepEqual(decoded.message[1], { type: 'text', data: { text: '  test\r\n🦜 ' } });
  assert.deepEqual(decoded.message[5], { type: 'reply', data: { id: 'opaque-message-fixture' } });
  assert.deepEqual(decoded.message[4], {
    type: 'file',
    data: { file_id: 'file-fixture', name: 'report.txt', file_hash: 'hash-fixture', file_size: 10 },
  });
  assert.equal(JSON.stringify(decoded).includes('owner'), false);
});

test('OneBot sender and connection identity are checked independently of group rank', () => {
  const wrongAccount = frame({ ...fixture, self_id: 10002 });
  assert.equal(wrongAccount.ok, false);
  if (!wrongAccount.ok) assert.equal(wrongAccount.error.code, 'auth-failed');
  assert.equal(frame({ ...fixture, sender: { user_id: 99999, role: 'owner' } }).ok, false);
  assert.equal(frame({ ...fixture, self_id: 9007199254740992 }).ok, false);
  assert.equal(frame({ ...fixture, message_id: 9007199254740992 }).ok, false);
  const opaque = value(frame({ ...fixture, message_id: 'opaque/non-numeric-id' }));
  assert.equal(opaque.kind, 'message');
  if (opaque.kind === 'message') assert.equal(opaque.message_id, 'opaque/non-numeric-id');
});

test('OneBot self-sent private peer is not inferred from the sender', () => {
  const parsed = value(
    frame({
      ...fixture,
      post_type: 'message_sent',
      message_type: 'private',
      sub_type: 'friend',
      user_id: 10001,
      group_id: undefined,
      target_id: 30001,
      sender: { user_id: 10001 },
      message: [{ type: 'text', data: { text: 'machine output' } }],
    }),
  );
  assert.equal(parsed.kind, 'message');
  if (parsed.kind !== 'message') throw new Error();
  assert.equal(parsed.post_type, 'message_sent');
  assert.equal(parsed.isSelf, true);
  assert.equal(parsed.target_id, 30001);
  assert.equal(parsed.group_id, null);
  const missingPeer = value(
    frame({ ...fixture, message_type: 'private', group_id: undefined, target_id: undefined }),
  );
  if (missingPeer.kind !== 'message') throw new Error();
  assert.equal(missingPeer.target_id, null);
});

test('standard group file notice is represented without inventing an event or message identity', () => {
  const notice = {
    time: 1794513600,
    self_id: 10001,
    post_type: 'notice',
    notice_type: 'group_upload',
    group_id: 20001,
    user_id: 30001,
    file: { id: 'file-fixture', name: 'report.txt', size: 10, busid: 102 },
  };
  const first = value(frame(notice));
  assert.equal(first.kind, 'group-upload');
  if (first.kind !== 'group-upload') throw new Error();
  assert.equal(first.message_id, null);
  assert.deepEqual(first.file, notice.file);
  assert.deepEqual(value(frame(notice)), first);
  const linked = value(frame({ ...notice, message_id: -42 }));
  if (linked.kind !== 'group-upload') throw new Error();
  assert.equal(linked.message_id, -42);
  assert.equal(frame({ ...notice, file: { ...notice.file, size: -1 } }).ok, false);
});

test('unsupported segments stay explicit; malformed or CQ-string messages are not lossy successes', () => {
  const decoded = value(
    frame({
      ...fixture,
      message: [
        { type: 'text', data: { text: 'visible' } },
        { type: 'future-media', data: { token: 'private-canary' } },
      ],
    }),
  );
  if (decoded.kind !== 'message') throw new Error();
  assert.deepEqual(decoded.message[1], { type: 'unsupported', originalType: 'future-media' });
  assert.equal(JSON.stringify(decoded).includes('private-canary'), false);
  assert.equal(frame({ ...fixture, message: '[CQ:image,file=unhandled]' }).ok, false);
  assert.equal(
    frame({ ...fixture, message: [{ type: 'file', data: { name: 'no-ref' } }] }).ok,
    false,
  );
  assert.equal(
    frame({
      ...fixture,
      message: Array.from({ length: 129 }, () => ({ type: 'text', data: { text: 'x' } })),
    }).ok,
    false,
  );
  const huge = frame({ ...fixture, unknown: '🦜'.repeat(ONEBOT_WIRE_MAX_BYTES / 4) });
  assert.equal(huge.ok, false);
  if (!huge.ok) assert.equal(huge.error.code, 'quota-exceeded');
});

test('OneBot envelope enforces status/retcode consistency and keeps async visibly incomplete', () => {
  assert.equal(response(null, 'async', 1).status, 'async');
  assert.equal(response(null, 'failed', -1).retcode, -1);
  for (const body of [
    { status: 'ok', retcode: 1, data: null, echo: 'e' },
    { status: 'failed', retcode: 0, data: null, echo: 'e' },
    { status: 'async', retcode: 1, data: { message_id: 5 }, echo: 'e' },
    { status: 'ok', retcode: 0, data: null },
    { status: 'ok', retcode: 0, echo: 'e' },
    { ...fixture, status: 'ok', retcode: 0, data: {}, echo: 'e' },
  ])
    assert.equal(frame(body).ok, false);
  const denied = response(null, 'failed', 1403);
  assert.deepEqual(value(decodeOneBotActionReceipt(denied, 'call-1', 'send')), {
    kind: 'rejected',
    retcode: 1403,
  });
  assert.deepEqual(value(decodeOneBotActionReceipt(response(null, 'async', 1), 'call-1', 'send')), {
    kind: 'async-accepted',
    retcode: 1,
  });
});

test('OneBot response correlation cannot settle a different request', () => {
  const result = decodeOneBotActionReceipt(response({ message_id: -8 }), 'other-call', 'send');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'conflict');
  assert.deepEqual(
    value(decodeOneBotActionReceipt(response({ message_id: -8 }), 'call-1', 'send')),
    { kind: 'send-response', message_id: -8, evidence: 'onebot-response-only' },
  );
  assert.deepEqual(
    value(
      decodeOneBotActionReceipt(response({ message_id: 'opaque-file-local-id' }), 'call-1', 'send'),
    ),
    { kind: 'send-response', message_id: 'opaque-file-local-id', evidence: 'onebot-response-only' },
  );
  assert.deepEqual(
    value(decodeOneBotActionReceipt(response({ file_id: 'uploaded' }), 'call-1', 'send')),
    { kind: 'unknown', reason: 'invalid-response' },
  );
  assert.deepEqual(
    value(decodeOneBotActionReceipt(response({ file_id: null }), 'call-1', 'file-action')),
    { kind: 'file-action-response', file_id: null, evidence: 'no-message-receipt' },
  );
  assert.deepEqual(
    value(
      decodeOneBotActionReceipt(response({ url: 'file:///remote/path' }), 'call-1', 'file-url'),
    ),
    { kind: 'unknown', reason: 'invalid-response' },
  );
});

test('OneBot sender encoding is explicit and never routes a private group-temporary reply to the group', () => {
  const message = [{ type: 'text', data: { text: 'complete reply 🦜' } }];
  assert.deepEqual(
    value(
      encodeOneBotAction(
        'send_private_msg',
        { user_id: 30001, group_id: 20001, message },
        'stable-call',
      ),
    ),
    {
      action: 'send_private_msg',
      params: { user_id: 30001, group_id: 20001, message, auto_escape: false },
      echo: 'stable-call',
    },
  );
  assert.equal(
    encodeOneBotAction('send_group_msg', { group_id: 20001, user_id: 30001, message }, 'e').ok,
    false,
  );
  assert.equal(
    encodeOneBotAction(
      'send_private_msg',
      { user_id: 30001, message: [{ type: 'at', data: { qq: 10001 } }] },
      'e',
    ).ok,
    false,
  );
  assert.equal(
    encodeOneBotAction(
      'send_private_msg',
      {
        user_id: 30001,
        group_id: 20001,
        message: [...message, { type: 'file', data: { file_id: 'f' } }],
      },
      'e',
    ).ok,
    false,
  );
  assert.equal(
    encodeOneBotAction(
      'send_group_msg',
      { group_id: 20001, message: [{ type: 'text', data: { text: 'x', role: 'admin' } }] },
      'e',
    ).ok,
    false,
  );
  assert.equal(encodeOneBotAction('get_status', { secret: 'must-not-echo' }, 'e').ok, false);
});

test('SnowLuma handler compatibility allows file-id-only lookup, and upload defaults stay send-like', () => {
  assert.deepEqual(
    value(encodeOneBotAction('get_private_file_url', { file_id: 'file' }, 'lookup')),
    { action: 'get_private_file_url', params: { file_id: 'file' }, echo: 'lookup' },
  );
  assert.deepEqual(
    value(
      encodeOneBotAction(
        'get_private_file_url',
        { user_id: 30001, file_id: 'file', file_hash: 'available-hash' },
        'lookup',
      ),
    ).params,
    { user_id: 30001, file_id: 'file', file_hash: 'available-hash' },
  );
  const upload = value(
    encodeOneBotAction(
      'upload_private_file',
      { user_id: 30001, file: '/remote-server/report.txt', name: 'report.txt' },
      'file-effect',
    ),
  );
  assert.equal(upload.params['upload_file'], true);
  assert.equal(upload.params['file'], '/remote-server/report.txt');
  assert.equal(
    value(
      encodeOneBotAction(
        'upload_group_file',
        { group_id: 20001, file: 'file:///remote/report', upload_file: false },
        'explicit-false',
      ),
    ).params['upload_file'],
    false,
  );
  assert.deepEqual(
    value(decodeOneBotActionReceipt(response({ file_id: 'f' }), 'call-1', 'file-action')),
    { kind: 'file-action-response', file_id: 'f', evidence: 'no-message-receipt' },
  );
});

test('OneBot heartbeat object status is not confused with an API response status', () => {
  const heartbeat = value(
    frame({
      time: 1,
      self_id: 10001,
      post_type: 'meta_event',
      meta_event_type: 'heartbeat',
      status: { online: true, good: false },
      interval: 5000,
    }),
  );
  assert.equal(heartbeat.kind, 'meta');
  if (heartbeat.kind !== 'meta') throw new Error();
  assert.deepEqual(heartbeat.status, { online: true, good: false });
  assert.equal(heartbeat.interval, 5000);
  assert.equal(
    frame({
      time: 1,
      self_id: 10001,
      post_type: 'meta_event',
      meta_event_type: 'heartbeat',
      status: { online: 'yes' },
    }).ok,
    false,
  );
});

test('SnowLuma zero source group means friend, while positive temporary groups keep their routing', () => {
  const message = [{ type: 'file', data: { file_id: 'f' } }];
  const outgoing = value(
    encodeOneBotAction('send_private_msg', { user_id: 30001, group_id: 0, message }, 'friend-file'),
  );
  assert.equal(outgoing.params['group_id'], 0);
  const incoming = value(
    frame({ ...fixture, message_type: 'private', sub_type: 'friend', group_id: 0 }),
  );
  if (incoming.kind !== 'message') throw new Error();
  assert.equal(incoming.group_id, null);
});

test('large decimal account strings retain precision while unsafe JSON numbers fail', () => {
  const id = '9007199254740993';
  const decoded = value(decodeOneBotFrame(JSON.stringify({ ...fixture, self_id: id }), id));
  assert.equal(decoded.kind, 'message');
  if (decoded.kind !== 'message') throw new Error();
  assert.equal(decoded.self_id, id);
  assert.equal(
    decodeOneBotFrame(JSON.stringify({ ...fixture, self_id: Number(id) }), id).ok,
    false,
  );
});

test('OneBot meta and unknown event kinds cannot masquerade as a chat command', () => {
  const meta = value(
    frame({
      time: 1,
      self_id: 10001,
      post_type: 'meta_event',
      meta_event_type: 'lifecycle',
      sub_type: 'connect',
    }),
  );
  assert.equal(meta.kind, 'meta');
  const request = value(
    frame({
      time: 1,
      self_id: 10001,
      post_type: 'request',
      request_type: 'friend',
      comment: 'grant admin',
    }),
  );
  assert.equal(request.kind, 'unhandled-event');
  assert.equal(JSON.stringify(request).includes('grant admin'), false);
});
