import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeError, type KernelError, type PluginManifest } from '@pet/contracts';
import { validateManifest } from '@pet/contracts/validation';
import { freezeJson } from './identity.js';
import type { PluginLoader, PluginModule } from './types.js';
export interface DiscoveryRoot {
  readonly directory: string;
  readonly origin: 'builtin' | 'user';
}
export interface FileEvidence {
  readonly relativePath: string;
  readonly sha256: string;
  readonly bytes: number;
}
export interface DiscoveredPlugin {
  readonly directory: string;
  readonly origin: 'builtin' | 'user';
  readonly manifest: PluginManifest;
  readonly files: readonly FileEvidence[];
}
export interface DiscoveryIssue {
  readonly directory: string;
  readonly error: KernelError;
}
export interface DiscoveryReport {
  readonly plugins: readonly DiscoveredPlugin[];
  readonly issues: readonly DiscoveryIssue[];
  readonly complete: boolean;
}
const verified = new WeakSet<object>();
const loadedLocations = new Map<string, string>();
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_PACKAGES = 256;
const MAX_ENTRIES = 64;
const samePath = (a: string, b: string) =>
  process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
async function plainDirectory(directory: string): Promise<void> {
  if (!path.isAbsolute(directory)) throw new Error('Invalid directory');
  const resolved = path.resolve(directory);
  const stat = await fs.lstat(resolved);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    !samePath(await fs.realpath(resolved), resolved)
  )
    throw new Error('Invalid directory');
}
async function readBounded(root: string, relativePath: string, maxBytes: number): Promise<Buffer> {
  const target = path.resolve(root, relativePath);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('Path escaped');
  let cursor = root;
  const parts = relative.split(path.sep);
  for (let i = 0; i < parts.length; i++) {
    cursor = path.join(cursor, parts[i]!);
    const info = await fs.lstat(cursor);
    if (info.isSymbolicLink() || (i < parts.length - 1 ? !info.isDirectory() : !info.isFile()))
      throw new Error('Linked entry');
  }
  const before = await fs.lstat(target, { bigint: true });
  if (before.size > BigInt(maxBytes)) throw new Error('Entry too large');
  const handle = await fs.open(target, 'r');
  try {
    const opened = await handle.stat({ bigint: true });
    if (opened.ino !== before.ino || opened.dev !== before.dev || !opened.isFile())
      throw new Error('Entry changed');
    const bytes = Buffer.alloc(maxBytes + 1);
    let count = 0;
    while (count < bytes.length) {
      const read = await handle.read(bytes, count, bytes.length - count, count);
      if (!read.bytesRead) break;
      count += read.bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (count > maxBytes || after.size !== opened.size || after.mtimeNs !== opened.mtimeNs)
      throw new Error('Entry changed');
    return bytes.subarray(0, count);
  } finally {
    await handle.close();
  }
}
const fingerprint = (relativePath: string, bytes: Buffer): FileEvidence =>
  Object.freeze({
    relativePath,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
  });
async function inspectPackage(
  directory: string,
  origin: 'builtin' | 'user',
): Promise<DiscoveredPlugin> {
  await plainDirectory(directory);
  const raw = await readBounded(directory, 'plugin.json', 65536);
  const input: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  const parsed = validateManifest(input);
  if (!parsed.ok) throw new Error('Invalid manifest');
  const manifest = parsed.value;
  const entries = [
    manifest.entries.runtime,
    ...(manifest.entries.ui ? [manifest.entries.ui] : []),
    ...Object.values(manifest.entries.workers ?? {}),
  ];
  const unique = [...new Set(entries)];
  if (unique.length > MAX_ENTRIES) throw new Error('Too many entries');
  const files = [fingerprint('plugin.json', raw)];
  for (const entry of unique)
    files.push(fingerprint(entry, await readBounded(directory, entry, MAX_ENTRY_BYTES)));
  const value = freezeJson({ directory: path.resolve(directory), origin, manifest, files });
  verified.add(value);
  return value;
}
/** Rechecks the same discovered code package without evaluating it. */
export async function verifyDiscoveredPlugin(candidate: DiscoveredPlugin): Promise<boolean> {
  if (!verified.has(candidate)) return false;
  try {
    const current = await inspectPackage(candidate.directory, candidate.origin);
    return JSON.stringify(current.files) === JSON.stringify(candidate.files);
  } catch {
    return false;
  }
}
/** Lists immediate package directories only. No import, install, network or fallback root. */
export async function discoverPlugins(roots: readonly DiscoveryRoot[]): Promise<DiscoveryReport> {
  const plugins: DiscoveredPlugin[] = [];
  const issues: DiscoveryIssue[] = [];
  let complete = true;
  for (const root of roots) {
    try {
      if (!['builtin', 'user'].includes(root.origin)) throw new Error('Invalid origin');
      await plainDirectory(root.directory);
      const entries = (await fs.readdir(root.directory, { withFileTypes: true })).sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      const candidates = entries.filter((entry) => entry.isDirectory() || entry.isSymbolicLink());
      if (candidates.length > MAX_PACKAGES) {
        issues.push({ directory: root.directory, error: makeError('quota-exceeded', false) });
        complete = false;
        continue;
      }
      for (const entry of candidates) {
        const directory = path.join(root.directory, entry.name);
        try {
          if (entry.isSymbolicLink()) throw new Error('Linked package');
          plugins.push(await inspectPackage(directory, root.origin));
        } catch {
          issues.push({ directory, error: makeError('invalid-input', false) });
        }
      }
    } catch {
      complete = false;
      issues.push({ directory: root.directory, error: makeError('unavailable', false) });
    }
  }
  return freezeJson({ plugins, issues, complete });
}
/** An entry-only integrity recheck, not a whole-package signature or malicious same-user sandbox. */
export function createVerifiedPluginLoader(packages: readonly DiscoveredPlugin[]): PluginLoader {
  const allowed = [...packages];
  if (allowed.some((candidate) => !verified.has(candidate))) throw new Error('Unverified package');
  return async (activation) => {
    if (activation.signal.aborted) throw new Error('Activation cancelled');
    const candidate = allowed.find(
      (item) =>
        item.manifest.id === activation.manifest.id &&
        samePath(path.resolve(item.directory, item.manifest.entries.runtime), activation.entryPath),
    );
    if (!candidate) throw new Error('Unverified package');
    await plainDirectory(candidate.directory);
    for (const entry of candidate.files) {
      const bytes = await readBounded(
        candidate.directory,
        entry.relativePath,
        entry.relativePath === 'plugin.json' ? 65536 : MAX_ENTRY_BYTES,
      );
      if (
        bytes.length !== entry.bytes ||
        fingerprint(entry.relativePath, bytes).sha256 !== entry.sha256
      )
        throw new Error('Package changed');
    }
    if (activation.signal.aborted) throw new Error('Activation cancelled');
    const file = path.resolve(candidate.directory, candidate.manifest.entries.runtime);
    if (!['.mjs', '.js', '.cjs'].includes(path.extname(file))) throw new Error('Unsupported entry');
    const url = pathToFileURL(file).href;
    const identity = createHash('sha256').update(JSON.stringify(candidate.files)).digest('hex');
    const loaded = loadedLocations.get(url);
    if (loaded !== undefined && loaded !== identity)
      throw new Error('Changed package requires a new version directory or runtime restart');
    loadedLocations.set(url, identity);
    const imported: unknown = await import(url);
    const module = (imported as { default?: unknown }).default;
    if (
      !module ||
      typeof module !== 'object' ||
      typeof (module as PluginModule).activate !== 'function'
    )
      throw new Error('Invalid plugin export');
    return module as PluginModule;
  };
}
