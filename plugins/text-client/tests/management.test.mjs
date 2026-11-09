import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { CompanionClient } from '../src/client/client.ts';
import { parseSnapshot, parseProfile, parseMemory, upsertFact } from '../src/protocol.ts';
import { snapshot } from './fixtures.mjs';

const application = { appliedRevision: 0, error: null };
const memory = { revision: 0, application, usage: { count: 0, dataBytes: 2, originBytes: 2 } };

test('optional management remains readonly on old peers; malformed present application is rejected', () => {
  assert.equal(parseSnapshot(snapshot()).ok, true);
  assert.equal(parseSnapshot(snapshot({ memory })).ok, true);
  assert.equal(
    parseSnapshot(snapshot({ memory: { ...memory, usage: { ...memory.usage, dataBytes: 3 } } })).ok,
    false,
  );
  assert.equal(
    parseSnapshot(snapshot({ memory: { ...memory, application: { error: null } } })).ok,
    false,
  );
  const profile = { agentId: 'agent-1', name: 'Test', persona: 'Persona', revision: 1 };
  assert.ok(parseProfile(profile));
  assert.equal(
    parseProfile({ ...profile, management: { application, launchOverrides: { name: true } } }),
    null,
  );
});

test('actual management HTTP rejects foreign identity and a receipt for another command', async () => {
  let commandId = 'different';
  let agentId = 'agent-1';
  const bodies = [];
  const server = createServer((request, response) => {
    if (request.url.startsWith('/api/events')) {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(': keepalive\n\n');
      return;
    }
    if (request.url === '/api/snapshot') {
      response.end(JSON.stringify({ ok: true, value: snapshot({ memory }) }));
      return;
    }
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      bodies.push(JSON.parse(body));
      response.end(
        JSON.stringify({
          ok: true,
          value: {
            receipt: { commandId, status: 'accepted', taskId: null, messageId: null },
            committedRevision: 1,
            view: { ...memory, revision: 1, agentId, facts: [] },
          },
        }),
      );
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const command = {
    commandId: 'own',
    expectedMemoryRevision: 0,
    expectedFactRevision: 0,
    key: 'language',
    value: '中文',
  };
  const client = new CompanionClient({ baseUrl });
  try {
    assert.equal((await upsertFact({ baseUrl, token: 'fixture' }, command)).ok, false);
    commandId = 'own';
    agentId = 'foreign';
    await client.connect('fixture');
    assert.equal((await client.upsertFact(command)).ok, false);
    assert.deepEqual(bodies, [command, command]);
    assert.equal(client.getState().snapshot.agent.id, 'agent-1');
  } finally {
    client.dispose();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('memory/snapshot identity and user origin use the canonical ID grammar, including real unavailable sentinel', () => {
  const identity = '458d6040-9101-42ad-8889-f29a97920a88';
  const origin = { kind: 'user-input', inputId: identity, evidence: { start: 0, end: 2 } };
  const fact = { key: 'language', value: '中文', revision: 1, updatedAt: 1700000000000, origin };
  const status = (row) => ({
    revision: 1,
    application: { appliedRevision: 1, error: null },
    usage: {
      count: 1,
      dataBytes: Buffer.byteLength(
        JSON.stringify([
          { key: row.key, value: row.value, revision: row.revision, updatedAt: row.updatedAt },
        ]),
      ),
      originBytes: Buffer.byteLength(JSON.stringify([row.origin])),
    },
  });
  for (const bad of ['', ' ', '../foreign', 'a'.repeat(129)]) {
    assert.equal(parseMemory({ ...status(fact), agentId: bad, facts: [fact] }), null);
    assert.equal(
      parseSnapshot(
        snapshot({ agent: { ...snapshot().agent, id: bad }, memory: status(fact), facts: [fact] }),
      ).ok,
      false,
    );
    const forged = { ...fact, origin: { ...origin, inputId: bad } };
    assert.equal(parseMemory({ ...status(forged), agentId: identity, facts: [forged] }), null);
    assert.equal(parseSnapshot(snapshot({ facts: [forged], memory: status(forged) })).ok, false);
  }
  for (const good of [identity, 'unavailable', 'agent-1']) {
    assert.ok(parseMemory({ ...status(fact), agentId: good, facts: [fact] }));
    assert.equal(
      parseSnapshot(
        snapshot({ agent: { ...snapshot().agent, id: good }, memory: status(fact), facts: [fact] }),
      ).ok,
      true,
    );
  }
});
