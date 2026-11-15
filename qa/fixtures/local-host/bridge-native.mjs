import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
const { WebSocketServer } = createRequire(
  new URL('../../../packages/local-host/package.json', import.meta.url),
)('ws');
import { deferred, sha } from './bridge-common.mjs';

/** Actual loopback HTTP/WS peers. Responses are controlled, transport and bytes are real. */
export async function createNativePeer() {
  const messages = [],
    uploads = [],
    errors = [],
    sockets = new Set();
  const identified = deferred();
  let inspectClaim = async () => {
    throw new Error('Native business IO without an expected State claim');
  };
  let claimObservations = 0;
  const server = createServer((request, response) => {
    void (async () => {
      const chunks = [];
      for await (const bytes of request) chunks.push(bytes);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
      let result;
      if (/^\/v2\/users\//u.test(request.url)) {
        await inspectClaim();
        claimObservations++;
      }
      if (request.url === '/app/getAppAccessToken') {
        assert.equal(body.clientSecret, 'CONTROLLED_QQ_SECRET_CANARY');
        result = { access_token: 'controlled-access-token', expires_in: 7200 };
      } else if (request.url === '/gateway') result = { url: 'wss://gateway.qq.com/controlled' };
      else if (/^\/v2\/users\/qa-recipient\/files$/u.test(request.url)) {
        assert.equal(body.srv_send_msg, false);
        const bytes = Buffer.from(body.file_data, 'base64');
        assert(bytes.length > 0);
        assert.equal(bytes.toString('base64'), body.file_data);
        const fileInfo = `PRIVATE_LOCAL_FILE_INFO_CANARY-${uploads.length + 1}`;
        uploads.push({ bytes, sha256: sha(bytes), fileInfo });
        result = { file_uuid: `native-file-${uploads.length}`, file_info: fileInfo, ttl: 600 };
      } else if (/^\/v2\/users\/qa-recipient\/messages$/u.test(request.url)) {
        if (body.msg_type === 7)
          assert(uploads.some((value) => value.fileInfo === body.media.file_info));
        const id = `native-message-${messages.length + 1}`;
        messages.push({ id, body });
        result = { id, timestamp: new Date().toISOString() };
      } else throw new Error(`Unexpected controlled native path ${request.url}`);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(result));
    })().catch((error) => {
      errors.push(error);
      response.destroy();
    });
  });
  const gateway = new WebSocketServer({ server });
  gateway.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 60000 } }));
    socket.on('message', (bytes) => {
      const frame = JSON.parse(bytes.toString());
      if (frame.op === 2) {
        socket.send(
          JSON.stringify({
            op: 0,
            t: 'READY',
            s: 1,
            d: { session_id: 'controlled-native-session', user: { id: 'controlled-native-bot' } },
          }),
        );
        identified.resolve();
      } else if (frame.op === 1) socket.send(JSON.stringify({ op: 11 }));
      else if (frame.op === 6) throw new Error('Unexpected native resume in bridge-only reconnect');
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing native peer address');
  return {
    url: `http://127.0.0.1:${address.port}`,
    messages,
    uploads,
    errors,
    identified: identified.promise,
    expectClaim(check) {
      inspectClaim = check;
    },
    get claimObservations() {
      return claimObservations;
    },
    async close() {
      const closed = [...sockets].map((socket) => {
        const ended = once(socket, 'close');
        socket.terminate();
        return ended;
      });
      await Promise.all(closed);
      await new Promise((resolve, reject) =>
        gateway.close((error) => (error ? reject(error) : resolve())),
      );
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
