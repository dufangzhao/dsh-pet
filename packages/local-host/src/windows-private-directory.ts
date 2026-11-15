import { execFile } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KernelFault } from '@pet/host-kernel';

export interface WindowsPrivateIdentity {
  readonly path: string;
  readonly userSid: string;
  readonly volumeId: string;
  readonly fileId: string;
  readonly links: number;
  readonly kind: 'directory' | 'file';
}
export interface WindowsPrivateDirectory {
  readonly path: string;
}
const captured = new WeakMap<WindowsPrivateDirectory, WindowsPrivateIdentity>();
const script = fileURLToPath(new URL('./windows-private-directory.ps1', import.meta.url));
const samePath = (left: string, right: string): boolean =>
  path.win32.normalize(left).toLowerCase() === path.win32.normalize(right).toLowerCase();
const nameOK = (name: string): boolean =>
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name) || /^\.rendezvous-[a-f0-9-]{36}$/.test(name);

/** Fixed OS binary only; neither command nor script comes from IPC or renderer input. */
export function windowsPrivateCommand(
  systemRoot: string,
  operation: 'InitializeDirectory' | 'VerifyDirectory' | 'VerifyFile',
  anchor: string,
  name: string,
): { executable: string; args: string[] } {
  if (
    !/^[A-Za-z]:\\/.test(systemRoot) ||
    !/^[A-Za-z]:\\/.test(anchor) ||
    !nameOK(name) ||
    name === '.' ||
    name === '..' ||
    name.endsWith('.') ||
    /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)
  )
    throw new KernelFault('invalid-input');
  return {
    executable: path.win32.join(
      systemRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    ),
    args: [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      script,
      '-Operation',
      operation,
      '-Anchor',
      anchor,
      '-Name',
      name,
    ],
  };
}
export function parseWindowsPrivateIdentity(
  value: unknown,
  expected: string,
  kind: 'directory' | 'file',
): WindowsPrivateIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new KernelFault('permission-denied');
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).sort().join(',') !== 'fileId,kind,links,path,userSid,version,volumeId' ||
    v['version'] !== 1 ||
    v['kind'] !== kind ||
    typeof v['path'] !== 'string' ||
    !samePath(v['path'], expected) ||
    typeof v['userSid'] !== 'string' ||
    !/^S-1-[0-9]{1,15}(?:-[0-9]{1,10}){1,15}$/.test(v['userSid']) ||
    typeof v['volumeId'] !== 'string' ||
    !/^[a-f0-9]{8}$/.test(v['volumeId']) ||
    typeof v['fileId'] !== 'string' ||
    !/^[a-f0-9]{16}$/.test(v['fileId']) ||
    typeof v['links'] !== 'number' ||
    !Number.isSafeInteger(v['links']) ||
    v['links'] < 1 ||
    (kind === 'file' && v['links'] !== 1)
  )
    throw new KernelFault('permission-denied');
  return {
    path: v['path'],
    userSid: v['userSid'],
    volumeId: v['volumeId'],
    fileId: v['fileId'],
    links: v['links'],
    kind,
  };
}
/** Native script failures are distinct from a positively identified access denial. */
export function windowsPrivateFailure(
  stderr: string,
  exitCode: string | number | null | undefined,
  killed = false,
): KernelFault {
  if (exitCode === 2 || exitCode === 'ENOENT' || killed) return new KernelFault('not-ready');
  const denied =
    /^local-host-private-profile-unavailable:(?:reparse-entry|foreign-owner|unprotected-directory|unexpected-denial|foreign-access|owner-rights-missing|outside-anchor|wrong-kind|nonregular-entry|nonregular-or-hardlinked-file|not-directory)$/m;
  return new KernelFault(denied.test(stderr.trim()) ? 'permission-denied' : 'internal');
}

async function inspect(
  operation: 'InitializeDirectory' | 'VerifyDirectory' | 'VerifyFile',
  anchor: string,
  name: string,
): Promise<WindowsPrivateIdentity | null> {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new KernelFault('not-ready');
  const systemRoot = process.env['SystemRoot'];
  if (!systemRoot || (process.env['WINDIR'] && !samePath(process.env['WINDIR'], systemRoot)))
    throw new KernelFault('not-ready');
  const command = windowsPrivateCommand(systemRoot, operation, anchor, name);
  for (const file of [command.executable, script]) {
    const info = await lstat(file).catch(() => {
      throw new KernelFault('not-ready');
    });
    if (!info.isFile() || info.isSymbolicLink() || !samePath(await realpath(file), file))
      throw new KernelFault('not-ready');
  }
  const environment: NodeJS.ProcessEnv = { SystemRoot: systemRoot, WINDIR: systemRoot };
  for (const key of ['TEMP', 'TMP']) if (process.env[key]) environment[key] = process.env[key];
  const output = await new Promise<string | null>((resolve, reject) => {
    execFile(
      command.executable,
      command.args,
      { env: environment, windowsHide: true, timeout: 15000, maxBuffer: 8192, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error) {
          if (operation === 'VerifyFile' && error.code === 3) resolve(null);
          else reject(windowsPrivateFailure(stderr, error.code, error.killed));
        } else resolve(stdout);
      },
    );
  });
  if (output === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(output.replace(/^\uFEFF/, ''));
  } catch {
    throw new KernelFault('permission-denied');
  }
  return parseWindowsPrivateIdentity(
    parsed,
    path.win32.join(anchor, name),
    operation === 'VerifyFile' ? 'file' : 'directory',
  );
}
/** Anchor is captured by native Main from this role's UserData parent, never supplied by a renderer. */
export async function initializeWindowsPrivateDirectory(
  userDataAnchor: string,
  relativeName: string,
): Promise<WindowsPrivateDirectory> {
  const identity = await inspect('InitializeDirectory', userDataAnchor, relativeName);
  if (!identity) throw new KernelFault('not-ready');
  const directory = Object.freeze({ path: identity.path });
  captured.set(directory, identity);
  return directory;
}
export async function verifyWindowsPrivateDirectory(
  directory: WindowsPrivateDirectory,
): Promise<WindowsPrivateIdentity> {
  const previous = captured.get(directory);
  if (!previous) throw new KernelFault('permission-denied');
  const current = await inspect(
    'VerifyDirectory',
    path.win32.dirname(directory.path),
    path.win32.basename(directory.path),
  );
  if (
    !current ||
    current.userSid !== previous.userSid ||
    current.volumeId !== previous.volumeId ||
    current.fileId !== previous.fileId
  )
    throw new KernelFault('permission-denied');
  return current;
}
export async function verifyWindowsPrivateFile(
  directory: WindowsPrivateDirectory,
  relativeName: string,
): Promise<WindowsPrivateIdentity | null> {
  const previous = captured.get(directory);
  if (!previous) throw new KernelFault('permission-denied');
  const current = await inspect('VerifyFile', directory.path, relativeName);
  if (current && (current.userSid !== previous.userSid || current.volumeId !== previous.volumeId))
    throw new KernelFault('permission-denied');
  return current;
}
