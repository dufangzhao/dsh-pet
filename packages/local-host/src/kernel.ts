import { realpathSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import {
  LOCAL_AGENT_LINK_CREDENTIAL_ID,
  LOCAL_AGENT_LINK_PLUGIN_ID,
  QQ_OFFICIAL_CREDENTIAL_ID,
  QQ_OFFICIAL_PLUGIN_ID,
  QQ_ONEBOT_CREDENTIAL_ID,
  QQ_ONEBOT_PLUGIN_ID,
  type JsonObject,
  type PluginManifest,
} from '@pet/contracts';
import { validateManifest } from '@pet/contracts/validation';
import {
  KernelFault,
  type PermissionPreset,
  type TaskHandle,
  type TaskSupervisor,
} from '@pet/host-kernel';
import { definePlugin, type PluginContext } from '@pet/plugin-sdk';
import { CompanionPluginHost, packageFingerprint } from '@pet/companion-runtime/plugin-host';
import { createOfficialQqPlugin, type OfficialQqPorts } from '@pet/qq-official';
import { createOneBotQqPlugin, type OneBotQqPorts } from '@pet/qq-onebot';
import { createLocalAgentLinkPlugin, type LocalAgentLinkPorts } from '@pet/local-agent-link';
import {
  LOCAL_QQ_CONTROL_ID,
  localQQControlDefinition,
  localQQControlManifest,
} from './qq-control.js';

// Factories are imported at process/module boot. Pin their package contents before any caller can await.
const bootSource = (specifier: string): { directory: string; digest: string } => {
  const directory = realpathSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.resolve(specifier))), '..'),
  );
  return { directory, digest: packageFingerprint(directory) };
};
const officialBoot = bootSource('@pet/qq-official');
const onebotBoot = bootSource('@pet/qq-onebot');
const agentLinkBoot = bootSource('@pet/local-agent-link');
const controlDirectory = realpathSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
);
const controlDigest = packageFingerprint(controlDirectory);

export type LocalQQSourceId = typeof QQ_OFFICIAL_PLUGIN_ID | typeof QQ_ONEBOT_PLUGIN_ID;
export type LocalSourceId = LocalQQSourceId | typeof LOCAL_AGENT_LINK_PLUGIN_ID;
export interface LocalSourceOptions<P> {
  readonly directory: string;
  readonly manifest: PluginManifest;
  /** Existing preset policy; source trust must still be explicitly reviewed. */
  readonly preset: PermissionPreset;
  /** Initial seed only; later edits use ConfigService CAS and survive host restart. */
  readonly config?: JsonObject;
  /** Host-private native ports; never supplied over a renderer or network boundary. */
  portsFor(context: PluginContext, host: CompanionPluginHost): P;
}
export interface LocalPluginKernelOptions {
  readonly dataDirectory: string;
  readonly official: LocalSourceOptions<OfficialQqPorts>;
  readonly onebot: LocalSourceOptions<OneBotQqPorts>;
  readonly agentLink?: LocalSourceOptions<LocalAgentLinkPorts>;
}
export interface LocalSourceReview {
  readonly pluginId: LocalSourceId;
  readonly digest: string;
  readonly trusted: boolean;
  readonly preset: PermissionPreset;
  readonly blocked: boolean;
  readonly cleanup: 'settled' | 'pending' | 'failed';
}
export interface LocalPluginKernel {
  /** Private host-only primitives used to bind native source ports. */
  readonly host: CompanionPluginHost;
  review(pluginId: LocalSourceId): LocalSourceReview;
  confirmTrust(pluginId: LocalSourceId, expectedDigest: string): void;
  withdrawTrust(pluginId: LocalSourceId, expectedDigest: string): void;
  setPreset(pluginId: LocalSourceId, preset: PermissionPreset): void;
  setEnabled(pluginId: LocalSourceId, enabled: boolean): Promise<void>;
  runFor(
    pluginId: LocalSourceId,
    work: Parameters<TaskSupervisor['run']>[1],
    options?: Parameters<TaskSupervisor['run']>[2],
  ): TaskHandle;
  /** Real active infrastructure owner; callers cannot choose an arbitrary task owner. */
  runManagement(
    work: Parameters<TaskSupervisor['run']>[1],
    options?: Parameters<TaskSupervisor['run']>[2],
  ): TaskHandle;
  close(): Promise<void>;
}

/** G0 host-only composition: no Agent runtime, conversation State or implicit source trust. */
export async function createLocalPluginKernel(
  options: LocalPluginKernelOptions,
): Promise<LocalPluginKernel> {
  const official = {
    ...options.official,
    manifest: structuredClone(options.official.manifest),
    ...(options.official.config ? { config: structuredClone(options.official.config) } : {}),
  };
  const onebot = {
    ...options.onebot,
    manifest: structuredClone(options.onebot.manifest),
    ...(options.onebot.config ? { config: structuredClone(options.onebot.config) } : {}),
  };
  const agentLink = options.agentLink
    ? {
        ...options.agentLink,
        manifest: structuredClone(options.agentLink.manifest),
        ...(options.agentLink.config ? { config: structuredClone(options.agentLink.config) } : {}),
      }
    : undefined;
  // Source review must name the same installed packages whose factories were loaded at boot.
  const entries = [
    { id: QQ_OFFICIAL_PLUGIN_ID, source: official, loaded: officialBoot },
    { id: QQ_ONEBOT_PLUGIN_ID, source: onebot, loaded: onebotBoot },
    ...(agentLink
      ? [{ id: LOCAL_AGENT_LINK_PLUGIN_ID, source: agentLink, loaded: agentLinkBoot } as const]
      : []),
  ] as const;
  const digests = new Map<LocalSourceId, string>();
  for (const { id, source, loaded } of entries) {
    if (!source || source.manifest.id !== id || !path.isAbsolute(source.directory))
      throw new KernelFault('invalid-input');
    const actual = await realpath(source.directory);
    const same =
      process.platform === 'win32'
        ? actual.toLowerCase() === loaded.directory.toLowerCase()
        : actual === loaded.directory;
    if (!same) throw new KernelFault('permission-denied');
    let disk: unknown;
    try {
      disk = JSON.parse(await readFile(path.join(source.directory, 'plugin.json'), 'utf8'));
    } catch {
      throw new KernelFault('invalid-input');
    }
    const parsed = validateManifest(disk);
    if (!parsed.ok || !isDeepStrictEqual(parsed.value, source.manifest))
      throw new KernelFault('invalid-input');
    if (packageFingerprint(source.directory) !== loaded.digest)
      throw new KernelFault('package-changed');
    digests.set(id, loaded.digest);
  }
  const holder: { host?: CompanionPluginHost } = {};
  const activeHost = (): CompanionPluginHost => {
    if (!holder.host) throw new KernelFault('not-ready');
    return holder.host;
  };
  const created = await CompanionPluginHost.create({
    dataDirectory: options.dataDirectory,
    sourceTrust: 'review',
    plugins: [
      {
        manifest: localQQControlManifest,
        directory: controlDirectory,
        preset: 'allow',
        enabled: false,
        definition: localQQControlDefinition,
      },
      {
        manifest: official.manifest,
        directory: official.directory,
        preset: official.preset,
        enabled: false,
        hostCredentials: [QQ_OFFICIAL_CREDENTIAL_ID],
        ...(official.config ? { initialConfig: official.config } : {}),
        definition: definePlugin({
          activate(context) {
            return createOfficialQqPlugin((current) =>
              official.portsFor(current, activeHost()),
            ).activate(context);
          },
        }),
      },
      {
        manifest: onebot.manifest,
        directory: onebot.directory,
        preset: onebot.preset,
        enabled: false,
        hostCredentials: [QQ_ONEBOT_CREDENTIAL_ID],
        ...(onebot.config ? { initialConfig: onebot.config } : {}),
        definition: definePlugin({
          activate(context) {
            return createOneBotQqPlugin((current) =>
              onebot.portsFor(current, activeHost()),
            ).activate(context);
          },
        }),
      },
      ...(agentLink
        ? [
            {
              manifest: agentLink.manifest,
              directory: agentLink.directory,
              preset: agentLink.preset,
              enabled: false,
              hostCredentials: [LOCAL_AGENT_LINK_CREDENTIAL_ID],
              ...(agentLink.config ? { initialConfig: agentLink.config } : {}),
              definition: definePlugin({
                activate(context) {
                  return createLocalAgentLinkPlugin((current) =>
                    agentLink.portsFor(current, activeHost()),
                  ).activate(context);
                },
              }),
            },
          ]
        : []),
    ],
  });
  holder.host = created;
  try {
    for (const { id, source } of entries)
      if (digests.get(id) !== packageFingerprint(source.directory))
        throw new KernelFault('package-changed');
    if (packageFingerprint(controlDirectory) !== controlDigest)
      throw new KernelFault('package-changed');
    if (
      !created.permissionControl.confirmTrust(
        { pluginId: LOCAL_QQ_CONTROL_ID, instanceId: 'default' },
        controlDigest,
        true,
      )
    )
      throw new KernelFault('permission-denied');
    await created.setEnabled(LOCAL_QQ_CONTROL_ID, true);
  } catch (error) {
    await created.close();
    throw error;
  }
  const identity = (pluginId: string) => ({ pluginId, instanceId: 'default' });
  const record = (pluginId: LocalSourceId): { directory: string; digest: string } => {
    const source = entries.find((entry) => entry.id === pluginId)?.source;
    const digest = digests.get(pluginId);
    if (!source || !digest) throw new KernelFault('invalid-input');
    return { directory: source.directory, digest };
  };
  const unchanged = (pluginId: LocalSourceId): string => {
    const entry = record(pluginId);
    try {
      if (packageFingerprint(entry.directory) === entry.digest) return entry.digest;
    } catch {
      // Missing or replaced source never becomes a reviewed source.
    }
    throw new KernelFault('package-changed');
  };
  const transitions = new Map<LocalSourceId, 'enable' | 'disable'>();
  const activeEpoch = new Map<LocalSourceId, { generation: number; epoch: number }>();
  const failedCleanup = new Set<LocalSourceId>();
  let closing: Promise<void> | undefined;
  const runLeased = (
    pluginId: string,
    work: Parameters<TaskSupervisor['run']>[1],
    taskOptions?: Parameters<TaskSupervisor['run']>[2],
  ): TaskHandle => {
    if (closing || !created.verifySource(pluginId)) throw new KernelFault('permission-denied');
    const policy = created.permissionControl.inspect(identity(pluginId));
    if (!policy || policy.blocked || policy.preset === 'deny')
      throw new KernelFault('permission-denied');
    const owner = created.owner(pluginId);
    const sourceSignal = created.manager.signal(owner);
    if (!sourceSignal || sourceSignal.aborted) throw new KernelFault('stale-owner');
    const signal = taskOptions?.signal
      ? AbortSignal.any([sourceSignal, taskOptions.signal])
      : sourceSignal;
    const handle = created.runFor(
      pluginId,
      async (task) => {
        const authorized = await created.permissions.authorize(
          task.owner,
          task.taskId,
          { kind: 'files', scope: 'plugin-data', access: 'read' },
          task.signal,
        );
        if (!authorized.ok) throw new KernelFault(authorized.error.code);
        const lease = authorized.value;
        const revoke = (): void => {
          handle.cancel('permission-revoked');
        };
        lease.signal.addEventListener('abort', revoke, { once: true });
        try {
          if (lease.signal.aborted) revoke();
          if (task.signal.aborted || !lease.isValid()) throw new KernelFault('permission-denied');
          const value = await work(task);
          if (!lease.isValid()) throw new KernelFault('permission-denied');
          return value;
        } finally {
          lease.signal.removeEventListener('abort', revoke);
          lease.close();
        }
      },
      { ...taskOptions, signal },
    );
    return handle;
  };
  return {
    host: created,
    review(pluginId) {
      const digest = unchanged(pluginId);
      const policy = created.permissionControl.inspect(identity(pluginId));
      if (!policy) throw new KernelFault('not-ready');
      const trusted = created.permissions.isTrusted(identity(pluginId), digest);
      const captured = activeEpoch.get(pluginId);
      const current = created.manager.get(identity(pluginId));
      return {
        pluginId,
        digest,
        trusted,
        preset: policy.preset,
        blocked: policy.blocked,
        cleanup: failedCleanup.has(pluginId)
          ? 'failed'
          : transitions.get(pluginId) === 'disable' ||
              (captured !== undefined &&
                (!trusted ||
                  policy.blocked ||
                  captured.epoch !== policy.epoch ||
                  current?.state !== 'active' ||
                  current.owner.generation !== captured.generation))
            ? 'pending'
            : 'settled',
      };
    },
    confirmTrust(pluginId, expectedDigest) {
      const digest = unchanged(pluginId);
      if (digest !== expectedDigest) throw new KernelFault('conflict');
      if (created.permissions.isTrusted(identity(pluginId), digest)) return;
      if (!created.permissionControl.confirmTrust(identity(pluginId), digest, true))
        throw new KernelFault('permission-denied');
    },
    withdrawTrust(pluginId, expectedDigest) {
      const { digest } = record(pluginId);
      if (digest !== expectedDigest) throw new KernelFault('conflict');
      if (!created.permissionControl.confirmTrust(identity(pluginId), digest, false))
        throw new KernelFault('permission-denied');
    },
    setPreset(pluginId, preset) {
      record(pluginId);
      const current = created.permissionControl.inspect(identity(pluginId));
      if (current && current.preset === preset && !current.blocked) return;
      if (!created.permissionControl.setPreset(identity(pluginId), preset))
        throw new KernelFault('invalid-input');
    },
    async setEnabled(pluginId, enabled) {
      record(pluginId);
      if (typeof enabled !== 'boolean') throw new KernelFault('invalid-input');
      if (closing || transitions.has(pluginId)) throw new KernelFault('conflict');
      if (enabled && failedCleanup.has(pluginId)) throw new KernelFault('not-ready');
      if (enabled) unchanged(pluginId);
      const entry = created.manager.get(identity(pluginId));
      const policy = created.permissionControl.inspect(identity(pluginId));
      if (!entry || !policy) throw new KernelFault('not-ready');
      const owner = entry.owner;
      const prior = activeEpoch.get(pluginId);
      if (
        enabled &&
        entry.state === 'active' &&
        (!prior || prior.generation !== owner.generation || prior.epoch !== policy.epoch)
      )
        throw new KernelFault('stale-owner');
      transitions.set(pluginId, enabled ? 'enable' : 'disable');
      try {
        let failure: { error: unknown } | undefined;
        try {
          await created.setEnabled(pluginId, enabled);
        } catch (error) {
          failure = { error };
        }
        if (!enabled) {
          try {
            await created.drainOwner(owner);
          } catch (error) {
            failure ??= { error };
          }
        }
        if (failure) {
          if (!enabled) failedCleanup.add(pluginId);
          throw failure.error;
        }
        if (enabled) {
          const applied = created.manager.get(identity(pluginId));
          if (!applied || applied.state !== 'active') throw new KernelFault('not-ready');
          activeEpoch.set(pluginId, { generation: applied.owner.generation, epoch: policy.epoch });
          const current = created.permissionControl.inspect(identity(pluginId));
          if (
            !current ||
            current.epoch !== policy.epoch ||
            current.blocked ||
            !created.verifySource(pluginId)
          )
            throw new KernelFault('stale-owner');
        } else activeEpoch.delete(pluginId);
      } finally {
        transitions.delete(pluginId);
      }
    },
    runFor(pluginId, work, taskOptions) {
      if (closing || transitions.has(pluginId)) throw new KernelFault('conflict');
      unchanged(pluginId);
      if (!created.verifySource(pluginId)) throw new KernelFault('permission-denied');
      const policy = created.permissionControl.inspect(identity(pluginId));
      if (!policy || policy.blocked || policy.preset === 'deny')
        throw new KernelFault('permission-denied');
      const owner = created.owner(pluginId);
      const captured = activeEpoch.get(pluginId);
      if (!captured || captured.generation !== owner.generation || captured.epoch !== policy.epoch)
        throw new KernelFault('stale-owner');
      return runLeased(pluginId, work, taskOptions);
    },
    runManagement(work, taskOptions) {
      return runLeased(LOCAL_QQ_CONTROL_ID, work, taskOptions);
    },
    close() {
      return (closing ??= created.close());
    },
  };
}
