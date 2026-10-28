import fs from 'node:fs/promises';
import path from 'node:path';
import { discoverPlugins } from '../../../packages/host-kernel/src/runtime/discovery.js';
import { APPLICATION_PLUGIN_IDS, DEMO_PLUGIN_IDS } from '../../../packages/contracts/src/index.js';
export async function generateAdmission(workspace: string): Promise<void> {
  const admitted = new Set<string>([
    ...Object.values(APPLICATION_PLUGIN_IDS),
    ...Object.values(DEMO_PLUGIN_IDS),
  ]);
  const found = await discoverPlugins([
    { directory: path.join(workspace, 'plugins'), origin: 'builtin' },
  ]);
  if (!found.complete) throw new Error('Incomplete builtin discovery');
  const plugins = Object.fromEntries(
    found.plugins
      .filter((p) => admitted.has(p.manifest.id))
      .map((p) => [p.manifest.id, { files: p.files }]),
  );
  for (const id of admitted) if (!plugins[id]) throw new Error('Missing first-party source: ' + id);
  await fs.writeFile(
    path.join(workspace, 'apps/desktop/src/main/builtin-admission.json'),
    JSON.stringify({ version: 1, plugins }, null, 2) + String.fromCharCode(10),
  );
}
