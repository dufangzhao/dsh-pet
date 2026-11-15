// Actual Main controllers → fresh real service → real coreless daemon; no manual host selection.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { register } from 'tsx/esm/api';
process.env.TSX_DISABLE_CACHE = '1';
register();
const { createCompanionService } = await import('../../apps/companion-service/src/service.ts');
const { createProductionLocalHost } = await import('../../apps/desktop/src/local-host/composition.ts');
const { startLocalHostDaemon } = await import('../../apps/desktop/src/local-host/daemon.ts');
const { attachLocalManagement } = await import('../../packages/local-host/src/management.ts');
const { DesktopCompanionController } = await import('../../apps/desktop/src/main/companion-client-controller.ts');
const { DesktopLocalHostController } = await import('../../apps/desktop/src/main/local-host-controller.ts');
const { packageFingerprint } = await import('../../packages/companion-runtime/src/plugin-host.ts');
const repository = path.resolve(import.meta.dirname, '../..');
const inputs = ['apps/desktop', 'apps/companion-service', 'packages/local-host', 'packages/contracts', 'packages/host-kernel', 'packages/companion-runtime', 'packages/plugin-sdk', 'plugins/text-client', 'plugins/qq-official', 'plugins/qq-onebot', 'plugins/local-host-bridge', 'plugins/local-agent-link'];
const pins = () => Object.fromEntries(inputs.map((name) => [name, packageFingerprint(path.join(repository, name))]));
const beforePins = pins();
const root = await mkdtemp(path.join(tmpdir(), 'pet-main-fresh-link-'));
const token = `main-fresh-service-${randomUUID()}`;
const report = { scope: 'actual-Main-explicit-link-selects-fresh-service-and-real-daemon-connects', status: 'running', checks: [], beforePins, root };
let service, daemon, companion, local, native;
const checked = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
try {
  service = await createCompanionService({ dataDirectory: path.join(root, 'server'), hostname: '127.0.0.1', port: 0, token, mode: 'scripted' });
  assert.deepEqual((await service.localHost.view()).selection, { mode: 'service-local', hostId: null });
  const lifetime = new AbortController();
  let revision = 1;
  let committed = () => {};
  const source = () => ({ owner: { pluginId: 'pet.companion-client', instanceId: 'default', generation: 1 }, digest: 'controlled-Main-source-port', policyEpoch: 1, configRevision: revision, baseUrl: service.url, signal: lifetime.signal });
  const host = {
    readEndpoint: async () => ({ ok: true, value: { baseUrl: service.url, revision } }),
    readSource: async () => ({ ok: true, value: source() }),
    saveEndpoint: async (baseUrl, expected) => {
      assert.equal(expected, revision);
      assert.equal(baseUrl, service.url);
      revision++;
      committed(revision);
      return { ok: true, value: { baseUrl, configRevision: revision, source: { ok: true, value: source() } } };
    },
    onConfigurationCommit: (listener) => { committed = listener; return () => {}; },
    isCurrent: async (captured) => captured.configRevision === revision && !lifetime.signal.aborted,
    withToken: async (_source, supplied, signal, operation) => operation(supplied, signal),
  };
  companion = new DesktopCompanionController(host, { choose: async () => null }, () => {});
  await companion.initialize();
  const connection = checked(await companion.connect({ baseUrl: service.url, token, expectedRevision: revision }));
  assert.equal(connection.phase, 'live');
  const profile = path.join(root, 'local-profile');
  daemon = await startLocalHostDaemon({ directory: path.join(profile, 'management'), packageVersion: '0.1.0-main-selection-qa', ...createProductionLocalHost({ dataDirectory: path.join(profile, 'plugin-data') }), onStopped: () => {} });
  native = await attachLocalManagement(daemon.rendezvous);
  local = new DesktopLocalHostController({ companion, start: async () => native, attach: async () => native, changed: () => {} });
  const initial = checked(await local.start());
  const target = { hostId: initial.view.identity.hostId, bootId: initial.view.identity.bootId };
  let review = checked(await local.reviewSource({ ...target, protocol: 'agent-link' }));
  checked(await local.confirmSourceTrust({ ...target, protocol: 'agent-link', expectedDigest: review.digest, expectedPermissionEpoch: review.permissionEpoch, trusted: true }));
  review = checked(await local.reviewSource({ ...target, protocol: 'agent-link' }));
  checked(await local.setSourcePreset({ ...target, protocol: 'agent-link', expectedDigest: review.digest, expectedPermissionEpoch: review.permissionEpoch, preset: 'allow' }));
  const current = checked(await local.getState()).view.agentLink;
  const linked = checked(await local.linkCurrentAgent({ ...target, connectionId: connection.connectionId, expectedRevision: current.revision, expectedCredentialVersion: current.credentialVersion }));
  assert.equal(linked.error, null);
  assert.equal(linked.view.agentLink.hasCredential, true);
  assert.deepEqual((await service.localHost.view()).selection, { mode: 'remote-host', hostId: target.hostId });
  report.checks.push('fresh-service-selection-written-only-by-explicit-Main-link-with-original-owner-token');
  const enabled = checked(await local.setAgentEnabled({ ...target, expectedRevision: linked.view.agentLink.revision, expectedCredentialVersion: linked.view.agentLink.credentialVersion, enabled: true }));
  assert.equal(enabled.error, null);
  assert.equal(enabled.view.agentLink.phase, 'connected');
  const server = await service.localHost.view();
  assert.equal(server.phase, 'connected');
  assert.equal(server.peer.bootId, target.bootId);
  const status = checked(await native.status());
  assert.equal(status.kernel.localCore, false);
  assert.equal(status.kernel.localState, false);
  report.checks.push('actual-authenticated-Agent-bridge-connected-to-that-selected-host', 'actual-coreless-daemon-no-second-Core-or-State');
  const stopped = checked(await local.stop(target));
  assert.equal(stopped.phase, 'stopped');
  report.checks.push('actual-daemon-kernel-and-bridge-stop-joined');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = error instanceof Error ? error.stack : String(error);
  process.exitCode = 1;
} finally {
  report.cleanup = {};
  for (const [name, value] of [['local', local], ['companion', companion], ['management', native], ['daemon', daemon], ['service', service]]) {
    if (!value) { report.cleanup[name] = 'not-created'; continue; }
    try { await value.close(); report.cleanup[name] = 'joined'; }
    catch (error) { report.cleanup[name] = 'failed'; report.status = 'failed'; process.exitCode = 1; report.cleanupError = error instanceof Error ? error.message : String(error); }
  }
  if (daemon) report.localTasksAfterClose = daemon.kernel.host.tasks.diagnostics();
  report.afterPins = pins();
  try { assert.deepEqual(report.afterPins, beforePins, 'Runtime source changed during the real Main→service test'); report.sourcePinsStable = true; }
  catch { report.sourcePinsStable = false; report.status = 'failed'; process.exitCode = 1; }
  const evidence = path.join(repository, 'qa/fixtures/local-host/evidence', `main-link-${randomUUID()}`);
  await mkdir(evidence, { recursive: true });
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, report: path.join(evidence, 'report.json'), checks: report.checks, failure: report.failure }));
}
