import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { JsonObject, PluginManifest } from '@pet/contracts';
import { definePlugin } from '@pet/plugin-sdk';
import {
  CompanionPluginHost,
  companionHostDefinition,
  companionHostManifest,
} from '@pet/companion-runtime';
import type { ResponseClient } from '@pet/harness-cortico';
import { createAuthorizedModelClient } from './model-client.js';

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const sourceId = 'pet.harness-cortico';
const sourceIdentity = { pluginId: sourceId, instanceId: 'default' };
const secret = 'operator-provisioned-model-canary-671d6b3e';
const request: Parameters<ResponseClient['respond']>[0] = {
  model: 'fixture-model',
  input: [{ type: 'message', role: 'user', content: 'Hello' }],
};
const response = (text = 'Fixture reply', status = 'completed') => ({
  id: 'response-fixture',
  model: 'fixture-model',
  status,
  output: [
    {
      id: 'message-fixture',
      type: 'message',
      role: 'assistant',
      status,
      content: [{ type: 'output_text', text, annotations: [] }],
    },
  ],
});
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});

async function fixture(
  handle: (response: ServerResponse, body: JsonObject) => void,
  declareCredentials = true,
) {
  const directory = await mkdtemp(path.join(tmpdir(), 'companion-model-authority-'));
  const sourceManifest = JSON.parse(
    await readFile(
      new URL('../../../plugins/harness-cortico/plugin.json', import.meta.url),
      'utf8',
    ),
  ) as PluginManifest;
  const plugins = await Promise.all(
    [
      companionHostManifest,
      {
        ...sourceManifest,
        permissions:
          sourceManifest.permissions?.filter(
            (permission) => declareCredentials || permission.kind !== 'credentials',
          ) ?? [],
      },
    ].map(async (manifest) => {
      const pluginDirectory = path.join(directory, manifest.id);
      await mkdir(pluginDirectory);
      await writeFile(path.join(pluginDirectory, 'plugin.json'), JSON.stringify(manifest));
      return {
        manifest,
        directory: pluginDirectory,
        enabled: true,
        preset: 'allow' as const,
        ...(manifest.id === sourceId ? { hostCredentials: ['model-api-key'] } : {}),
        definition:
          manifest.id === companionHostManifest.id
            ? companionHostDefinition
            : definePlugin({
                activate(context) {
                  context.provide('cortico', {
                    status: async () => null,
                    accept: async () => null,
                    stopForeground: async () => null,
                  });
                },
              }),
      };
    }),
  );
  const host = await CompanionPluginHost.create({
    dataDirectory: path.join(directory, 'data'),
    plugins,
  });
  const requests: Array<{ authorization: string | undefined; body: JsonObject }> = [];
  const server = createServer((incoming, outgoing) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as JsonObject;
      requests.push({ authorization: incoming.headers.authorization, body });
      handle(outgoing, body);
    })().catch(() => outgoing.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  const model = createAuthorizedModelClient(host, sourceId, {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    apiKey: secret,
  });
  cleanups.push(async () => {
    await model.close();
    await host.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  return { host, model, requests, directory };
}

async function assertNoSecretFiles(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await assertNoSecretFiles(file);
    else if (entry.isFile())
      expect((await readFile(file)).includes(Buffer.from(secret))).toBe(false);
  }
}

it('borrows for the source and preserves native/private generation options without persisting a key', async () => {
  const f = await fixture((outgoing) => {
    outgoing.writeHead(200, { 'Content-Type': 'application/json' });
    outgoing.end(JSON.stringify(response()));
  });
  const quote = vi.fn(() => []);
  const origin = {
    instance: 'fixture',
    module: 'native',
    model: 'fixture-model',
    compatibilityDomain: 'fixture',
  };
  const generateOptions = {
    sessionId: 'private-cache-key',
    role: 'foreground',
    diagnostic: true,
    origin,
    quote,
  };
  const result = await f.model.client.respond(request, generateOptions);
  expect(result.origin).toEqual(origin);
  expect(result.attempts).toHaveLength(1);
  expect(quote).toHaveBeenCalledOnce();
  expect(f.requests).toEqual([
    {
      authorization: `Bearer ${secret}`,
      body: expect.objectContaining({
        model: 'fixture-model',
        stream: false,
        store: false,
        prompt_cache_key: 'private-cache-key',
      }),
    },
  ]);
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(f.host.permissionControl.snapshotAudit().entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        owner: expect.objectContaining({ pluginId: sourceId }),
        kind: 'credentials',
        event: 'approved',
      }),
    ]),
  );
  expect(f.host.permissions.diagnostics().leases).toBe(0);
  await assertNoSecretFiles(f.directory);
});

it.each(['undeclared', 'denied', 'changed-source'] as const)(
  'rejects %s model borrowing before HTTP I/O',
  async (mode) => {
    const f = await fixture(
      (outgoing) => outgoing.end(JSON.stringify(response())),
      mode !== 'undeclared',
    );
    if (mode === 'denied') f.host.permissionControl.setPreset(sourceIdentity, 'deny');
    if (mode === 'changed-source')
      await writeFile(path.join(f.directory, sourceId, 'changed.txt'), 'changed package');
    await expect(f.model.client.respond(request)).rejects.toMatchObject({
      code: 'permission-denied',
    });
    expect(f.requests).toHaveLength(0);
    expect(f.host.permissions.diagnostics().leases).toBe(0);
    await assertNoSecretFiles(f.directory);
  },
);

it.each(['source-revoked', 'caller-aborted'] as const)(
  'cancels real model I/O on %s and retains the native partial error',
  async (mode) => {
    const receivedDelta = deferred();
    const socketClosed = deferred();
    const f = await fixture((outgoing) => {
      outgoing.on('close', socketClosed.resolve);
      outgoing.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const events = [
        { type: 'response.created', response: { ...response('', 'in_progress'), output: [] } },
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: {
            id: 'partial-message',
            type: 'message',
            role: 'assistant',
            status: 'in_progress',
            content: [],
          },
        },
        {
          type: 'response.content_part.added',
          output_index: 0,
          item_id: 'partial-message',
          content_index: 0,
          part: { type: 'output_text', text: '', annotations: [] },
        },
        {
          type: 'response.output_text.delta',
          output_index: 0,
          item_id: 'partial-message',
          content_index: 0,
          delta: 'retained partial',
          logprobs: [],
        },
      ];
      for (const [sequence_number, event] of events.entries())
        outgoing.write(`data: ${JSON.stringify({ ...event, sequence_number })}\n\n`);
    });
    const caller = new AbortController();
    const running = f.model.client.respond(request, {
      signal: caller.signal,
      onEvent(event) {
        if (event.type === 'response.output_text.delta') receivedDelta.resolve();
      },
    });
    const observed = running.catch((error: unknown) => error);
    await receivedDelta.promise;
    if (mode === 'source-revoked') f.host.permissionControl.revoke(sourceIdentity);
    else caller.abort();
    const error = await observed;
    await socketClosed.promise;
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: 'GenerationError',
      partial: {
        id: 'response-fixture',
        output: [
          expect.objectContaining({
            content: [{ type: 'output_text', text: 'retained partial', annotations: [] }],
          }),
        ],
      },
      attempts: [expect.objectContaining({ outcome: 'aborted', responseId: 'response-fixture' })],
    });
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(f.requests).toHaveLength(1);
    expect(f.host.tasks.diagnostics().pendingWork).toBe(0);
    expect(f.host.permissions.diagnostics().leases).toBe(0);
    await assertNoSecretFiles(f.directory);
  },
);

it('borrows the current owner generation after the Harness is replaced', async () => {
  const f = await fixture((outgoing) => {
    outgoing.writeHead(200, { 'Content-Type': 'application/json' });
    outgoing.end(JSON.stringify(response()));
  });
  const firstOwner = f.host.owner(sourceId);
  await f.model.client.respond(request);
  await f.host.setEnabled(sourceId, false);
  await f.host.setEnabled(sourceId, true);
  expect(f.host.owner(sourceId).generation).toBeGreaterThan(firstOwner.generation);
  expect((await f.model.client.respond(request)).response.id).toBe('response-fixture');
  expect(f.requests).toHaveLength(2);
});

it.each([false, true])(
  'preserves native HTTP errors and filters secret-bearing error bodies (%s)',
  async (leaksSecret) => {
    const body = leaksSecret ? `reflected ${secret}` : 'fixture bad request';
    const f = await fixture((outgoing) => {
      outgoing.writeHead(400);
      outgoing.end(body);
    });
    const error: unknown = await f.model.client
      .respond(request)
      .catch((failure: unknown) => failure);
    if (leaksSecret) expect(error).toMatchObject({ error: { code: 'permission-denied' } });
    else
      expect(error).toMatchObject({
        name: 'GenerationError',
        status: 400,
        body,
        attempts: [expect.objectContaining({ status: 400, outcome: 'failed' })],
      });
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(f.requests).toHaveLength(1);
    await assertNoSecretFiles(f.directory);
  },
);
