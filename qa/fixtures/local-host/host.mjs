// Controlled G0 composition only: production role/lifecycle, actual kernel and QQ factories.
import { register } from 'tsx/esm/api';
register();
const { runLocalHostElectron } = await import('../../../apps/desktop/src/local-host/main.ts');
const { createLocalPluginKernel } = await import('../../../packages/local-host/src/kernel.ts');
const { createAuthorizedOneBotIo, createAuthorizedOfficialIo } = await import('../../../packages/local-host/src/qq-native/index.ts');
const { validateManifest } = await import('../../../packages/contracts/src/validation/index.ts');
const { KernelFault } = await import('../../../packages/host-kernel/src/index.ts');
const { QQ_OFFICIAL_PLUGIN_ID, QQ_ONEBOT_PLUGIN_ID } = await import('../../../packages/contracts/src/index.ts');
const { readFile, writeFile, appendFile, realpath } = await import('node:fs/promises');
const { createRequire } = await import('node:module');
const resolveSource = createRequire(new URL('../../../packages/local-host/package.json', import.meta.url)).resolve;
const path = await import('node:path');
const arg = process.argv.find(value => value.startsWith('--local-host-profile='));
if (!arg) throw new Error('Missing private G0 profile');
const profile = arg.slice('--local-host-profile='.length);
const secret = 'g0-controlled-local-onebot-key';
const source = async specifier => {
  const directory = await realpath(path.resolve(path.dirname(resolveSource(specifier)), '..'));
  const checked = validateManifest(JSON.parse(await readFile(path.join(directory, 'plugin.json'), 'utf8')));
  if (!checked.ok) throw new Error('Invalid actual source manifest');
  return { directory, manifest: checked.value };
};
const official = await source('@pet/qq-official'), onebot = await source('@pet/qq-onebot');
void runLocalHostElectron({ profileDirectory: profile, packageVersion: '0.1.0', createKernel: async () => {
  let driver, officialRevision, onebotRevision;
  let resolveListening; const listening = new Promise(resolve => { resolveListening = resolve; });
  const binding = (host, context, settings, revision) => {
    const identity = { pluginId: context.owner.pluginId, instanceId: context.owner.instanceId };
    const epoch = host.permissionControl.inspect(identity)?.epoch;
    return { owner: context.owner, signal: context.signal, configRevision: revision, credentialVersion: 'g0-key-version', settings, credential: secret,
      check: async () => { const current = await host.configs.get(identity), policy = host.permissionControl.inspect(identity);
        if (!host.manager.isActive(context.owner) || context.signal.aborted || !host.verifySource(identity.pluginId) || !policy || policy.epoch !== epoch || policy.blocked || policy.preset === 'deny' || !current.ok || current.value.revision !== revision) throw new KernelFault('stale-owner'); },
    };
  };
  const kernel = await createLocalPluginKernel({ dataDirectory: path.join(profile, 'plugin-data'),
    official: { ...official, preset: 'allow', config: { protocol: 'official', appId: 'g0-only', scenes: ['private'] }, portsFor(context, host) { return {
      authorizedOfficial: settings => createAuthorizedOfficialIo(host, binding(host, context, settings, officialRevision), { fetch: async () => { throw new Error('G0 has no official account/network'); }, websocket: () => { throw new Error('G0 has no official account/network'); } }),
      observer: { onStatus() {}, onEvent: async () => {} }, bind: () => async () => {},
    }; } },
    onebot: { ...onebot, preset: 'allow', config: { protocol: 'onebot-v11', accountId: '12345', mode: 'reverse-ws', channelMode: 'universal', mediaProfile: 'snowluma-v11', listenHost: '127.0.0.1', listenPort: 0, path: '/g0' }, portsFor(context, host) { return {
      authorizedOneBot: settings => createAuthorizedOneBotIo(host, binding(host, context, settings, onebotRevision), { onListening: value => resolveListening(value.port) }),
      observer: { onStatus() {}, onEvent: async event => { await appendFile(path.join(profile, 'g0-observed.ndjson'), JSON.stringify({ postType: event.post_type }) + '\n', { mode: 0o600 }); } },
      bind: value => { driver = value; return async () => {}; },
    }; } },
  });
  try {
    for (const id of [QQ_OFFICIAL_PLUGIN_ID, QQ_ONEBOT_PLUGIN_ID]) {
      const review = kernel.review(id); if (review.trusted) throw new Error('G0 source was implicitly trusted');
      kernel.confirmTrust(id, review.digest);
    }
    const a = await kernel.host.configs.get({ pluginId: QQ_OFFICIAL_PLUGIN_ID, instanceId: 'default' });
    const b = await kernel.host.configs.get({ pluginId: QQ_ONEBOT_PLUGIN_ID, instanceId: 'default' });
    if (!a.ok || !b.ok) throw new Error('No actual Config'); officialRevision = a.value.revision; onebotRevision = b.value.revision;
    await kernel.setEnabled(QQ_OFFICIAL_PLUGIN_ID, true); await kernel.setEnabled(QQ_ONEBOT_PLUGIN_ID, true);
    if (!driver) throw new Error('Actual OneBot factory did not bind');
    kernel.runFor(QQ_ONEBOT_PLUGIN_ID, async task => { await driver.start(task.signal); return null; });
    const port = await listening;
    await writeFile(path.join(profile, 'g0-native.json'), JSON.stringify({ pid: process.pid, port, sourceRoots: [official.directory, onebot.directory], inheritedForbiddenNames: ['AGENT_TOKEN', 'MODEL_API_KEY', 'DSH_API_KEY', 'G0_UNDECLARED_KEY', 'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE'].filter(name => Object.hasOwn(process.env, name)) }), { mode: 0o600 });
    return kernel;
  } catch (error) { await kernel.close(); throw error; }
} });
