import { mkdtemp, lstat, realpath, rm, chmod, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { LOCAL_HOST_PROTOCOL_VERSION } from '@pet/contracts';
import {
  openPrivateDirectory,
  readRendezvous,
  publishRendezvous,
  getOrCreateLocalHostId,
  newManagementCapability,
  type LocalHostRendezvous,
} from './rendezvous.js';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'local-host-rendezvous-'));
  const original = await lstat(root),
    absolute = await realpath(root);
  cleanup.push(async () => {
    const current = await lstat(absolute);
    if (
      (await realpath(absolute)) !== absolute ||
      current.dev !== original.dev ||
      current.ino !== original.ino ||
      path.dirname(absolute) !== (await realpath(tmpdir())) ||
      !path.basename(absolute).startsWith('local-host-rendezvous-')
    )
      throw new Error('Wrong owned cleanup');
    await rm(absolute, { recursive: true });
  });
  const directory = await openPrivateDirectory(path.join(root, 'private'));
  const value: LocalHostRendezvous = {
    format: 1,
    protocolVersion: LOCAL_HOST_PROTOCOL_VERSION,
    hostId: await getOrCreateLocalHostId(directory),
    bootId: randomUUID(),
    packageVersion: '0.1.0',
    endpoint: { host: '127.0.0.1', port: 12345 },
    managementCapability: newManagementCapability(),
  };
  return { root, directory, value };
}
it.skipIf(process.platform === 'win32')(
  'publishes only protected perboot identity and retires the exact inode without deleting host identity',
  async () => {
    const f = await fixture();
    expect(await readRendezvous(f.directory)).toBeNull();
    const published = await publishRendezvous(f.directory, f.value);
    expect(await readRendezvous(f.directory)).toEqual(f.value);
    expect((await lstat(path.join(f.directory.path, 'rendezvous.json'))).mode & 0o077).toBe(0);
    await published.retire();
    expect(await readRendezvous(f.directory)).toBeNull();
    expect(await getOrCreateLocalHostId(f.directory)).toBe(f.value.hostId);
  },
);
it.skipIf(process.platform === 'win32')(
  'old boot cannot retire a newer record or silently overwrite an unexpected record',
  async () => {
    const f = await fixture(),
      old = await publishRendezvous(f.directory, f.value);
    const next = {
      ...f.value,
      bootId: randomUUID(),
      managementCapability: newManagementCapability(),
    };
    await expect(publishRendezvous(f.directory, next)).rejects.toMatchObject({
      error: { code: 'conflict' },
    });
    const current = await publishRendezvous(f.directory, next, f.value);
    await expect(old.retire()).rejects.toMatchObject({ error: { code: 'stale-owner' } });
    expect(await readRendezvous(f.directory)).toEqual(next);
    await current.retire();
  },
);
it.skipIf(process.platform === 'win32')(
  'rejects world-readable, linked and oversized discovery rather than trusting a PID or remote URL',
  async () => {
    const f = await fixture(),
      published = await publishRendezvous(f.directory, f.value),
      name = path.join(f.directory.path, 'rendezvous.json');
    await chmod(name, 0o644);
    await expect(readRendezvous(f.directory)).rejects.toMatchObject({
      error: { code: 'permission-denied' },
    });
    await chmod(name, 0o600);
    await published.retire();
    const outside = path.join(f.root, 'outside');
    await writeFile(outside, JSON.stringify(f.value), { mode: 0o600 });
    await symlink(outside, name);
    await expect(readRendezvous(f.directory)).rejects.toMatchObject({
      error: { code: 'permission-denied' },
    });
  },
);
it.skipIf(process.platform === 'win32')(
  'concurrent retirement yields a captured record or absence without leaking a retired descriptor',
  async () => {
    const f = await fixture();
    for (let index = 0; index < 16; index++) {
      const published = await publishRendezvous(f.directory, f.value);
      const reads = Array.from({ length: 8 }, () => readRendezvous(f.directory));
      await published.retire();
      for (const observed of await Promise.all(reads))
        expect(observed === null || observed.bootId === f.value.bootId).toBe(true);
      expect(await readRendezvous(f.directory)).toBeNull();
    }
  },
);
