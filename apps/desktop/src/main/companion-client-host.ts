import {
  DESKTOP_COMPANION_PLUGIN_ID,
  makeError,
  type Result,
  type TaskContext,
} from '@pet/contracts';
import {
  CredentialBroker,
  CredentialError,
  MemoryCiphertextStore,
  credentialPermissionAuthorizer,
  KernelFault,
  type PermissionLease,
} from '@pet/host-kernel';
import type { DesktopHost } from './desktop-host.js';
import type {
  DesktopCompanionHostPort,
  DesktopCompanionSource,
  DesktopCompanionEndpointSave,
} from './companion-client-types.js';
import { companionEndpoint } from './companion-client-controller.js';
import { isCommittedArtifactSave, type ArtifactSaveCommit } from './companion-artifact.js';
const identity = { pluginId: DESKTOP_COMPANION_PLUGIN_ID, instanceId: 'default' };
const fault = <T>(code: Parameters<typeof makeError>[0]): Result<T> => ({
  ok: false,
  error: makeError(code, false),
});

/** Host provisioned for one exact source/config target, never an SDK-wide network bypass. */
export class DesktopCompanionHostAdapter implements DesktopCompanionHostPort {
  constructor(private readonly host: DesktopHost) {}
  async readEndpoint(): Promise<Result<{ baseUrl: string; revision: number }>> {
    const result = await this.host.configs.get(identity);
    if (!result.ok) return result;
    const baseUrl = result.value.data['baseUrl'];
    if (typeof baseUrl !== 'string') return fault('invalid-input');
    return { ok: true, value: { baseUrl, revision: result.value.revision } };
  }
  async readSource(): Promise<Result<DesktopCompanionSource>> {
    const entry = this.host.manager.get(identity);
    if (!entry || !this.host.manager.isActive(entry.owner)) return fault('not-ready');
    const trust = this.host.describeTrust(entry.owner);
    const policy = this.host.permissionControl.inspect(identity);
    const signal = this.host.manager.signal(entry.owner);
    if (
      !trust?.trusted ||
      !policy ||
      policy.blocked ||
      policy.preset === 'deny' ||
      !signal ||
      signal.aborted
    )
      return fault('permission-denied');
    if (!(await this.host.verifyTrust(entry.owner, trust.digest))) return fault('package-changed');
    const endpoint = await this.readEndpoint();
    if (!endpoint.ok) return endpoint;
    const currentPolicy = this.host.permissionControl.inspect(identity);
    if (
      signal.aborted ||
      !this.host.manager.isActive(entry.owner) ||
      !currentPolicy ||
      currentPolicy.epoch !== policy.epoch ||
      currentPolicy.blocked ||
      currentPolicy.preset === 'deny' ||
      !this.host.describeTrust(entry.owner)?.trusted
    )
      return fault('stale-owner');
    return {
      ok: true,
      value: {
        owner: entry.owner,
        digest: trust.digest,
        policyEpoch: policy.epoch,
        configRevision: endpoint.value.revision,
        baseUrl: endpoint.value.baseUrl,
        signal,
      },
    };
  }
  async saveEndpoint(
    baseUrl: string,
    expectedRevision: number,
  ): Promise<Result<DesktopCompanionEndpointSave>> {
    const before = await this.readSource();
    if (!before.ok) return before;
    const normalized = companionEndpoint(baseUrl);
    const saved = await this.host.configs.save(identity, { baseUrl: normalized }, expectedRevision);
    if (!saved.ok) return saved;
    let source: Result<DesktopCompanionSource>;
    try {
      source = await this.readSource();
    } catch (error) {
      source = fault(error instanceof KernelFault ? error.error.code : 'unavailable');
    }
    return {
      ok: true,
      value: {
        baseUrl: saved.value.snapshot.data['baseUrl'] as string,
        configRevision: saved.value.snapshot.revision,
        source,
      },
    };
  }
  onConfigurationCommit(listener: (revision: number) => void): () => void {
    return this.host.onConfigurationCommit(identity.pluginId, listener);
  }
  async isCurrent(source: DesktopCompanionSource): Promise<boolean> {
    if (source.signal.aborted || !this.host.manager.isActive(source.owner)) return false;
    const policy = this.host.permissionControl.inspect(identity);
    if (
      !policy ||
      policy.blocked ||
      policy.preset === 'deny' ||
      policy.epoch !== source.policyEpoch
    )
      return false;
    if (!(await this.host.verifyTrust(source.owner, source.digest))) return false;
    const endpoint = await this.readEndpoint();
    return (
      endpoint.ok &&
      endpoint.value.revision === source.configRevision &&
      endpoint.value.baseUrl === source.baseUrl &&
      !source.signal.aborted
    );
  }
  async withToken<T>(
    source: DesktopCompanionSource,
    token: string,
    signal: AbortSignal,
    operation: (token: string, signal: AbortSignal) => Promise<T>,
    commit?: ArtifactSaveCommit,
  ): Promise<T> {
    if (!(await this.isCurrent(source))) throw new KernelFault('stale-owner');
    // A supplied token is borrowed only. This broker has no persistent encryption path.
    const broker = new CredentialBroker({
      store: new MemoryCiphertextStore(),
      cipher: {
        encrypt: async () => {
          throw new CredentialError('unavailable');
        },
        decrypt: async () => {
          throw new CredentialError('unavailable');
        },
      },
      authorize: credentialPermissionAuthorizer(this.host.permissions),
    });
    let outcome: { value: T } | { error: unknown } | undefined;
    let actual: Promise<void> | undefined;
    const started = this.host.tasks.run(
      source.owner,
      async (context: TaskContext) => {
        let lease: PermissionLease | undefined;
        try {
          const sourceLease = await this.host.permissions.authorize(
            source.owner,
            context.taskId,
            { kind: 'files', scope: 'plugin-data', access: 'read' },
            context.signal,
          );
          if (!sourceLease.ok) throw new KernelFault(sourceLease.error.code);
          lease = sourceLease.value;
          if (!(await this.isCurrent(source))) throw new KernelFault('stale-owner');
          await broker.withSecretForHost(
            source.owner,
            ['service-token'],
            'service-token',
            {
              taskId: context.taskId,
              signal: AbortSignal.any([context.signal, lease.signal, signal]),
            },
            async (secret, authorizedSignal) => {
              actual = (async () => {
                try {
                  const value = await operation(secret, authorizedSignal);
                  if (
                    !isCommittedArtifactSave(value, commit, source) &&
                    (!(await this.isCurrent(source)) ||
                      authorizedSignal.aborted ||
                      context.signal.aborted ||
                      !lease?.isValid())
                  )
                    throw new KernelFault('stale-owner');
                  // Never publish a service-supplied echo of the owner bearer through an IPC Result.
                  if (broker.redactor.containsValue(value))
                    throw new KernelFault('permission-denied');
                  outcome = { value };
                } catch (error) {
                  outcome = { error };
                }
              })();
              await actual;
              return null;
            },
            token,
          );
        } catch (error) {
          if (
            !outcome ||
            (!('error' in outcome) && !isCommittedArtifactSave(outcome.value, commit, source))
          )
            outcome = { error };
        } finally {
          await actual;
          lease?.close();
        }
        return null;
      },
      { signal },
    );
    if (!started.ok) {
      broker.dispose();
      throw new KernelFault(started.error.code);
    }
    try {
      const logical = await started.value.result;
      await started.value.settled;
      if (outcome && 'error' in outcome) {
        if (outcome.error instanceof KernelFault) throw outcome.error;
        if (outcome.error instanceof CredentialError) throw new KernelFault(outcome.error.code);
        throw new KernelFault('unavailable');
      }
      if (
        !logical.ok &&
        !(outcome && 'value' in outcome && isCommittedArtifactSave(outcome.value, commit, source))
      )
        throw new KernelFault(logical.error.code);
      if (!outcome || !('value' in outcome)) throw new KernelFault('unavailable');
      return outcome.value;
    } finally {
      await actual;
      await started.value.settled;
      started.value.release();
      broker.dispose();
      await broker.drainUses();
      await broker.drainWrites();
      broker.redactor.clear();
    }
  }
}
