import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SseDecoder } from '../src/client/sse.ts';

test('decodes framed events and ignores comments', () => {
  const decoder = new SseDecoder();
  const messages = decoder.push(
    ': keep-alive\n\nid: 7\nevent: companion\ndata: {"sequence":7}\n\n',
  );
  assert.deepEqual(messages, [{ event: 'companion', data: '{"sequence":7}', id: '7' }]);
});

test('buffers a partial frame until the blank line arrives', () => {
  const decoder = new SseDecoder();
  assert.deepEqual(decoder.push('event: companion\ndata: {"a":'), []);
  const messages = decoder.push('1}\n\n');
  assert.deepEqual(messages, [{ event: 'companion', data: '{"a":1}', id: null }]);
});

test('handles CRLF split across chunks', () => {
  const decoder = new SseDecoder();
  assert.deepEqual(decoder.push('event: refresh\r'), []);
  assert.deepEqual(decoder.push('\ndata: {}\r\n\r\n'), [
    { event: 'refresh', data: '{}', id: null },
  ]);
});

test('joins multi-line data and defaults the event name', () => {
  const decoder = new SseDecoder();
  const messages = decoder.push('data: line one\ndata: line two\n\n');
  assert.deepEqual(messages, [{ event: 'message', data: 'line one\nline two', id: null }]);
});
