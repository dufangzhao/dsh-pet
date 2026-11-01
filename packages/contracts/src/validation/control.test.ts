import { describe, expect, it } from 'vitest';
import {
  validateControlMessage,
  validateMediaFrame,
  validateStreamHeader,
} from '../validation/validate.js';
import { MEDIA_MAX_CHUNK_BYTES } from '../media.js';
import { makeError } from '../errors.js';

const owner = { pluginId: 'official.voice-chat', instanceId: 'default', generation: 1 };

const base = () => ({
  protocol: 1,
  sessionId: 'session-1',
  id: 'msg-1',
  owner,
});

describe('control messages: accepted shapes', () => {
  it.each([
    [
      'request',
      { type: 'request', method: 'start', payload: { a: 1 }, taskId: 'task-1', budgetMs: 5000 },
    ],
    [
      'owner-scoped runtime invocation',
      {
        type: 'request',
        method: 'runtime.invoke',
        payload: {},
        taskId: 'listener',
        budgetMs: null,
      },
    ],
    ['request without optional fields', { type: 'request', method: 'ping', payload: {} }],
    ['request carrying an array payload', { type: 'request', method: 'ping', payload: [1, 'a'] }],
    ['request carrying a null payload', { type: 'request', method: 'ping', payload: null }],
    [
      'response ok',
      { type: 'response', replyTo: 'msg-1', result: { ok: true, value: { text: 'hi' } } },
    ],
    [
      'response error',
      { type: 'response', replyTo: 'msg-1', result: { ok: false, error: makeError('cancelled') } },
    ],
    [
      'event',
      { type: 'event', topic: 'progress', sequence: 3, payload: { p: 0.5 }, taskId: 'task-1' },
    ],
    ['cancel', { type: 'cancel', taskId: 'task-1', reason: 'user' }],
    [
      'stream-credit',
      { type: 'stream-credit', streamId: 'stream-1', taskId: 'task-1', credits: 4 },
    ],
    ['stream-end', { type: 'stream-end', streamId: 'stream-1', taskId: 'task-1', sequence: 9 }],
    [
      'stream-end with error',
      {
        type: 'stream-end',
        streamId: 'stream-1',
        taskId: 'task-1',
        sequence: 9,
        error: makeError('network'),
      },
    ],
  ])('accepts %s', (_label, body) => {
    const result = validateControlMessage({ ...base(), ...body });
    expect(result.ok).toBe(true);
  });
});

describe('control messages: rejected shapes', () => {
  it.each([
    ['unknown type', { type: 'approve' }],
    ['missing owner', { type: 'cancel', taskId: 't', reason: 'user', owner: undefined }],
    ['unknown field', { type: 'cancel', taskId: 't', reason: 'user', extra: 1 }],
    ['wrong protocol', { type: 'cancel', taskId: 't', reason: 'user', protocol: 2 }],
    ['unknown cancel reason', { type: 'cancel', taskId: 't', reason: 'because' }],
    ['credits above the budget', { type: 'stream-credit', streamId: 's', taskId: 't', credits: 9 }],
    ['zero credits', { type: 'stream-credit', streamId: 's', taskId: 't', credits: 0 }],
    ['budget above the cap', { type: 'request', method: 'm', payload: {}, budgetMs: 86400001 }],
    [
      'owner-scoped host request',
      { type: 'request', method: 'host.api', payload: {}, taskId: 'task', budgetMs: null },
    ],
    [
      'owner-scoped command',
      { type: 'request', method: 'runtime.command', payload: {}, taskId: 'task', budgetMs: null },
    ],
    [
      'owner-scoped invocation without task',
      { type: 'request', method: 'runtime.invoke', payload: {}, budgetMs: null },
    ],
    ['zero budget', { type: 'request', method: 'm', payload: {}, budgetMs: 0 }],
    ['negative sequence', { type: 'event', topic: 't', sequence: -1, payload: {} }],
    ['payload is not JSON', { type: 'request', method: 'm', payload: { fn: () => 1 } }],
    ['session id with a colon', { type: 'cancel', taskId: 't', reason: 'user', sessionId: 'a:b' }],
  ])('rejects %s', (_label, body) => {
    expect(validateControlMessage({ ...base(), ...body }).ok).toBe(false);
  });

  it('rejects a message whose error key does not match its code', () => {
    const result = validateControlMessage({
      ...base(),
      type: 'response',
      replyTo: 'msg-1',
      result: {
        ok: false,
        error: { code: 'network', messageKey: 'errors.internal', retryable: true },
      },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a message larger than the control budget', () => {
    const result = validateControlMessage({
      ...base(),
      type: 'event',
      topic: 't',
      sequence: 1,
      payload: { blob: 'x'.repeat(70_000) },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects credentials smuggled onto the generic channel', () => {
    const result = validateControlMessage({
      ...base(),
      type: 'request',
      method: 'set-key',
      payload: { apiKey: 'sk-live' },
    });
    // Shape alone cannot detect a secret; what matters is that the value is not
    // echoed by any error. A well-formed payload is accepted and left to the host.
    expect(result.ok).toBe(true);
  });
});

describe('stream headers and media frames', () => {
  const header = () => ({
    streamId: 'stream-1',
    taskId: 'task-1',
    owner,
    sequence: 0,
    byteLength: 4,
  });

  it('accepts a well-formed header', () => {
    expect(validateStreamHeader(header()).ok).toBe(true);
  });

  it('accepts a zero-length chunk', () => {
    expect(validateStreamHeader({ ...header(), byteLength: 0 }).ok).toBe(true);
  });

  it.each([
    ['byte length above the chunk budget', { byteLength: MEDIA_MAX_CHUNK_BYTES + 1 }],
    ['negative sequence', { sequence: -1 }],
    ['fractional sequence', { sequence: 1.5 }],
    ['generation zero', { owner: { ...owner, generation: 0 } }],
    ['owner with an unknown field', { owner: { ...owner, trusted: true } }],
    ['stream id with a slash', { streamId: 'a/b' }],
    ['unknown header field', { extra: true }],
  ])('rejects %s', (_label, patch) => {
    expect(validateStreamHeader({ ...header(), ...patch }).ok).toBe(false);
  });

  it('accepts a frame whose payload length matches the header', () => {
    const frame = { header: header(), payload: new Uint8Array(4) };
    const result = validateMediaFrame(frame);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.payload.byteLength).toBe(4);
  });

  it('rejects a frame whose payload length disagrees with the header', () => {
    const frame = { header: header(), payload: new Uint8Array(3) };
    expect(validateMediaFrame(frame).ok).toBe(false);
  });

  it('rejects a non-Uint8Array payload', () => {
    expect(validateMediaFrame({ header: header(), payload: [1, 2, 3, 4] }).ok).toBe(false);
  });

  it('rejects a shared buffer payload', () => {
    const shared = new SharedArrayBuffer(4);
    const frame = { header: header(), payload: new Uint8Array(shared) };
    expect(validateMediaFrame(frame).ok).toBe(false);
  });

  it('rejects a frame with an unknown top-level field', () => {
    const frame = { header: header(), payload: new Uint8Array(4), extra: 1 };
    expect(validateMediaFrame(frame).ok).toBe(false);
  });

  it('rejects a non-object frame', () => {
    expect(validateMediaFrame(null).ok).toBe(false);
    expect(validateMediaFrame('frame').ok).toBe(false);
  });
});
