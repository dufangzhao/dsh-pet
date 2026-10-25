import { app, BrowserWindow, safeStorage } from 'electron';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { CredentialBroker, CredentialError } from '../../packages/host-kernel/src/credentials/credential-broker.js';
import { FileCiphertextStore } from '../../packages/host-kernel/src/credentials/file-ciphertext-store.js';
import { createSafeStorageCipher } from '../../packages/host-kernel/src/credentials/secret-cipher.js';
const directory = __dirname;
app.setPath('userData', path.join(directory, 'profile'));
const report: Record<string, unknown> = { status: 'starting', fixtureOnly: true };
void app.whenReady().then(async () => {
  const vault = path.join(directory, 'vault'); await fs.mkdir(vault, { recursive: true });
  const store = new FileCiphertextStore(vault);
  const broker = new CredentialBroker({ cipher: createSafeStorageCipher(safeStorage), store, authorize: async () => ({ isValid: () => true, close: () => {} }) });
  const alpha = { pluginId: 'test.alpha', instanceId: 'native-smoke', generation: 1 };
  const beta = { pluginId: 'test.beta', instanceId: 'native-smoke', generation: 1 };
  const fixture = 'm1-public-credential-fixture';
  const task = { taskId: 'native-smoke', signal: new AbortController().signal };
  const aKey = JSON.stringify([alpha.pluginId, alpha.instanceId, 'api-key']);
  const bKey = JSON.stringify([beta.pluginId, beta.instanceId, 'api-key']);
  try {
    assert.equal(process.versions.electron, '45.0.0'); assert.equal(process.platform, 'win32');
    report['stage'] = 'native-cipher-shape';
    const nativeCipher = await safeStorage.encryptStringAsync('public-shape-fixture');
    report['cipherShape'] = { buffer: Buffer.isBuffer(nativeCipher), view: ArrayBuffer.isView(nativeCipher), tag: Object.prototype.toString.call(nativeCipher), bytes: nativeCipher.byteLength, offset: nativeCipher.byteOffset, backingBytes: nativeCipher.buffer.byteLength };
    const pooledCopy = Buffer.from(Uint8Array.from(nativeCipher));
    const ownedCopy = Buffer.alloc(nativeCipher.byteLength); ownedCopy.set(nativeCipher);
    const checks = [];
    for (const [kind, bytes] of [['original', nativeCipher], ['pooled-copy', pooledCopy], ['owned-copy', ownedCopy]] as const) {
      let ok = false; try { ok = (await safeStorage.decryptStringAsync(bytes)).result === 'public-shape-fixture'; } catch { /* metadata only */ }
      checks.push({ kind, sameBytes: bytes.equals(nativeCipher), offset: bytes.byteOffset, backingBytes: bytes.buffer.byteLength, ok });
    }
    report['bufferComparison'] = checks;
    report['stage'] = 'set-secret';
    await broker.setSecret(alpha, 'api-key', fixture);
    const a = broker.issueClient(alpha, ['api-key']);
    report['stage'] = 'direct-store-read';
    const storedProbe = await store.read(aKey); report['storedBytes'] = storedProbe?.byteLength; assert.ok(storedProbe);
    report['stage'] = 'direct-cipher-read';
    const decodedProbe = await createSafeStorageCipher(safeStorage).decrypt(storedProbe);
    report['decodedShape'] = { string: typeof decodedProbe.plaintext === 'string', boundFixture: decodedProbe.plaintext.includes(fixture), shouldReEncrypt: decodedProbe.shouldReEncrypt };
    report['stage'] = 'same-owner-read';
    assert.equal(await a.withSecret('api-key', task, async secret => secret === fixture), true);
    const ciphertext = await store.read(aKey); assert.ok(ciphertext);
    const files = await fs.readdir(vault); const contents = await Promise.all(files.filter(f => f.endsWith('.sealed')).map(f => fs.readFile(path.join(vault, f), 'utf8')));
    assert.ok(contents.every(text => !text.includes(fixture)));
    report['stage'] = 'namespace-tamper';
    await store.write(bKey, ciphertext);
    const b = broker.issueClient(beta, ['api-key']);
    await assert.rejects(b.withSecret('api-key', task, async () => true), { code: 'permission-denied' });
    report['stage'] = 'revoke';
    broker.revoke(alpha);
    await assert.rejects(a.withSecret('api-key', task, async () => true), { code: 'stale-owner' });
    report['status'] = 'passed'; report['runtime'] = { electron: process.versions.electron, node: process.versions.node };
    report['checks'] = ['async-DPAPI-roundtrip', 'ciphertext-only-disk', 'mismatched-namespace-rejected', 'revoked-client-rejected'];
    report['windowCount'] = BrowserWindow.getAllWindows().length; assert.equal(report['windowCount'], 0);
  } finally {
    try { await store.remove(aKey); await store.remove(bKey); report['cleanup'] = 'complete'; }
    catch { report['cleanup'] = 'failed'; throw new Error('Fixture cleanup failed'); }
  }
}).catch(error => { report['status'] = 'failed'; report['failureCode'] = error instanceof CredentialError ? error.code : 'fixture-or-adapter-failure'; process.exitCode = 1; }).finally(async () => {
  await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify(report) + String.fromCharCode(10)); app.exit(report['status'] === 'passed' ? 0 : 1);
});
