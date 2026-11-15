// Future Q2/Q4 check for downstream auth isolation through the actual service/client.
// Do not run until backend/source freeze, parent build and integration authorization.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { register } from 'tsx/esm/api';
import { startControlledMagpie } from '../fixtures/companion-voice-input/controlled-magpie.mjs';

if (process.argv.length !== 3 || process.argv[2] !== '--run-frozen') {
  console.error('Parent source freeze, build and explicit integration authorization are required');
  process.exit(2);
}
register();
const { createCompanionService } = await import('../../apps/companion-service/src/service.ts');
const { CompanionClient } = await import('../../plugins/text-client/src/client/client.ts');
const { VOICE_ASR_PROVIDER } = await import('../../packages/contracts/src/companion-voice.ts');
const report = { scope: 'controlled-provider-auth-isolation', status: 'running', checks: [],
  limit: 'Synthetic local peer and credentials only; no real Magpie authentication or inference.' };
let service, peer, client, token;
let stage = 'preflight', exit = 1;
function value(result) {
  assert.equal(result.ok, true, `actual operation failed: ${result.error?.code ?? 'unknown'}`);
  return result.value;
}
try {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'companion-voice-auth-'));
  token = randomUUID() + randomUUID();
  peer = await startControlledMagpie({ catalogResult: 'auth',
    expectedAuthorization: 'Bearer magpie-dsh-pet' });
  service = await createCompanionService({ dataDirectory, token, mode: 'scripted' });
  client = new CompanionClient({ baseUrl: service.url });
  await client.connect(token);
  const target = client.getVoiceTarget(); assert.ok(target);
  const initial = value(await client.readVoice(target));
  const provider = initial.providers.find((item) => item.providerRef === VOICE_ASR_PROVIDER);
  assert.ok(provider);
  const configured = value(await client.saveAsrProvider({ providerRef: provider.providerRef,
    expectedRevision: provider.configRevision, settings: { baseUrl: peer.baseUrl, modelRef: '',
      authMode: 'local-client-id', protocol: 'mimo-native' } }, target));
  const selected = configured.providers.find((item) => item.providerRef === provider.providerRef);
  assert.ok(selected?.bindingId);
  stage = 'upstream-auth-remains-voice-local';
  const query = new URLSearchParams({ providerRef: selected.providerRef, bindingId: selected.bindingId });
  const direct = await fetch(`${service.url}/api/voice/catalog?${query}`, { headers: {
    Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
  const body = await direct.json();
  assert.equal(direct.status, 200); assert.equal(body.ok, false); assert.equal(body.error.code, 'auth-failed');
  assert.equal(peer.snapshot.catalogCount, 1); assert.equal(peer.snapshot.audioCount, 0);
  const fromClient = await client.readAsrCatalog({ providerRef: selected.providerRef,
    bindingId: selected.bindingId }, target);
  assert.equal(fromClient.ok, false); assert.equal(fromClient.error.code, 'auth-failed');
  await client.refresh();
  assert.equal(client.getState().phase, 'live');
  assert.equal(client.getVoiceTarget().agentId, target.agentId);
  assert.equal(peer.snapshot.audioCount, 0);
  stage = 'service-auth-remains-separate';
  const denied = await fetch(`${service.url}/api/voice`, { headers: {
    Authorization: 'Bearer synthetic-invalid-token' }, signal: AbortSignal.timeout(10000) });
  assert.equal(denied.status, 401);
  assert.equal(client.getState().phase, 'live');
  report.checks.push('provider-401-is-http-200-voice-failure-with-live-text-client');
  report.checks.push('service-bearer-denial-remains-separate');
  report.status = 'controlled-provider-auth-passed'; exit = 0;
} catch (error) {
  let detail = error instanceof Error ? error.message : 'Non-error failure';
  for (const secret of [token].filter(Boolean))
    for (const value of [secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64'), JSON.stringify(secret).slice(1, -1)])
      detail = detail.split(value).join('[redacted]');
  report.status = 'controlled-provider-auth-failed'; report.failure = `${stage}: ${detail.slice(0, 700)}`;
} finally {
  try { client?.dispose(); } catch { report.status = 'cleanup-failed'; exit = 1; }
  try { await service?.close(); } catch { report.status = 'cleanup-failed'; exit = 1; }
  try { await peer?.close(); } catch { report.status = 'cleanup-failed'; exit = 1; }
  console.log(JSON.stringify(report, null, 2)); process.exitCode = exit;
}
