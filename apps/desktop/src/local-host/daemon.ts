import { randomUUID } from 'node:crypto';
import {
  LOCAL_HOST_PROTOCOL_VERSION,
  type JsonObject,
  type LocalHostRuntimeIdentity,
} from '@pet/contracts';
import type { LocalPluginKernel } from '@pet/local-host';
import {
  openPrivateDirectory,
  getOrCreateLocalHostId,
  newManagementCapability,
  publishRendezvous,
  readRendezvous,
  type LocalHostRendezvous,
} from '../../../../packages/local-host/src/rendezvous.js';
import {
  startLocalManagement,
  type LocalManagementServer,
  type LocalManagementConsole,
} from '../../../../packages/local-host/src/management.js';

export interface LocalHostDaemon {
  readonly identity: LocalHostRuntimeIdentity;
  /** Native test/composition only. Do not project the management capability to a renderer. */
  readonly rendezvous: LocalHostRendezvous;
  readonly kernel: LocalPluginKernel;
  close(): Promise<void>;
}
/** This caller must already hold Electron's role/profile singleton; no PID-based ownership. */
export async function startLocalHostDaemon(options: {
  readonly directory: string;
  readonly packageVersion: string;
  createKernel(): Promise<LocalPluginKernel>;
  createConsole?(
    kernel: LocalPluginKernel,
    identity: LocalHostRuntimeIdentity,
    changed: () => void,
  ): Promise<LocalManagementConsole>;
  onStopped(): void | Promise<void>;
}): Promise<LocalHostDaemon> {
  const directory = await openPrivateDirectory(options.directory);
  const previous = await readRendezvous(directory);
  const identity: LocalHostRuntimeIdentity = {
    protocolVersion: LOCAL_HOST_PROTOCOL_VERSION,
    packageVersion: options.packageVersion,
    hostId: await getOrCreateLocalHostId(directory),
    bootId: randomUUID(),
  };
  const capability = newManagementCapability();
  const kernel = await options.createKernel();
  let server: LocalManagementServer | undefined;
  let consoleBackend: LocalManagementConsole | undefined;
  let stoppingKernel: Promise<void> | undefined;
  const closeKernel = (): Promise<void> =>
    (stoppingKernel ??= (async () => {
      await server?.drainSecrets();
      await consoleBackend?.close?.();
      await kernel.close();
    })());
  let publication: Awaited<ReturnType<typeof publishRendezvous>> | undefined;
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> =>
    (closing ??= (async () => {
      // Never erase discovery or claim stopped if real native/kernel cleanup failed.
      await closeKernel();
      await server?.close();
      await publication?.retire();
    })());
  try {
    consoleBackend = await options.createConsole?.(kernel, identity, () => server?.changed());
    server = await startLocalManagement({
      ...(consoleBackend ? { console: consoleBackend } : {}),
      identity,
      capability,
      kernel: {
        status: async (): Promise<JsonObject> => ({
          plugins: kernel.host.views().map((view) => ({ ...view })),
          tasks: { ...kernel.host.tasks.diagnostics() },
          localCore: false,
          localState: false,
        }),
        close: closeKernel,
      },
      onStopped: async () => {
        await close();
        await options.onStopped();
      },
    });
    const rendezvous: LocalHostRendezvous = {
      ...identity,
      format: 1,
      endpoint: server.endpoint,
      managementCapability: capability,
    };
    publication = await publishRendezvous(directory, rendezvous, previous);
    return { identity, rendezvous, kernel, close };
  } catch (error) {
    await close();
    throw error;
  }
}
