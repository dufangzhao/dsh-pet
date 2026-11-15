// Scoped independent review only: actual React SSR plus real components under a local hook scheduler.
// No browser, product server, model, QQ connection or user data is used.
import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, mock, test } from 'node:test';
import { registerHooks } from 'node:module';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
// CSS has no role in these SSR/hook canaries; no browser rendering is claimed.
const cssHook = registerHooks({ load(url, context, next) {
  return url.endsWith('.css') ? { format: 'module', source: 'export {};', shortCircuit: true } : next(url, context);
} });
after(() => cssHook.deregister());
const { QQJudgeForm } = await import('../plugins/text-client/src/client/qq-judge-form.tsx');
import { defaultQQPolicySettings } from '../packages/contracts/src/companion-qq.ts';
import { readMaterialText, MATERIAL_TEXT_MAX_BYTES } from '../plugins/text-client/src/client/material-transport.ts';

const slots = [];
let cursor = 0, effects = [], mounted = false, dirty = false, component, props, tree;
const release = [];
const originalFetch = globalThis.fetch;
const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const hooks = {
  useState(initial) { const slot = slots[cursor++] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slot.value, next => { if (!mounted) return; const value = typeof next === 'function' ? next(slot.value) : next; if (!Object.is(value, slot.value)) { slot.value = value; dirty = true; } }]; },
  useRef(initial) { return slots[cursor++] ??= { current: initial }; },
  useEffect(effect, deps) { const index = cursor++; const slot = slots[index] ??= {}; if (!same(slot.deps, deps)) { slot.deps = deps; effects.push(() => { slot.cleanup?.(); slot.cleanup = effect(); }); } },
  useId() { return `review-${cursor++}`; },
};
const { default: defaultReact, ...namedReact } = React;
mock.module('react', { defaultExport: defaultReact, namedExports: { ...namedReact, ...hooks } });
// TSX may use the checkout's classic JSX mode in a standalone Node invocation.
globalThis.React = defaultReact;
const { QQPanel } = await import('../plugins/text-client/src/client/qq-panel.tsx');
const { MessageMaterials } = await import('../plugins/text-client/src/client/message-materials.tsx');
const qqForm = await import('../plugins/text-client/src/client/qq-form.ts');

function unmount() { mounted = false; for (const slot of slots) slot?.cleanup?.(); effects = []; }
function render(fn = component, next = props) {
  if (fn === QQPanel && next.onView === undefined) next = { ...next, onView: value => {
    if (mounted && !Object.is(props.view, value)) { props = { ...props, view: value }; dirty = true; }
  } };
  component = fn; props = next; mounted = true;
  for (let i = 0; i < 25; i++) {
    cursor = 0; dirty = false; tree = component(props);
    for (const effect of effects.splice(0)) effect();
    if (!dirty) return tree;
  }
  throw new Error('Hook render did not settle');
}
async function flush() { for (let i = 0; i < 3; i++) { await new Promise(r => setTimeout(r, 0)); if (mounted && dirty) render(); } }
function gate(fallback) { let resolve; const promise = new Promise(r => resolve = r); release.push(() => resolve(fallback)); return { promise, resolve }; }
function nodes(value, predicate) {
  if (Array.isArray(value)) return value.flatMap(v => nodes(v, predicate));
  if (!React.isValidElement(value)) return [];
  const result = predicate(value) ? [value] : [];
  for (const [key, child] of Object.entries(value.props)) {
    if (key === 'children' && typeof child === 'function') result.push(...nodes(child({ inputId: 'review-field', describedBy: undefined }), predicate));
    else result.push(...nodes(child, predicate));
  }
  return result;
}
function byId(id) { if (dirty) render(); const found = nodes(tree, node => node.props['data-testid'] === id)[0]; assert.ok(found, id); return found; }
function judge() { if (dirty) render(); const found = nodes(tree, node => node.type === QQJudgeForm)[0]; assert.ok(found, 'judge component'); return found.props; }
beforeEach(() => { slots.length = 0; cursor = 0; effects = []; mounted = false; dirty = false; });
afterEach(async () => { unmount(); for (const done of release.splice(0)) done(); await flush(); globalThis.fetch = originalFetch; });
const ok = value => ({ ok: true, value });
function view() {
  const policy = defaultQQPolicySettings();
  const connection = { baseUrl: 'https://a.synthetic.invalid/v1', model: 'model-a', authMode: 'gateway-key' };
  const source = (protocol) => ({
    protocol, sourcePluginId: protocol === 'official' ? 'pet.qq-official' : 'pet.qq-onebot', instanceId: 'default', desiredEnabled: false, source: 'ready', configRevision: 1, appliedRevision: null,
    settings: protocol === 'official' ? { protocol, appId: 'app-a', scenes: ['private', 'group'] } : { protocol, accountId: '900', mode: 'reverse-ws', channelMode: 'universal', mediaProfile: 'snowluma-v11', listenHost: '127.0.0.1', listenPort: 8080, path: '/onebot' },
    account: { protocol, sourcePluginId: protocol === 'official' ? 'pet.qq-official' : 'pet.qq-onebot', instanceId: 'default', accountId: protocol === 'official' ? 'app-a' : '900' },
    bindingId: null, phase: 'unconfigured', credential: { available: false, writable: true, version: 'source-v1', source: 'none' }, media: { text: 'available', image: 'unverified', voice: 'unverified', file: 'unverified' }, cleanup: 'settled', error: null, installedVersion: null,
  });
  return { version: 1, policy: { revision: 1, settings: policy }, sources: [source('official'), source('onebot-v11')], judge: { sourcePluginId: 'pet.qq-participation-magpie', configRevision: 1, appliedRevision: null, settings: { ...policy.judge, connection }, bindingId: null, credential: { available: false, writable: true, version: 'judge-v1', source: 'none' }, readiness: 'unconfigured', active: 0, admittedAttempts: 0, inputTokens: null, outputTokens: null, error: null } };
}
function transport(initial = view()) {
  let server = initial;
  const writes = [];
  const value = {
    connectionId: 'connection-A',
    read: async () => ok(server), savePolicy: async () => ok(server), saveSource: async () => ok(server), writeCredential: async () => ok(server),
    saveJudge: async command => { server = { ...server, judge: { ...server.judge, configRevision: 2, settings: command.settings } }; return ok(server); },
    writeJudgeCredential: async command => { writes.push(command); return ok(server); },
    setEnabled: async () => ok(null), readDeliveries: async () => ok({ deliveries: [], next: null }), readDelivery: async () => ({ ok: false, error: { code: 'unavailable' } }),
  };
  return { value, writes, server: () => server };
}

test('gateway-key writable judge renders through real React with an ordinary secret prop', () => {
  const value = view();
  const form = { judge: { settings: value.judge.settings, configRevision: 1, credentialVersion: 'judge-v1', connectionId: 'connection-A', edited: false } };
  assert.doesNotThrow(() => renderToStaticMarkup(React.createElement(QQJudgeForm, { key: 'review-element', secretValue: 'synthetic-review-key', view: value.judge, form, onSecretChange() {}, actions: { saving: false, writing: false, dirty: false, onEdit() {}, onSave() {}, onWriteKey() {} } })));
});

test('successful judge config save advances the actual panel draft baseline for subsequent key writes', async () => {
  const current = view(); const t = transport(current);
  render(QQPanel, { open: true, view: current, transport: t.value, onClose() {} }); await flush();
  judge().actions.onEdit(settings => ({ ...settings, connection: { ...settings.connection, model: 'model-b' } }));
  judge().actions.onSave(); await flush();
  assert.equal(judge().form.judge.configRevision, 2);
  assert.equal(judge().form.judge.edited, false);
});

test('dirty judge settings retain both CAS baselines across an external policy-only edit', async () => {
  const current = view(); const t = transport(current); const commands = [];
  t.value.saveJudge = async command => { commands.push(command); return ok(current); };
  render(QQPanel, { open: true, view: current, transport: t.value, onClose() {} }); await flush();
  judge().actions.onEdit(settings => ({ ...settings, connection: { ...settings.connection, model: 'edited-model' } }));
  const newer = structuredClone(current);
  newer.policy.revision = 2;
  newer.policy.settings.judge.maxAttemptsPerHour = 7;
  newer.judge.settings.maxAttemptsPerHour = 7;
  render(QQPanel, { open: true, view: newer, transport: t.value, onClose() {} }); await flush();
  judge().actions.onSave(); await flush();
  assert.ok(commands.length === 0 || commands[0].expectedPolicyRevision === 1,
    `old settings borrowed new policy revision: ${JSON.stringify(commands[0])}`);
});

test('rebasing a dirty policy preserves its edits without reverting the independent saved judge subset', () => {
  const current = view();
  let draft = qqForm.followView(qqForm.emptyQQForm, current, current.sources[0], 'connection-A');
  draft = qqForm.editPolicy(draft, settings => ({ ...settings, voiceOutputEnabled: true }));
  const newer = structuredClone(current);
  newer.policy.revision = 2;
  newer.policy.settings.judge.maxAttemptsPerHour = 7;
  newer.judge.settings.maxAttemptsPerHour = 7;
  draft = qqForm.rebaseOnView(draft, newer);
  const command = qqForm.policySaveCommand(draft, newer);
  assert.equal(command.settings.voiceOutputEnabled, true);
  assert.equal(command.expectedRevision, 2);
  assert.equal(command.settings.judge.maxAttemptsPerHour, 7);
});

test('a local unsaved judge target change cannot write a credential against the saved old target', async () => {
  const current = view(); const t = transport(current);
  render(QQPanel, { open: true, view: current, transport: t.value, onClose() {} }); await flush();
  judge().actions.onEdit(settings => ({ ...settings, connection: { ...settings.connection, baseUrl: 'https://b.synthetic.invalid/v1' } }));
  judge().actions.onWriteKey('synthetic-key-for-B'); await flush();
  assert.equal(t.writes.length, 0);
});

test('a typed judge key cannot borrow a new saved target credential baseline', async () => {
  const current = view(); const t = transport(current);
  render(QQPanel, { open: true, view: current, transport: t.value, onClose() {} }); await flush();
  judge().onSecretChange('synthetic-private-key-for-A');
  const newer = structuredClone(current);
  newer.judge.settings.connection.baseUrl = 'https://b.synthetic.invalid/v1';
  newer.judge.configRevision = 2;
  newer.judge.credential.version = 'judge-B-v2';
  render(QQPanel, { open: true, view: newer, transport: t.value, onClose() {} }); await flush();
  const value = judge().secretValue;
  if (value) judge().actions.onWriteKey(value);
  await flush();
  assert.equal(t.writes.length, 0, `old secret adopted new target CAS: ${JSON.stringify(t.writes[0])}`);
});

test('switching protocol during a held source save does not restore the old source form', async () => {
  const current = view(); const t = transport(current); const held = gate(ok(current));
  t.value.saveSource = () => held.promise;
  render(QQPanel, { open: true, view: current, transport: t.value, onClose() {} }); await flush();
  byId('qq-app-id').props.onChange({ target: { value: 'app-edited' } });
  byId('qq-save-source').props.onClick(); await flush();
  byId('qq-select-onebot-v11').props.onClick(); await flush();
  assert.equal(byId('qq-account-id').props.value, '900');
  held.resolve(ok(current)); await flush();
  assert.equal(byId('qq-account-id').props.value, '900');
});

test('a material full-text result from A cannot enter the same message after actions change to B', async () => {
  const ref = { id: 'text-material', kind: 'text', name: 'full.txt', sizeBytes: 4, mediaType: 'text/plain', sha256: '0'.repeat(64), durationMs: null, audience: { kind: 'owner-private' }, originInputIds: ['input'] };
  const message = { id: 'same-message', text: 'Explanation only', content: { kind: 'text-document', material: ref }, materials: [ref] };
  const held = gate(ok('A private full text'));
  const actions = { connectionId: 'A', readText: () => held.promise, readBlob: async () => ({ ok: false }) };
  render(MessageMaterials, { message, actions });
  byId('material-view-text-material').props.onClick();
  render(MessageMaterials, { message, actions: { ...actions, connectionId: 'B', readText: async () => ok('B text') } });
  assert.equal(byId('material-view-text-material').props.disabled, false, 'B must not inherit A busy');
  held.resolve(ok('A private full text')); await flush();
  assert.equal(nodes(tree, node => node.props['data-testid'] === 'material-fulltext').length, 0);
});

test('full-text byte budget stops the response before consuming an entire oversized unframed body', async () => {
  let pulled = 0, cancelled = false;
  globalThis.fetch = async () => new Response(new ReadableStream({
    pull(controller) { pulled++; if (pulled > 8) controller.close(); else controller.enqueue(new Uint8Array(MATERIAL_TEXT_MAX_BYTES / 2)); },
    cancel() { cancelled = true; },
  }));
  const result = await readMaterialText({ baseUrl: 'https://synthetic.invalid', token: 'synthetic' }, 'material');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'quota-exceeded');
  assert.ok(pulled < 8, `read ${pulled} chunks before rejecting`);
  assert.equal(cancelled, true);
});
