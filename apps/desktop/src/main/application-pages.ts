import fs from 'node:fs/promises';
import path from 'node:path';
import { APPLICATION_PLUGIN_IDS, type ApplicationPage, type JsonObject } from '@pet/contracts';
import { jsonPreflight } from '@pet/contracts/validation';
import { verifyDiscoveredPlugin } from '@pet/host-kernel';
import type { DesktopHost } from './desktop-host.js';
const views = new Map<string, string>(
  Object.entries(APPLICATION_PLUGIN_IDS)
    .filter(([key]) => !['profile', 'agent'].includes(key))
    .map(([key, id]) => [id, 'pet.' + key]),
);
const ordered = [...views.keys()];
const object = (value: unknown): value is JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
/** Adapter over the public Cortico WebUiPageManifest, scoped by an existing panel owner. */
export async function applicationPages(host: DesktopHost): Promise<ApplicationPage[]> {
  const pages: ApplicationPage[] = [];
  for (const contribution of host.manager.contributions()) {
    const declaration = contribution.declaration;
    if (declaration.kind !== 'panel' || !declaration.entry.endsWith('.json')) continue;
    const owner = contribution.owner;
    const source = host.getPackage(owner);
    if (!source || !host.manager.isActive(owner) || !(await verifyDiscoveredPlugin(source)))
      continue;
    const target = path.resolve(source.directory, declaration.entry);
    const relative = path.relative(source.directory, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue;
    const raw = await fs.readFile(target, 'utf8');
    if (Buffer.byteLength(raw, 'utf8') > 48 * 1024) continue;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      continue;
    }
    const safe = jsonPreflight(value);
    if (!safe.ok || !object(safe.value)) continue;
    const manifest = safe.value;
    if (
      typeof manifest['id'] !== 'string' ||
      typeof manifest['label'] !== 'string' ||
      !['world', 'persona', 'llm'].includes(String(manifest['kind'])) ||
      manifest['label'].length > 128
    )
      continue;
    const panels = manifest['panels'];
    if (
      panels !== undefined &&
      (!Array.isArray(panels) ||
        panels.length > 32 ||
        panels.some(
          (p) => !object(p) || typeof p['id'] !== 'string' || typeof p['title'] !== 'string',
        ))
    )
      continue;
    const builtin = source.origin === 'builtin' ? views.get(owner.pluginId) : undefined;
    if (Array.isArray(panels))
      manifest['panels'] = panels.map((p) => {
        const panel = { ...(p as JsonObject) };
        if (panel['builtin'] !== builtin) delete panel['builtin'];
        return panel;
      });
    manifest['availability'] = 'active';
    delete manifest['client'];
    if (!host.manager.isActive(owner)) continue;
    const firstPanel = Array.isArray(panels) ? (panels[0] as JsonObject | undefined) : undefined;
    const panelId = typeof firstPanel?.['id'] === 'string' ? firstPanel['id'] : null;
    const actions = panelId
      ? host.manager
          .contributions()
          .filter(
            (c) =>
              c.owner.pluginId === owner.pluginId &&
              c.owner.instanceId === owner.instanceId &&
              c.owner.generation === owner.generation &&
              c.declaration.kind === 'command',
          )
          .map((c) => ({
            panelId,
            method: c.id,
            label: c.declaration.title['zh-CN'] ?? Object.values(c.declaration.title)[0]!,
          }))
      : [];
    pages.push({
      id: [owner.pluginId, owner.instanceId, contribution.id].join('/'),
      owner: { ...owner },
      title: manifest['label'],
      order: ordered.includes(owner.pluginId) ? (ordered.indexOf(owner.pluginId) + 1) * 10 : 100,
      manifest,
      ...(actions.length ? { actions } : {}),
    });
  }
  return pages.sort(
    (a, b) => a.order - b.order || a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
  );
}
