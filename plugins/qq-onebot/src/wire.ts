import { JSON_MAX_BYTES, makeError, type JsonObject, type Result } from '@pet/contracts';

/** Metadata/control envelopes, not SnowLuma byte-stream frames. */
export const ONEBOT_WIRE_MAX_BYTES = JSON_MAX_BYTES;
const MAX_SEGMENTS = 128;
export type OneBotWireId = string | number;
export type OneBotSegment =
  | { type: 'text'; data: { text: string } }
  | { type: 'at'; data: { qq: OneBotWireId } }
  | { type: 'reply'; data: { id: OneBotWireId } }
  | { type: 'image' | 'record' | 'file'; data: JsonObject }
  | { type: 'unsupported'; originalType: string };
export type OneBotMessageEvent = {
  kind: 'message';
  post_type: 'message' | 'message_sent';
  self_id: OneBotWireId;
  time: number;
  message_type: 'private' | 'group';
  sub_type: string;
  message_id: OneBotWireId;
  message_seq: number | null;
  user_id: OneBotWireId;
  group_id: OneBotWireId | null;
  target_id: OneBotWireId | null;
  anonymous: boolean;
  /** Native account evidence only. Does not decide a product principal or role. */
  isSelf: boolean;
  message: OneBotSegment[];
};
export type OneBotFileNotice = {
  kind: 'group-upload';
  post_type: 'notice';
  notice_type: 'group_upload';
  self_id: OneBotWireId;
  time: number;
  group_id: OneBotWireId;
  user_id: OneBotWireId;
  message_id: OneBotWireId | null;
  file: { id: string; name: string; size: number; busid: number | null };
};
export type OneBotResponse = {
  kind: 'response';
  echo: string;
  status: 'ok' | 'async' | 'failed';
  retcode: number;
  /** Private, untrusted native payload. Receipt decoders select operation-specific fields. */
  data: unknown;
};
export type OneBotFrame =
  | OneBotMessageEvent
  | OneBotFileNotice
  | OneBotResponse
  | {
      kind: 'meta';
      self_id: OneBotWireId;
      time: number;
      meta_event_type: string;
      sub_type: string | null;
      status: { online: boolean | null; good: boolean | null } | null;
      interval: number | null;
    }
  | {
      kind: 'unhandled-event';
      self_id: OneBotWireId;
      time: number;
      post_type: string;
      notice_type: string | null;
    };

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error();
  return value as Record<string, unknown>;
}
function string(value: unknown, max = ONEBOT_WIRE_MAX_BYTES, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.length) || value.length > max)
    throw new Error();
  return value;
}
function integer(value: unknown, min = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) throw new Error();
  return value;
}
function hasSpaceOrControl(text: string): boolean {
  return [...text].some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127);
}
function wireId(value: unknown): OneBotWireId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value === 0) throw new Error();
    return value;
  }
  const result = string(value, 512);
  if (hasSpaceOrControl(result) || result === '0') throw new Error();
  return result; // Opaque strings and signed message IDs are not cast to QQ account numbers.
}
function accountId(value: unknown): OneBotWireId {
  const result = wireId(value);
  if (typeof result === 'number' ? result < 1 : !/^[1-9]\d*$/u.test(result)) throw new Error();
  return result;
}
function optionalId(value: unknown): OneBotWireId | null {
  return value === undefined || value === null ? null : wireId(value);
}
function optionalAccount(value: unknown): OneBotWireId | null {
  return value === undefined || value === null ? null : accountId(value);
}
function temporaryGroup(value: unknown): OneBotWireId | null {
  // SnowLuma treats zero as a normal friend send, not a temporary-session source group.
  return value === 0 || value === '0' ? null : optionalAccount(value);
}
function optionalBoolean(value: unknown): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'boolean') throw new Error();
  return value;
}
function optionalString(value: unknown, max = 512): string | null {
  return value === undefined || value === null ? null : string(value, max, true);
}
function echo(value: unknown): string {
  const result = string(value, 128);
  if (hasSpaceOrControl(result)) throw new Error();
  return result;
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > MAX_SEGMENTS) throw new Error();
  return value;
}
function mediaSegment(type: 'image' | 'record' | 'file', input: unknown): OneBotSegment {
  const raw = object(input);
  const data: JsonObject = {};
  // Preserve wire aliases individually. A gateway path remains a remote reference, never a local file.
  for (const key of [
    'file',
    'file_id',
    'url',
    'path',
    'name',
    'file_name',
    'file_hash',
    'md5',
    'type',
    'summary',
  ]) {
    if (raw[key] !== undefined) data[key] = string(raw[key], key === 'summary' ? 4096 : 8192, true);
  }
  for (const key of ['file_size', 'size', 'subType', 'sub_type']) {
    if (raw[key] !== undefined) data[key] = integer(raw[key]);
  }
  if (
    !['file', 'file_id', 'url', 'path'].some(
      (key) => typeof data[key] === 'string' && data[key] !== '',
    )
  )
    throw new Error();
  return { type, data };
}
function segment(value: unknown): OneBotSegment {
  const raw = object(value);
  const type = string(raw['type'], 64);
  const data = object(raw['data']);
  if (type === 'text') return { type, data: { text: string(data['text'], undefined, true) } };
  if (type === 'at')
    return { type, data: { qq: data['qq'] === 'all' ? 'all' : accountId(data['qq']) } };
  if (type === 'reply') return { type, data: { id: wireId(data['id']) } };
  if (type === 'image' || type === 'record' || type === 'file') return mediaSegment(type, data);
  return { type: 'unsupported', originalType: type };
}

export function decodeOneBotFrame(text: string, expectedSelfId: OneBotWireId): Result<OneBotFrame> {
  if (typeof text !== 'string') return { ok: false, error: makeError('invalid-input', false) };
  if (Buffer.byteLength(text, 'utf8') > ONEBOT_WIRE_MAX_BYTES)
    return { ok: false, error: makeError('quota-exceeded', false) };
  try {
    accountId(expectedSelfId);
    const raw = object(JSON.parse(text) as unknown);
    if (raw['post_type'] === undefined) {
      const status = raw['status'];
      const retcode = integer(raw['retcode'], Number.MIN_SAFE_INTEGER);
      if (
        (status !== 'ok' && status !== 'async' && status !== 'failed') ||
        (status === 'ok' && retcode !== 0) ||
        (status === 'async' && (retcode !== 1 || raw['data'] !== null)) ||
        (status === 'failed' && (retcode === 0 || retcode === 1)) ||
        !Object.hasOwn(raw, 'data')
      )
        throw new Error();
      return {
        ok: true,
        value: { kind: 'response', echo: echo(raw['echo']), status, retcode, data: raw['data'] },
      };
    }
    // Heartbeat events have an object-valued status; only response-like fields are ambiguous.
    if (
      raw['echo'] !== undefined ||
      typeof raw['status'] === 'string' ||
      raw['retcode'] !== undefined
    )
      throw new Error();
    const selfId = accountId(raw['self_id']);
    if (String(selfId) !== String(expectedSelfId))
      return { ok: false, error: makeError('auth-failed', false) };
    const time = integer(raw['time']);
    const postType = string(raw['post_type'], 64);
    if (postType === 'message' || postType === 'message_sent') {
      const messageType = raw['message_type'];
      if (messageType !== 'private' && messageType !== 'group') throw new Error();
      const userId = accountId(raw['user_id']);
      const sender = object(raw['sender']);
      if (
        sender['user_id'] !== undefined &&
        String(accountId(sender['user_id'])) !== String(userId)
      )
        throw new Error();
      const groupId =
        messageType === 'group' ? accountId(raw['group_id']) : temporaryGroup(raw['group_id']);
      const seq = raw['message_seq'];
      return {
        ok: true,
        value: {
          kind: 'message',
          post_type: postType,
          self_id: selfId,
          time,
          message_type: messageType,
          sub_type: string(raw['sub_type'], 64),
          message_id: wireId(raw['message_id']),
          message_seq: seq === undefined ? null : integer(seq),
          user_id: userId,
          group_id: groupId,
          target_id: optionalAccount(raw['target_id']),
          anonymous: raw['anonymous'] !== undefined && raw['anonymous'] !== null,
          isSelf: String(userId) === String(selfId),
          message: list(raw['message']).map(segment),
        },
      };
    }
    if (postType === 'notice' && raw['notice_type'] === 'group_upload') {
      const file = object(raw['file']);
      return {
        ok: true,
        value: {
          kind: 'group-upload',
          post_type: 'notice',
          notice_type: 'group_upload',
          self_id: selfId,
          time,
          group_id: accountId(raw['group_id']),
          user_id: accountId(raw['user_id']),
          message_id: optionalId(raw['message_id']),
          file: {
            id: string(file['id'], 512),
            name: string(file['name'], 1024),
            size: integer(file['size']),
            busid: file['busid'] === undefined ? null : integer(file['busid']),
          },
        },
      };
    }
    if (postType === 'meta_event')
      return {
        ok: true,
        value: {
          kind: 'meta',
          self_id: selfId,
          time,
          meta_event_type: string(raw['meta_event_type'], 64),
          sub_type: optionalString(raw['sub_type'], 64),
          status:
            raw['status'] === undefined || raw['status'] === null
              ? null
              : {
                  online: optionalBoolean(object(raw['status'])['online']),
                  good: optionalBoolean(object(raw['status'])['good']),
                },
          interval: raw['interval'] === undefined ? null : integer(raw['interval']),
        },
      };
    return {
      ok: true,
      value: {
        kind: 'unhandled-event',
        self_id: selfId,
        time,
        post_type: postType,
        notice_type: optionalString(raw['notice_type'], 64),
      },
    };
  } catch {
    return { ok: false, error: makeError('invalid-input', false) };
  }
}

export type OneBotAction =
  | 'get_status'
  | 'get_login_info'
  | 'get_version_info'
  | 'send_private_msg'
  | 'send_group_msg'
  | 'get_image'
  | 'get_record'
  | 'get_group_file_url'
  | 'get_private_file_url'
  | 'upload_group_file'
  | 'upload_private_file';
export type OneBotActionFrame = { action: OneBotAction; params: JsonObject; echo: string };

function exact(raw: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(raw).some((key) => !keys.includes(key))) throw new Error();
}
function outgoingSegment(input: unknown): JsonObject {
  const raw = object(input);
  exact(raw, ['type', 'data']);
  const parsed = segment(input);
  if (parsed.type === 'unsupported') throw new Error();
  const data = object(raw['data']);
  const fields =
    parsed.type === 'text'
      ? ['text']
      : parsed.type === 'at'
        ? ['qq']
        : parsed.type === 'reply'
          ? ['id']
          : [
              'file',
              'file_id',
              'url',
              'path',
              'name',
              'file_name',
              'file_hash',
              'md5',
              'file_size',
              'size',
              'type',
              'summary',
              'subType',
              'sub_type',
            ];
  exact(data, fields);
  return { type: parsed.type, data: parsed.data };
}

/** Fixed wire action subset. No action dispatch, reconnect, retry or caller authorization here. */
export function encodeOneBotAction(
  action: OneBotAction,
  input: unknown,
  requestEcho: string,
): Result<OneBotActionFrame> {
  try {
    const raw = object(input);
    const params: JsonObject = {};
    if (action === 'get_status' || action === 'get_login_info' || action === 'get_version_info') {
      exact(raw, []);
    } else if (action === 'send_private_msg' || action === 'send_group_msg') {
      exact(raw, ['user_id', 'group_id', 'message', 'auto_escape']);
      if (action === 'send_group_msg') {
        if (raw['user_id'] !== undefined) throw new Error();
        params['group_id'] = accountId(raw['group_id']);
      } else {
        params['user_id'] = accountId(raw['user_id']);
        // SnowLuma's source group selects a temporary private session; do not discard it.
        if (raw['group_id'] !== undefined)
          params['group_id'] = temporaryGroup(raw['group_id']) ?? 0;
      }
      const messages = list(raw['message']).map(outgoingSegment);
      if (!messages.length) throw new Error();
      if (action === 'send_private_msg' && messages.some((item) => item['type'] === 'at'))
        throw new Error();
      if (
        action === 'send_private_msg' &&
        params['group_id'] !== undefined &&
        params['group_id'] !== 0 &&
        messages.some((item) => item['type'] === 'file')
      )
        throw new Error();
      if (raw['auto_escape'] !== undefined && typeof raw['auto_escape'] !== 'boolean')
        throw new Error();
      params['message'] = messages;
      params['auto_escape'] = raw['auto_escape'] ?? false;
    } else if (action === 'get_image' || action === 'get_record') {
      exact(raw, ['file', 'file_id']);
      if (raw['file'] === undefined && raw['file_id'] === undefined) throw new Error();
      for (const key of ['file', 'file_id'])
        if (raw[key] !== undefined) params[key] = string(raw[key], 8192);
    } else if (action === 'get_group_file_url' || action === 'get_private_file_url') {
      exact(
        raw,
        action === 'get_group_file_url'
          ? ['group_id', 'file_id', 'busid']
          : ['user_id', 'file_id', 'file_hash'],
      );
      params['file_id'] = string(raw['file_id'], 512);
      if (action === 'get_group_file_url') {
        params['group_id'] = accountId(raw['group_id']);
        if (raw['busid'] !== undefined) params['busid'] = integer(raw['busid']);
      } else {
        // The inspected handler permits file_id only despite the stricter SDK declaration.
        if (raw['user_id'] !== undefined) params['user_id'] = accountId(raw['user_id']);
        if (raw['file_hash'] !== undefined)
          params['file_hash'] = string(raw['file_hash'], 512, true);
      }
    } else if (action === 'upload_group_file' || action === 'upload_private_file') {
      const group = action === 'upload_group_file';
      exact(
        raw,
        group
          ? ['group_id', 'file', 'name', 'folder', 'folder_id', 'upload_file']
          : ['user_id', 'file', 'name', 'upload_file'],
      );
      params[group ? 'group_id' : 'user_id'] = accountId(raw[group ? 'group_id' : 'user_id']);
      params['file'] = string(raw['file'], 8192);
      for (const key of group ? ['name', 'folder', 'folder_id'] : ['name'])
        if (raw[key] !== undefined) params[key] = string(raw[key], 1024, true);
      if (raw['upload_file'] !== undefined && typeof raw['upload_file'] !== 'boolean')
        throw new Error();
      // Native default is a publish/send effect, not a harmless staging upload.
      params['upload_file'] = raw['upload_file'] ?? true;
    } else throw new Error();
    const value: OneBotActionFrame = { action, params, echo: echo(requestEcho) };
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > ONEBOT_WIRE_MAX_BYTES)
      return { ok: false, error: makeError('quota-exceeded', false) };
    return { ok: true, value };
  } catch {
    return { ok: false, error: makeError('invalid-input', false) };
  }
}

export type OneBotActionReceipt =
  | { kind: 'send-response'; message_id: OneBotWireId; evidence: 'onebot-response-only' }
  | { kind: 'file-action-response'; file_id: string | null; evidence: 'no-message-receipt' }
  | { kind: 'file-url-response'; url: string }
  | { kind: 'rejected'; retcode: number }
  | { kind: 'async-accepted'; retcode: 1 }
  | { kind: 'unknown'; reason: 'invalid-response' };

/** Even a send message_id may be local/opaque or cover only the last part of a mixed action. */
export function decodeOneBotActionReceipt(
  response: OneBotResponse,
  expectedEcho: string,
  operation: 'send' | 'file-action' | 'file-url',
): Result<OneBotActionReceipt> {
  if (response.echo !== expectedEcho) return { ok: false, error: makeError('conflict', false) };
  if (response.status === 'failed')
    return { ok: true, value: { kind: 'rejected', retcode: response.retcode } };
  if (response.status === 'async')
    return { ok: true, value: { kind: 'async-accepted', retcode: 1 } };
  try {
    const raw = object(response.data);
    if (operation === 'send')
      return {
        ok: true,
        value: {
          kind: 'send-response',
          message_id: wireId(raw['message_id']),
          evidence: 'onebot-response-only',
        },
      };
    if (operation === 'file-action') {
      if (!Object.hasOwn(raw, 'file_id')) throw new Error();
      return {
        ok: true,
        value: {
          kind: 'file-action-response',
          file_id: raw['file_id'] === null ? null : string(raw['file_id'], 512),
          evidence: 'no-message-receipt',
        },
      };
    }
    if (operation !== 'file-url') throw new Error();
    const value = string(raw['url'], 8192);
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password)
      throw new Error();
    return { ok: true, value: { kind: 'file-url-response', url: value } };
  } catch {
    return { ok: true, value: { kind: 'unknown', reason: 'invalid-response' } };
  }
}
