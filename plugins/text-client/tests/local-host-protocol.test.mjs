import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { getLocalHostSelection, selectLocalHost } from '../src/client/local-host-protocol.ts';

async function fixture(handler) {
  const seen = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (bytes) => {
      body += bytes;
    });
    request.on('end', () => {
      seen.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        body,
      });
      handler(response, seen.at(-1));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    seen,
    transport: { baseUrl: `http://127.0.0.1:${address.port}`, token: 'fixture-owner-token' },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}
const view = (selection = { mode: 'service-local', hostId: null }) => ({
  revision: 3,
  selection,
  phase: 'disabled',
  error: null,
  peer: { unverified: true },
  sources: [{ unverified: true }],
});
test('fixed local-host HTTP returns only a rebuilt validated selection receipt', async () => {
  const f = await fixture((response) => response.end(JSON.stringify({ ok: true, value: view() })));
  try {
    const result = await getLocalHostSelection(f.transport, AbortSignal.timeout(2000));
    assert.deepEqual(result, {
      ok: true,
      value: {
        revision: 3,
        selection: { mode: 'service-local', hostId: null },
        phase: 'disabled',
        error: null,
      },
    });
    assert.deepEqual(f.seen, [
      {
        method: 'GET',
        url: '/api/local-host',
        authorization: 'Bearer fixture-owner-token',
        body: '',
      },
    ]);
  } finally {
    await f.close();
  }
});
test('selection sends the captured CAS once and preserves conflict without another read or write', async () => {
  const f = await fixture((response) =>
    response.writeHead(409).end(JSON.stringify({ ok: false, error: { code: 'conflict' } })),
  );
  try {
    const command = { expectedRevision: 3, selection: { mode: 'remote-host', hostId: 'this-pc' } };
    const result = await selectLocalHost(f.transport, command, AbortSignal.timeout(2000));
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'conflict');
    assert.equal(f.seen.length, 1);
    assert.equal(f.seen[0].url, '/api/local-host');
    assert.deepEqual(JSON.parse(f.seen[0].body), command);
  } finally {
    await f.close();
  }
});
test('malformed selection identity never reaches the typed receipt', async () => {
  const f = await fixture((response) =>
    response.end(JSON.stringify({ ok: true, value: view({ mode: 'remote-host', hostId: '' }) })),
  );
  try {
    assert.equal((await getLocalHostSelection(f.transport, AbortSignal.timeout(2000))).ok, false);
  } finally {
    await f.close();
  }
});
