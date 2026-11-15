import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
export async function within(promise, label, timeout = 15000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export function ok(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
}
export const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const keyOf = (request) => `${request.delivery.id}/${request.partId}/${request.operation}`;
export function png(padding = 0) {
  const chunk = (kind, data) => {
    const value = Buffer.alloc(12 + data.length);
    value.writeUInt32BE(data.length);
    value.write(kind, 4);
    data.copy(value, 8);
    value.writeUInt32BE(crc32(value.subarray(4, -4)), value.length - 4);
    return value;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, 255, 128, 0, 255]))),
    ...(padding ? [chunk('tEXt', Buffer.from(`Comment\0${'x'.repeat(padding)}`))] : []),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
export function noPrivate(value) {
  const body = JSON.stringify(value);
  return (
    !body.includes('PRIVATE_LOCAL_FILE_INFO_CANARY') &&
    !body.includes('CONTROLLED_QQ_SECRET_CANARY')
  );
}
export const bridgeManifest = {
  schemaVersion: 1,
  id: 'pet.local-host-bridge',
  version: '0.1.0',
  displayName: { en: 'Controlled bridge QA owner' },
  description: {
    en: 'G0 owner-seeded State and actual task composition fixture; not participant admission',
  },
  license: 'MIT',
  host: '^1.0.0',
  platforms: ['linux-x64', 'win32-x64', 'darwin-arm64'],
  entries: { runtime: 'bridge-server.mjs' },
  permissions: [
    { kind: 'files', scope: 'plugin-data', access: 'read-write' },
    { kind: 'capability-use', capability: 'companion.state@1' },
  ],
};
