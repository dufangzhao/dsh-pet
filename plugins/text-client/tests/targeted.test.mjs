import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { CompanionClient } from '../src/client/client.ts';
import { getTask, parseSnapshot } from '../src/protocol.ts';
import { snapshot, task } from './fixtures.mjs';

async function peer() {
  let receiptTask = null;
  let detail = task();
  const commands = [];
  const server = createServer((request, response) => {
    if (request.url.startsWith('/api/events')) {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(': keepalive\n\n');
      return;
    }
    if (request.url === '/api/snapshot') {
      response.end(JSON.stringify({ ok: true, value: snapshot({ tasks: [task()] }) }));
      return;
    }
    if (request.url === '/api/tasks/task-1') {
      response.end(JSON.stringify({ ok: true, value: detail }));
      return;
    }
    if (request.url === '/api/tasks/task-1/stop') {
      let body = '';
      request.on('data', (chunk) => {
        body += chunk;
      });
      request.on('end', () => {
        const command = JSON.parse(body);
        commands.push(command);
        response.end(
          JSON.stringify({
            ok: true,
            value: {
              commandId: command.commandId,
              taskId: receiptTask,
              messageId: null,
              status: 'accepted',
            },
          }),
        );
      });
      return;
    }
    response.writeHead(404).end('{}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    commands,
    receiptTask: (id) => {
      receiptTask = id;
    },
    detail: (next) => {
      detail = next;
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
for (const wrong of [null, 'another-task']) {
  test(`wrong stop receipt task ${wrong} stays uncertain and retries its original command ID over HTTP`, async () => {
    const f = await peer();
    const client = new CompanionClient({ baseUrl: f.url, newCommandId: () => 'one-stop-intent' });
    try {
      await client.connect('fixture-token');
      f.receiptTask(wrong);
      await client.requestStop('task-1');
      assert.equal(client.getState().stops['task-1'].uncertain, true);
      f.receiptTask('task-1');
      await client.requestStop('task-1');
      assert.equal(client.getState().stops['task-1'].uncertain, false);
      assert.deepEqual(
        f.commands.map((command) => command.commandId),
        ['one-stop-intent', 'one-stop-intent'],
      );
    } finally {
      client.dispose();
      await f.close();
    }
  });
}
test('HTTP task details reject another task and cross-task artifact metadata', async () => {
  const f = await peer();
  const artifact = {
    id: 'artifact',
    taskId: 'another-task',
    name: 'file.txt',
    sizeBytes: 1,
    mediaType: 'text/plain',
  };
  try {
    f.detail(task({ id: 'another-task', artifacts: [artifact] }));
    assert.equal((await getTask({ baseUrl: f.url, token: 'fixture' }, 'task-1')).ok, false);
    f.detail(task({ artifacts: [artifact] }));
    assert.equal((await getTask({ baseUrl: f.url, token: 'fixture' }, 'task-1')).ok, false);
    assert.equal(parseSnapshot(snapshot({ tasks: [task({ artifacts: [artifact] })] })).ok, false);
  } finally {
    await f.close();
  }
});
