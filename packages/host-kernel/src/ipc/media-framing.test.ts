import { expect, it } from 'vitest';
import type { MediaFrame, Result } from '@pet/contracts';
import { encodeMediaFrame, MediaFrameDecoder, MEDIA_HEADER_BYTES } from './media-framing.js';
const frame = (seq = 0, bytes = new Uint8Array([1, 2, 3])): MediaFrame => ({
  header: {
    streamId: 's',
    taskId: 't',
    owner: { pluginId: 'test.media', instanceId: 'default', generation: 1 },
    sequence: seq,
    byteLength: bytes.length,
  },
  payload: bytes,
});
const unwrap = <T>(v: Result<T>) => {
  if (!v.ok) throw new Error(v.error.code);
  return v.value;
};
it('decodes every single-byte fragmentation without aliasing input', () => {
  const result: MediaFrame[] = [];
  const bytes = unwrap(encodeMediaFrame(frame()));
  const decoder = new MediaFrameDecoder((value) => {
    result.push(value);
    return { ok: true, value: null };
  });
  for (const byte of bytes) expect(decoder.feed(new Uint8Array([byte])).ok).toBe(true);
  expect(result).toEqual([frame()]);
  expect(decoder.end().ok).toBe(true);
  expect(decoder.bufferedBytes()).toBe(0);
});
it('handles concatenated frames including a zero-byte payload', () => {
  const a = unwrap(encodeMediaFrame(frame(0, new Uint8Array()))),
    b = unwrap(encodeMediaFrame(frame(1)));
  const result: MediaFrame[] = [];
  const decoder = new MediaFrameDecoder((value) => {
    result.push(value);
    return { ok: true, value: null };
  });
  expect(decoder.feed(Buffer.concat([a, b])).ok).toBe(true);
  expect(result.map((f) => f.header.sequence)).toEqual([0, 1]);
  expect(decoder.end().ok).toBe(true);
});
it('refuses declared lengths before allocating their contents', () => {
  const prefix = Buffer.alloc(8);
  prefix.writeUInt32BE(MEDIA_HEADER_BYTES + 1, 0);
  prefix.writeUInt32BE(0xffffffff, 4);
  const decoder = new MediaFrameDecoder(() => ({ ok: true, value: null }));
  expect(decoder.feed(prefix)).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
  expect(decoder.bufferedBytes()).toBe(0);
});
it('reports truncated input rather than a normal end', () => {
  const decoder = new MediaFrameDecoder(() => ({ ok: true, value: null }));
  decoder.feed(unwrap(encodeMediaFrame(frame())).slice(0, 10));
  expect(decoder.end()).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
});
it('keeps the first bounded failure and does not echo malformed metadata', () => {
  const h = Buffer.from('private-not-json');
  const prefix = Buffer.alloc(8);
  prefix.writeUInt32BE(h.length, 0);
  const decoder = new MediaFrameDecoder(() => ({ ok: true, value: null }));
  const bad = decoder.feed(Buffer.concat([prefix, h]));
  expect(JSON.stringify(bad)).not.toContain('private-not-json');
  expect(decoder.feed(unwrap(encodeMediaFrame(frame())))).toEqual(bad);
});
it('honors sink rejection instead of dropping a frame silently', () => {
  const decoder = new MediaFrameDecoder(() => ({
    ok: false,
    error: { code: 'quota-exceeded', messageKey: 'errors.quota-exceeded', retryable: true },
  }));
  expect(decoder.feed(unwrap(encodeMediaFrame(frame())))).toMatchObject({
    ok: false,
    error: { code: 'quota-exceeded' },
  });
});
it('stops the same read batch when its sink closes the parser', () => {
  let count = 0;
  const decoder = new MediaFrameDecoder(() => {
    count++;
    decoder.abort({ code: 'cancelled', messageKey: 'errors.cancelled', retryable: false });
    return { ok: true, value: null };
  });
  const bytes = Buffer.concat([
    unwrap(encodeMediaFrame(frame(0))),
    unwrap(encodeMediaFrame(frame(1))),
  ]);
  expect(decoder.feed(bytes)).toMatchObject({ ok: false, error: { code: 'cancelled' } });
  expect(count).toBe(1);
  expect(decoder.bufferedBytes()).toBe(0);
});
it('does not accept bytes after a normal transport end', () => {
  const decoder = new MediaFrameDecoder(() => ({ ok: true, value: null }));
  expect(decoder.end().ok).toBe(true);
  expect(decoder.feed(unwrap(encodeMediaFrame(frame())))).toMatchObject({
    ok: false,
    error: { code: 'not-ready' },
  });
});
