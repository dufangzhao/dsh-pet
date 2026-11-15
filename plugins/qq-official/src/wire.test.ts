import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Result } from '@pet/contracts';
import {
  OFFICIAL_QQ_MESSAGE_INTENTS,
  OFFICIAL_WIRE_MAX_BYTES,
  decodeOfficialGatewayFrame,
  decodeOfficialHttpReceipt,
  decodeOfficialTokenResponse,
  encodeOfficialHeartbeat,
  encodeOfficialIdentify,
  encodeOfficialMediaUpload,
  encodeOfficialMessage,
  encodeOfficialResume,
  encodeOfficialTokenRequest,
} from './wire.js';

const fixture = JSON.parse(
  readFileSync(
    new URL('../../../qa/fixtures/companion-qq/protocol/official-group-at.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>;
function value<T>(result: Result<T>): T {
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}
function frame(payload: unknown): ReturnType<typeof decodeOfficialGatewayFrame> {
  return decodeOfficialGatewayFrame(JSON.stringify(payload));
}

test('official group-at identity proves mention even after QQ stripped its markup', () => {
  const decoded = value(frame(fixture));
  assert.equal(decoded.kind, 'message');
  if (decoded.kind !== 'message') throw new Error('Expected native message');
  assert.equal(decoded.event.t, 'GROUP_AT_MESSAGE_CREATE');
  assert.deepEqual(decoded.event.d.mentions, []);
  assert.equal(decoded.event.d.content, '  内容保留\r\n第二行');
  assert.equal(decoded.event.id, 'event-fixture-42');
  assert.equal(decoded.event.d.id, 'ROBOT1.0_fixture-inbound');
  assert.equal(decoded.event.d.message_scene.msg_idx, 'REFIDX_fixture-current');
  assert.equal(decoded.event.d.message_scene.ref_msg_idx, 'REFIDX_fixture-quoted');
  assert.equal(decoded.event.d.author.member_openid, 'opaque_member_fixture');
  assert.equal(decoded.event.d.author.bot, false);
  assert.equal(decoded.event.d.attachments.length, 3);
  assert.equal(
    decoded.event.d.attachments[1]?.voice_wav_url,
    'https://media.example.invalid/voice.wav',
  );
  assert.equal(decoded.event.d.attachments[1]?.asr_refer_text, 'Reference only');
  assert.equal(decoded.event.d.msg_elements[0]?.msg_elements[0]?.content, 'nested');
  assert.equal(JSON.stringify(decoded).includes('must-not-project'), false);
  assert.equal(JSON.stringify(decoded).includes('member_role'), false);
});

test('official C2C empty text can carry media; unknown bot identity stays unknown', () => {
  const decoded = value(
    frame({
      op: 0,
      s: 1,
      t: 'C2C_MESSAGE_CREATE',
      d: {
        id: 'c2c-id',
        timestamp: '2026-11-13T00:00:00Z',
        author: { user_openid: 'user-opaque' },
        attachments: [{ content_type: 'voice', filename: 'a.silk' }],
      },
    }),
  );
  assert.equal(decoded.kind, 'message');
  if (decoded.kind !== 'message') throw new Error();
  assert.equal(decoded.event.d.content, '');
  assert.equal(decoded.event.d.author.bot, null);
  assert.equal(decoded.event.d.attachments[0]?.url, null);
  assert.equal(decoded.event.id, null);
});

test('gateway control states remain distinct from messages or authenticated readiness', () => {
  assert.deepEqual(value(frame({ op: 10, d: { heartbeat_interval: 45000 } })), {
    kind: 'hello',
    op: 10,
    heartbeat_interval: 45000,
  });
  assert.deepEqual(
    value(
      frame({
        op: 0,
        t: 'READY',
        s: 1,
        d: { session_id: 'resume-session', user: { id: 'bot-account' } },
      }),
    ),
    { kind: 'ready', op: 0, s: 1, session_id: 'resume-session', user_id: 'bot-account' },
  );
  assert.deepEqual(value(frame({ op: 0, t: 'RESUMED', s: 2, d: '' })), {
    kind: 'resumed',
    op: 0,
    s: 2,
  });
  assert.deepEqual(value(frame({ op: 1, d: 2 })), { kind: 'heartbeat', op: 1, s: 2 });
  assert.equal(value(frame({ op: 11 })).kind, 'heartbeat-ack');
  assert.equal(value(frame({ op: 7 })).kind, 'reconnect');
  assert.deepEqual(value(frame({ op: 9, d: false })), {
    kind: 'invalid-session',
    op: 9,
    resumable: false,
  });
  assert.equal(value(frame({ op: 12 })).kind, 'unhandled-op');
  assert.deepEqual(
    value(
      frame({
        op: 0,
        t: 'AT_MESSAGE_CREATE',
        s: 3,
        id: 'guild-event',
        d: { content: 'not a QQ group' },
      }),
    ),
    { kind: 'unhandled-event', op: 0, t: 'AT_MESSAGE_CREATE', s: 3, id: 'guild-event' },
  );
  assert.equal(frame({ op: 10, d: { heartbeat_interval: 0 } }).ok, false);
  assert.equal(frame({ op: 0, t: 'READY', s: 0, d: { session_id: 's' } }).ok, false);
});

test('official malformed fields are rejected without turning event IDs into message IDs', () => {
  const data = fixture['d'] as Record<string, unknown>;
  for (const d of [
    { ...data, id: undefined },
    { ...data, author: { user_openid: 'wrong-scene' } },
    { ...data, attachments: [{ size: -1 }] },
    { ...data, attachments: [{ url: 'file:///host-secret' }] },
    { ...data, attachments: [{ url: 'https://name:secret@media.example.invalid/a' }] },
    { ...data, message_scene: { ext: ['msg_idx=REFIDX_a', 'msg_idx=REFIDX_b'] } },
  ]) {
    const result = frame({ ...fixture, d });
    assert.equal(result.ok, false);
    assert.equal(JSON.stringify(result).includes('host-secret'), false);
  }
  assert.equal(decodeOfficialGatewayFrame('{invalid-secret').ok, false);
  assert.equal(decodeOfficialGatewayFrame('[]').ok, false);
});

test('official metadata frames and recursive quote parsing are bounded', () => {
  const huge = frame({ ...fixture, unknown: '🦜'.repeat(OFFICIAL_WIRE_MAX_BYTES / 4) });
  assert.equal(huge.ok, false);
  if (!huge.ok) assert.equal(huge.error.code, 'quota-exceeded');
  let quotes: unknown[] = [];
  for (let i = 0; i < 5; i++) quotes = [{ content: 'nested', msg_elements: quotes }];
  assert.equal(
    frame({ ...fixture, d: { ...(fixture['d'] as Record<string, unknown>), msg_elements: quotes } })
      .ok,
    false,
  );
});

test('official timestamps do not silently roll an invalid date into a later reply window', () => {
  const data = fixture['d'] as Record<string, unknown>;
  for (const timestamp of ['2026-02-30T00:00:00Z', '2026-11-13T24:00:00Z', '2026-11-13T00:00:00'])
    assert.equal(frame({ ...fixture, d: { ...data, timestamp } }).ok, false);
  assert.equal(
    frame({ ...fixture, d: { ...data, timestamp: '2024-02-29T23:59:59.123+08:00' } }).ok,
    true,
  );
  const largeText = encodeOfficialMessage('c2c', 'u', {
    msg_type: 0,
    content: '🦜'.repeat(20000),
    msg_seq: 1,
  });
  assert.equal(largeText.ok, false);
  if (!largeText.ok) assert.equal(largeText.error.code, 'quota-exceeded');
});

test('token and gateway auth codecs preserve wire fields without echoing failed credentials', () => {
  assert.deepEqual(value(encodeOfficialTokenRequest('app-fixture', 'fixture-secret')), {
    appId: 'app-fixture',
    clientSecret: 'fixture-secret',
  });
  assert.deepEqual(
    value(decodeOfficialTokenResponse(200, '{"access_token":"fixture-token","expires_in":"7200"}')),
    { access_token: 'fixture-token', expires_in: 7200 },
  );
  assert.equal(
    decodeOfficialTokenResponse(200, '{"access_token":"fixture-token","expires_in":0}').ok,
    false,
  );
  assert.deepEqual(value(encodeOfficialIdentify('fixture-token')), {
    op: 2,
    d: { token: 'QQBot fixture-token', intents: OFFICIAL_QQ_MESSAGE_INTENTS, shard: [0, 1] },
  });
  assert.deepEqual(value(encodeOfficialResume('fixture-token', 'session', 42)), {
    op: 6,
    d: { token: 'QQBot fixture-token', session_id: 'session', seq: 42 },
  });
  assert.deepEqual(value(encodeOfficialHeartbeat(null)), { op: 1, d: null });
  const result = encodeOfficialIdentify('fixture-secret\r\nAuthorization: bad');
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes('fixture-secret'), false);
  const refused = decodeOfficialTokenResponse(401, 'fixture-secret');
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.error.code, 'auth-failed');
});

test('outgoing official text retains content and distinct passive/display reference fields', () => {
  const body = {
    msg_type: 0,
    content: '  原文\r\n🦜',
    msg_id: 'ROBOT1.0_received',
    msg_seq: 2,
    message_reference: { message_id: 'REFIDX_display' },
  };
  const result = value(encodeOfficialMessage('group', 'opaque/group', body));
  assert.equal(result.path, '/v2/groups/opaque%2Fgroup/messages');
  assert.deepEqual(result.body, body);
  assert.deepEqual(body.msg_id, 'ROBOT1.0_received');
  assert.equal(encodeOfficialMessage('group', 'g', { ...body, event_id: 'event' }).ok, false);
  assert.equal(
    encodeOfficialMessage('group', 'g', {
      ...body,
      message_reference: { message_id: 'ROBOT1.0_received' },
    }).ok,
    false,
  );
  assert.equal(encodeOfficialMessage('group', 'g', { ...body, msg_seq: 0 }).ok, false);
  assert.equal(encodeOfficialMessage('group', 'g', { ...body, is_wakeup: true }).ok, false);
  assert.equal(
    value(encodeOfficialMessage('c2c', 'u', { msg_type: 0, content: 'proactive', msg_seq: 1 }))
      .body['msg_id'],
    undefined,
  );
  assert.equal(
    encodeOfficialMessage('c2c', 'u', {
      msg_type: 2,
      markdown: { content: 'md' },
      content: 'text',
      msg_seq: 1,
    }).ok,
    false,
  );
});

test('official upload-only encoding requires explicit no-send intent and keeps upload separate', () => {
  const payload = {
    file_type: 4,
    file_name: 'result.txt',
    upload_id: 'upload-fixture',
    srv_send_msg: false,
  };
  assert.deepEqual(value(encodeOfficialMediaUpload('c2c', 'u', payload)), {
    path: '/v2/users/u/files',
    body: payload,
  });
  assert.equal(
    encodeOfficialMediaUpload('group', 'g', { ...payload, srv_send_msg: true }).ok,
    false,
  );
  assert.equal(
    encodeOfficialMediaUpload('group', 'g', { ...payload, srv_send_msg: undefined }).ok,
    false,
  );
  assert.equal(
    encodeOfficialMediaUpload('group', 'g', { ...payload, url: 'https://media.example.invalid/a' })
      .ok,
    false,
  );
  assert.equal(
    encodeOfficialMediaUpload('group', 'g', { ...payload, file_data: 'not-a-metadata-field' }).ok,
    false,
  );
  const receipt = decodeOfficialHttpReceipt(
    200,
    '{"file_uuid":"f","file_info":"opaque-file-info","ttl":300}',
    'media-upload',
  );
  assert.deepEqual(receipt, {
    kind: 'media-upload-accepted',
    file_uuid: 'f',
    file_info: 'opaque-file-info',
    ttl: 300,
    reported_message_id: null,
  });
  assert.equal(
    decodeOfficialHttpReceipt(200, '{"file_uuid":"f","file_info":"opaque","ttl":300}', 'message')
      .kind,
    'unknown',
  );
});

test('official API refusal, uncertain result and one-part acceptance never imply batch delivery', () => {
  assert.deepEqual(
    decodeOfficialHttpReceipt(
      200,
      '{"id":"msg","timestamp":"2026-11-13T00:00:00Z","ext_info":{"ref_idx":"REFIDX_one"}}',
      'message',
    ),
    {
      kind: 'message-accepted',
      id: 'msg',
      timestamp: '2026-11-13T00:00:00Z',
      ref_idx: 'REFIDX_one',
    },
  );
  assert.deepEqual(
    decodeOfficialHttpReceipt(200, '{"code":40034005,"message":"secret raw error"}', 'message'),
    { kind: 'rejected', httpStatus: 200, code: 40034005 },
  );
  assert.deepEqual(decodeOfficialHttpReceipt(403, 'secret body', 'message'), {
    kind: 'rejected',
    httpStatus: 403,
    code: null,
  });
  for (const [status, body] of [
    [500, '{"code":50055001}'],
    [202, '{"id":"pending"}'],
    [200, '{}'],
    [200, 'invalid'],
    [200, '{"code":"0","id":"m"}'],
    [200, '{"biz_code":40093002,"id":"m"}'],
  ] as const) {
    const receipt = decodeOfficialHttpReceipt(status, body, 'message');
    assert.notEqual(receipt.kind, 'message-accepted');
    assert.equal('delivered' in receipt, false);
  }
  const parts = [
    decodeOfficialHttpReceipt(200, '{"id":"part-1"}', 'message'),
    decodeOfficialHttpReceipt(504, '', 'message'),
  ];
  assert.deepEqual(
    parts.map((part) => part.kind),
    ['message-accepted', 'unknown'],
  );
  assert.equal(JSON.stringify(parts).includes('retry'), false);
});
