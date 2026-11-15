import { app } from 'electron';
import path from 'node:path';
import { mkdir, realpath } from 'node:fs/promises';
import { startLocalHostDaemon, type LocalHostDaemon } from './daemon.js';
import { openPrivateDirectory } from '../../../../packages/local-host/src/rendezvous.js';

type EntryOptions = Omit<Parameters<typeof startLocalHostDaemon>[0], 'directory' | 'onStopped'> & {
  readonly profileDirectory: string;
};
/** Fixed headless role entry. Production composition supplies the reviewed native factory; no module path comes from IPC. */
export async function runLocalHostElectron(options: EntryOptions): Promise<LocalHostDaemon | null> {
  if (!path.isAbsolute(options.profileDirectory))
    throw new Error('Local host requires an absolute private profile');
  if (process.platform === 'win32') await openPrivateDirectory(options.profileDirectory);
  else {
    await mkdir(options.profileDirectory, { recursive: true, mode: 0o700 });
    if ((await realpath(options.profileDirectory)) !== path.resolve(options.profileDirectory))
      throw new Error('Local host profile must not be a link');
  }
  app.setName('pet-local-plugin-host');
  app.setPath('userData', options.profileDirectory);
  if (!app.requestSingleInstanceLock()) {
    app.exit(0);
    return null;
  }
  // No BrowserWindow and no parent IPC listener: GUI lifetime cannot stop this role.
  app.on('window-all-closed', () => {});
  await app.whenReady();
  let daemon: LocalHostDaemon;
  try {
    daemon = await startLocalHostDaemon({
      directory: path.join(options.profileDirectory, 'management'),
      packageVersion: options.packageVersion,
      createKernel: options.createKernel,
      ...(options.createConsole ? { createConsole: options.createConsole } : {}),
      onStopped: () => {
        app.exit(0);
      },
    });
  } catch {
    app.exit(1);
    throw new Error('Local host startup failed');
  }
  let quitting = false;
  app.on('before-quit', (event) => {
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    void daemon.close().then(
      () => app.exit(0),
      () => {
        // Keep the process/profile lock when native settlement cannot be confirmed.
        quitting = false;
        process.stderr.write('Local host cleanup is not confirmed; explicit recovery required.\n');
      },
    );
  });
  return daemon;
}
