import { JSON_MAX_BYTES, makeError, type JsonObject, type Result } from '@pet/contracts';

/** Control frames only. Media bytes have a separate, owned transfer boundary. */
export const OFFICIAL_WIRE_MAX_BYTES = JSON_MAX_BYTES;
export const OFFICIAL_QQ_MESSAGE_INTENTS = 1 << 25;
const MAX_ITEMS = 128;
const MAX_QUOTE_DEPTH = 4;

/** Native protocol fields; this is neither a canonical input nor an authorization grant. */
export type OfficialAttachment = {
  url: string | null;
  filename: string | null;
  content_type: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  voice_wav_url: string | null;
  asr_refer_text: string | null;
};
export type OfficialAuthor = {
  id: string | null;
  user_openid: string | null;
  member_openid: string | null;
  username: string | null;
  bot: boolean | null;
};
export type OfficialMessageElement = {
  id: string | null;
  message_id: string | null;
  msg_idx: string | null;
  message_type: number | null;
  content: string;
  author: OfficialAuthor | null;
  attachments: OfficialAttachment[];
  msg_elements: OfficialMessageElement[];
};
export type OfficialMessageEvent = {
  t: 'C2C_MESSAGE_CREATE' | 'GROUP_AT_MESSAGE_CREATE' | 'GROUP_MESSAGE_CREATE';
  s: number;
  id: string | null;
  d: {
    id: string;
    timestamp: string;
    content: string;
    message_type: number | null;
    author: OfficialAuthor;
    group_openid: string | null;
    mentions: { id: string; is_you: boolean | null; bot: boolean | null }[];
    attachments: OfficialAttachment[];
    msg_elements: OfficialMessageElement[];
    message_reference: { message_id: string } | null;
    /** Deliberately excludes message_scene.ext auth_token and unknown secret-bearing fields. */
    message_scene: { msg_idx: string | null; ref_msg_idx: string | null };
  };
};
export type OfficialGatewayFrame =
  | { kind: 'hello'; op: 10; heartbeat_interval: number }
  | { kind: 'heartbeat'; op: 1; s: number | null }
  | { kind: 'heartbeat-ack'; op: 11 }
  | { kind: 'reconnect'; op: 7 }
  | { kind: 'invalid-session'; op: 9; resumable: boolean | null }
  | { kind: 'ready'; op: 0; s: number; session_id: string; user_id: string }
  | { kind: 'resumed'; op: 0; s: number }
  | { kind: 'message'; op: 0; event: OfficialMessageEvent }
  | { kind: 'unhandled-event'; op: 0; t: string; s: number; id: string | null }
  | { kind: 'unhandled-op'; op: number };

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error();
  return value as Record<string, unknown>;
}
function string(value: unknown, max = OFFICIAL_WIRE_MAX_BYTES, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.length) || value.length > max)
    throw new Error();
  return value;
}
function opaque(value: unknown, max: number): string {
  const result = string(value, max);
  if ([...result].some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127))
    throw new Error();
  return result;
}
function id(value: unknown): string {
  return opaque(value, 512);
}
function optionalString(value: unknown, max = OFFICIAL_WIRE_MAX_BYTES): string | null {
  return value === undefined || value === null ? null : string(value, max, true);
}
function optionalId(value: unknown): string | null {
  return value === undefined || value === null ? null : id(value);
}
function integer(value: unknown, min = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) throw new Error();
  return value;
}
function optionalInteger(value: unknown): number | null {
  return value === undefined || value === null ? null : integer(value);
}
function optionalBoolean(value: unknown): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'boolean') throw new Error();
  return value;
}
function list(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_ITEMS) throw new Error();
  return value;
}
function url(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = string(value, 8192);
  const parsed = new URL(text);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password)
    throw new Error();
  return text; // Signed references remain private. This does not grant a download permission.
}
function timestamp(value: unknown): string {
  const text = string(value, 64);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(text) ||
    !Number.isFinite(Date.parse(text))
  )
    throw new Error();
  const calendar = new Date(`${text.slice(0, 10)}T00:00:00Z`);
  if (
    calendar.toISOString().slice(0, 10) !== text.slice(0, 10) ||
    Number(text.slice(11, 13)) > 23 ||
    Number(text.slice(14, 16)) > 59 ||
    Number(text.slice(17, 19)) > 59
  )
    throw new Error();
  return text;
}
function author(value: unknown): OfficialAuthor {
  const raw = object(value);
  return {
    id: optionalId(raw['id']),
    user_openid: optionalId(raw['user_openid']),
    member_openid: optionalId(raw['member_openid']),
    username: optionalString(raw['username'], 512),
    bot: optionalBoolean(raw['bot']),
  };
}
function attachments(value: unknown): OfficialAttachment[] {
  return list(value).map((item) => {
    const raw = object(item);
    return {
      url: url(raw['url']),
      filename: optionalString(raw['filename'], 1024),
      content_type: optionalString(raw['content_type'], 128),
      size: optionalInteger(raw['size']),
      width: optionalInteger(raw['width']),
      height: optionalInteger(raw['height']),
      voice_wav_url: url(raw['voice_wav_url']),
      asr_refer_text: optionalString(raw['asr_refer_text']),
    };
  });
}
function elements(value: unknown, depth = 0): OfficialMessageElement[] {
  const items = list(value);
  if (items.length && depth >= MAX_QUOTE_DEPTH) throw new Error();
  return items.map((item) => {
    const raw = object(item);
    return {
      id: optionalId(raw['id']),
      message_id: optionalId(raw['message_id']),
      msg_idx: optionalId(raw['msg_idx']),
      message_type: optionalInteger(raw['message_type']),
      content: raw['content'] === undefined ? '' : string(raw['content'], undefined, true),
      author: raw['author'] === undefined ? null : author(raw['author']),
      attachments: attachments(raw['attachments']),
      msg_elements: elements(raw['msg_elements'], depth + 1),
    };
  });
}
function references(value: unknown): { msg_idx: string | null; ref_msg_idx: string | null } {
  const result: { msg_idx: string | null; ref_msg_idx: string | null } = {
    msg_idx: null,
    ref_msg_idx: null,
  };
  if (value === undefined || value === null) return result;
  for (const item of list(object(value)['ext'])) {
    const entry = string(item);
    for (const key of ['msg_idx', 'ref_msg_idx'] as const) {
      if (!entry.startsWith(`${key}=`)) continue;
      const next = id(entry.slice(key.length + 1));
      if (result[key] !== null && result[key] !== next) throw new Error();
      result[key] = next;
    }
  }
  return result;
}

export function decodeOfficialGatewayFrame(text: string): Result<OfficialGatewayFrame> {
  if (typeof text !== 'string') return { ok: false, error: makeError('invalid-input', false) };
  if (Buffer.byteLength(text, 'utf8') > OFFICIAL_WIRE_MAX_BYTES)
    return { ok: false, error: makeError('quota-exceeded', false) };
  try {
    const raw = object(JSON.parse(text) as unknown);
    const op = integer(raw['op']);
    if (op === 10)
      return {
        ok: true,
        value: {
          kind: 'hello',
          op,
          heartbeat_interval: integer(object(raw['d'])['heartbeat_interval'], 1),
        },
      };
    if (op === 1)
      return { ok: true, value: { kind: 'heartbeat', op, s: optionalInteger(raw['d']) } };
    if (op === 11) return { ok: true, value: { kind: 'heartbeat-ack', op } };
    if (op === 7) return { ok: true, value: { kind: 'reconnect', op } };
    if (op === 9)
      return {
        ok: true,
        value: { kind: 'invalid-session', op, resumable: optionalBoolean(raw['d']) },
      };
    if (op !== 0) return { ok: true, value: { kind: 'unhandled-op', op } };
    const t = id(raw['t']);
    const s = integer(raw['s']);
    const eventId = optionalId(raw['id']);
    if (t === 'RESUMED') return { ok: true, value: { kind: 'resumed', op, s } };
    if (t === 'READY') {
      const data = object(raw['d']);
      return {
        ok: true,
        value: {
          kind: 'ready',
          op,
          s,
          session_id: id(data['session_id']),
          user_id: id(object(data['user'])['id']),
        },
      };
    }
    if (
      t !== 'C2C_MESSAGE_CREATE' &&
      t !== 'GROUP_AT_MESSAGE_CREATE' &&
      t !== 'GROUP_MESSAGE_CREATE'
    )
      return { ok: true, value: { kind: 'unhandled-event', op, t, s, id: eventId } };
    const data = object(raw['d']);
    const sender = author(data['author']);
    const groupId = t === 'C2C_MESSAGE_CREATE' ? null : id(data['group_openid']);
    id(t === 'C2C_MESSAGE_CREATE' ? sender.user_openid : sender.member_openid);
    const reference = data['message_reference'];
    const event: OfficialMessageEvent = {
      t,
      s,
      id: eventId,
      d: {
        id: id(data['id']),
        timestamp: timestamp(data['timestamp']),
        content: data['content'] === undefined ? '' : string(data['content'], undefined, true),
        message_type: optionalInteger(data['message_type']),
        author: sender,
        group_openid: groupId,
        mentions: list(data['mentions']).map((item) => {
          const mention = object(item);
          return {
            id: id(mention['id']),
            is_you: optionalBoolean(mention['is_you']),
            bot: optionalBoolean(mention['bot']),
          };
        }),
        attachments: attachments(data['attachments']),
        msg_elements: elements(data['msg_elements']),
        message_reference:
          reference === undefined || reference === null
            ? null
            : { message_id: id(object(reference)['message_id']) },
        message_scene: references(data['message_scene']),
      },
    };
    // GROUP_AT_MESSAGE_CREATE itself proves a mention; content/mentions may have it stripped.
    return { ok: true, value: { kind: 'message', op, event } };
  } catch {
    return { ok: false, error: makeError('invalid-input', false) };
  }
}

function encoded(build: () => JsonObject): Result<JsonObject> {
  try {
    const value = build();
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > OFFICIAL_WIRE_MAX_BYTES)
      return { ok: false, error: makeError('quota-exceeded', false) };
    return { ok: true, value };
  } catch {
    return { ok: false, error: makeError('invalid-input', false) };
  }
}
function token(value: unknown): string {
  return opaque(value, 4096);
}

/** Secret-bearing result: host-private transport only, never a canonical DTO or log. */
export function encodeOfficialTokenRequest(
  appId: string,
  clientSecret: string,
): Result<JsonObject> {
  return encoded(() => ({ appId: id(appId), clientSecret: token(clientSecret) }));
}
/** Secret-bearing native result; token acquisition is not a connected gateway or a send receipt. */
export function decodeOfficialTokenResponse(
  httpStatus: number,
  text: string,
): Result<{ access_token: string; expires_in: number }> {
  if (httpStatus === 401 || httpStatus === 403)
    return { ok: false, error: makeError('auth-failed', false) };
  if (httpStatus !== 200) return { ok: false, error: makeError('unavailable', false) };
  try {
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > OFFICIAL_WIRE_MAX_BYTES)
      throw new Error();
    const raw = object(JSON.parse(text) as unknown);
    if (raw['code'] !== undefined && raw['code'] !== 0) throw new Error();
    const expires = raw['expires_in'];
    const seconds =
      typeof expires === 'string' && /^[1-9]\d*$/u.test(expires) ? Number(expires) : expires;
    return {
      ok: true,
      value: { access_token: token(raw['access_token']), expires_in: integer(seconds, 1) },
    };
  } catch {
    return { ok: false, error: makeError('invalid-input', false) };
  }
}
export function encodeOfficialIdentify(
  accessToken: string,
  intents = OFFICIAL_QQ_MESSAGE_INTENTS,
): Result<JsonObject> {
  return encoded(() => {
    const bits = integer(intents, 1);
    if (bits > 0x7fffffff) throw new Error();
    return { op: 2, d: { token: `QQBot ${token(accessToken)}`, intents: bits, shard: [0, 1] } };
  });
}
export function encodeOfficialResume(
  accessToken: string,
  sessionId: string,
  sequence: number,
): Result<JsonObject> {
  return encoded(() => ({
    op: 6,
    d: { token: `QQBot ${token(accessToken)}`, session_id: id(sessionId), seq: integer(sequence) },
  }));
}
export function encodeOfficialHeartbeat(sequence: number | null): Result<JsonObject> {
  return encoded(() => ({ op: 1, d: sequence === null ? null : integer(sequence) }));
}

export type OfficialMessageRequest = { path: string; body: JsonObject };
/** Encode a single already-authorized part. Does not pick a target, mode, seq or fallback. */
export function encodeOfficialMessage(
  scene: 'c2c' | 'group',
  target: string,
  payload: unknown,
): Result<OfficialMessageRequest> {
  let path = '';
  const result = encoded(() => {
    if (scene !== 'c2c' && scene !== 'group') throw new Error();
    path = `/v2/${scene === 'c2c' ? 'users' : 'groups'}/${encodeURIComponent(id(target))}/messages`;
    const raw = object(payload);
    const allowed = [
      'msg_type',
      'content',
      'markdown',
      'media',
      'msg_id',
      'event_id',
      'msg_seq',
      'message_reference',
    ];
    if (Object.keys(raw).some((key) => !allowed.includes(key))) throw new Error();
    const type = integer(raw['msg_type']);
    const body: JsonObject = { msg_type: type, msg_seq: integer(raw['msg_seq'], 1) };
    if (type === 0) {
      if (raw['markdown'] !== undefined || raw['media'] !== undefined) throw new Error();
      body['content'] = string(raw['content']);
    } else if (type === 2) {
      if (raw['content'] !== undefined || raw['media'] !== undefined) throw new Error();
      const markdown = object(raw['markdown']);
      if (Object.keys(markdown).some((key) => key !== 'content')) throw new Error();
      body['markdown'] = { content: string(markdown['content']) };
    } else if (type === 7) {
      if (raw['markdown'] !== undefined) throw new Error();
      const media = object(raw['media']);
      if (Object.keys(media).some((key) => key !== 'file_info')) throw new Error();
      body['media'] = { file_info: string(media['file_info']) };
      if (raw['content'] !== undefined) body['content'] = string(raw['content'], undefined, true);
    } else throw new Error();
    if (raw['msg_id'] !== undefined && raw['event_id'] !== undefined) throw new Error();
    if (raw['msg_id'] !== undefined) body['msg_id'] = id(raw['msg_id']);
    if (raw['event_id'] !== undefined) body['event_id'] = id(raw['event_id']);
    if (raw['message_reference'] !== undefined) {
      const reference = object(raw['message_reference']);
      if (Object.keys(reference).some((key) => key !== 'message_id')) throw new Error();
      const ref = id(reference['message_id']);
      if (!ref.startsWith('REFIDX_') || ref.length === 7) throw new Error();
      body['message_reference'] = { message_id: ref };
    }
    return body;
  });
  return result.ok ? { ok: true, value: { path, body: result.value } } : result;
}

/** URL/imported-upload metadata only. No implicit send and no large base64 body on this port. */
export function encodeOfficialMediaUpload(
  scene: 'c2c' | 'group',
  target: string,
  payload: unknown,
): Result<OfficialMessageRequest> {
  let path = '';
  const result = encoded(() => {
    if (scene !== 'c2c' && scene !== 'group') throw new Error();
    path = `/v2/${scene === 'c2c' ? 'users' : 'groups'}/${encodeURIComponent(id(target))}/files`;
    const raw = object(payload);
    if (
      Object.keys(raw).some(
        (key) => !['file_type', 'file_name', 'url', 'upload_id', 'srv_send_msg'].includes(key),
      )
    )
      throw new Error();
    const type = integer(raw['file_type'], 1);
    if (![1, 3, 4].includes(type) || raw['srv_send_msg'] !== false) throw new Error();
    if ((raw['url'] === undefined) === (raw['upload_id'] === undefined)) throw new Error();
    const body: JsonObject = {
      file_type: type,
      file_name: string(raw['file_name'], 1024),
      srv_send_msg: false,
    };
    if (raw['upload_id'] !== undefined) body['upload_id'] = id(raw['upload_id']);
    else {
      const source = url(raw['url']);
      if (!source) throw new Error();
      body['url'] = source;
    }
    return body;
  });
  return result.ok ? { ok: true, value: { path, body: result.value } } : result;
}

export type OfficialHttpReceipt =
  | { kind: 'message-accepted'; id: string; timestamp: string | null; ref_idx: string | null }
  | {
      kind: 'media-upload-accepted';
      file_uuid: string;
      file_info: string;
      ttl: number;
      reported_message_id: string | null;
    }
  | { kind: 'rejected'; httpStatus: number; code: number | null }
  | {
      kind: 'unknown';
      httpStatus: number;
      reason: 'server-error' | 'pending-or-unexpected-status' | 'invalid-response';
    };

/** One response only; neither batch completeness nor human receipt is established here. */
export function decodeOfficialHttpReceipt(
  httpStatus: number,
  text: string,
  operation: 'message' | 'media-upload',
): OfficialHttpReceipt {
  if (
    !Number.isInteger(httpStatus) ||
    httpStatus < 100 ||
    httpStatus > 599 ||
    (operation !== 'message' && operation !== 'media-upload')
  )
    return { kind: 'unknown', httpStatus: 0, reason: 'invalid-response' };
  let raw: Record<string, unknown> | null = null;
  try {
    if (typeof text === 'string' && Buffer.byteLength(text, 'utf8') <= OFFICIAL_WIRE_MAX_BYTES)
      raw = object(JSON.parse(text) as unknown);
  } catch {
    // An invalid reply after dispatch does not prove that the remote effect did not occur.
  }
  const rawCode = raw?.['code'] ?? raw?.['biz_code'];
  const code = typeof rawCode === 'number' && Number.isSafeInteger(rawCode) ? rawCode : null;
  if (
    raw &&
    raw['code'] !== undefined &&
    raw['biz_code'] !== undefined &&
    raw['code'] !== raw['biz_code']
  )
    return { kind: 'unknown', httpStatus, reason: 'invalid-response' };
  if (httpStatus >= 500) return { kind: 'unknown', httpStatus, reason: 'server-error' };
  if (httpStatus >= 400 || (raw !== null && code !== null && code !== 0))
    return { kind: 'rejected', httpStatus, code };
  if (httpStatus !== 200)
    return { kind: 'unknown', httpStatus, reason: 'pending-or-unexpected-status' };
  try {
    if (!raw || (rawCode !== undefined && code === null)) throw new Error();
    if (operation === 'media-upload')
      return {
        kind: 'media-upload-accepted',
        file_uuid: id(raw['file_uuid']),
        file_info: string(raw['file_info']),
        ttl: integer(raw['ttl']),
        reported_message_id: optionalId(raw['id']),
      };
    const extra = raw['ext_info'];
    return {
      kind: 'message-accepted',
      id: id(raw['id']),
      timestamp: raw['timestamp'] === undefined ? null : timestamp(raw['timestamp']),
      ref_idx: extra === undefined ? null : optionalId(object(extra)['ref_idx']),
    };
  } catch {
    return { kind: 'unknown', httpStatus, reason: 'invalid-response' };
  }
}
