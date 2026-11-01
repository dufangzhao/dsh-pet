import path from 'node:path';
import { APPLICATION_PLUGIN_IDS, makeError, type Result } from '@pet/contracts';
import { KernelFault } from '@pet/host-kernel';
import type { DesktopHost } from './desktop-host.js';
import { admittedApplicationSource } from './application-admission.js';
const identity = { pluginId: APPLICATION_PLUGIN_IDS.profile, instanceId: 'default' };
/** Upgrade the saved profile before role activation; ConfigService validates and CAS-commits it. */
export async function migrateApplicationProfile(host: DesktopHost): Promise<Result<null>> {
  const current = await host.configs.get(identity);
  if (current.ok) return { ok: true, value: null };
  if (current.error.code !== 'not-ready') return current;
  const entry = host.manager.get(identity),
    source = entry ? host.getPackage(entry.owner) : null,
    review = entry ? host.describeTrust(entry.owner) : null;
  if (!entry || !source || !review || source.manifest.config?.version !== 2)
    return { ok: false, error: makeError('not-ready', false) };
  if (!admittedApplicationSource(source) && !review.trusted)
    return { ok: false, error: makeError('package-changed', false) };
  const signal = host.manager.ownerSignal(entry.owner);
  if (!signal || signal.aborted) return { ok: false, error: makeError('stale-owner', false) };
  try {
    if (!(await host.verifyTrust(entry.owner, review.digest)))
      return { ok: false, error: makeError('package-changed', false) };
    const prepared = await host.configs.prepareMigration(
      identity,
      (request) =>
        host.driver.migrateConfig(
          {
            owner: entry.owner,
            manifest: source.manifest,
            entryPath: path.resolve(source.directory, source.manifest.entries.runtime),
          },
          request,
        ),
      { signal },
    );
    if (!prepared.ok) return prepared;
    try {
      const committed = await prepared.value.commit(signal);
      return committed.ok ? { ok: true, value: null } : committed;
    } finally {
      prepared.value.discard();
    }
  } catch (error) {
    return {
      ok: false,
      error: makeError(error instanceof KernelFault ? error.error.code : 'unavailable', false),
    };
  }
}
