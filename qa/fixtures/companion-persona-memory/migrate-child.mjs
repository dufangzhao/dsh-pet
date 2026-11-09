// Child process for the actual offline migration API, only against generated QA paths.
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { register } from 'tsx/esm/api';

const [data, backup] = process.argv.slice(2);
const temporary = await realpath(os.tmpdir());
const root = await realpath(data);
assert.equal(path.dirname(root), temporary);
assert.match(path.basename(root), /^companion-m3-v1-/);
const backupParent = await realpath(path.dirname(backup));
assert.equal(path.dirname(backupParent), temporary);
assert.match(path.basename(backupParent), /^companion-m3-backup-/);
assert.equal(path.basename(backup), 'backup');
register();
const { migrateCompanionData } = await import('../../../apps/companion-service/dist/migrate.mjs');
try {
  const result = await migrateCompanionData({ dataDirectory: root, backupDirectory: backup });
  console.log(JSON.stringify({ ok: true, value: result }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, code: error?.error?.code ?? error?.code ?? 'unavailable' }));
}
