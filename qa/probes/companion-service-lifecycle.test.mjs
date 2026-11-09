import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { test } from 'node:test';
import {
  ALTERNATIVE,
  HARNESS,
  deferred,
  fixture,
  patch,
  records,
  snapshot,
  until,
  value,
  within,
} from '../fixtures/companion-service/helpers.mjs';

const { CompanionPluginHost } = await import('../../packages/companion-runtime/src/plugin-host.ts');
const { SqliteState } = await import('../../plugins/state-sqlite/src/state.ts');
const TEXT = 'pet.text-client';
const STATE = 'pet.state-sqlite';
const CLOUD = 'pet.cloud-exec';
const HOST = 'pet.companion-host';
const CORTICO = `${HARNESS}/cortico`;

async function config(f, pluginId) {
  const result = await f.service.host.configs.get({ pluginId, instanceId: 'default' });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
}

async function setPlugin(f, id, enabled, commandId = randomUUID()) {
  return value(await f.post(`/api/plugins/${id}`, { commandId, enabled }));
}

async function uiStatus(f) {
  const response = await fetch(f.service.url, { signal: AbortSignal.timeout(10000) });
  await response.arrayBuffer();
  return response.status;
}

// Observe real activation calls without changing a provider's behavior or its source fingerprint.
function observeActivations() {
  const activated = [];
  const restore = patch(
    CompanionPluginHost,
    'create',
    (create) => (options) =>
      create({
        ...options,
        plugins: options.plugins.map((registration) => {
          const definition = registration.definition;
          return {
            ...registration,
            definition: {
              ...definition,
              activate(context) {
                activated.push(registration.manifest.id);
                return definition.activate(context);
              },
            },
          };
        }),
      }),
  );
  return { activated, restore };
}

test(
  'stored disabled text and harness never activate before HTTP publication on restart',
  { timeout: 30000 },
  async (t) => {
    let f = await fixture(t);
    let observation;
    try {
      const initial = await snapshot(f);
      assert.equal(await uiStatus(f), 200);
      await setPlugin(f, TEXT, false);
      await setPlugin(f, HARNESS, false);
      const root = f.dataDirectory;
      await f.close();
      observation = observeActivations();
      f = await fixture(t, { dataDirectory: root });
      assert.equal(
        observation.activated.includes(TEXT),
        false,
        'stored withdrawal applies before text activation',
      );
      assert.equal(
        observation.activated.includes(HARNESS),
        false,
        'stored harness withdrawal applies before Core activation',
      );
      assert.equal(
        await uiStatus(f),
        404,
        'the first publicly reachable UI response is unavailable',
      );
      const restarted = await snapshot(f);
      assert.equal(restarted.agent.id, initial.agent.id);
      assert.equal(restarted.agent.status, 'unavailable');
      assert.equal(restarted.plugins.find((plugin) => plugin.id === TEXT).desiredActive, false);
      assert.equal(restarted.plugins.find((plugin) => plugin.id === HARNESS).desiredActive, false);
      await setPlugin(f, TEXT, true);
      assert.equal(await uiStatus(f), 200);
      assert.equal(observation.activated.filter((id) => id === TEXT).length, 1);
      value(await f.post('/api/harness', { commandId: randomUUID(), harness: CORTICO }));
      const restored = await snapshot(f);
      assert.equal(restored.agent.id, initial.agent.id);
      assert.equal(restored.agent.status, 'ready');
      assert.equal(restored.agent.harness, CORTICO);
      assert.equal(observation.activated.filter((id) => id === HARNESS).length, 1);
    } finally {
      try {
        await f.close();
      } finally {
        observation?.restore();
      }
    }
  },
);

test(
  'explicit execution image persists through omitted and identical options without revision churn',
  { timeout: 30000 },
  async (t) => {
    // This reference is configuration-only: no task/code is submitted and no Docker availability is claimed.
    const options = {
      image: 'qa.invalid/companion-config-only:probe',
      name: 'Lifecycle configuration fixture',
      persona: 'Use the unchanged operator profile.',
    };
    let f = await fixture(t, options);
    let observation;
    try {
      const identity = (await snapshot(f)).agent.id;
      const root = f.dataDirectory;
      const savedExecution = await config(f, CLOUD);
      const savedProfile = await config(f, HOST);
      assert.equal(savedExecution.data.image, options.image);
      assert.equal(f.service.host.isEnabled(CLOUD), true);
      for (const next of [{ name: options.name, persona: options.persona }, options]) {
        await f.close();
        f = await fixture(t, { dataDirectory: root, ...next });
        const execution = await config(f, CLOUD);
        const operator = await config(f, HOST);
        assert.deepEqual(execution.data, savedExecution.data);
        assert.equal(execution.revision, savedExecution.revision);
        assert.deepEqual(operator.data, savedProfile.data);
        assert.equal(operator.revision, savedProfile.revision);
        assert.equal((await snapshot(f)).agent.id, identity);
        assert.equal(f.service.host.isEnabled(CLOUD), true);
        assert.deepEqual(await records(root), [], 'configuration does not start a real execution');
      }
      await setPlugin(f, CLOUD, false);
      await f.close();
      observation = observeActivations();
      f = await fixture(t, { dataDirectory: root });
      assert.equal(
        observation.activated.includes(CLOUD),
        false,
        'saved image does not override stored withdrawal',
      );
      assert.equal(f.service.host.isEnabled(CLOUD), false);
      const execution = await config(f, CLOUD);
      assert.equal(execution.data.image, options.image);
      assert.equal(execution.revision, savedExecution.revision);
      assert.deepEqual(await records(root), []);
    } finally {
      try {
        await f.close();
      } finally {
        observation?.restore();
      }
    }
  },
);

test(
  'disabled state remains manageable after restart, rejects reused commands and restores the same Agent',
  { timeout: 30000 },
  async (t) => {
    let f = await fixture(t);
    let observation;
    try {
      const initial = await snapshot(f);
      const memory = value(await f.get('/api/memory'));
      assert.ok(Number.isSafeInteger(memory.revision));
      assert.equal(memory.facts.find((fact) => fact.key === 'lifecycle'), undefined);
      const remembered = value(
        await f.post('/api/facts', {
          commandId: randomUUID(),
          expectedMemoryRevision: memory.revision,
          expectedFactRevision: 0,
          key: 'lifecycle',
          value: 'Keep my identity and fact',
        }),
      );
      assert.equal(remembered.receipt.status, 'accepted');
      await setPlugin(f, TEXT, false);
      const disableId = randomUUID();
      await setPlugin(f, STATE, false, disableId);
      assert.equal(
        value(await f.get('/api/plugins')).find((plugin) => plugin.id === STATE).state,
        'disabled',
      );
      assert.equal((await f.get('/api/snapshot')).status, 503);
      const root = f.dataDirectory;
      await f.close();
      observation = observeActivations();
      f = await fixture(t, { dataDirectory: root });
      assert.equal(
        observation.activated.includes(STATE),
        false,
        'restart must not open a stored-disabled writer',
      );
      assert.equal(observation.activated.includes(TEXT), false);
      assert.equal(await uiStatus(f), 404);
      const unavailable = await f.get('/api/snapshot');
      assert.equal(unavailable.status, 503);
      assert.equal(unavailable.body.ok, false);
      const disabled = value(await f.get('/api/plugins'));
      assert.equal(disabled.find((plugin) => plugin.id === STATE).state, 'disabled');
      const revision = (await config(f, HOST)).revision;
      const conflict = await f.post(`/api/plugins/${STATE}`, {
        commandId: disableId,
        enabled: true,
      });
      assert.equal(conflict.status, 409);
      assert.equal(conflict.body.error.code, 'conflict');
      assert.equal(
        value(await f.get('/api/plugins')).find((plugin) => plugin.id === STATE).state,
        'disabled',
      );
      assert.equal((await config(f, HOST)).revision, revision);
      assert.equal(
        observation.activated.filter((id) => id === STATE).length,
        1,
        'command validation temporarily opens the writer exactly once',
      );
      // An independent real SQLite writer can acquire the same exclusive lock only if rollback closed it.
      const independent = new SqliteState({ dataDirectory: path.join(root, 'state') });
      try {
        const durable = independent.snapshot();
        assert.equal(durable.ok, true);
        assert.equal(durable.value.assistantId, initial.agent.id);
      } finally {
        independent.close();
      }
      const restoreId = randomUUID();
      assert.equal((await setPlugin(f, STATE, true, restoreId)).status, 'accepted');
      const restored = await snapshot(f);
      assert.equal(restored.agent.id, initial.agent.id);
      assert.equal(restored.agent.status, 'ready');
      assert.equal(
        restored.facts.find((fact) => fact.key === 'lifecycle').value,
        'Keep my identity and fact',
      );
      assert.equal(restored.plugins.find((plugin) => plugin.id === STATE).state, 'active');
      assert.equal(
        await uiStatus(f),
        404,
        'state restoration must preserve the independent text withdrawal',
      );
      assert.equal((await setPlugin(f, STATE, true, restoreId)).status, 'duplicate');
      await setPlugin(f, TEXT, true);
      assert.equal(await uiStatus(f), 200);
      assert.equal((await snapshot(f)).agent.id, initial.agent.id);
    } finally {
      try {
        await f.close();
      } finally {
        observation?.restore();
      }
    }
  },
);

test(
  'fixture admission drains to ready and the same rejected switch command can return to Cortico',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const reached = deferred();
    const release = deferred();
    let admission;
    const restore = patch(f.service.runtime, 'harnessPorts', (original) => (key, profile) => {
      const ports = original(key, profile);
      if (key !== ALTERNATIVE) return ports;
      return {
        ...ports,
        async publish(output) {
          reached.resolve();
          await release.promise;
          return ports.publish(output);
        },
      };
    });
    try {
      const initial = await snapshot(f);
      const memory = value(await f.get('/api/memory'));
      assert.ok(Number.isSafeInteger(memory.revision));
      assert.equal(memory.facts.find((fact) => fact.key === 'answer-style'), undefined);
      const remembered = value(
        await f.post('/api/facts', {
          commandId: randomUUID(),
          expectedMemoryRevision: memory.revision,
          expectedFactRevision: 0,
          key: 'answer-style',
          value: 'brief and concrete',
        }),
      );
      assert.equal(remembered.receipt.status, 'accepted');
      value(await f.post('/api/harness', { commandId: randomUUID(), harness: ALTERNATIVE }));
      const input = { commandId: randomUUID(), text: 'FIXTURE_LIFECYCLE_INPUT' };
      admission = f.post('/api/messages', input);
      await within(reached.promise, 'real fixture publication admission');
      const busy = await snapshot(f);
      assert.equal(busy.agent.status, 'busy');
      assert.equal(
        busy.messages.filter((message) => message.role === 'user' && message.text === input.text)
          .length,
        1,
      );
      assert.equal(
        busy.messages.some(
          (message) => message.role === 'assistant' && message.text.includes(input.text),
        ),
        false,
      );
      const back = { commandId: randomUUID(), harness: CORTICO };
      const conflict = await f.post('/api/harness', back);
      assert.equal(
        conflict.status,
        409,
        'replacement must wait for actual accepted input to drain',
      );
      release.resolve();
      const accepted = value(await admission);
      assert.equal(accepted.status, 'accepted');
      const answered = await until(
        () => snapshot(f),
        (state) =>
          state.agent.status === 'ready' &&
          state.messages.some(
            (message) => message.role === 'assistant' && message.text.includes(input.text),
          ),
        'fixture answer and ready status',
      );
      const replies = answered.messages.filter(
        (message) => message.role === 'assistant' && message.text.includes(input.text),
      );
      assert.equal(replies.length, 1);
      assert.equal(replies[0].inputId, accepted.messageId);
      assert.match(replies[0].text, /brief and concrete/);
      assert.equal(value(await f.post('/api/messages', input)).status, 'duplicate');
      assert.equal(value(await f.post('/api/harness', back)).status, 'accepted');
      const returned = await snapshot(f);
      assert.equal(returned.agent.id, initial.agent.id);
      assert.equal(returned.agent.harness, CORTICO);
      assert.equal(returned.agent.status, 'ready');
      assert.equal(
        returned.plugins.find((plugin) => plugin.id === 'pet.harness-fixture').state,
        'disabled',
      );
      assert.equal(
        returned.messages.filter(
          (message) => message.role === 'assistant' && message.text.includes(input.text),
        ).length,
        1,
      );
      assert.equal(
        returned.facts.find((fact) => fact.key === 'answer-style').value,
        'brief and concrete',
      );
    } finally {
      release.resolve();
      if (admission) await admission;
      restore();
      await f.close();
    }
  },
);
