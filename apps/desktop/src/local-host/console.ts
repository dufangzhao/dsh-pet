import {
  LOCAL_AGENT_LINK_PLUGIN_ID,
  QQ_OFFICIAL_PLUGIN_ID,
  QQ_ONEBOT_PLUGIN_ID,
  type LocalHostRuntimeIdentity,
  type LocalAgentLinkView,
  type LocalHostConsoleView,
  type LocalHostConsoleMutation,
  type LocalHostSourceReview,
  type LocalHostSourceReviewCommand,
  type LocalHostSourceTrustCommand,
  type LocalHostSourcePresetCommand,
  type LocalHostSourceSettingsCommand,
  type LocalHostSourceEnabledCommand,
  type LocalHostAgentSettingsCommand,
  type LocalHostAgentEnabledCommand,
  type LocalHostSecretTarget,
  type ManagedSourceSelector,
} from '@pet/contracts';
import { KernelFault, SecretRedactor } from '@pet/host-kernel';
import type {
  LocalPluginKernel,
  LocalSourceId,
} from '../../../../packages/local-host/src/kernel.js';
import type {
  LocalQQSourceController,
  LocalSourceMutation,
} from '../../../../packages/local-host/src/qq-source.js';
import type { QQAgentLink } from '../../../../packages/local-host/src/qq-agent-link.js';

const pluginId = (selector: ManagedSourceSelector): LocalSourceId =>
  selector === 'agent-link'
    ? LOCAL_AGENT_LINK_PLUGIN_ID
    : selector === 'official'
      ? QQ_OFFICIAL_PLUGIN_ID
      : QQ_ONEBOT_PLUGIN_ID;
/** Native operator facade over the actual owners; it stores neither credentials nor another settings ledger. */
export class LocalHostConsole {
  readonly redactor = new SecretRedactor();
  readonly runManagement: LocalPluginKernel['runManagement'];
  private closed = false;
  private closing: Promise<void> | undefined;
  constructor(
    private readonly options: {
      readonly identity: LocalHostRuntimeIdentity;
      readonly kernel: LocalPluginKernel;
      readonly sources: LocalQQSourceController;
      readonly agent: QQAgentLink;
      changed(): void;
    },
  ) {
    this.runManagement = (work, settings) => options.kernel.runManagement(work, settings);
  }
  private live(): void {
    if (this.closed) throw new KernelFault('unavailable');
  }
  async view(): Promise<LocalHostConsoleView> {
    return (await this.mutation()).view;
  }
  private async mutation(
    source?: LocalSourceMutation,
    committedAgent?: LocalAgentLinkView,
  ): Promise<LocalHostConsoleMutation> {
    const [sources, agentLink] = await Promise.all([
      source?.view ?? this.options.sources.view(),
      committedAgent ?? this.options.agent.view(),
    ]);
    return {
      view: {
        identity: this.options.identity,
        sourcesRevision: sources.revision,
        sources: [...sources.sources],
        agentLink,
      },
      error: source?.error ?? null,
    };
  }
  private sourceReview(protocol: ManagedSourceSelector): LocalHostSourceReview {
    const id = pluginId(protocol),
      review = this.options.kernel.review(id),
      policy = this.options.kernel.host.permissionControl.inspect({
        pluginId: id,
        instanceId: 'default',
      });
    if (!policy) throw new KernelFault('not-ready');
    return {
      protocol,
      digest: review.digest,
      trusted: review.trusted,
      preset: review.preset,
      blocked: review.blocked,
      permissionEpoch: policy.epoch,
      cleanup: review.cleanup,
    };
  }
  async review(input: LocalHostSourceReviewCommand): Promise<LocalHostSourceReview> {
    this.live();
    return this.sourceReview(input.protocol);
  }
  async trust(input: LocalHostSourceTrustCommand): Promise<LocalHostConsoleMutation> {
    this.live();
    const current = this.sourceReview(input.protocol);
    if (
      current.digest !== input.expectedDigest ||
      current.permissionEpoch !== input.expectedPermissionEpoch
    )
      throw new KernelFault('conflict');
    // No await between captured review/epoch checks and the existing synchronous permission owner.
    const id = pluginId(input.protocol);
    if (input.trusted) this.options.kernel.confirmTrust(id, input.expectedDigest);
    else this.options.kernel.withdrawTrust(id, input.expectedDigest);
    this.options.changed();
    return { view: await this.view(), error: null };
  }
  async preset(input: LocalHostSourcePresetCommand): Promise<LocalHostConsoleMutation> {
    this.live();
    const current = this.sourceReview(input.protocol);
    if (
      current.digest !== input.expectedDigest ||
      current.permissionEpoch !== input.expectedPermissionEpoch
    )
      throw new KernelFault('conflict');
    this.options.kernel.setPreset(pluginId(input.protocol), input.preset);
    this.options.changed();
    return { view: await this.view(), error: null };
  }
  async sourceSettings(input: LocalHostSourceSettingsCommand): Promise<LocalHostConsoleMutation> {
    this.live();
    const mutation = await this.options.sources.saveSource({
      protocol: input.protocol,
      expectedRevision: input.expectedRevision,
      settings: input.settings,
    });
    return this.mutation(mutation);
  }
  async sourceEnabled(input: LocalHostSourceEnabledCommand): Promise<LocalHostConsoleMutation> {
    this.live();
    const mutation = await this.options.sources.setEnabled(
      input.protocol,
      input.enabled,
      input.expectedControlRevision,
      {
        expectedConfigRevision: input.expectedConfigRevision,
        expectedCredentialVersion: input.expectedCredentialVersion,
      },
    );
    return this.mutation(mutation);
  }
  async agentSettings(input: LocalHostAgentSettingsCommand): Promise<LocalHostConsoleMutation> {
    this.live();
    const committed = await this.options.agent.saveTarget({
      expectedRevision: input.expectedRevision,
      baseUrl: input.baseUrl,
      agentId: input.agentId,
      agentEpoch: input.agentEpoch,
    });
    return this.mutation(undefined, committed);
  }
  async agentEnabled(input: LocalHostAgentEnabledCommand): Promise<LocalHostConsoleMutation> {
    this.live();
    const committed = input.enabled
      ? await this.options.agent.connect(input.expectedRevision, input.expectedCredentialVersion)
      : await this.options.agent.disconnect(
          input.expectedRevision,
          input.expectedCredentialVersion,
        );
    return this.mutation(undefined, committed);
  }
  async clearCredential(
    input: LocalHostSecretTarget,
    signal: AbortSignal,
  ): Promise<LocalHostConsoleMutation> {
    return this.credential(input, null, signal);
  }
  async prepareSecret(
    input: LocalHostSecretTarget,
  ): Promise<(value: string, signal: AbortSignal) => Promise<LocalHostConsoleMutation>> {
    this.live();
    const captured = Object.freeze({ ...input });
    if (captured.purpose === 'qq-source') {
      const source = (await this.options.sources.view()).sources.find(
        (value) => value.protocol === captured.protocol,
      );
      if (
        !source ||
        source.configRevision !== captured.expectedRevision ||
        source.credential.version !== captured.expectedCredentialVersion
      )
        throw new KernelFault('conflict');
    } else {
      const agent = await this.options.agent.view();
      if (
        agent.revision !== captured.expectedRevision ||
        agent.credentialVersion !== captured.expectedCredentialVersion
      )
        throw new KernelFault('conflict');
    }
    return (value, signal) => this.credential(captured, value, signal);
  }
  private async credential(
    input: LocalHostSecretTarget,
    value: string | null,
    signal: AbortSignal,
  ): Promise<LocalHostConsoleMutation> {
    this.live();
    signal.throwIfAborted();
    if (input.purpose === 'qq-source') {
      const mutation = await this.options.sources.credential(
        {
          protocol: input.protocol,
          expectedRevision: input.expectedRevision,
          expectedCredentialVersion: input.expectedCredentialVersion,
          value,
        },
        signal,
      );
      return this.mutation(mutation);
    }
    const committed = await this.options.agent.saveCredential(
      {
        expectedRevision: input.expectedRevision,
        expectedCredentialVersion: input.expectedCredentialVersion,
        value,
      },
      signal,
    );
    return this.mutation(undefined, committed);
  }
  close(): Promise<void> {
    return (this.closing ??= (async () => {
      this.closed = true;
      await this.options.agent.close();
      await this.options.sources.close();
    })());
  }
}
