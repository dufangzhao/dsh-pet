import admission from './builtin-admission.json' with { type: 'json' };
import {
  APPLICATION_PLUGIN_IDS as ID,
  DEMO_PLUGIN_IDS,
  SPEECH_OUTPUT_PLUGIN_IDS,
  VOICE_INPUT_PLUGIN_IDS,
  modelProviderId,
  modelService,
} from '@pet/contracts';
import type { DesktopHost } from './desktop-host.js';
import type { DiscoveredPlugin } from '@pet/host-kernel';
const records: Readonly<Record<string, { files: readonly unknown[] }>> = admission.plugins;
export function admittedApplicationSource(candidate: DiscoveredPlugin): boolean {
  const expected = records[candidate.manifest.id];
  return (
    candidate.origin === 'builtin' &&
    !!expected &&
    JSON.stringify(expected.files) === JSON.stringify(candidate.files)
  );
}
export async function startApplicationPlugins(
  host: DesktopHost,
  enabled: (id: string) => boolean = () => true,
): Promise<void> {
  host.manager.capabilities.select({ pluginId: ID.agent, instanceId: 'default' }, 'app.profile@1', {
    pluginId: ID.profile,
    instanceId: 'default',
    providerId: 'profile',
  });
  host.manager.capabilities.select(
    { pluginId: ID.agent, instanceId: 'default' },
    'agent.conversation@1',
    { pluginId: ID.agent, instanceId: 'default', providerId: 'conversation' },
  );
  host.manager.capabilities.select(
    { pluginId: ID.agent, instanceId: 'default' },
    'llm.responses@1',
    { pluginId: DEMO_PLUGIN_IDS.cloud, instanceId: 'default', providerId: 'responses' },
  );
  const selectedModel = await host.configs.get({
    pluginId: DEMO_PLUGIN_IDS.cloud,
    instanceId: 'default',
  });
  const active =
    selectedModel.ok && typeof selectedModel.value.data['active'] === 'string'
      ? selectedModel.value.data['active']
      : '';
  if (modelService(active)?.available)
    host.manager.capabilities.select(
      { pluginId: ID.agent, instanceId: 'default' },
      'llm.responses@1',
      {
        pluginId: DEMO_PLUGIN_IDS.cloud,
        instanceId: 'default',
        providerId: modelProviderId(active),
      },
    );
  for (const id of [
    ...new Set([
      ...Object.values(ID),
      DEMO_PLUGIN_IDS.avatar,
      ...Object.values(SPEECH_OUTPUT_PLUGIN_IDS),
      VOICE_INPUT_PLUGIN_IDS.talkKey,
    ]),
  ]) {
    if (!enabled(id)) continue;
    const entry = host.manager.get({ pluginId: id, instanceId: 'default' });
    const source = entry ? host.getPackage(entry.owner) : null;
    if (!source || !entry || !admittedApplicationSource(source)) continue;
    const review = host.describeTrust(entry.owner);
    if (!review || !(await host.verifyTrust(entry.owner, review.digest))) continue;
    host.permissionControl.confirmTrust(
      { pluginId: id, instanceId: 'default' },
      review.digest,
      true,
    );
    const config = await host.configs.get({ pluginId: id, instanceId: 'default' });
    if (config.ok)
      await host.manager.enable({ pluginId: id, instanceId: 'default' }, config.value.data);
  }
}
