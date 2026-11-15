import { execFile } from 'node:child_process';
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LocalHostProcessIdentity } from '@pet/contracts';
import { validateLocalHostProcessIdentity } from '@pet/contracts/validation';
import { KernelFault } from '@pet/host-kernel';
import { privateDirectoryIdentity, type PrivateDirectory } from './rendezvous.js';

export interface OwnedProcessProvenance {
  readonly kind: 'owned-process-provenance';
}
export interface OwnedProcessDeathProof {
  readonly status: 'gone';
}
export type OwnedProcessUnavailable = {
  readonly status: 'unavailable';
  readonly reason: 'live' | 'access-denied' | 'identity-mismatch' | 'unsupported' | 'unverifiable';
};
export type OwnedProcessDeathReason = 'not-found' | 'pid-reused' | 'process-exited';
/** Native-only dependency: projections are metadata; the proof remains module-private. */
export interface OwnedProcessProvider {
  identity(): LocalHostProcessIdentity;
  check(): Promise<void>;
  gone(
    original: LocalHostProcessIdentity,
  ): Promise<OwnedProcessDeathProof | OwnedProcessUnavailable>;
}
const captured = new WeakMap<OwnedProcessProvenance, LocalHostProcessIdentity>();
const deaths = new WeakMap<
  OwnedProcessDeathProof,
  { readonly identity: LocalHostProcessIdentity; readonly reason: OwnedProcessDeathReason }
>();
const unavailable = (reason: OwnedProcessUnavailable['reason']): OwnedProcessUnavailable => ({
  status: 'unavailable',
  reason,
});
const errno = (error: unknown): string | undefined =>
  error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

/** /proc comm may contain spaces and ')'; field22 is measured ticks, not a timestamp estimate. */
export function linuxProcessStartIdentity(text: string, expectedPid: number): string {
  const open = text.indexOf('('),
    close = text.lastIndexOf(')');
  if (open < 1 || close <= open || Number(text.slice(0, open).trim()) !== expectedPid)
    throw new KernelFault('not-ready');
  const fields = text
      .slice(close + 1)
      .trim()
      .split(/\s+/),
    start = fields[19];
  if (!start || !/^\d+$/.test(start) || fields.length < 20) throw new KernelFault('not-ready');
  return start;
}
async function linuxBootIdentity(): Promise<string> {
  const boot = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
  const namespace = await stat('/proc/self/ns/pid', { bigint: true });
  if (!uuid.test(boot)) throw new KernelFault('not-ready');
  // Reject a proc mount whose PID numbering does not match this native process.
  linuxProcessStartIdentity(await readFile('/proc/self/stat', 'utf8'), process.pid);
  return `${boot}@${namespace.dev}:${namespace.ino}`;
}
interface WindowsObservation {
  readonly status: 'live' | 'exited' | 'not-found' | 'access-denied' | 'unverifiable';
  readonly osBootIdentity: string;
  readonly processCreationIdentity: string | null;
}
async function windowsProcess(
  operation: 'Capture' | 'Inspect',
  pid: number,
): Promise<WindowsObservation> {
  const systemRoot = process.env['SystemRoot'];
  if (
    process.platform !== 'win32' ||
    process.arch !== 'x64' ||
    !systemRoot ||
    !/^[A-Za-z]:\\/.test(systemRoot)
  )
    throw new KernelFault('not-ready');
  const same = (a: string, b: string) =>
    path.win32.normalize(a).toLowerCase() === path.win32.normalize(b).toLowerCase();
  if (process.env['WINDIR'] && !same(process.env['WINDIR'], systemRoot))
    throw new KernelFault('not-ready');
  const executable = path.win32.join(
    systemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const script = fileURLToPath(new URL('./owned-process.ps1', import.meta.url));
  for (const file of [executable, script]) {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || !same(await realpath(file), file))
      throw new KernelFault('not-ready');
  }
  const env: NodeJS.ProcessEnv = { SystemRoot: systemRoot, WINDIR: systemRoot };
  for (const key of ['TEMP', 'TMP']) if (process.env[key]) env[key] = process.env[key];
  const output = await new Promise<string>((resolve, reject) =>
    execFile(
      executable,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        script,
        '-Operation',
        operation,
        '-ProcessId',
        String(pid),
      ],
      { env, windowsHide: true, timeout: 15000, maxBuffer: 4096, encoding: 'utf8' },
      (error, stdout) => (error ? reject(new KernelFault('not-ready')) : resolve(stdout)),
    ),
  );
  const value: unknown = JSON.parse(output.replace(/^\uFEFF/, ''));
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new KernelFault('not-ready');
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).sort().join(',') !== 'osBootIdentity,processCreationIdentity,status' ||
    typeof v['osBootIdentity'] !== 'string' ||
    !uuid.test(v['osBootIdentity']) ||
    !['live', 'exited', 'not-found', 'access-denied', 'unverifiable'].includes(
      String(v['status']),
    ) ||
    (v['processCreationIdentity'] !== null &&
      (typeof v['processCreationIdentity'] !== 'string' ||
        !/^\d+$/.test(v['processCreationIdentity'])))
  )
    throw new KernelFault('not-ready');
  const status = v['status'];
  if ((status === 'live' || status === 'exited') && v['processCreationIdentity'] === null)
    throw new KernelFault('not-ready');
  if (
    status !== 'live' &&
    status !== 'exited' &&
    status !== 'not-found' &&
    status !== 'access-denied' &&
    status !== 'unverifiable'
  )
    throw new KernelFault('not-ready');
  return {
    status,
    osBootIdentity: v['osBootIdentity'],
    processCreationIdentity: v['processCreationIdentity'],
  };
}
export async function captureCurrentOwnedProcess(
  profile: PrivateDirectory,
): Promise<OwnedProcessProvenance> {
  const profileIdentity = await privateDirectoryIdentity(profile);
  let identity: LocalHostProcessIdentity;
  if (process.platform === 'linux') {
    if (!process.getuid || (await stat('/proc/self')).uid !== process.getuid())
      throw new KernelFault('not-ready');
    identity = {
      osKind: 'linux',
      osBootIdentity: await linuxBootIdentity(),
      pid: process.pid,
      processCreationIdentity: linuxProcessStartIdentity(
        await readFile('/proc/self/stat', 'utf8'),
        process.pid,
      ),
      profileIdentity,
    };
  } else if (process.platform === 'win32') {
    const current = await windowsProcess('Capture', process.pid);
    if (current.status !== 'live' || !current.processCreationIdentity)
      throw new KernelFault('not-ready');
    identity = {
      osKind: 'win32',
      osBootIdentity: current.osBootIdentity,
      pid: process.pid,
      processCreationIdentity: current.processCreationIdentity,
      profileIdentity,
    };
  } else throw new KernelFault('not-ready');
  if ((await privateDirectoryIdentity(profile)) !== profileIdentity)
    throw new KernelFault('conflict');
  const proof = Object.freeze({ kind: 'owned-process-provenance' as const });
  captured.set(proof, Object.freeze(identity));
  return proof;
}
export function ownedProcessIdentity(provenance: OwnedProcessProvenance): LocalHostProcessIdentity {
  const identity = captured.get(provenance);
  if (!identity) throw new KernelFault('permission-denied');
  return { ...identity };
}
/** Only a positive OS observation can mint this proof. Old records without the once-captured identity stay held. */
export async function verifyOriginalProcessGone(
  original: LocalHostProcessIdentity | null | undefined,
  profile: PrivateDirectory,
): Promise<OwnedProcessDeathProof | OwnedProcessUnavailable> {
  if (!original || !validateLocalHostProcessIdentity(original).ok)
    return unavailable('unverifiable');
  original = Object.freeze({ ...original });
  if (original.osKind !== process.platform) return unavailable('unsupported');
  if (
    !Number.isSafeInteger(original.pid) ||
    original.pid < 1 ||
    original.pid > (original.osKind === 'win32' ? 0xffffffff : 0x7fffffff) ||
    !/^\d+$/.test(original.processCreationIdentity)
  )
    return unavailable('unverifiable');
  try {
    const currentProfile = await privateDirectoryIdentity(profile);
    if (currentProfile !== original.profileIdentity) return unavailable('identity-mismatch');
    let reason: OwnedProcessDeathReason | undefined;
    if (original.osKind === 'linux') {
      if ((await linuxBootIdentity()) !== original.osBootIdentity)
        return unavailable('identity-mismatch');
      try {
        const text = await readFile(`/proc/${original.pid}/stat`, 'utf8');
        const start = linuxProcessStartIdentity(text, original.pid);
        if (start === original.processCreationIdentity) return unavailable('live');
        reason = 'pid-reused';
      } catch (error) {
        if (errno(error) === 'ENOENT' || errno(error) === 'ESRCH') reason = 'not-found';
        else
          return unavailable(
            errno(error) === 'EACCES' || errno(error) === 'EPERM'
              ? 'access-denied'
              : 'unverifiable',
          );
      }
    } else {
      const current = await windowsProcess('Inspect', original.pid);
      if (current.osBootIdentity !== original.osBootIdentity)
        return unavailable('identity-mismatch');
      if (current.status === 'access-denied' || current.status === 'unverifiable')
        return unavailable(current.status);
      if (current.status === 'not-found') reason = 'not-found';
      else if (current.processCreationIdentity !== original.processCreationIdentity)
        reason = 'pid-reused';
      else if (current.status === 'exited') reason = 'process-exited';
      else return unavailable('live');
    }
    if ((await privateDirectoryIdentity(profile)) !== currentProfile)
      return unavailable('identity-mismatch');
    const proof = Object.freeze({ status: 'gone' as const });
    deaths.set(proof, { identity: Object.freeze({ ...original }), reason });
    return proof;
  } catch (error) {
    return unavailable(
      errno(error) === 'EACCES' || errno(error) === 'EPERM' ? 'access-denied' : 'unverifiable',
    );
  }
}
export async function verifyCurrentOwnedProcess(
  provenance: OwnedProcessProvenance,
  profile: PrivateDirectory,
): Promise<void> {
  const identity = captured.get(provenance);
  if (!identity || identity.pid !== process.pid) throw new KernelFault('stale-owner');
  const observed = await verifyOriginalProcessGone(identity, profile);
  if (observed.status !== 'unavailable' || observed.reason !== 'live')
    throw new KernelFault('stale-owner');
}
export function ownedProcessDeathFact(proof: OwnedProcessDeathProof): {
  readonly identity: LocalHostProcessIdentity;
  readonly reason: OwnedProcessDeathReason;
} {
  const fact = deaths.get(proof);
  if (!fact) throw new KernelFault('permission-denied');
  return { identity: { ...fact.identity }, reason: fact.reason };
}
