import { afterEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { saveCompanionArtifact } from './companion-artifact.js';
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function setup(hang = false) {
  const directory = await mkdtemp(path.join(tmpdir(), 'companion-artifact-test-'));
  cleanup.push(async () => {
    if (
      path.dirname(directory) !== tmpdir() ||
      !path.basename(directory).startsWith('companion-artifact-test-')
    )
      throw new Error('Unexpected temporary directory');
    await rm(directory, { recursive: true });
  });
  let calls = 0;
  let closed = false;
  const server = createServer((request, response) => {
    calls++;
    expect(request.url).toBe('/api/artifacts/artifact-1');
    expect(request.headers.authorization).toBe('Bearer isolated-auth-token');
    response.on('close', () => {
      closed = true;
    });
    response.writeHead(200, { 'content-length': '6' });
    response.write('abc');
    if (!hang) response.end('def');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  cleanup.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing address');
  return {
    directory,
    target: path.join(directory, 'result.txt'),
    transport: { baseUrl: `http://127.0.0.1:${address.port}`, token: 'isolated-auth-token' },
    artifact: {
      id: 'artifact-1',
      taskId: 'task-1',
      name: 'result.txt',
      mediaType: 'text/plain',
      sizeBytes: 6,
    },
    calls: () => calls,
    closed: () => closed,
  };
}
it('authenticates and saves verified bytes without a token URL or JSON file transfer', async () => {
  const fixture = await setup();
  const result = await saveCompanionArtifact(
    fixture.transport,
    fixture.artifact,
    { choose: async () => fixture.target },
    1,
    new AbortController().signal,
    () => true,
  );
  expect(result).toEqual({
    ok: true,
    value: { status: 'saved', name: 'result.txt', sizeBytes: 6 },
  });
  expect(await readFile(fixture.target, 'utf8')).toBe('abcdef');
  expect(await readdir(fixture.directory)).toEqual(['result.txt']);
});
it('a retired native chooser cannot initiate network I/O or publish a file', async () => {
  const fixture = await setup();
  let chosen = false;
  let current = true;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const result = saveCompanionArtifact(
    fixture.transport,
    fixture.artifact,
    {
      choose: async () => {
        chosen = true;
        await gate;
        return fixture.target;
      },
    },
    1,
    new AbortController().signal,
    () => current,
  );
  await vi.waitFor(() => expect(chosen).toBe(true));
  current = false;
  release();
  expect(await result).toMatchObject({ ok: false, error: { code: 'stale-owner' } });
  expect(fixture.calls()).toBe(0);
  expect(await readdir(fixture.directory)).toEqual([]);
});
it('retiring a live byte stream aborts the socket and removes only its owned temporary file', async () => {
  const fixture = await setup(true);
  const abort = new AbortController();
  const result = saveCompanionArtifact(
    fixture.transport,
    fixture.artifact,
    { choose: async () => fixture.target },
    1,
    abort.signal,
    () => !abort.signal.aborted,
  ).catch(() => null);
  await vi.waitFor(() => expect(fixture.calls()).toBe(1));
  abort.abort();
  expect(await result).not.toMatchObject({ ok: true });
  await vi.waitFor(() => expect(fixture.closed()).toBe(true));
  expect(await readdir(fixture.directory)).toEqual([]);
});
