// Independent review canaries: fresh SQLite roots and an in-memory model permit only.
// No product server, Docker, model, device, account or original data is used.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SqliteState } from '../plugins/state-sqlite/src/state.ts';
import { ModelPermit } from '../plugins/harness-cortico/src/model-permit.ts';

const account = { protocol: 'onebot-v11', sourcePluginId: 'pet.qq-onebot', instanceId: 'default', accountId: '900' };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const scope = (principalId, audience = { kind: 'person-private', principalId }) => ({ kind: 'conversation', principalId, audience });
function origin(inputId, principalId, groupId) {
  const senderId = principalId === 'alice' ? '101' : '102';
  const audience = groupId ? { kind: 'qq-group', account, groupId } : { kind: 'person-private', principalId };
  return {
    kind: 'qq', inputId, principalId, policyRevision: 1, eventKey: `event-${inputId}`, messageId: '1', trigger: 'direct', quote: null,
    actor: groupId ? { account, scene: 'group', senderId, groupId } : { account, scene: 'private', senderId },
    audience,
    route: { kind: 'qq', account, scene: groupId ? 'group' : 'private', targetId: groupId ?? senderId, reference: { eventId: null, messageId: '1', occurredAt: 1000, displayReference: null } },
  };
}
async function withState(run) {
  const parent = await realpath(tmpdir());
  const root = await mkdtemp(path.join(parent, 'companion-qq-review-5519-'));
  const state = new SqliteState({ dataDirectory: root });
  try { await run(state); }
  finally {
    state.close();
    const resolved = await realpath(root);
    assert.equal(path.dirname(resolved), parent);
    assert.ok(path.basename(resolved).startsWith('companion-qq-review-5519-'));
    await rm(resolved, { recursive: true });
  }
}
function admit(state, value, materialIds = []) {
  ok(state.createInput({ id: value.inputId, commandId: `command-${value.inputId}`, origin: value, evidence: {}, materialIds }));
  return ok(state.commitInput({ id: value.inputId, text: `current-${value.inputId}` }));
}
function publish(state, value, id) {
  return ok(state.appendMessage({ id, role: 'assistant', text: id, inputId: value.inputId, audience: value.audience, origins: [value] }));
}

test('conversation filtering happens before bounded pages, with public facts and own tasks only', async () => withState(state => {
  const alice = origin('alice-input', 'alice');
  const bob = origin('bob-input', 'bob');
  admit(state, alice); admit(state, bob);
  for (let index = 0; index < 6; index++) publish(state, alice, `alice-${index}`);
  for (let index = 0; index < 80; index++) publish(state, bob, `bob-${index}`);
  let revision = 0;
  for (const [key, audience] of [['alice-fact', alice.audience], ['bob-fact', bob.audience], ['public-fact', { kind: 'public' }], ['owner-fact', { kind: 'owner-private' }]]) {
    ok(state.invoke('rememberFact', { commandId: `remember-${key}`, key, value: key, audience, expectedMemoryRevision: revision++, expectedFactRevision: 0, origin: { kind: 'owner-form' } }));
  }
  const selected = scope('alice');
  const snapshot = ok(state.snapshot({ scope: selected, messageLimit: 3 }));
  assert.deepEqual(snapshot.messages.map(message => message.id), ['alice-3', 'alice-4', 'alice-5']);
  assert.deepEqual(snapshot.facts.map(fact => fact.key).sort(), ['alice-fact', 'public-fact']);
  const events = ok(state.events({ scope: selected, after: 0, epoch: snapshot.epoch, limit: 2 }));
  assert.equal(events.events.length, 2);
  assert.ok(events.events.every(event => !JSON.stringify(event).includes('bob')));
  const groupAlice = origin('group-alice', 'alice', '700');
  const groupBob = origin('group-bob', 'bob', '700');
  admit(state, groupAlice); admit(state, groupBob);
  const taskOrigin = value => ({ inputId: value.inputId, principalId: value.principalId, audience: value.audience, route: value.route, origins: [value], materialIds: [] });
  const own = ok(state.createTask({ commandId: 'group-alice-task', title: 'own', code: '0', origin: taskOrigin(groupAlice) })).task;
  const other = ok(state.createTask({ commandId: 'group-bob-task', title: 'other', code: '0', origin: taskOrigin(groupBob) })).task;
  const groupScope = scope('alice', groupAlice.audience);
  assert.deepEqual(ok(state.snapshot({ scope: groupScope, taskLimit: 1 })).tasks.map(task => task.id), [own.id]);
  assert.equal(state.invoke('getTask', { id: other.id, scope: groupScope }).ok, false);
}));

test('legacy message and task intent fingerprints retain stable IDs on exact retries', async () => withState(state => {
  const command = { commandId: 'legacy-command', text: 'original' };
  const first = ok(state.acceptMessage(command));
  const repeated = ok(state.acceptMessage(command));
  assert.equal(repeated.receipt.status, 'duplicate');
  assert.equal(repeated.message.id, first.message.id);
  assert.equal(repeated.message.inputId, command.commandId);
  assert.equal(repeated.message.origins[0].inputId, first.message.id);
  const task = { commandId: 'legacy-work', title: 'legacy', code: '0' };
  const created = ok(state.createTask(task));
  const known = ok(state.createTask(task));
  assert.equal(known.receipt.status, 'duplicate');
  assert.equal(known.task.id, created.task.id);
  assert.equal(known.task.origin.audience.kind, 'owner-private');
}));

test('missing material cannot make an input ready and a settled cancelled input cannot reactivate', async () => withState(state => {
  const value = origin('missing-input', 'alice');
  ok(state.createInput({ id: value.inputId, commandId: 'missing-command', origin: value, evidence: {}, materialIds: ['missing-bytes'] }));
  assert.equal(state.commitInput({ id: value.inputId, text: 'must not run without material' }).ok, false);
  const selected = scope('alice');
  assert.equal(ok(state.getInput({ id: value.inputId, scope: selected })).phase, 'preparing');
  assert.equal(ok(state.snapshot({ scope: selected })).messages.length, 0);
  ok(state.updateInput({ id: value.inputId, phase: 'cancelled', cleanup: 'settled', error: null }));
  assert.equal(ok(state.claimInput({ id: value.inputId })).claimed, false);
  assert.equal(state.updateInput({ id: value.inputId, phase: 'ready', cleanup: 'pending' }).ok, false);
}));

test('a cancelled parked model waiter never invokes native work, and the permit still advances', async () => {
  const permit = new ModelPermit();
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let entered;
  const active = new Promise(resolve => { entered = resolve; });
  const first = permit.run(new AbortController().signal, async () => { entered(); await held; });
  await active;
  const parked = new AbortController();
  let nativeCalls = 0;
  const second = permit.run(parked.signal, async () => { nativeCalls++; }).catch(error => error);
  parked.abort();
  const cancellation = await second;
  assert.equal(cancellation.name, 'AbortError');
  assert.equal(nativeCalls, 0);
  release(); await first;
  await permit.run(new AbortController().signal, async () => { nativeCalls++; });
  assert.equal(nativeCalls, 1);
  assert.deepEqual(permit.diagnostics(), { active: false, waiting: 0 });
});
