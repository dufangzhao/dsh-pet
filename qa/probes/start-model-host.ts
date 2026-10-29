import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as nextPoll } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import {
  APPLICATION_PLUGIN_IDS as APP,
  DEMO_PLUGIN_IDS as DEMO,
  MODEL_CONNECTION_IPC,
  MODEL_SERVICE_ENDPOINTS,
  modelProviderId,
  type JsonObject,
  type ModelConnectionOutcome,
  type ModelConnectionSnapshot,
  type ModelServiceEndpoint,
  type Result,
} from '../../packages/contracts/src/index.js';
import {
  FileCiphertextStore,
  FileConfigStore,
  capabilityPermissionAuthorizer,
  createSafeStorageCipher,
  discoverPlugins,
  type SecretCipher,
} from '../../packages/host-kernel/src/index.js';
import { DesktopHost } from '../../apps/desktop/src/main/desktop-host.js';
import { DemoController } from '../../apps/desktop/src/main/demo-controller.js';
import { ApplicationController } from '../../apps/desktop/src/main/application-controller.js';
import { ModelConnectionController } from '../../apps/desktop/src/main/model-connection-controller.js';
import { admittedApplicationSource } from '../../apps/desktop/src/main/application-admission.js';
import { demoReadiness } from '../../apps/desktop/src/main/demo-readiness.js';
import { handleModelConnectionRequest } from '../../apps/desktop/src/main/model-connection-request.js';
import { createModelConnectionBridge } from '../../apps/desktop/src/preload/model-connection-bridge.js';
import type { PetRequestSource } from '../../apps/desktop/src/main/ipc-request.js';

const root = path.resolve(__dirname, '../..');
const cloud = { pluginId: DEMO.cloud, instanceId: 'default' };
const agent = { pluginId: APP.agent, instanceId: 'default' };
const voice = { pluginId: DEMO.voice, instanceId: 'default' };
const endpoints = MODEL_SERVICE_ENDPOINTS.filter(endpoint => endpoint.available && endpoint.auth === 'api-key');
const fixtureSource = String.raw`import { randomUUID } from 'node:crypto';
import { definePlugin } from '@pet/plugin-sdk';
import { MODEL_SERVICE_ENDPOINTS, modelProviderId } from '@pet/contracts';
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
export default definePlugin({ activate(ctx) {
  const audit = [];
  for (const endpoint of MODEL_SERVICE_ENDPOINTS.filter(item => item.available)) {
    const selected = async () => {
      const config = await ctx.host.config.get();
      if (!config.ok) return null;
      const models = object(config.value.data.models);
      return endpoint.id === 'deepseek' && typeof config.value.data.model === 'string'
        ? config.value.data.model : typeof models?.[endpoint.id] === 'string'
          ? models[endpoint.id] : endpoint.defaultModel;
    };
    const use = async (task, method, input) => {
      const model = await selected();
      if (!model || !ctx.host.credentials) return { errorCode: 'not-ready' };
      const used = await ctx.host.credentials.withSecret(task, endpoint.secretKey, async (secret, signal) => {
        // Only this reviewed fixture sees plaintext; no network or secret-bearing audit output.
        const keyMatchesEndpoint = secret.startsWith('QA_START_KEY_' + endpoint.id + '_');
        audit.push({ service: endpoint.id, model, method, credentialUsed: true, keyMatchesEndpoint, aborted: signal.aborted });
        if (signal.aborted) return { errorCode: 'cancelled' };
        if (!keyMatchesEndpoint) return { errorCode: 'auth-failed' };
        if (method === 'test') return model.startsWith('qa-pass-')
          ? { ok: true, elapsedMs: 1 }
          : { ok: false, elapsedMs: 1, reason: 'scripted-model-rejected' };
        const request = object(object(input)?.request);
        if (!request || !Array.isArray(request.input) || !request.tools?.some(tool => tool.name === 'pet_say'))
          return { errorCode: 'invalid-input' };
        const id = 'qa-' + randomUUID();
        const origin = { instance: 'qa-isolated-provider', module: 'openai-responses-compat', model, compatibilityDomain: 'qa.invalid' };
        return {
          response: { id, object: 'response', created_at: 0, status: 'completed', model,
            output: [{ type: 'function_call', id: id + '-item', call_id: id + '-call', name: 'pet_say',
              arguments: JSON.stringify({ text: 'QA fixture ' + endpoint.id + ' ' + model }), status: 'completed' }],
            usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
          origin, attempts: [{ id: id + '-attempt', generationId: id, ordinal: 1, origin,
            startedAt: new Date().toISOString(), elapsedMs: 0, requestId: null, responseId: id,
            outcome: 'completed', status: null, serviceTier: null,
            meters: { input: 1, output: 1, total: 2, cachedInput: 0, uncachedInput: 1, reasoning: 0, native: null }, charges: [] }],
        };
      });
      return used.ok ? used.value : { errorCode: used.error.code };
    };
    ctx.provide(modelProviderId(endpoint.id), {
      describe: async () => ({ service: endpoint.id, model: await selected(), baseUrl: endpoint.baseUrl,
        label: endpoint.label, audit: audit.map(item => ({ ...item })) }),
      test: task => use(task, 'test', null),
      respond: (task, input) => use(task, 'respond', input),
    });
  }
  ctx.provide('deepseek', { respond: async () => ({ text: '', mode: 'deepseek', errorCode: 'not-ready' }) });
} });
`;
const object = (value: unknown): JsonObject => {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'Expected JSON object');
  return value as JsonObject;
};
function value<T>(result: Result<T>, label: string): T {
  assert.ok(result.ok, label + (result.ok ? '' : ': ' + result.error.code));
  return result.value;
}
function refused(result: Result<unknown>, code: string): void {
  assert.equal(result.ok, false, 'Request unexpectedly succeeded');
  if (!result.ok) assert.equal(result.error.code, code);
}
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
async function withoutApprovals<T>(host: DesktopHost, work: Promise<T>, label: string): Promise<T> {
  let settled: { ok: true; value: T } | { ok: false; error: unknown } | undefined;
  void work.then(result => { settled = { ok: true, value: result }; }, error => { settled = { ok: false, error }; });
  const deadline = Date.now() + 15000;
  while (!settled) {
    assert.equal(host.approvals.snapshot().length, 0, label + ': unexpected approval request');
    assert.ok(Date.now() < deadline, label + ': operation did not settle');
    await nextPoll(5);
  }
  assert.equal(host.approvals.snapshot().length, 0, label + ': pending approvals remained');
  if (!settled.ok) throw settled.error;
  return settled.value;
}

async function cipherForHeadless(): Promise<{ cipher: SecretCipher; emulatedCipher: boolean; backend: string }> {
  // Run-as-node normally has no safeStorage. An available native backend must pass its roundtrip.
  const storage = (await import('electron')).safeStorage;
  const nativeAvailable = process.platform === 'win32' &&
    typeof storage?.isAsyncEncryptionAvailable === 'function' &&
    await storage.isAsyncEncryptionAvailable().catch(() => false);
  if (nativeAvailable) {
    const native = createSafeStorageCipher(storage);
    const publicProbe = 'QA public encryption availability probe';
    const decoded = await native.decrypt(await native.encrypt(publicProbe));
    assert.ok(decoded.plaintext === publicProbe, 'Platform cipher roundtrip failed');
    return { cipher: native, emulatedCipher: false, backend: 'electron-async-safeStorage' };
  }
  const key = randomBytes(32);
  const cipher: SecretCipher = {
    async encrypt(plaintext) {
      const iv = randomBytes(12);
      const encryptor = createCipheriv('aes-256-gcm', key, iv);
      const bytes = Buffer.concat([encryptor.update(plaintext, 'utf8'), encryptor.final()]);
      return Uint8Array.from(Buffer.concat([iv, encryptor.getAuthTag(), bytes]));
    },
    async decrypt(ciphertext) {
      const bytes = Buffer.from(ciphertext);
      const decryptor = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decryptor.setAuthTag(bytes.subarray(12, 28));
      return { plaintext: Buffer.concat([decryptor.update(bytes.subarray(28)), decryptor.final()]).toString('utf8'), shouldReEncrypt: false };
    },
  };
  return { cipher, emulatedCipher: true, backend: 'qa-aes-256-gcm-ephemeral-headless-only' };
}

type Decision = {
  operation: string;
  kind: string;
  choice: string;
  owner: string;
  origins?: readonly string[];
  keys?: readonly string[];
};
type Policy = 'allow' | 'deny-network' | 'deny-credentials' | 'cancel-credentials';

void (async () => {
  let host: DesktopHost | undefined;
  let demo: DemoController | undefined;
  let application: ApplicationController | undefined;
  let models: ModelConnectionController | undefined;
  const profile = path.join(__dirname, 'profile');
  const applicationStore = new FileConfigStore(path.join(profile, 'host-settings'));
  const applicationIdentity = { pluginId: 'host.application-state', instanceId: 'default' };
  const hostShutdowns: Array<{ phase: string; exitConfirmed: boolean; forced: boolean }> = [];
  const checks: string[] = [];
  const decisions: Decision[] = [];
  const canaries: string[] = [];
  const drains: Promise<void>[] = [];
  const output: string[] = [];
  const mediaErrors: string[] = [];
  const report: Record<string, unknown> = {
    status: 'failed', checks, decisions, hostShutdowns,
    runtime: { electron: process.versions['electron'], node: process.versions.node },
    assumptions: [
      'Parent builds the current worker, plugins, and builtin admission serially before this runner.',
      'Only the isolated pet.llm-provider runtime is scripted; its current manifest/config/provides/consumes/permissions are unchanged.',
      'No provider traffic is sent. Scripted model values determine test results after real credential authorization.',
      'Headless safeStorage absence permits an ephemeral QA cipher; emulatedCipher is explicit and is not OS-encryption evidence.',
      'This exercises the real fixed request/preload functions in process, not a BrowserWindow IPC sender.',
      'Cancellation uses TaskSupervisor.cancelAll while its credential approval is pending; no Start cancel UI/API is claimed.',
      'Recovery creates fresh DesktopHost workers serially with the same isolated profile, builtin files, and cipher; it is not an OS process restart or OAuth test.',
      'Each fresh host explicitly reviews the scripted fixture digest again; the fixture never inherits production builtin admission.',
    ],
  };
  const redact = (text: string): string => canaries.reduce((safe, secret) => safe.split(secret).join('[redacted QA credential]'), text).slice(-8000);
  const closeHost = async (phase: string): Promise<void> => {
    const closingHost = host;
    if (!closingHost) return;
    const closingApplication = application;
    const before = closingApplication ? await applicationStore.read(applicationIdentity) : null;
    models?.close();
    closingApplication?.close();
    demo?.close();
    const stopped = await closingHost.shutdown();
    hostShutdowns.push({ phase, ...stopped });
    report['hostShutdown'] = stopped;
    assert.deepEqual(stopped, { exitConfirmed: true, forced: false });
    if (closingApplication) {
      // A late lifecycle notification after actual shutdown must not persist shutdown as user intent.
      await closingApplication.recordPluginStates();
      assert.deepEqual(await applicationStore.read(applicationIdentity), before,
        'Closed application persisted shutdown plugin states as user-disabled choices');
    }
    await Promise.all(drains);
    assert.deepEqual(mediaErrors, []);
    host = undefined; demo = undefined; application = undefined; models = undefined;
  };
  try {
    report['stage'] = 'copy-built-packages';
    const builtinRoot = path.join(__dirname, 'builtin');
    const modelRoot = path.join(profile, 'asr-models');
    await fs.mkdir(builtinRoot, { recursive: true });
    const originals = await discoverPlugins([{ directory: path.join(root, 'plugins'), origin: 'builtin' }]);
    assert.equal(originals.complete, true, 'Built plugin discovery incomplete');
    const placeholderPaths = ['talk-key', 'audio-capture', 'asr-cloud']
      .map(name => path.join(root, 'plugins', name)).sort();
    assert.deepEqual(originals.issues.map(issue => issue.directory).sort(), placeholderPaths,
      'Discovery issues must be exactly the three known non-plugin workspace directories');
    for (const issue of originals.issues) {
      assert.equal(issue.error.code, 'invalid-input');
      await assert.rejects(fs.lstat(path.join(issue.directory, 'plugin.json')), { code: 'ENOENT' },
        'A known placeholder issue must mean its manifest is absent');
    }
    report['knownPlaceholderIssues'] = originals.issues.map(issue => ({
      directory: path.relative(root, issue.directory), code: issue.error.code, manifestAbsent: true,
    }));
    const requiredBuiltinIds = new Set<string>([...Object.values(APP), ...Object.values(DEMO)]);
    for (const id of requiredBuiltinIds)
      assert.equal(originals.plugins.filter(plugin => plugin.manifest.id === id).length, 1,
        'Required built plugin must be discovered with every entry present: ' + id);
    report['requiredBuiltinIds'] = [...requiredBuiltinIds].sort();
    for (const plugin of originals.plugins) {
      const target = path.join(builtinRoot, path.basename(plugin.directory));
      for (const file of plugin.files) {
        const destination = path.join(target, file.relativePath);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.copyFile(path.join(plugin.directory, file.relativePath), destination);
        assert.equal(hash(await fs.readFile(destination)), file.sha256, 'Copied built entry changed');
      }
    }
    const originalCloud = originals.plugins.find(plugin => plugin.manifest.id === cloud.pluginId);
    assert.ok(originalCloud);
    const fixtureRoot = path.join(builtinRoot, path.basename(originalCloud.directory));
    await build({
      stdin: { contents: fixtureSource, resolveDir: path.join(root, 'plugins/llm-provider'), sourcefile: 'reviewed-start-model-fixture.mjs', loader: 'js' },
      outfile: path.join(fixtureRoot, originalCloud.manifest.entries.runtime),
      bundle: true, platform: 'node', format: 'esm', target: 'node24',
    });
    assert.ok((await fs.readFile(path.join(fixtureRoot, 'plugin.json'))).equals(await fs.readFile(path.join(originalCloud.directory, 'plugin.json'))), 'Fixture manifest must be byte-identical');
    const encryption = await cipherForHeadless();
    report['emulatedCipher'] = encryption.emulatedCipher;
    report['cipherBackend'] = encryption.backend;
    if (encryption.emulatedCipher) report['cipherLimitation'] = 'Headless platform encryption unavailable; this run does not validate DPAPI.';
    let encryptions = 0;
    let decryptions = 0;
    const cipher: SecretCipher = {
      async encrypt(plaintext) { encryptions++; return encryption.cipher.encrypt(plaintext); },
      async decrypt(ciphertext) { decryptions++; return encryption.cipher.decrypt(ciphertext); },
    };
    const createHost = (): Promise<DesktopHost> => DesktopHost.create({
      executable: process.execPath,
      workerEntry: path.join(root, 'apps/desktop/dist/runtime/worker.cjs'),
      builtinDirectory: builtinRoot,
      userDirectory: path.join(profile, 'plugins'),
      cipher,
      adapters: demoReadiness(modelRoot),
      approvalTimeoutMs: 20000,
      media: { output: (_ref, reader) => {
        const drain = (async () => {
          const chunks: Buffer[] = [];
          for await (const bytes of reader) chunks.push(Buffer.from(bytes));
          output.push(Buffer.concat(chunks).toString('utf8'));
        })().catch(error => { mediaErrors.push(redact(String(error))); });
        drains.push(drain);
        return drain;
      } },
    });
    host = await createHost();
    const runningHost = host;
    assert.ok(runningHost.credentials);
    for (const plugin of originals.plugins.filter(plugin => plugin.manifest.id !== cloud.pluginId)) {
      const row = runningHost.manager.get({ pluginId: plugin.manifest.id, instanceId: 'default' });
      assert.ok(row);
      const source = runningHost.getPackage(row.owner);
      assert.ok(source);
      assert.deepEqual(source.files, plugin.files);
      if (Object.values(APP).includes(plugin.manifest.id as typeof APP[keyof typeof APP]))
        assert.equal(admittedApplicationSource(source), true, 'Refresh builtin admission before running');
    }
    demo = await DemoController.create(runningHost, modelRoot, () => {});
    application = await ApplicationController.create(runningHost, demo, profile, () => {}, () => {});
    const app = application;
    const initialApplication = await app.snapshot();
    assert.equal(initialApplication.agent.state, 'ready', 'Actual Cortico Core must start');
    assert.equal(initialApplication.prompt.state, 'applied');
    if (initialApplication.dialog) value(await app.answer(initialApplication.dialog.id, initialApplication.dialog.step, 'later'), 'Defer guide');
    let changed = 0;
    const opened: string[] = [];
    const controller = new ModelConnectionController(runningHost, app, () => { changed++; }, async url => { opened.push(url); });
    models = controller;
    const expectedUrl = pathToFileURL(path.join(root, 'apps/desktop/dist/renderer/console/index.html')).href;
    const source: PetRequestSource = { senderId: 42, expectedId: 42, mainFrame: true, frameUrl: expectedUrl, expectedUrl };
    const actions = new Map<string, string>(Object.entries(MODEL_CONNECTION_IPC).map(([action, channel]) => [channel, action]));
    let bridgeInvocations = 0;
    const bridge = createModelConnectionBridge(async (channel, ...args) => {
      bridgeInvocations++;
      const action = actions.get(channel);
      assert.ok(action, 'Preload emitted a non-fixed channel');
      return handleModelConnectionRequest(source, action, args, controller);
    });
    const snapshot = async (): Promise<ModelConnectionSnapshot> => value(await bridge.getSnapshot(), 'Read model snapshot');
    const pause = async (): Promise<void> => {
      assert.equal(value(await bridge.setPaused({ paused: true }), 'Pause through model bridge').paused, true);
      assert.equal(object(value(await app.agent('state', null), 'Read real Core state'))['paused'], true);
    };
    const mode = async () => value(await runningHost.configs.get(voice), 'Read run mode');
    const setDemoMode = async (): Promise<void> => {
      const current = await mode();
      value(await runningHost.configs.save(voice, { ...current.data, mode: 'demo' }, current.revision), 'Set mode precondition');
    };
    const binding = () => {
      const owner = runningHost.manager.get(agent)?.owner;
      assert.ok(owner);
      return runningHost.manager.capabilities.bind(owner, 'llm.responses@1');
    };
    const assertMetadata = (state: ModelConnectionSnapshot): void => {
      const { notice, ...metadata } = state;
      assert.deepEqual(Object.keys(metadata).sort(), ['active', 'credentialStorageAvailable', 'endpoints', 'paused', 'revision', 'services']);
      if (notice !== undefined) assert.ok(typeof notice === 'string' && notice.trim().length > 0, 'Restore notice must describe a failure');
      assert.equal(state.endpoints.length, MODEL_SERVICE_ENDPOINTS.filter(endpoint => endpoint.available).length);
      assert.equal(state.services.find(service => service.auth === 'browser')?.available, false, 'This headless harness has no browser auth controller');
      for (const endpoint of state.endpoints) assert.deepEqual(Object.keys(endpoint).sort(), ['id', 'keyConfigured', 'model']);
      for (const service of state.services) {
        assert.equal(Object.hasOwn(service, 'baseUrl'), false);
        assert.equal(Object.hasOwn(service, 'protocol'), false);
        assert.equal(Object.hasOwn(service, 'secretKey'), false);
      }
      assert.ok(canaries.every(secret => !JSON.stringify(state).includes(secret)), 'Snapshot exposed a credential');
    };
    const keys = new Map<string, string>();
    const keyFor = (id: string): string => {
      let key = keys.get(id);
      if (!key) { key = 'QA_START_KEY_' + id + '_' + randomUUID(); keys.set(id, key); canaries.push(key); }
      return key;
    };
    const store = new FileCiphertextStore(path.join(profile, 'vault'));
    const stored = async (endpoint: ModelServiceEndpoint): Promise<Uint8Array> => {
      const bytes = await store.read(JSON.stringify([cloud.pluginId, cloud.instanceId, endpoint.secretKey]));
      assert.ok(bytes, 'Expected endpoint ciphertext');
      return bytes;
    };
    const assertStored = async (endpoint: ModelServiceEndpoint): Promise<void> => {
      const decoded = object(JSON.parse((await cipher.decrypt(await stored(endpoint))).plaintext));
      assert.equal(decoded['version'], 1);
      assert.deepEqual(decoded['owner'], cloud);
      assert.equal(decoded['keyId'], endpoint.secretKey);
      assert.ok(decoded['secret'] === keys.get(endpoint.id), 'Stored credential does not match its endpoint canary');
    };
    const drive = async <T>(operation: string, work: Promise<Result<T>>, endpoint: ModelServiceEndpoint, policy: Policy = 'allow',
      context: { host: DesktopHost; application: ApplicationController } = { host: runningHost, application: app },
      onCredentialPending?: () => Promise<void>): Promise<Result<T>> => {
      const operationHost = context.host;
      const operationApplication = context.application;
      let credentialHookUsed = false;
      let done = false;
      let result: Result<T> | undefined;
      let rejection: unknown;
      let rejected = false;
      void work.then(data => { result = data; done = true; }, error => { rejection = error; rejected = true; done = true; });
      const seen = new Set<string>();
      const deadline = Date.now() + 15000;
      let cancelled: { id: string; step: string } | undefined;
      while (!done) {
        const pending = operationHost.approvals.snapshot()[0];
        if (!pending) {
          assert.ok(Date.now() < deadline, operation + ': no settlement or permission dialog');
          await nextPoll(5);
          continue;
        }
        assert.equal(seen.has(pending.requestId), false, 'Answered approval remained pending');
        seen.add(pending.requestId);
        if (operation.startsWith('save-') && seen.size === 1) {
          const current = value(await operationHost.configs.get(cloud), 'Read busy operation revision');
          refused(await bridge.saveAndStart({ id: endpoint.id, model: 'qa-pass-busy', expectedRevision: current.revision }), 'not-ready');
          refused(await bridge.testConnection(), 'not-ready');
        }
        assert.equal(pending.owner.pluginId, cloud.pluginId, 'Unexpected permission owner');
        assert.ok(operationHost.tasks.taskSignal(pending.taskId, pending.owner), 'Approval must belong to live task');
        const dialog = (await operationApplication.snapshot()).dialog;
        assert.ok(dialog);
        assert.equal(dialog.id, pending.requestId);
        assert.equal(dialog.step, pending.permissionDigest);
        assert.deepEqual(dialog.choices.map(choice => choice.id), ['allow', 'deny']);
        const permission = pending.permission;
        if (permission.kind === 'network') assert.deepEqual(permission.origins, [new URL(endpoint.baseUrl).origin]);
        if (permission.kind === 'credentials') assert.deepEqual(permission.keys, [endpoint.secretKey]);
        if (permission.kind === 'capability-use') assert.equal(permission.capability, 'llm.responses@1');
        assert.ok(['capability-use', 'network', 'credentials'].includes(permission.kind));
        refused(await operationApplication.answer(dialog.id, 'wrong-step', 'allow'), 'stale-owner');
        if (permission.kind === 'credentials' && onCredentialPending && !credentialHookUsed) {
          credentialHookUsed = true;
          await onCredentialPending();
        }
        const cancel = policy === 'cancel-credentials' && permission.kind === 'credentials';
        const deny = (policy === 'deny-network' && permission.kind === 'network') || (policy === 'deny-credentials' && permission.kind === 'credentials');
        const choice = cancel ? 'cancel-task' : deny ? 'deny' : 'allow';
        decisions.push({ operation, kind: permission.kind, choice, owner: pending.owner.pluginId,
          ...(permission.kind === 'network' ? { origins: permission.origins } : {}),
          ...(permission.kind === 'credentials' ? { keys: permission.keys } : {}) });
        if (cancel) {
          assert.ok(operationHost.tasks.cancelAll() > 0, 'Task cancellation must affect pending work');
          cancelled = { id: dialog.id, step: dialog.step };
        } else {
          value(await operationApplication.answer(dialog.id, dialog.step, choice), 'Answer actual pending approval');
          refused(await operationApplication.answer(dialog.id, dialog.step, choice), 'stale-owner');
        }
      }
      if (rejected) throw rejection;
      assert.ok(result, operation + ': missing result');
      assert.equal(operationHost.approvals.snapshot().length, 0, 'Operation left pending approvals');
      if (cancelled) refused(await operationApplication.answer(cancelled.id, cancelled.step, 'allow'), 'stale-owner');
      return result;
    };
    const save = async (endpoint: ModelServiceEndpoint, model: string, policy: Policy = 'allow', includeKey = true): Promise<ModelConnectionOutcome> => {
      const current = await snapshot();
      const start = decisions.length;
      const result = value(await drive('save-' + endpoint.id + '-' + model, bridge.saveAndStart({ id: endpoint.id, model,
        expectedRevision: current.revision, ...(includeKey ? { key: keyFor(endpoint.id) } : {}) }), endpoint, policy), 'Save and test ' + endpoint.id);
      const actual = decisions.slice(start);
      assert.ok(actual.some(decision => decision.kind === 'capability-use'), 'Self capability use must be approved');
      assert.ok(actual.some(decision => decision.kind === 'network'), 'Provider method network permission must be approved');
      if (policy !== 'deny-network') assert.ok(actual.some(decision => decision.kind === 'credentials'), 'withSecret must request the actual endpoint key');
      assert.equal(runningHost.permissionControl.inspect(cloud)?.preset, 'ask');
      assertMetadata(result.snapshot);
      await assertStored(endpoint);
      return result;
    };

    report['stage'] = 'fixed-boundaries-and-empty-state';
    const initial = await snapshot();
    assertMetadata(initial);
    assert.equal(initial.active, null);
    assert.equal(initial.credentialStorageAvailable, true);
    assert.ok(initial.endpoints.every(endpoint => !endpoint.keyConfigured));
    refused(await bridge.testConnection(), 'not-ready');
    assert.equal(Object.isFrozen(bridge), true);
    const beforeArity = bridgeInvocations;
    refused(await Reflect.apply(bridge.getSnapshot, bridge, [{}]), 'invalid-input');
    refused(await Reflect.apply(bridge.saveAndStart, bridge, []), 'invalid-input');
    refused(await Reflect.apply(bridge.testConnection, bridge, [null]), 'invalid-input');
    refused(await Reflect.apply(bridge.setPaused, bridge, []), 'invalid-input');
    assert.equal(bridgeInvocations, beforeArity, 'Wrong arity must stop before IPC');
    for (const badSource of [{ ...source, senderId: 7 }, { ...source, mainFrame: false },
      { ...source, frameUrl: source.frameUrl + '#other' }, { ...source, expectedUrl: 'https://qa.invalid', frameUrl: 'https://qa.invalid' }])
      refused(await handleModelConnectionRequest(badSource, 'save', [{ id: 'deepseek', model: 'qa-pass-deepseek', expectedRevision: initial.revision, key: keyFor('deepseek') }], controller), 'permission-denied');
    const validSave = { id: 'deepseek', model: 'qa-pass-deepseek', expectedRevision: initial.revision };
    const badSaves: unknown[] = [null, {}, { ...validSave, baseUrl: 'https://qa.invalid' }, { ...validSave, providerId: 'responses' },
      { ...validSave, model: 'x'.repeat(129) }, { ...validSave, expectedRevision: -1 },
      { ...validSave, expectedRevision: 1.5 }, { ...validSave, key: 7 }, { ...validSave, key: 'x'.repeat(4097) }];
    for (const request of badSaves) refused(await handleModelConnectionRequest(source, 'save', [request], controller), 'invalid-input');
    refused(await handleModelConnectionRequest(source, 'snapshot', [null], controller), 'invalid-input');
    refused(await handleModelConnectionRequest(source, 'run', [{ paused: 'true' }], controller), 'invalid-input');
    refused(await handleModelConnectionRequest(source, 'open', [{ id: 'qwen', url: 'https://qa.invalid' }], controller), 'invalid-input');
    refused(await handleModelConnectionRequest(source, 'unknown', [{ id: 'qwen' }], controller), 'invalid-input');
    for (const endpoint of MODEL_SERVICE_ENDPOINTS.filter(endpoint => !endpoint.available))
      refused(await bridge.saveAndStart({ id: endpoint.id, model: endpoint.defaultModel, expectedRevision: initial.revision }), 'not-ready');
    refused(await bridge.saveAndStart(validSave), 'invalid-input');
    refused(await bridge.openServicePage({ id: 'https://qa.invalid' }), 'invalid-input');
    for (const endpoint of MODEL_SERVICE_ENDPOINTS) value(await bridge.openServicePage({ id: endpoint.id }), 'Resolve fixed service link');
    assert.deepEqual(opened, MODEL_SERVICE_ENDPOINTS.map(endpoint => endpoint.keyUrl));
    assert.deepEqual(await snapshot(), initial, 'Rejected boundary requests changed state');
    checks.push('fixed-preload-arity-and-real-request-trust-shape-revision-and-fixed-link-boundaries');

    const qwen = endpoints.find(endpoint => endpoint.id === 'qwen');
    const intl = endpoints.find(endpoint => endpoint.id === 'qwen-intl');
    const deepseek = endpoints.find(endpoint => endpoint.id === 'deepseek');
    assert.ok(qwen); assert.ok(intl); assert.ok(deepseek);
    await pause();
    const cloudRow = runningHost.manager.get(cloud); assert.ok(cloudRow);
    const candidate = runningHost.getPackage(cloudRow.owner); assert.ok(candidate);
    const review = runningHost.describeTrust(cloudRow.owner); assert.ok(review);
    assert.equal(admittedApplicationSource(candidate), false, 'Scripted source must not inherit builtin admission');
    assert.equal(review.trusted, false);
    const pretrust = await snapshot();
    refused(await bridge.saveAndStart({ id: qwen.id, model: 'qa-pass-qwen-unreviewed', expectedRevision: pretrust.revision, key: keyFor(qwen.id) }), 'package-changed');
    assert.equal((await snapshot()).active, null);
    assert.equal(runningHost.approvals.snapshot().length, 0);
    assert.equal(await runningHost.verifyTrust(cloudRow.owner, review.digest), true);
    assert.equal(runningHost.permissionControl.confirmTrust(cloud, review.digest, true), true);
    report['fixtureTrust'] = { digest: review.digest, explicitReview: true, fixtureSourceSha256: hash(Buffer.from(fixtureSource)), files: candidate.files, manifestMatchesOriginal: true };
    checks.push('isolated-source-needs-exact-fingerprint-review-with-current-manifest-unchanged');

    report['stage'] = 'denial-cancellation-and-initial-failure';
    for (const policy of ['deny-network', 'deny-credentials', 'cancel-credentials'] as const) {
      const result = await save(qwen, 'qa-pass-qwen-' + policy, policy);
      assert.equal(result.test.ok, false);
      assert.equal(result.snapshot.active, null);
      assert.equal(result.snapshot.paused, true);
      assert.equal((await mode()).data['mode'], 'demo');
      assert.equal(result.snapshot.endpoints.find(endpoint => endpoint.id === qwen.id)?.keyConfigured, true);
      assert.equal(result.snapshot.endpoints.find(endpoint => endpoint.id === intl.id)?.keyConfigured, false);
    }
    const initialFailure = await save(qwen, 'qa-fail-qwen');
    assert.equal(initialFailure.test.ok, false);
    assert.equal(initialFailure.snapshot.active, null);
    assert.equal(initialFailure.snapshot.paused, true);
    checks.push('network-denial-credential-denial-and-task-cancellation-never-activate-or-resume');

    report['stage'] = 'first-success-and-stale-CAS';
    const firstRevision = (await snapshot()).revision;
    const first = await save(deepseek, 'qa-pass-deepseek');
    assert.equal(first.test.ok, true);
    assert.equal(first.snapshot.active?.id, deepseek.id);
    assert.equal(first.snapshot.paused, false);
    assert.equal(value(binding(), 'Read actual binding').providerId, modelProviderId(deepseek.id));
    assert.equal((await mode()).data['mode'], 'deepseek');
    const cloudBeforeStale = value(await runningHost.configs.get(cloud), 'Read pre-conflict config');
    const ciphertextBeforeStale = await stored(qwen);
    const bindingBeforeStale = value(binding(), 'Read pre-conflict binding');
    const encryptionsBeforeStale = encryptions;
    const rejectedKey = 'QA_START_STALE_' + randomUUID(); canaries.push(rejectedKey);
    refused(await bridge.saveAndStart({ id: qwen.id, model: 'qa-pass-stale', expectedRevision: firstRevision, key: rejectedKey }), 'conflict');
    assert.deepEqual(value(await runningHost.configs.get(cloud), 'Read post-conflict config'), cloudBeforeStale);
    assert.ok(Buffer.from(await stored(qwen)).equals(Buffer.from(ciphertextBeforeStale)), 'Stale revision replaced ciphertext');
    assert.equal(encryptions, encryptionsBeforeStale);
    assert.deepEqual(value(binding(), 'Read post-conflict binding'), bindingBeforeStale);
    assert.equal(runningHost.approvals.snapshot().length, 0);
    await assertStored(qwen);
    checks.push('success-binds-real-registry-sets-mode-resumes-Core-and-stale-CAS-does-not-replace-key');

    await pause();
    await setDemoMode();
    const beforeFailure = value(binding(), 'Read active binding');
    const beforeMode = await mode();
    const failedDraft = await save(qwen, 'qa-fail-qwen-draft');
    assert.equal(failedDraft.test.ok, false);
    assert.equal(failedDraft.snapshot.active?.id, deepseek.id);
    assert.equal(failedDraft.snapshot.paused, true);
    assert.deepEqual(value(binding(), 'Read binding after failed draft'), beforeFailure);
    assert.deepEqual(await mode(), beforeMode);
    const activeTest = value(await drive('test-saved-active', bridge.testConnection(), deepseek), 'Test saved active endpoint');
    assert.equal(activeTest.test.ok, true, 'Test must use saved active DeepSeek despite failed Qwen draft');
    assert.equal(activeTest.snapshot.active?.id, deepseek.id);
    assert.equal((await snapshot()).paused, true, 'Testing must preserve pause');
    assert.deepEqual(await mode(), beforeMode);
    checks.push('failed-draft-retains-saved-key-config-and-active-binding-mode-and-test-targets-saved-active');

    report['stage'] = 'all-service-model-and-regional-key-cases';
    const successful: string[] = [];
    for (const endpoint of endpoints) {
      await pause();
      await setDemoMode();
      const previous = await snapshot();
      const previousBinding = value(binding(), 'Read binding before failed service');
      const previousMode = await mode();
      const failed = await save(endpoint, 'qa-fail-' + endpoint.id);
      assert.equal(failed.test.ok, false);
      assert.equal(failed.snapshot.active?.id, previous.active?.id);
      assert.equal(failed.snapshot.paused, true);
      assert.equal(failed.snapshot.endpoints.find(item => item.id === endpoint.id)?.model, 'qa-fail-' + endpoint.id);
      assert.deepEqual(value(binding(), 'Read binding after failed service'), previousBinding);
      assert.deepEqual(await mode(), previousMode);
      const passed = await save(endpoint, 'qa-pass-' + endpoint.id, 'allow', false);
      assert.equal(passed.test.ok, true);
      assert.equal(passed.snapshot.active?.id, endpoint.id);
      assert.equal(passed.snapshot.active.model, 'qa-pass-' + endpoint.id);
      assert.equal(passed.snapshot.paused, false);
      const actualBinding = value(binding(), 'Read actual selected provider');
      assert.equal(actualBinding.provider.pluginId, cloud.pluginId);
      assert.equal(actualBinding.providerId, modelProviderId(endpoint.id));
      assert.equal((await mode()).data['mode'], 'deepseek');
      assert.equal(object(value(await app.agent('state', null), 'Read resumed Core'))['paused'], false);
      successful.push(endpoint.id);
    }
    for (const endpoint of endpoints) await assertStored(endpoint);
    assert.equal(new Set(endpoints.map(endpoint => endpoint.secretKey)).size, endpoints.length);
    assert.ok(keys.get(qwen.id) !== keys.get(intl.id), 'Regional canaries must be different');
    checks.push('every-current-available-service-fails-and-succeeds-via-own-provider-model-and-independent-key');

    report['stage'] = 'real-Core-turn-and-fixture-audit';
    const selected = endpoints.at(-1); assert.ok(selected);
    const turn = value(await drive('Core-turn-selected-provider', app.agent('turn', { text: 'Report the QA fixture service through the actual Core.', mode: 'deepseek', via: 'console' }), selected), 'Real Core turn');
    assert.equal(object(turn)['errorCode'], null);
    assert.equal(object(turn)['text'], 'QA fixture ' + selected.id + ' qa-pass-' + selected.id);
    await Promise.all(drains);
    assert.deepEqual(mediaErrors, []);
    assert.ok(output.some(bytes => object(JSON.parse(bytes))['text'] === object(turn)['text']), 'Actual media output missed Core reply');
    const currentCloud = runningHost.manager.get(cloud); assert.ok(currentCloud);
    const auditTask = value(runningHost.tasks.invokeCapability(runningHost.manager, currentCloud.owner, 'llm.responses@1', 'describe', null,
      capabilityPermissionAuthorizer(runningHost.permissions, runningHost.manager), { timeoutMs: 10000 }), 'Read fixture audit through authorized capability');
    let audit: JsonObject;
    try { audit = object(value(await drive('fixture-audit', auditTask.result, selected), 'Fixture audit')); }
    finally { auditTask.release(); }
    assert.ok(Array.isArray(audit['audit']));
    const calls = audit['audit'].map(object);
    for (const endpoint of endpoints) {
      const tests = calls.filter(call => call['service'] === endpoint.id && call['method'] === 'test');
      assert.ok(tests.some(call => call['model'] === 'qa-fail-' + endpoint.id));
      assert.ok(tests.some(call => call['model'] === 'qa-pass-' + endpoint.id));
    }
    assert.ok(calls.every(call => call['credentialUsed'] === true && call['keyMatchesEndpoint'] === true && call['aborted'] === false));
    const targetIndex = calls.findIndex(call => call['model'] === 'qa-fail-qwen-draft');
    assert.ok(targetIndex >= 0);
    assert.equal(calls[targetIndex + 1]?.['service'], deepseek.id);
    assert.equal(calls[targetIndex + 1]?.['model'], 'qa-pass-deepseek');
    assert.ok(calls.some(call => call['service'] === selected.id && call['method'] === 'respond'));
    checks.push('actual-Core-turn-uses-new-binding-withSecret-and-emits-reply-through-real-media');

    report['stage'] = 'post-probe-revision-conflict';
    await pause();
    await setDemoMode();
    const beforeProbeConflict = await snapshot();
    const conflictBinding = value(binding(), 'Read binding before interleaved save');
    const conflictMode = await mode();
    const conflictDecryptions = decryptions;
    let injectedRevision: number | undefined;
    const interleaved = await drive('post-probe-revision-conflict', bridge.saveAndStart({
      id: qwen.id, model: 'qa-pass-qwen-conflict', expectedRevision: beforeProbeConflict.revision,
    }), qwen, 'allow', { host: runningHost, application: app }, async () => {
      const current = value(await runningHost.configs.get(cloud), 'Read config at credential approval');
      const saved = value(await runningHost.configs.save(cloud, {
        ...current.data, models: { ...object(current.data['models']), [intl.id]: 'qa-pass-interleaved-revision' },
      }, current.revision), 'Save newer config while model credential approval is pending');
      injectedRevision = saved.snapshot.revision;
    });
    refused(interleaved, 'conflict');
    assert.ok(injectedRevision !== undefined, 'Credential approval hook was not reached');
    assert.ok(decryptions > conflictDecryptions, 'The model probe must actually consume the approved credential');
    const conflicted = await snapshot();
    assert.equal(conflicted.revision, injectedRevision);
    assert.equal(conflicted.active?.id, beforeProbeConflict.active?.id);
    assert.equal(conflicted.paused, true);
    assert.equal(conflicted.endpoints.find(endpoint => endpoint.id === intl.id)?.model, 'qa-pass-interleaved-revision');
    assert.deepEqual(value(binding(), 'Read binding after successful but stale probe'), conflictBinding);
    assert.deepEqual(await mode(), conflictMode);
    checks.push('new-config-revision-during-real-credential-approval-rejects-post-probe-activation');

    report['stage'] = 'explicit-deny-does-not-reset-on-save';
    assert.equal(runningHost.permissionControl.setPreset(cloud, 'deny'), true);
    const denyBefore = await snapshot();
    const denyDecryptions = decryptions;
    const denyBinding = value(binding(), 'Read selected binding under explicit deny');
    const deniedSave = value(await withoutApprovals(runningHost, bridge.saveAndStart({
      id: qwen.id, model: 'qa-pass-qwen-preset-denied', expectedRevision: denyBefore.revision,
    }), 'Save with explicit deny preset'), 'Save result with explicit deny preset');
    assert.equal(deniedSave.test.ok, false);
    assert.equal(deniedSave.snapshot.active?.id, denyBefore.active?.id);
    assert.equal(deniedSave.snapshot.paused, true);
    assert.equal(runningHost.permissionControl.inspect(cloud)?.preset, 'deny');
    assert.equal(decryptions, denyDecryptions, 'Explicit deny must prevent credential consumption');
    assert.deepEqual(value(binding(), 'Read binding after explicitly denied save'), denyBinding);
    assert.deepEqual(await mode(), conflictMode);
    assert.equal(runningHost.permissionControl.setPreset(cloud, 'ask'), true);
    await app.recordPluginStates();
    assert.equal(app.pluginWasDisabled(cloud.pluginId), false);
    checks.push('save-enable-preserves-explicit-deny-without-prompt-key-use-binding-mode-or-bus-switch');

    const savedCloud = value(await runningHost.configs.get(cloud), 'Read persisted active model before reopen');
    const savedMode = await mode();
    const savedCiphertexts = new Map<string, Uint8Array>();
    for (const endpoint of endpoints) savedCiphertexts.set(endpoint.id, await stored(endpoint));
    const freshReviews: Array<{ phase: string; digest: string }> = [];
    report['freshFixtureReviews'] = freshReviews;
    const reopen = async (phase: string) => {
      assert.equal(host, undefined, 'Previous host must actually shut down before reopening');
      host = await createHost();
      const nextHost = host;
      assert.ok(nextHost !== runningHost && nextHost.driver !== runningHost.driver, 'Recovery must use a fresh host and worker driver');
      demo = await DemoController.create(nextHost, modelRoot, () => {});
      application = await ApplicationController.create(nextHost, demo, profile, () => {}, () => {});
      const nextApplication = application;
      const nextModels = new ModelConnectionController(nextHost, nextApplication, () => { changed++; }, async url => { opened.push(url); });
      models = nextModels;
      assert.equal((await nextApplication.snapshot()).agent.state, 'ready', 'Fresh Core must start from the persisted profile');
      assert.deepEqual(value(await nextHost.configs.get(cloud), phase + ': restored config'), savedCloud);
      assert.deepEqual(value(await nextHost.configs.get(voice), phase + ': restored voice mode'), savedMode);
      for (const endpoint of endpoints) {
        const expected = savedCiphertexts.get(endpoint.id); assert.ok(expected);
        assert.ok(Buffer.from(await stored(endpoint)).equals(Buffer.from(expected)), 'Reopening changed saved ciphertext');
      }
      return { host: nextHost, application: nextApplication, models: nextModels };
    };
    const reviewFreshFixture = async (context: Awaited<ReturnType<typeof reopen>>, phase: string): Promise<void> => {
      const row = context.host.manager.get(cloud); assert.ok(row);
      const source = context.host.getPackage(row.owner); assert.ok(source);
      const nextReview = context.host.describeTrust(row.owner); assert.ok(nextReview);
      assert.deepEqual(source.files, candidate.files, 'Fresh fixture source changed');
      assert.equal(admittedApplicationSource(source), false, 'Scripted fixture must never pretend to be production-pinned code');
      assert.equal(nextReview.trusted, false, 'Each fresh host must independently review this fixture');
      assert.equal(nextReview.digest, review.digest);
      assert.equal(await context.host.verifyTrust(row.owner, nextReview.digest), true);
      assert.equal(context.host.permissionControl.confirmTrust(cloud, nextReview.digest, true), true);
      freshReviews.push({ phase, digest: nextReview.digest });
    };
    const freshBinding = (context: Awaited<ReturnType<typeof reopen>>) => {
      const owner = context.host.manager.get(agent)?.owner; assert.ok(owner);
      return context.host.manager.capabilities.bind(owner, 'llm.responses@1');
    };
    const readFreshAudit = async (context: Awaited<ReturnType<typeof reopen>>, phase: string): Promise<JsonObject[]> => {
      const row = context.host.manager.get(cloud); assert.ok(row);
      context.host.manager.capabilities.select(cloud, 'llm.responses@1', { ...cloud, providerId: modelProviderId(selected.id) });
      const task = value(context.host.tasks.invokeCapability(context.host.manager, row.owner, 'llm.responses@1', 'describe', null,
        capabilityPermissionAuthorizer(context.host.permissions, context.host.manager), { timeoutMs: 10000 }), 'Read fresh fixture audit');
      try {
        const audit = object(value(await drive(phase, task.result, selected, 'allow', context), phase));
        assert.ok(Array.isArray(audit['audit']));
        return audit['audit'].map(object);
      } finally { task.release(); }
    };

    const restoreTasks: Array<{ phase: string; providerTasks: number }> = [];
    report['restoreTasks'] = restoreTasks;
    const restoreWithoutProbe = async (context: Awaited<ReturnType<typeof reopen>>, phase: string): Promise<void> => {
      const tasks = new Set<string>();
      const remove = context.host.tasks.subscribe(event => {
        if (event.kind === 'started' && event.owner.pluginId === cloud.pluginId) tasks.add(event.taskId);
      });
      try { await withoutApprovals(context.host, context.models.restore(), phase); }
      finally { remove(); }
      restoreTasks.push({ phase, providerTasks: tasks.size });
      assert.equal(tasks.size, 0, 'Restore must not start a provider task, even when explicit deny would block it');
    };
    await closeHost('initial');
    report['stage'] = 'fresh-host-unreviewed-and-deny-restore';
    const restored = await reopen('restored');
    assert.equal(restored.application.pluginWasDisabled(cloud.pluginId), false, 'Shutdown must not become a user disable');
    assert.equal((await restored.models.snapshot()).active, null, 'Provider must not become active before restore');
    value(await restored.models.setPaused(true), 'Pause fresh Core before restore');
    const restoreMode = value(await restored.host.configs.get(voice), 'Read mode before restore');
    const beforeRestore = decryptions;
    await restoreWithoutProbe(restored, 'Unreviewed fixture restore');
    const unreviewed = await restored.models.snapshot();
    assertMetadata(unreviewed);
    assert.equal(unreviewed.active, null);
    assert.ok(unreviewed.notice, 'Unreviewed source must report its restore failure');
    assert.equal(restored.host.manager.get(cloud)?.state, 'disabled');
    assert.equal(decryptions, beforeRestore);
    await reviewFreshFixture(restored, 'restored');
    assert.equal(restored.host.permissionControl.setPreset(cloud, 'deny'), true);
    const otherEndpoint = endpoints.find(endpoint => endpoint.id !== selected.id); assert.ok(otherEndpoint);
    restored.host.manager.capabilities.select(agent, 'llm.responses@1', { ...cloud, providerId: modelProviderId(otherEndpoint.id) });
    await restoreWithoutProbe(restored, 'Reviewed restore under explicit deny');
    const recovered = await restored.models.snapshot(); assertMetadata(recovered);
    assert.equal(recovered.notice, undefined, 'Successful recovery must clear the prior failure notice');
    assert.equal(recovered.active?.id, selected.id);
    assert.equal(recovered.active?.model, 'qa-pass-' + selected.id);
    assert.equal(recovered.paused, true, 'Restore must not resume a paused Core');
    assert.equal(restored.host.permissionControl.inspect(cloud)?.preset, 'deny');
    assert.equal(restored.host.manager.get(cloud)?.state, 'active');
    const restoredBinding = value(freshBinding(restored), 'Read restored actual Core binding');
    assert.equal(restoredBinding.provider.pluginId, cloud.pluginId);
    assert.equal(restoredBinding.providerId, modelProviderId(selected.id));
    assert.equal(decryptions, beforeRestore, 'Restore must not consume credentials or perform a probe');
    assert.deepEqual(value(await restored.host.configs.get(cloud), 'Read unchanged restored config'), savedCloud);
    assert.deepEqual(value(await restored.host.configs.get(voice), 'Read unchanged restored mode'), restoreMode);
    const deniedTest = value(await withoutApprovals(restored.host, restored.models.testConnection(), 'Test under restored deny preset'), 'Denied test result');
    assert.equal(deniedTest.test.ok, false);
    assert.equal(restored.host.permissionControl.inspect(cloud)?.preset, 'deny');
    assert.equal(decryptions, beforeRestore);
    assert.equal(restored.host.permissionControl.setPreset(cloud, 'ask'), true);
    assert.deepEqual(await readFreshAudit(restored, 'restore-no-probe-audit'), [], 'Restore must make no provider test/respond calls');
    checks.push('fresh-host-reviews-exact-fixture-restores-selected-binding-without-probe-and-preserves-deny-mode-pause');

    assert.equal(value(await restored.models.setPaused(false), 'Explicitly resume Core for the recovery reply').paused, false);
    const replyOutputStart = output.length;
    const restoredTurn = value(await drive('restored-Core-turn', restored.application.agent('turn', {
      text: 'Verify the saved selected provider after fresh host recovery.', mode: 'deepseek', via: 'console',
    }), selected, 'allow', restored), 'Fresh Core turn after restore');
    assert.equal(object(restoredTurn)['errorCode'], null);
    assert.equal(object(restoredTurn)['text'], 'QA fixture ' + selected.id + ' qa-pass-' + selected.id);
    await Promise.all(drains);
    assert.ok(output.slice(replyOutputStart).some(bytes => object(JSON.parse(bytes))['text'] === object(restoredTurn)['text']),
      'Fresh Core must emit its own recovered provider reply');
    const restoredCalls = await readFreshAudit(restored, 'restored-Core-audit');
    assert.equal(restoredCalls.length, 1);
    assert.equal(restoredCalls[0]?.['method'], 'respond');
    assert.equal(restoredCalls[0]?.['service'], selected.id);
    assert.equal(restoredCalls[0]?.['keyMatchesEndpoint'], true);
    report['restoredFixtureCalls'] = restoredCalls;
    report['restoredSnapshot'] = recovered;
    await restored.application.recordPluginStates();
    await closeHost('restored');
    checks.push('fresh-Core-turn-consumes-persisted-key-and-closed-state-recording-keeps-enabled-user-choice');

    report['stage'] = 'persist-user-disabled-model-plugin';
    const userDisabled = await reopen('user-disabled');
    assert.equal(userDisabled.application.pluginWasDisabled(cloud.pluginId), false);
    await reviewFreshFixture(userDisabled, 'user-disabled');
    const beforeUserRestore = decryptions;
    await restoreWithoutProbe(userDisabled, 'Restore before explicit user disable');
    assert.equal(decryptions, beforeUserRestore);
    assert.equal((await userDisabled.models.snapshot()).active?.id, selected.id);
    value(await userDisabled.host.manager.disable(cloud), 'Explicitly disable model plugin');
    await userDisabled.application.recordPluginStates();
    assert.equal(userDisabled.application.pluginWasDisabled(cloud.pluginId), true);
    const disabledRecord = await applicationStore.read(applicationIdentity); assert.ok(disabledRecord);
    assert.ok(Array.isArray(disabledRecord.data['disabled']) && disabledRecord.data['disabled'].includes(cloud.pluginId));
    const beforeDisabledRestore = decryptions;
    await restoreWithoutProbe(userDisabled, 'Respect current user disable');
    assert.equal(userDisabled.host.manager.get(cloud)?.state, 'disabled');
    assert.equal((await userDisabled.models.snapshot()).active, null);
    assert.equal(decryptions, beforeDisabledRestore);
    refused(freshBinding(userDisabled), 'not-ready');
    await closeHost('user-disabled');

    report['stage'] = 'fresh-host-respects-persisted-disable';
    const disabledAgain = await reopen('disabled-reopen');
    assert.equal(disabledAgain.application.pluginWasDisabled(cloud.pluginId), true);
    assert.equal(disabledAgain.host.manager.get(cloud)?.state, 'disabled');
    await reviewFreshFixture(disabledAgain, 'disabled-reopen');
    const beforeDisabledReopen = decryptions;
    await restoreWithoutProbe(disabledAgain, 'Respect persisted user disable after fresh host review');
    const disabledState = await disabledAgain.models.snapshot(); assertMetadata(disabledState);
    assert.equal(disabledState.active, null);
    assert.equal(disabledState.notice, undefined, 'User disable is not a restore failure');
    assert.equal(disabledState.endpoints.find(endpoint => endpoint.id === selected.id)?.keyConfigured, true);
    assert.equal(disabledAgain.host.manager.get(cloud)?.state, 'disabled');
    refused(freshBinding(disabledAgain), 'not-ready');
    assert.equal(decryptions, beforeDisabledReopen);
    refused(await withoutApprovals(disabledAgain.host, disabledAgain.models.testConnection(), 'Test while user-disabled'), 'not-ready');
    await disabledAgain.application.recordPluginStates();
    assert.equal(disabledAgain.application.pluginWasDisabled(cloud.pluginId), true);
    assert.deepEqual(value(await disabledAgain.host.configs.get(cloud), 'Read disabled saved model config'), savedCloud);
    assert.deepEqual(value(await disabledAgain.host.configs.get(voice), 'Read disabled saved mode'), savedMode);
    report['disabledRestoreSnapshot'] = disabledState;
    checks.push('explicit-user-disable-persists-and-prevents-restore-even-after-fresh-host-exact-source-review');

    report['stage'] = 'snapshot-and-disk-secret-exclusion';
    const beforeMetadata = decryptions;
    assert.ok(models);
    const final = await models.snapshot(); assertMetadata(final);
    assert.equal(decryptions, beforeMetadata, 'Snapshot must use credential metadata without decrypting keys');
    const scan = async (directory: string): Promise<number> => {
      let count = 0;
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) count += await scan(file);
        else if (entry.isFile()) {
          const bytes = await fs.readFile(file);
          assert.ok(canaries.every(secret => !bytes.includes(Buffer.from(secret))), 'Raw credential persisted in isolated profile');
          count++;
        }
      }
      return count;
    };
    const inspectedFiles = await scan(profile);
    const originalAfter = await discoverPlugins([{ directory: path.join(root, 'plugins'), origin: 'builtin' }]);
    assert.deepEqual(originalAfter, originals, 'Original plugins changed during probe');
    assert.ok(canaries.every(secret => !JSON.stringify({ calls, decisions, output, final }).includes(secret)), 'Credential escaped into public data');
    assert.ok(changed > 0);
    report['servicesTested'] = successful;
    report['fixtureCalls'] = calls;
    report['snapshot'] = final;
    report['credentialChecks'] = { isolatedProfileFiles: inspectedFiles, ciphertextCount: (await fs.readdir(path.join(profile, 'vault'))).filter(file => file.endsWith('.sealed')).length,
      metadataDoesNotDecrypt: true, staleCiphertextUnchanged: true, plaintextOnlyCheckedLocally: true };
    checks.push('snapshot-only-exposes-endpoint-metadata-and-profile-disk-and-audit-contain-no-raw-keys');
    report['status'] = 'passed';
  } catch (error) {
    report['failure'] = redact(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  } finally {
    try {
      await closeHost('disabled-reopen');
    } catch (error) {
      report['status'] = 'failed';
      report['shutdownFailure'] = redact(error instanceof Error ? error.stack ?? error.message : String(error));
      process.exitCode = 1;
    }
    const serialized = JSON.stringify(report);
    const reportSafe = canaries.every(secret => !serialized.includes(secret));
    const bounded = Buffer.byteLength(serialized) <= 96 * 1024;
    const finalReport = reportSafe && bounded ? report : {
      status: 'failed', stage: report['stage'], hostShutdown: report['hostShutdown'],
      failure: reportSafe ? 'Final report exceeded 96 KiB' : 'Final report failed credential exclusion',
    };
    if (!reportSafe || !bounded) process.exitCode = 1;
    if (process.send) process.send(finalReport, () => { process.disconnect?.(); });
  }
})();
