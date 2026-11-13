import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { JSON_MAX_BYTES, MEDIA_MAX_CHUNK_BYTES } from '@pet/contracts';
import {
  decodeSnowDownloadReply,
  decodeSnowUploadReply,
  encodeSnowMediaRequest,
  SNOW_UPLOAD_CHUNK_BYTES,
} from './media-wire.js';

const ECHO = 'qq-media:00000000-0000-4000-8000-000000000001:1';
const bytes = Buffer.from('a real fixture byte sequence');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const params = {
  stream_id: 'owned-upload',
  filename: 'fixture.txt',
  total_chunks: 1,
  file_size: bytes.byteLength,
  expected_sha256: sha256,
  file_retention: 300000,
};
const envelope = (data: unknown, echo = 'e') =>
  JSON.stringify({ status: 'ok', retcode: 0, data, echo, stream: 'stream-action' });

test('SnowLuma transfer upload serializes only a bounded raw chunk and needs a separate complete request', () => {
  const encoded = encodeSnowMediaRequest({
    action: 'upload_file_stream',
    echo: ECHO,
    params,
    chunk: { index: 0, bytes },
  });
  assert.ok(encoded.ok);
  const raw = JSON.parse(encoded.value) as {
    params: { chunk_data: string; chunk_index: number; is_complete?: boolean };
  };
  assert.deepEqual(Buffer.from(raw.params.chunk_data, 'base64'), bytes);
  assert.equal(raw.params.chunk_index, 0);
  assert.equal(raw.params.is_complete, undefined);
  const complete = encodeSnowMediaRequest({
    action: 'upload_file_stream',
    echo: 'qq-media:00000000-0000-4000-8000-000000000001:2',
    params: { ...params, is_complete: true },
  });
  assert.ok(complete.ok);
  assert.equal(
    encodeSnowMediaRequest({
      action: 'upload_file_stream',
      echo: ECHO,
      params: { ...params, is_complete: true },
      chunk: { index: 0, bytes },
    }).ok,
    false,
  );
  const big = Buffer.alloc(SNOW_UPLOAD_CHUNK_BYTES, 1);
  const bounded = encodeSnowMediaRequest({
    action: 'upload_file_stream',
    echo: ECHO,
    params: { ...params, file_size: big.byteLength },
    chunk: { index: 0, bytes: big },
  });
  assert.ok(bounded.ok);
  assert.ok(Buffer.byteLength(bounded.value) < JSON_MAX_BYTES);
});

test('SnowLuma upload progress is not completion and only a real matching terminal contains a stage reference', () => {
  const progress = decodeSnowUploadReply(
    envelope({
      type: 'stream',
      status: 'chunk_received',
      stream_id: params.stream_id,
      received_chunks: 1,
      total_chunks: 1,
    }),
    'e',
  );
  assert.ok(progress.ok);
  assert.equal(progress.value.kind, 'upload-progress');
  const complete = decodeSnowUploadReply(
    envelope({
      type: 'response',
      status: 'file_complete',
      stream_id: params.stream_id,
      received_chunks: 1,
      total_chunks: 1,
      file_path: '/remote/stream/owned-upload_fixture.txt',
      file_name: 'fixture.txt',
      file_size: bytes.length,
      sha256,
    }),
    'e',
  );
  assert.ok(complete.ok);
  assert.equal(complete.value.kind, 'upload-complete');
  assert.equal(
    decodeSnowUploadReply(
      envelope({
        type: 'response',
        status: 'file_complete',
        stream_id: params.stream_id,
        received_chunks: 0,
        total_chunks: 1,
        file_path: '/remote/a',
        file_name: 'a',
        file_size: 0,
        sha256,
      }),
      'e',
    ).ok,
    false,
  );
  assert.equal(
    decodeSnowUploadReply(
      envelope({
        type: 'stream',
        status: 'chunk_received',
        stream_id: params.stream_id,
        received_chunks: 1,
        total_chunks: 1,
      }),
      'other-echo',
    ).ok,
    false,
  );
});

test('SnowLuma transfer failure can omit stream marker; async and ordinary events are not file completion', () => {
  const error = JSON.stringify({
    status: 'failed',
    retcode: 1403,
    data: null,
    echo: 'e',
    wording: 'secret-url',
  });
  assert.deepEqual(decodeSnowUploadReply(error, 'e'), {
    ok: true,
    value: { kind: 'rejected', retcode: 1403 },
  });
  assert.equal(JSON.stringify(decodeSnowDownloadReply(error, 'e')).includes('secret-url'), false);
  assert.equal(
    decodeSnowUploadReply(
      JSON.stringify({ status: 'async', retcode: 1, data: null, echo: 'e' }),
      'e',
    ).ok,
    false,
  );
  assert.equal(
    decodeSnowDownloadReply(
      JSON.stringify({ status: 'ok', retcode: 0, data: {}, echo: 'e', post_type: 'message' }),
      'e',
    ).ok,
    false,
  );
});

test('SnowLuma download decodes exact bytes and preserves header unknown size without inventing a receipt ID', () => {
  const info = decodeSnowDownloadReply(
    envelope({
      type: 'stream',
      data_type: 'file_info',
      file_name: 'fixture.txt',
      file_size: 0,
      chunk_size: 16384,
    }),
    'e',
  );
  assert.ok(info.ok);
  assert.equal(info.value.kind, 'download-info');
  const base64 = bytes.toString('base64');
  const chunk = decodeSnowDownloadReply(
    envelope({
      type: 'stream',
      data_type: 'file_chunk',
      index: 0,
      data: base64,
      size: bytes.length,
      base64_size: base64.length,
      progress: 100,
    }),
    'e',
  );
  assert.ok(chunk.ok);
  if (chunk.value.kind !== 'download-chunk') throw new Error();
  assert.deepEqual(Buffer.from(chunk.value.bytes), bytes);
  const done = decodeSnowDownloadReply(
    envelope({
      type: 'response',
      data_type: 'file_complete',
      file_name: 'fixture.txt',
      total_chunks: 1,
      total_bytes: bytes.length,
      message: 'done',
    }),
    'e',
  );
  assert.ok(done.ok);
  assert.equal(done.value.kind, 'download-complete');
  assert.equal('stream_id' in done.value, false);
});

test('SnowLuma chunk size, base64 and count corruption are rejected before a consumer sees bytes', () => {
  const base64 = bytes.toString('base64');
  const valid = {
    type: 'stream',
    data_type: 'file_chunk',
    index: 0,
    data: base64,
    size: bytes.length,
    base64_size: base64.length,
  };
  for (const chunk of [
    { ...valid, data: `${base64}!`, base64_size: base64.length + 1 },
    { ...valid, size: bytes.length + 1 },
    { ...valid, base64_size: base64.length - 1 },
    { ...valid, index: -1 },
    { ...valid, size: MEDIA_MAX_CHUNK_BYTES + 1 },
  ])
    assert.equal(decodeSnowDownloadReply(envelope(chunk), 'e').ok, false);
});
