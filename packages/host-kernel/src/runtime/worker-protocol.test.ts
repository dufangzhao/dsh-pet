import path from 'node:path';
import { expect, it } from 'vitest';
import type { PluginManifest } from '@pet/contracts';
import { manifestDigest, parseBootstrap } from './worker-protocol.js';
const owner = { pluginId: 'core.runtime', instanceId: 'test', generation: 1 };
const bootstrap = {
  version: 1,
  sessionId: 's',
  owner,
  roots: [{ directory: path.resolve('.'), origin: 'user' }],
};
it('accepts only host-owned absolute directory configuration', () => {
  expect(parseBootstrap(bootstrap)).not.toBeNull();
  expect(
    parseBootstrap({ ...bootstrap, roots: [{ directory: 'relative', origin: 'user' }] }),
  ).toBeNull();
  expect(
    parseBootstrap({ ...bootstrap, roots: [{ directory: path.resolve('.'), origin: 'network' }] }),
  ).toBeNull();
  expect(parseBootstrap({ ...bootstrap, extra: true })).toBeNull();
  expect(parseBootstrap({ ...bootstrap, owner: { ...owner, generation: 0 } })).toBeNull();
});
it('bounds startup directories and snapshots caller data', () => {
  expect(
    parseBootstrap({ ...bootstrap, roots: Array.from({ length: 9 }, () => bootstrap.roots[0]) }),
  ).toBeNull();
  const parsed = parseBootstrap(bootstrap)!;
  bootstrap.roots[0]!.origin = 'builtin';
  expect(parsed.roots[0]?.origin).toBe('user');
  bootstrap.roots[0]!.origin = 'user';
});
it('uses a stable canonical manifest digest rather than key order', () => {
  const a = {
    id: 'test',
    version: '1',
    displayName: { b: '2', a: '1' },
  } as unknown as PluginManifest;
  const b = {
    displayName: { a: '1', b: '2' },
    version: '1',
    id: 'test',
  } as unknown as PluginManifest;
  expect(manifestDigest(a)).toBe(manifestDigest(b));
  expect(manifestDigest({ ...b, version: '2' })).not.toBe(manifestDigest(a));
});
