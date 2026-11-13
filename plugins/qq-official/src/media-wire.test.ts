import assert from 'node:assert/strict';
import test from 'node:test';
import { COMPANION_MATERIAL_FILE_MAX_BYTES } from '@pet/contracts';
import {
  decodeOfficialPrepared,
  isOfficialPartFinished,
  officialMediaPath,
  officialPrepareBody,
  validOfficialMediaMetadata,
  OFFICIAL_PREFIX_HASH_BYTES,
} from './media-wire.js';

const metadata = {
  scene: 'c2c' as const,
  targetId: 'opaque-target',
  file_type: 4 as const,
  file_name: 'report.txt',
  sizeBytes: 11,
};
const hashes = {
  md5: 'a'.repeat(32),
  sha1: 'b'.repeat(40),
  md5_10m: 'c'.repeat(32),
  sha256: 'd'.repeat(64),
};
const response = (data: unknown) => ({ status: 200, body: JSON.stringify(data) });
const prepared = {
  upload_id: 'provider-upload',
  block_size: '8',
  parts: [
    {
      index: 1,
      presigned_url: 'https://cos.example.invalid/part?token=private-b',
      block_size: '3',
    },
    {
      index: 0,
      presigned_url: 'https://cos.example.invalid/part?token=private-a',
      block_size: '8',
    },
  ],
};

test('official native media metadata is bounded and hashes use the exact documented prefix length', () => {
  assert.equal(validOfficialMediaMetadata(metadata), true);
  assert.equal(
    validOfficialMediaMetadata({ ...metadata, sizeBytes: COMPANION_MATERIAL_FILE_MAX_BYTES + 1 }),
    false,
  );
  assert.equal(validOfficialMediaMetadata({ ...metadata, file_type: 2 }), false);
  assert.equal(
    validOfficialMediaMetadata({ ...metadata, url: 'https://unselected.invalid' }),
    false,
  );
  assert.equal(OFFICIAL_PREFIX_HASH_BYTES, 10_002_432);
  const encoded = officialPrepareBody(metadata, hashes);
  assert.ok(encoded.ok);
  assert.deepEqual(encoded.value, {
    file_type: 4,
    file_name: 'report.txt',
    file_size: '11',
    md5: hashes.md5,
    sha1: hashes.sha1,
    md5_10m: hashes.md5_10m,
  });
  assert.equal(
    officialMediaPath(metadata, 'upload_prepare'),
    '/v2/users/opaque-target/upload_prepare',
  );
});

test('official prepare uses actual upload ID and complete indexed byte ranges, independent of array order', () => {
  const parsed = decodeOfficialPrepared(response(prepared), 11);
  assert.ok(parsed.ok);
  assert.equal(parsed.value.upload_id, 'provider-upload');
  assert.deepEqual(
    parsed.value.parts.map((part) => [part.index, part.offset, part.byteLength]),
    [
      [0, 0, 8],
      [1, 8, 3],
    ],
  );
  assert.equal(parsed.value.parts[0]?.presigned_url, prepared.parts[1]?.presigned_url);
});

test('official missing, duplicate, inconsistent and unsafe preparation data never fabricate a plan', () => {
  for (const data of [
    { ...prepared, upload_id: undefined },
    { ...prepared, parts: prepared.parts.slice(1) },
    { ...prepared, parts: [prepared.parts[0], prepared.parts[0]] },
    {
      ...prepared,
      parts: [
        { index: 0, presigned_url: 'https://cos.example.invalid/p', block_size: '9' },
        prepared.parts[0],
      ],
    },
    { ...prepared, code: 40093002 },
    {
      ...prepared,
      parts: [
        { index: 0, presigned_url: 'http://cos.example.invalid/p', block_size: '8' },
        prepared.parts[0],
      ],
    },
    {
      ...prepared,
      parts: [
        { index: 0, presigned_url: 'https://name:secret@cos.example.invalid/p', block_size: '8' },
        prepared.parts[0],
      ],
    },
  ]) {
    const result = decodeOfficialPrepared(response(data), 11);
    assert.equal(result.ok, false);
    assert.equal(JSON.stringify(result).includes('secret'), false);
  }
  assert.equal(decodeOfficialPrepared({ status: 200, body: 'bad-json' }, 11).ok, false);
});

test('official part confirmation is not a file or message receipt', () => {
  assert.equal(isOfficialPartFinished(response({})), true);
  assert.equal(isOfficialPartFinished(response({ code: 0 })), true);
  assert.equal(isOfficialPartFinished(response({ code: 40093001 })), false);
  assert.equal(
    isOfficialPartFinished(response({ file_uuid: 'f', file_info: 'private', ttl: 300 })),
    false,
  );
  assert.equal(isOfficialPartFinished({ status: 504, body: '{}' }), false);
});
