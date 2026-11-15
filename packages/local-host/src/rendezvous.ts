import { constants, type Stats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import {
  initializeWindowsPrivateDirectory,
  verifyWindowsPrivateDirectory,
  verifyWindowsPrivateFile,
  type WindowsPrivateDirectory,
} from './windows-private-directory.js';
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { KernelFault } from '@pet/host-kernel';
import { LOCAL_HOST_PROTOCOL_VERSION, type LocalHostRuntimeIdentity } from '@pet/contracts';

/** Native Main only. The capability authenticates this daemon boot, never an Agent/QQ role. */
export interface LocalHostRendezvous extends LocalHostRuntimeIdentity {
  readonly format: 1;
  readonly endpoint: { readonly host: '127.0.0.1'; readonly port: number };
  readonly managementCapability: string;
}
export interface PrivateDirectory {
  readonly path: string;
  readonly dev: number;
  readonly ino: number;
  readonly uid: number;
  readonly windows?: WindowsPrivateDirectory;
}
const NAME = 'rendezvous.json';
const MAX_BYTES = 4096;
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}
export function isLocalHostRendezvous(value: unknown): value is LocalHostRendezvous {
  const v = record(value),
    endpoint = v && record(v['endpoint']);
  return (
    !!v &&
    exact(v, [
      'format',
      'protocolVersion',
      'hostId',
      'bootId',
      'packageVersion',
      'endpoint',
      'managementCapability',
    ]) &&
    v['format'] === 1 &&
    v['protocolVersion'] === LOCAL_HOST_PROTOCOL_VERSION &&
    uuid(v['hostId']) &&
    uuid(v['bootId']) &&
    typeof v['packageVersion'] === 'string' &&
    /^(?![\s\S]*[\r\n])[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(v['packageVersion']) &&
    v['packageVersion'].length <= 64 &&
    typeof v['managementCapability'] === 'string' &&
    /^[a-f0-9]{64}$/.test(v['managementCapability']) &&
    !!endpoint &&
    exact(endpoint, ['host', 'port']) &&
    endpoint['host'] === '127.0.0.1' &&
    typeof endpoint['port'] === 'number' &&
    Number.isSafeInteger(endpoint['port']) &&
    endpoint['port'] > 0 &&
    endpoint['port'] <= 65535
  );
}
function privateEntry(info: Stats, directory: boolean): void {
  if (process.platform === 'win32') {
    if (
      info.isSymbolicLink() ||
      (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1)
    )
      throw new KernelFault('permission-denied');
    return; // Owner/DACL authority comes from the Windows handle verifier, not uid/mode bits.
  }
  if (
    !process.getuid ||
    info.uid !== process.getuid() ||
    info.isSymbolicLink() ||
    (info.mode & 0o077) !== 0 ||
    (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1)
  )
    throw new KernelFault('permission-denied');
}
/** Native role UserData only. Existing Windows ACLs are verified, never repaired. */
export async function openPrivateDirectory(directory: string): Promise<PrivateDirectory> {
  if (!path.isAbsolute(directory)) throw new KernelFault('not-ready');
  const absolute = path.resolve(directory);
  if (process.platform === 'win32') {
    const windows = await initializeWindowsPrivateDirectory(
      path.dirname(absolute),
      path.basename(absolute),
    );
    const info = await lstat(windows.path);
    privateEntry(info, true);
    return { path: windows.path, dev: info.dev, ino: info.ino, uid: info.uid, windows };
  }
  await mkdir(absolute, { mode: 0o700, recursive: true });
  if ((await realpath(absolute)) !== absolute) throw new KernelFault('permission-denied');
  const info = await lstat(absolute);
  privateEntry(info, true);
  return { path: absolute, dev: info.dev, ino: info.ino, uid: info.uid };
}
async function checkDirectory(directory: PrivateDirectory): Promise<void> {
  if (process.platform === 'win32') {
    if (!directory.windows || directory.windows.path !== directory.path)
      throw new KernelFault('permission-denied');
    await verifyWindowsPrivateDirectory(directory.windows);
    return;
  }
  const info = await lstat(directory.path);
  privateEntry(info, true);
  if (
    (await realpath(directory.path)) !== directory.path ||
    info.dev !== directory.dev ||
    info.ino !== directory.ino ||
    info.uid !== directory.uid
  )
    throw new KernelFault('permission-denied');
}
/** Stable local provenance only; cannot be supplied by a renderer as filesystem authority. */
export async function privateDirectoryIdentity(directory: PrivateDirectory): Promise<string> {
  await checkDirectory(directory);
  let coordinates: readonly string[];
  if (directory.windows) {
    const native = await verifyWindowsPrivateDirectory(directory.windows);
    coordinates = [
      path.win32.normalize(native.path).toLowerCase(),
      native.volumeId,
      native.fileId,
      native.userSid,
    ];
  } else {
    const info = await lstat(directory.path, { bigint: true });
    coordinates = [directory.path, info.dev.toString(), info.ino.toString(), info.uid.toString()];
  }
  return createHash('sha256').update(JSON.stringify(coordinates)).digest('hex');
}
async function verifyPrivateFile(
  directory: PrivateDirectory,
  name: string,
  file: FileHandle,
): Promise<true | string | null> {
  if (process.platform !== 'win32') return true;
  if (!directory.windows) throw new KernelFault('permission-denied');
  const current = await verifyWindowsPrivateFile(directory.windows, name);
  if (!current) return null;
  const fd = await file.stat({ bigint: true });
  if (!fd.isFile() || fd.nlink !== 1n || fd.ino.toString(16).padStart(16, '0') !== current.fileId)
    throw new KernelFault('conflict');
  return `${current.volumeId}:${current.fileId}`;
}
function missing(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
}
async function read(
  directory: PrivateDirectory,
): Promise<{ value: LocalHostRendezvous; identity: Stats; nativeIdentity: string | null } | null> {
  await checkDirectory(directory);
  let file;
  try {
    file = await open(path.join(directory.path, NAME), constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (missing(error)) return null;
    throw new KernelFault('permission-denied');
  }
  try {
    const info = await file.stat();
    privateEntry(info, false);
    if (!(await verifyPrivateFile(directory, NAME, file))) return null;
    if (info.size > MAX_BYTES) throw new KernelFault('quota-exceeded');
    const bytes = await file.readFile();
    if (bytes.byteLength > MAX_BYTES) throw new KernelFault('quota-exceeded');
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new KernelFault('invalid-input');
    }
    if (!isLocalHostRendezvous(parsed)) throw new KernelFault('invalid-input');
    await checkDirectory(directory);
    const after = await lstat(path.join(directory.path, NAME)).catch((error) => {
      if (missing(error)) return null;
      throw error;
    });
    if (!after) return null; // A retired record must not escape through an already-open descriptor.
    privateEntry(after, false);
    const nativeIdentity = await verifyPrivateFile(directory, NAME, file);
    if (!nativeIdentity) return null;
    if (info.dev !== after.dev || info.ino !== after.ino || info.size !== after.size)
      throw new KernelFault('conflict');
    return {
      value: parsed,
      identity: info,
      nativeIdentity: nativeIdentity === true ? null : nativeIdentity,
    };
  } finally {
    await file.close();
  }
}
export async function readRendezvous(
  directory: PrivateDirectory,
): Promise<LocalHostRendezvous | null> {
  return (await read(directory))?.value ?? null;
}
/** Called only by the process holding the native per-profile singleton. No PID-based takeover. */
export async function publishRendezvous(
  directory: PrivateDirectory,
  value: LocalHostRendezvous,
  expectedPrevious: LocalHostRendezvous | null = null,
): Promise<{ retire(): Promise<void> }> {
  if (!isLocalHostRendezvous(value)) throw new KernelFault('invalid-input');
  const current = await read(directory);
  if (JSON.stringify(current?.value ?? null) !== JSON.stringify(expectedPrevious))
    throw new KernelFault('conflict');
  const temporary = path.join(directory.path, `.rendezvous-${randomUUID()}`);
  const target = path.join(directory.path, NAME);
  const file = await open(
    temporary,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  );
  const identity = await file.stat();
  let published = false;
  let nativeIdentity: string | null = null;
  const removeTemporary = async (): Promise<void> => {
    const remaining = await lstat(temporary).catch((error) => {
      if (missing(error)) return null;
      throw error;
    });
    if (!remaining) return;
    await checkDirectory(directory);
    if (remaining.dev !== identity.dev || remaining.ino !== identity.ino)
      throw new KernelFault('permission-denied');
    if (directory.windows) {
      const native = await verifyWindowsPrivateFile(directory.windows, path.basename(temporary));
      if (!native || `${native.volumeId}:${native.fileId}` !== nativeIdentity)
        throw new KernelFault('permission-denied');
    }
    await unlink(temporary);
  };
  try {
    privateEntry(identity, false);
    const native = await verifyPrivateFile(directory, path.basename(temporary), file);
    if (!native) throw new KernelFault('conflict');
    nativeIdentity = native === true ? null : native;
    await file.writeFile(JSON.stringify(value));
    await file.sync();
    await file.close();
    await checkDirectory(directory);
    const beforeCommit = await read(directory);
    if (
      JSON.stringify(beforeCommit?.value ?? null) !== JSON.stringify(expectedPrevious) ||
      (current &&
        (beforeCommit?.identity.dev !== current.identity.dev ||
          beforeCommit.identity.ino !== current.identity.ino ||
          beforeCommit.nativeIdentity !== current.nativeIdentity))
    )
      throw new KernelFault('conflict');
    await rename(temporary, target);
    published = true;
    await checkDirectory(directory);
    const committed = await read(directory);
    if (
      !committed ||
      committed.identity.dev !== identity.dev ||
      committed.identity.ino !== identity.ino ||
      committed.nativeIdentity !== nativeIdentity
    )
      throw new KernelFault('conflict');
  } finally {
    await file.close();
    if (!published) await removeTemporary();
  }
  return {
    retire: async () => {
      const current = await read(directory);
      if (!current) return;
      if (
        current.identity.dev !== identity.dev ||
        current.identity.ino !== identity.ino ||
        current.value.bootId !== value.bootId ||
        current.nativeIdentity !== nativeIdentity
      )
        throw new KernelFault('stale-owner');
      await checkDirectory(directory);
      await unlink(target);
    },
  };
}
export async function getOrCreateLocalHostId(directory: PrivateDirectory): Promise<string> {
  await checkDirectory(directory);
  const filePath = path.join(directory.path, 'host-id');
  try {
    const file = await open(
      filePath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    const id = randomUUID();
    try {
      privateEntry(await file.stat(), false);
      if (!(await verifyPrivateFile(directory, 'host-id', file))) throw new KernelFault('conflict');
      await file.writeFile(id);
      await file.sync();
    } finally {
      await file.close();
    }
    await checkDirectory(directory);
    return id;
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EEXIST')
      throw error;
  }
  const file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    privateEntry(info, false);
    if (!(await verifyPrivateFile(directory, 'host-id', file))) throw new KernelFault('not-ready');
    if (info.size > 64) throw new KernelFault('invalid-input');
    const id = await file.readFile('utf8');
    if (!uuid(id)) throw new KernelFault('invalid-input');
    await checkDirectory(directory);
    return id;
  } finally {
    await file.close();
  }
}
export function newManagementCapability(): string {
  return randomBytes(32).toString('hex');
}
