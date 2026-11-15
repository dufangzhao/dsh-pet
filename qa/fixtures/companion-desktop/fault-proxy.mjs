import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';

// Faults affect the wire to the actual isolated service, never a replacement desktop bridge.
// Authorization is forwarded only to that loopback service and is never recorded.
export async function waitForFault(observed, label) {
  let timer;
  try {
    return await Promise.race([
      observed,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), 15000); }),
    ]);
  } finally { clearTimeout(timer); }
}

export async function startFaultProxy(serviceUrl) {
  const target = new URL(serviceUrl);
  assert.equal(target.protocol, 'http:');
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(target.pathname, '/');
  const counts = new Map();
  const streams = new Set();
  const sockets = new Set();
  let next = null;
  const server = http.createServer((request, response) => {
    const route = new URL(request.url, 'http://127.0.0.1').pathname;
    counts.set(route, (counts.get(route) ?? 0) + 1);
    const fault = next?.route === route ? next : null;
    if (fault) next = null;
    const upstream = http.request({ hostname: target.hostname, port: target.port,
      method: request.method, path: request.url,
      headers: { ...request.headers, host: target.host } }, (incoming) => {
      if (!fault) {
        response.writeHead(incoming.statusCode, incoming.headers);
        if (route === '/api/events') {
          const stream = { incoming, response };
          streams.add(stream);
          incoming.once('close', () => streams.delete(stream));
          response.once('close', () => incoming.destroy());
        }
        incoming.pipe(response);
        incoming.on('error', () => response.destroy());
        return;
      }
      const chunks = [];
      let size = 0;
      incoming.on('data', (chunk) => {
        size += chunk.length;
        if (size > 80 * 1024) incoming.destroy(new Error('Fault response exceeds fixture limit'));
        else chunks.push(chunk);
      });
      incoming.on('error', (error) => { fault.reject(error); response.destroy(); });
      incoming.on('end', () => {
        const original = Buffer.concat(chunks);
        // Upstream bytes have already been serialized before a delayed release.
        fault.ready({ status: incoming.statusCode, bytes: original.length });
        if (fault.mode === 'drop') { response.destroy(); return; }
        const body = fault.mode === 'invalid' ? Buffer.from('{"invalid":true}') : original;
        const headers = { ...incoming.headers, 'content-length': String(body.length) };
        delete headers['transfer-encoding'];
        const deliver = () => {
          if (!response.destroyed) { response.writeHead(incoming.statusCode, headers); response.end(body); }
        };
        if (fault.mode === 'hold') fault.deliver = deliver;
        else deliver();
      });
    });
    upstream.on('error', (error) => {
      if (fault) fault.reject(error);
      response.destroy();
    });
    request.on('aborted', () => upstream.destroy());
    request.pipe(upstream);
  });
  server.on('connection', (socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    url: `http://127.0.0.1:${address.port}`,
    count: (route) => counts.get(route) ?? 0,
    streamCount: () => streams.size,
    // Arm one JSON response. The returned promise resolves when upstream has finished serializing it.
    arm(route, mode) {
      assert.equal(next, null, 'a fault is already armed');
      assert.ok(route.startsWith('/api/') && !route.includes('?'));
      assert.ok(['hold', 'drop', 'invalid'].includes(mode));
      let ready, reject;
      const observed = new Promise((resolve, fail) => { ready = resolve; reject = fail; });
      const fault = { route, mode, ready, reject, deliver: null };
      next = fault;
      return { observed, release() { assert.equal(typeof fault.deliver, 'function', 'response not held yet'); fault.deliver(); } };
    },
    endStreams() {
      for (const stream of streams) { stream.incoming.destroy(); stream.response.destroy(); }
    },
    async close() {
      for (const stream of streams) { stream.incoming.destroy(); stream.response.destroy(); }
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
