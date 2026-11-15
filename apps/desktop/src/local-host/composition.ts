import { createRequire } from 'node:module';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { validateManifest } from '@pet/contracts/validation';
import { KernelFault } from '@pet/host-kernel';
import {
  createLocalPluginKernel,
  QQAgentLink,
  LocalQQExecutionOwner,
  type LocalPluginKernel,
} from '@pet/local-host';
import { LocalQQSourceController } from '../../../../packages/local-host/src/qq-source.js';
import { LocalHostConsole } from './console.js';
import { openPrivateDirectory } from '../../../../packages/local-host/src/rendezvous.js';
import {
  captureCurrentOwnedProcess,
  ownedProcessIdentity,
  verifyCurrentOwnedProcess,
  verifyOriginalProcessGone,
  type OwnedProcessProvider,
} from '../../../../packages/local-host/src/owned-process.js';
import type { startLocalHostDaemon } from './daemon.js';

const root = createRequire(import.meta.url);
const installed = createRequire(root.resolve('@pet/local-host'));
async function sourcePackage(specifier: string) {
  const directory = await realpath(path.resolve(path.dirname(installed.resolve(specifier)), '..'));
  const manifest = validateManifest(
    JSON.parse(await readFile(path.join(directory, 'plugin.json'), 'utf8')) as unknown,
  );
  if (!manifest.ok) throw new KernelFault('invalid-input');
  return { directory, manifest: manifest.value, preset: 'deny' as const };
}
/** One actual coreless kernel and its private sources/link. Package directories are the imported physical factories. */
export function createProductionLocalHost(options: {
  readonly dataDirectory: string;
}): Pick<Parameters<typeof startLocalHostDaemon>[0], 'createKernel' | 'createConsole'> {
  let kernel: LocalPluginKernel | undefined;
  let sources: LocalQQSourceController | undefined;
  let agent: QQAgentLink | undefined;
  let execution: LocalQQExecutionOwner | undefined;
  let ownedProcess: OwnedProcessProvider | undefined;
  return {
    createKernel: async () => {
      if (kernel) throw new KernelFault('conflict');
      const profile = await openPrivateDirectory(path.dirname(path.resolve(options.dataDirectory)));
      const provenance = await captureCurrentOwnedProcess(profile);
      const provider: OwnedProcessProvider = {
        identity: () => ownedProcessIdentity(provenance),
        check: () => verifyCurrentOwnedProcess(provenance, profile),
        gone: (original) => verifyOriginalProcessGone(original, profile),
      };
      ownedProcess = Object.freeze(provider);
      const [official, onebot, agentLink] = await Promise.all([
        sourcePackage('@pet/qq-official'),
        sourcePackage('@pet/qq-onebot'),
        sourcePackage('@pet/local-agent-link'),
      ]);
      kernel = await createLocalPluginKernel({
        dataDirectory: options.dataDirectory,
        official: {
          ...official,
          portsFor(context) {
            if (!sources) throw new KernelFault('not-ready');
            return sources.officialPorts(context);
          },
        },
        onebot: {
          ...onebot,
          portsFor(context) {
            if (!sources) throw new KernelFault('not-ready');
            return sources.onebotPorts(context);
          },
        },
        agentLink: {
          ...agentLink,
          portsFor(context) {
            if (!agent) throw new KernelFault('not-ready');
            return agent.featurePorts(context);
          },
        },
      });
      return kernel;
    },
    createConsole: async (current, identity, changed) => {
      if (current !== kernel || sources || agent || !ownedProcess)
        throw new KernelFault('conflict');
      try {
        sources = new LocalQQSourceController(current, {
          onOfficial: async (event, captured) => {
            if (!agent) throw new KernelFault('not-ready');
            await agent.official(event, captured);
          },
          onOneBot: async (event, captured) => {
            if (!agent) throw new KernelFault('not-ready');
            await agent.onebot(event, captured);
          },
          changed: () => {
            changed();
            if (agent) void agent.syncSources();
          },
        });
        execution = new LocalQQExecutionOwner({ kernel: current, sources, ownedProcess });
        agent = new QQAgentLink({
          kernel: current,
          identity,
          sources,
          execution,
          changed,
          ownedProcess,
        });
        await sources.initialize();
        await agent.initialize();
        return new LocalHostConsole({ kernel: current, identity, sources, agent, changed });
      } catch (error) {
        await agent?.close();
        await execution?.close();
        await sources?.close();
        throw error;
      }
    },
  };
}
