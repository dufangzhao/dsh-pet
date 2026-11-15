import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';

// Loopback-only wire gate for real POST replies; never replaces service/Main/renderer behavior.
export async function startResponseGate(serviceUrl) {
  const target = new URL(serviceUrl);
  assert.equal(target.protocol, 'http:'); assert.equal(target.hostname, '127.0.0.1');
  assert.equal(target.pathname, '/');
  const sockets = new Set();
  let armed = null;
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const gate = request.method === 'POST' && armed?.path === pathname ? armed : null;
    if (gate) armed = null;
    const upstream = http.request({ hostname: target.hostname, port: target.port, method: request.method,
      path: request.url, headers: { ...request.headers, host: target.host } }, (incoming) => {
      incoming.on('error', (error) => { gate?.reject(error); response.destroy(); });
      response.once('close', () => incoming.destroy());
      if (!gate) { response.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(response); return; }
      const chunks = [];
      let size = 0;
      incoming.on('data', (chunk) => {
        size += chunk.length;
        if (size > 64 * 1024) incoming.destroy(new Error('Gated response exceeds wire budget'));
        else chunks.push(chunk);
      });
      incoming.on('end', () => {
        const body = Buffer.concat(chunks);
        gate.release = () => {
          if (response.destroyed) return false;
          response.writeHead(incoming.statusCode, incoming.headers); response.end(body);
          return true;
        };
        gate.resolve({ method: request.method, path: pathname, status: incoming.statusCode, size });
      });
    });
    upstream.on('error', (error) => { gate?.reject(error); response.destroy(); });
    request.on('aborted', () => upstream.destroy());
    request.pipe(upstream);
  });
  server.on('connection', (socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  return {
    url: `http://127.0.0.1:${address.port}`,
    arm(pathname) {
      assert.equal(armed, null);
      assert.ok(['/api/profile', '/api/facts'].includes(pathname));
      let resolve, reject;
      const observed = new Promise((done, fail) => { resolve = done; reject = fail; });
      const gate = { path: pathname, resolve, reject, release: null };
      armed = gate;
      return { observed, release() { assert.equal(typeof gate.release, 'function'); return gate.release(); } };
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
