import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setImmediate as nextPoll } from 'node:timers/promises';
import { build } from 'esbuild';
import type { ApplicationSnapshot, JsonObject } from '../../packages/contracts/src/index.js';
import { DesktopHost } from '../../apps/desktop/src/main/desktop-host.js';
import { DemoController } from '../../apps/desktop/src/main/demo-controller.js';
import { ApplicationController } from '../../apps/desktop/src/main/application-controller.js';
import { demoReadiness } from '../../apps/desktop/src/main/demo-readiness.js';

const root = path.resolve(__dirname, '../..');
const fixture = { pluginId: 'qa.scripted-model', instanceId: 'default' };
const agent = { pluginId: 'pet.agent-cortico', instanceId: 'default' };
const profileIdentity = { pluginId: 'pet.profile', instanceId: 'default' };
const changes = [
  { petName: 'QA Model Pet', personaPrompt: 'QA_ALLOWED_PERSONA: be clear and report actual receipts.' },
  { petName: 'QA Denied Pet', personaPrompt: 'QA_DENIED_PERSONA: this change must not be committed.' },
];
const receipts = [
  'Settings saved; the updated prompt applies after the current batch ends.',
  'Settings were not changed: permission-denied',
];

void (async () => {
  let host: DesktopHost | undefined;
  let demo: DemoController | undefined;
  let application: ApplicationController | undefined;
  const report: Record<string, unknown> = { status: 'failed', checks: [], electron: process.versions['electron'], node: process.versions.node };
  const checks = report['checks'] as string[];
  const output: string[] = [];
  const drains: Promise<void>[] = [];
  const mediaErrors: string[] = [];
  try {
    const profile = path.join(__dirname, 'profile');
    const fixtureRoot = path.join(profile, 'plugins', fixture.pluginId);
    await fs.mkdir(fixtureRoot, { recursive: true });
    await fs.writeFile(path.join(fixtureRoot, 'plugin.json'), JSON.stringify({
      schemaVersion: 1, id: fixture.pluginId, version: '0.1.0',
      displayName: { 'zh-CN': 'QA scripted model' }, description: { 'zh-CN': '模型配置审批验收' }, license: 'MIT', host: '^1.0.0', platforms: ['win32-x64'],
      entries: { runtime: 'dist/index.mjs' }, provides: [{ id: 'responses', capability: 'llm.responses@1' }],
      permissions: [{ kind: 'files', scope: 'plugin-data', access: 'read-write' }],
      config: { version: 1, schema: { type: 'object', additionalProperties: false, properties: {} } },
    }));
    await build({
      stdin: { resolveDir: path.join(root, 'plugins/profile'), loader: 'ts', contents: `
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { definePlugin } from '@pet/plugin-sdk';
export default definePlugin({ async activate(ctx) {
  assert.ok(ctx.dataDirectory);
  // A synthetic canary belongs only to this fixture context, never to a service.
  const privateSecret = await fs.readFile(path.join(ctx.dataDirectory, 'private-canary.txt'), 'utf8');
  const audit = { requests: [], results: [], receipts: [] };
  const changes = ${JSON.stringify(changes)};
  let calls = 0;
  ctx.provide('responses', {
    describe: async () => ({ model: 'qa-scripted-model' }),
    respond: async (_task, input) => {
      const request = input.request;
      assert.ok(Array.isArray(request.input));
      assert.ok(request.tools.some(tool => tool.name === 'configure_pet'));
      assert.ok(request.tools.some(tool => tool.name === 'pet_say'));
      assert.equal(JSON.stringify(request).includes(privateSecret), false, 'Private fixture canary entered model request');
      assert.ok(++calls <= 4, 'Unexpected additional Core model round');
      const turn = Math.ceil(calls / 2);
      const configure = calls % 2 === 1;
      const callId = 'qa-configure-' + turn;
      let args = { changes: changes[turn - 1] };
      if (!configure) {
        const receipt = request.input.find(item => item.type === 'function_call_output' && item.call_id === callId);
        assert.equal(typeof receipt?.output, 'string', 'Core must deliver the actual configure_pet receipt');
        assert.match(receipt.output, /Settings saved;|Settings were not changed:/);
        audit.receipts.push(receipt.output);
        args = { text: 'QA receipt: ' + receipt.output };
      }
      const id = 'qa-response-' + calls;
      const origin = { instance: 'qa.scripted-model', module: 'openai-responses-compat', model: 'qa-scripted-model', compatibilityDomain: 'qa.invalid' };
      const result = {
        response: { id, object: 'response', created_at: 0, status: 'completed', model: origin.model,
          output: [{ type: 'function_call', id: id + '-item', call_id: configure ? callId : 'qa-say-' + turn,
            name: configure ? 'configure_pet' : 'pet_say', arguments: JSON.stringify(args), status: 'completed' }],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
        origin, attempts: [{ id: id + '-attempt', generationId: id, ordinal: 1, origin, startedAt: new Date().toISOString(),
          elapsedMs: 0, requestId: null, responseId: id, outcome: 'completed', status: null, serviceTier: null,
          meters: { input: 1, output: 1, total: 2, cachedInput: 0, uncachedInput: 1, reasoning: 0, native: null }, charges: [] }],
      };
      assert.equal(JSON.stringify(result).includes(privateSecret), false, 'Private fixture canary entered model result');
      audit.requests.push(request);
      audit.results.push(result);
      await fs.writeFile(path.join(ctx.dataDirectory, 'model-audit.json'), JSON.stringify(audit));
      return result;
    },
  });
} });`, },
      outfile: path.join(fixtureRoot, 'dist/index.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node24',
    });
    host = await DesktopHost.create({
      executable: process.execPath, workerEntry: path.join(root, 'apps/desktop/dist/runtime/worker.cjs'),
      builtinDirectory: path.join(root, 'plugins'), userDirectory: path.join(profile, 'plugins'),
      adapters: demoReadiness(path.join(root, '.cache/asr-models')),
      media: { output: (_ref, reader) => {
        // Direct application.agent calls have no DemoController output route.
        const drain = (async () => {
          const chunks: Buffer[] = [];
          for await (const bytes of reader) chunks.push(Buffer.from(bytes));
          output.push(Buffer.concat(chunks).toString('utf8'));
        })().catch(error => { mediaErrors.push(String(error)); });
        drains.push(drain);
        return drain;
      } },
    });
    assert.equal(host.credentials, undefined);
    demo = await DemoController.create(host, path.join(root, '.cache/asr-models'), () => {});
    application = await ApplicationController.create(host, demo, profile, () => {}, () => {});
    let state = await application.snapshot();
    assert.equal(state.agent.state, 'ready');
    assert.ok(state.profile);
    assert.equal(state.prompt.state, 'applied');
    assert.equal(state.prompt.appliedRevision, state.profile.revision);
    assert.equal(host.permissionControl.inspect(profileIdentity)?.preset, 'ask');
    assert.equal(host.permissionControl.inspect(agent)?.preset, 'local');
    assert.ok(state.dialog);
    assert.ok((await application.answer(state.dialog.id, state.dialog.step, 'later')).ok);

    const row = host.manager.get(fixture); assert.ok(row);
    const review = host.describeTrust(row.owner); assert.ok(review);
    assert.equal(await host.verifyTrust(row.owner, review.digest), true);
    assert.equal(host.permissionControl.confirmTrust(fixture, review.digest, true), true);
    assert.equal(host.permissionControl.setPreset(fixture, 'local'), true);
    const data = await host.dataDirectories.get(fixture); assert.ok(data.ok);
    const privateSecret = 'QA_PRIVATE_CANARY_' + randomUUID();
    await fs.writeFile(path.join(data.value, 'private-canary.txt'), privateSecret);
    const config = await host.configs.get(fixture); assert.ok(config.ok);
    const enabled = await host.manager.enable(fixture, config.value.data);
    assert.ok(enabled.ok, JSON.stringify(enabled)); assert.equal(enabled.value.state, 'active');
    // Application startup selects the real provider; override only after create.
    host.manager.capabilities.select(agent, 'llm.responses@1', { ...fixture, providerId: 'responses' });
    assert.equal(host.manager.list().filter(p => p.state === 'active').some(p =>
      p.manifest.permissions?.some(permission => permission.kind === 'network' || permission.kind === 'credentials')), false);
    checks.push('ordinary-Core-and-profile-with-reviewed-offline-fixture-and-no-credential-broker');

    const completed: ApplicationSnapshot[] = [];
    const decisions: Array<{ id: string; step: string }> = [];
    for (const [index, choice] of (['allow', 'deny'] as const).entries()) {
      const before: ApplicationSnapshot = await application.snapshot(); assert.ok(before.profile);
      let finished = false;
      const turn: ReturnType<ApplicationController['agent']> = application.agent('turn', { text: 'Apply the requested QA pet name and persona prompt, then report the actual result.', mode: 'deepseek', via: 'console' });
      void turn.then(() => { finished = true; }, () => { finished = true; });
      const deadline = Date.now() + 15000;
      do {
        state = await application.snapshot();
        if (state.dialog?.choices.some(c => c.id === 'allow')) break;
        assert.equal(finished, false, 'Core turn ended without a profile permission dialog');
        assert.ok(Date.now() < deadline, 'Profile permission dialog did not arrive');
        await nextPoll();
      } while (true);
      const dialog = state.dialog; assert.ok(dialog);
      const pending = host.approvals.snapshot(); assert.equal(pending.length, 1);
      const approval = pending[0]; assert.ok(approval);
      assert.deepEqual(approval.owner, before.profile.owner);
      assert.deepEqual(approval.permission, { kind: 'files', scope: 'plugin-data', access: 'read-write' });
      assert.ok(host.tasks.taskSignal(approval.taskId, approval.owner));
      assert.equal(dialog.id, approval.requestId); assert.equal(dialog.step, approval.permissionDigest);
      assert.deepEqual(dialog.choices.map(c => c.id), ['allow', 'deny']);
      assert.deepEqual(state.profile, before.profile);
      assert.equal(state.prompt.appliedRevision, before.profile.revision);
      const wrongId: Awaited<ReturnType<ApplicationController['answer']>> = await application.answer('wrongnonce', dialog.step, 'allow');
      const wrongStep: Awaited<ReturnType<ApplicationController['answer']>> = await application.answer(dialog.id, 'wrongnonce', 'allow');
      assert.equal(wrongId.ok, false); assert.equal(wrongStep.ok, false);
      if (wrongId.ok === false) assert.equal(wrongId.error.code, 'stale-owner');
      if (wrongStep.ok === false) assert.equal(wrongStep.error.code, 'stale-owner');
      const previous = decisions[0];
      if (previous) {
        assert.notEqual(dialog.id, previous.id);
        assert.equal((await application.answer(previous.id, previous.step, 'allow')).ok, false);
      }
      const unchanged = await application.snapshot();
      assert.equal(unchanged.dialog?.id, dialog.id); assert.equal(unchanged.dialog?.step, dialog.step);
      assert.deepEqual(unchanged.profile, before.profile);
      assert.equal(host.approvals.snapshot()[0]?.requestId, approval.requestId);
      const answered = await application.answer(dialog.id, dialog.step, choice);
      assert.ok(answered.ok, JSON.stringify(answered));
      const result = await turn; assert.ok(result.ok, JSON.stringify(result));
      assert.ok(result.value && typeof result.value === 'object' && !Array.isArray(result.value));
      assert.equal(result.value['errorCode'], null); assert.equal(result.value['mode'], 'deepseek');
      assert.equal(result.value['text'], 'QA receipt: ' + receipts[index]);
      assert.equal((await application.answer(dialog.id, dialog.step, 'allow')).ok, false);
      state = await application.snapshot(); assert.ok(state.profile);
      const revision = before.profile.revision + (choice === 'allow' ? 1 : 0);
      assert.equal(state.profile.revision, revision);
      assert.deepEqual(state.profile.data, choice === 'allow' ? { ...before.profile.data, ...changes[index] } : before.profile.data);
      const appliedDeadline = Date.now() + 10000;
      while (state.prompt.state !== 'applied' || state.prompt.appliedRevision !== revision) {
        assert.ok(Date.now() < appliedDeadline, 'Committed prompt was not acknowledged by Core');
        await nextPoll(); state = await application.snapshot();
      }
      assert.ok(state.profile);
      const committedProfile = state.profile;
      assert.equal(state.prompt.segments.find(s => s.id === 'persona.body')?.text, committedProfile.data.personaPrompt);
      assert.ok(state.prompt.segments.some(s => s.id === 'persona.identity' && s.text.includes(committedProfile.data.petName)));
      assert.equal(host.permissionControl.inspect(profileIdentity)?.preset, 'ask');
      assert.equal(host.approvals.snapshot().length, 0);
      if (choice === 'allow') {
        const stale = await application.saveProfile(before.profile.revision, { ...state.profile.data, petName: 'Stale QA overwrite' });
        assert.equal(stale.ok, false);
        if (stale.ok === false) assert.equal(stale.error.code, 'conflict');
        assert.deepEqual((await application.snapshot()).profile, state.profile);
      }
      completed.push(state); decisions.push({ id: dialog.id, step: dialog.step });
      checks.push(choice === 'allow' ? 'actual-profile-own-write-approval-rejects-wrongnonce-replay-and-stale-CAS-then-applies-prefix' : 'new-request-denial-keeps-profile-and-acknowledged-prefix-unchanged-and-replies-from-failure-receipt');
    }
    const allowed = completed[0], denied = completed[1]; assert.ok(allowed); assert.ok(denied);
    assert.deepEqual(denied.profile, allowed.profile); assert.deepEqual(denied.prompt, allowed.prompt);
    await Promise.all(drains); assert.deepEqual(mediaErrors, []); assert.equal(output.length, 2);
    assert.deepEqual(output.map(bytes => JSON.parse(bytes)), receipts.map(text => ({ kind: 'reply', text: 'QA receipt: ' + text })));
    const audit = JSON.parse(await fs.readFile(path.join(data.value, 'model-audit.json'), 'utf8')) as { requests: JsonObject[]; results: JsonObject[]; receipts: string[] };
    assert.equal(audit.requests.length, 4); assert.equal(audit.results.length, 4);
    assert.deepEqual(audit.receipts, receipts);
    assert.deepEqual(audit.results.map(result => ((result['response'] as JsonObject)['output'] as JsonObject[])[0]?.['name']), ['configure_pet', 'pet_say', 'configure_pet', 'pet_say']);
    const prefixes = audit.requests.map(request => JSON.stringify((request['input'] as JsonObject[])
      .filter(item => item['type'] === 'message' && ['system', 'developer'].includes(String(item['role'])))
      .map(item => item['content'])));
    assert.ok(changes[0]); assert.ok(changes[1]);
    assert.equal(prefixes[1]?.includes(changes[0].personaPrompt), false);
    assert.ok(prefixes[2]?.includes(changes[0].personaPrompt)); assert.ok(prefixes[2]?.includes(changes[0].petName));
    assert.ok(prefixes[3]?.includes(changes[0].personaPrompt)); assert.equal(prefixes[3]?.includes(changes[1].personaPrompt), false);
    assert.equal(JSON.stringify({ audit, completed, output }).includes(privateSecret), false, 'Private fixture canary escaped its owned context');
    checks.push('full-Generation-tool-receipts-next-batch-prefix-all-media-bytes-and-private-canary-exclusion');
    report['modelRequests'] = audit.requests.length; report['decisions'] = decisions; report['profileRevision'] = denied.profile?.revision;
    report['status'] = 'passed';
  } catch (error) {
    report['failure'] = error instanceof Error ? error.stack : String(error); process.exitCode = 1;
  } finally {
    application?.close(); demo?.close();
    if (host) {
      try {
        const shutdown = await host.shutdown(); report['hostShutdown'] = shutdown;
        assert.deepEqual(shutdown, { exitConfirmed: true, forced: false });
        await Promise.all(drains); assert.deepEqual(mediaErrors, []);
      } catch (error) {
        report['status'] = 'failed'; report['shutdownFailure'] = error instanceof Error ? error.stack : String(error); process.exitCode = 1;
      }
    }
    process.send?.(report);
  }
})();
