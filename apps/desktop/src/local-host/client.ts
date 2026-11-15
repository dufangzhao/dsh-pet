import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, realpath } from 'node:fs/promises';
import path from 'node:path';
import { KernelFault } from '@pet/host-kernel';
import {
  attachLocalManagement,
  type LocalManagementClient,
} from '../../../../packages/local-host/src/management.js';
import {
  openPrivateDirectory,
  readRendezvous,
} from '../../../../packages/local-host/src/rendezvous.js';

export async function attachLocalHost(
  profileDirectory: string,
  packageVersion: string,
): Promise<LocalManagementClient> {
  if (process.platform === 'win32') await openPrivateDirectory(profileDirectory);
  const directory = await openPrivateDirectory(path.join(profileDirectory, 'management'));
  const captured = await readRendezvous(directory);
  if (!captured) throw new KernelFault('not-ready');
  if (captured.packageVersion !== packageVersion) throw new KernelFault('conflict');
  return attachLocalManagement(captured);
}
/** OS-native startup only; a GUI environment is not an implicit credential or Node-loader handoff. */
export function localHostEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const name of [
    'SystemRoot',
    'WINDIR',
    'TEMP',
    'TMP',
    'TMPDIR',
    'PATH',
    'HOME',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'DISPLAY',
    'WAYLAND_DISPLAY',
    'XAUTHORITY',
    'XDG_RUNTIME_DIR',
    'XDG_CONFIG_HOME',
    'XDG_CACHE_HOME',
    'XDG_DATA_HOME',
    'XDG_DATA_DIRS',
    'DBUS_SESSION_BUS_ADDRESS',
    'LANG',
    'LANGUAGE',
    'LC_ALL',
    'LC_CTYPE',
    'LC_MESSAGES',
    'TZ',
  ]) {
    if (source[name] !== undefined) environment[name] = source[name];
  }
  return environment;
}
/** Main-only bundled launch descriptor. Renderer methods never receive either executable or entry. */
export interface LocalHostLaunch {
  readonly executablePath: string;
  readonly entryPath: string;
  /** Explicit native/test composition override, never a renderer value or the entire GUI environment. */
  readonly environment?: NodeJS.ProcessEnv;
  /** Explicit Linux acceptance environment only; never a claim of OS sandbox verification. */
  readonly noSandbox?: boolean;
}
export async function startOrAttachLocalHost(options: {
  readonly profileDirectory: string;
  readonly packageVersion: string;
  readonly launch: LocalHostLaunch;
}): Promise<LocalManagementClient> {
  if (process.platform === 'win32') await openPrivateDirectory(options.profileDirectory);
  const directory = await openPrivateDirectory(path.join(options.profileDirectory, 'management'));
  const captured = await readRendezvous(directory);
  if (captured) {
    if (captured.packageVersion !== options.packageVersion) throw new KernelFault('conflict');
    // A failed proof is not permission to kill/take over the old process or start a duplicate.
    return attachLocalManagement(captured);
  }
  for (const name of [options.launch.executablePath, options.launch.entryPath]) {
    if (!path.isAbsolute(name) || (await realpath(name)) !== name)
      throw new KernelFault('permission-denied');
    await access(name);
  }
  const child = spawn(
    options.launch.executablePath,
    [
      ...(options.launch.noSandbox ? ['--no-sandbox'] : []),
      options.launch.entryPath,
      `--local-host-profile=${options.profileDirectory}`,
    ],
    {
      detached: true,
      stdio: 'ignore',
      env: options.launch.environment ?? localHostEnvironment(),
    },
  );
  await once(child, 'spawn');
  child.unref();
  const expires = performance.now() + 30000;
  // Bounded startup discovery only; no Agent IO/offline command retry or PID liveness inference.
  while (performance.now() < expires) {
    const ready = await readRendezvous(directory);
    if (ready) {
      if (ready.packageVersion !== options.packageVersion) throw new KernelFault('conflict');
      return attachLocalManagement(ready);
    }
    if (child.exitCode !== null || child.signalCode !== null) throw new KernelFault('unavailable');
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  throw new KernelFault('timeout');
}
