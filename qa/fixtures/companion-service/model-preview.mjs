// Real companion HTTP/Core/SQLite/Docker composition with a controlled loopback protocol peer.
// This peer is not Magpie and does not call an upstream model. Credentials stay in a private file.
import { randomUUID } from 'node:crypto';
import { createServer, request as proxyRequest } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFixtureModelClient } from '../../../packages/companion-runtime/src/fixture-model.ts';
import { createCompanionService } from '../../../apps/companion-service/src/service.ts';

const directory = await mkdtemp(path.join(tmpdir(), 'companion-model-browser-'));
const token = randomUUID() + randomUUID();
const gatewayKey = randomUUID() + randomUUID();
const native = createFixtureModelClient();
const seenWork = new Set();
const calls = [];
let closedStreams = 0;
const gateway = createServer((incoming, outgoing) => {
  void (async () => {
    if (incoming.method === 'GET' && incoming.url === '/stats') {
      outgoing.writeHead(200, { 'Content-Type': 'application/json' });
      outgoing.end(JSON.stringify({ calls, closedStreams }));
      return;
    }
    if (incoming.method !== 'POST' || incoming.url !== '/v1/responses') {
      outgoing.writeHead(404);
      outgoing.end();
      return;
    }
    const parts = [];
    for await (const part of incoming) parts.push(Buffer.from(part));
    const request = JSON.parse(Buffer.concat(parts).toString('utf8'));
    const auth = incoming.headers.authorization;
    calls.push({ model: request.model, stream: request.stream === true, at: Date.now() });
    if (auth !== 'Bearer magpie-dsh-pet' && auth !== `Bearer ${gatewayKey}`) {
      outgoing.writeHead(401, { 'Content-Type': 'application/json' });
      outgoing.end(
        JSON.stringify({ error: { message: 'Controlled gateway authentication refused' } }),
      );
      return;
    }
    if (request.model === 'loopback-error') {
      outgoing.writeHead(400, { 'Content-Type': 'application/json' });
      outgoing.end(JSON.stringify({ error: { message: 'Controlled unsupported model' } }));
      return;
    }
    if (request.model === 'loopback-hang') {
      outgoing.writeHead(200, { 'Content-Type': 'text/event-stream' });
      outgoing.write(': deliberately pending protocol fixture\n\n');
      outgoing.once('close', () => {
        closedStreams++;
      });
      return;
    }
    const generation = await native.respond({ model: request.model, input: [] });
    let output = generation.response.output.map((item) => ({
      ...item,
      content: [
        {
          type: 'output_text',
          text: '回环协议联调回复：OK（未调用真实模型）。',
          annotations: [],
          logprobs: [],
        },
      ],
    }));
    const input = latestInput(request.input);
    const start = request.tools?.find(
      (tool) => tool.type === 'function' && /start_work$/.test(tool.name),
    );
    if (input?.kind === 'user' && /联调报表/.test(input.text) && !seenWork.has(input.id) && start) {
      seenWork.add(input.id);
      const callId = randomUUID();
      output = [
        {
          type: 'function_call',
          id: `item-${callId}`,
          call_id: callId,
          name: start.name,
          status: 'completed',
          arguments: JSON.stringify({
            inputId: input.id,
            title: '回环模型协议报表（非真实模型）',
            code: "import { writeFileSync } from 'node:fs'; await new Promise(r => setTimeout(r, 3000)); writeFileSync('summary.md', '# 支出汇总\\n\\n总计：25\\n'); writeFileSync('items.csv', 'name,amount\\nA,12\\nB,8\\nC,5\\n'); console.log('total=25');",
            outputs: [
              { path: 'summary.md', mediaType: 'text/markdown' },
              { path: 'items.csv', mediaType: 'text/csv' },
            ],
          }),
        },
      ];
    }
    const completed = { ...generation.response, model: request.model, output };
    if (request.stream === true) {
      const events = [
        {
          type: 'response.created',
          sequence_number: 0,
          response: { ...completed, status: 'in_progress', output: [] },
        },
      ];
      for (const [index, item] of output.entries()) {
        events.push({
          type: 'response.output_item.added',
          sequence_number: events.length,
          output_index: index,
          item: { ...item, status: 'in_progress' },
        });
        events.push({
          type: 'response.output_item.done',
          sequence_number: events.length,
          output_index: index,
          item,
        });
      }
      events.push({
        type: 'response.completed',
        sequence_number: events.length,
        response: completed,
      });
      outgoing.writeHead(200, { 'Content-Type': 'text/event-stream' });
      outgoing.end(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''));
    } else {
      outgoing.writeHead(200, { 'Content-Type': 'application/json' });
      outgoing.end(JSON.stringify(completed));
    }
  })().catch((error) => {
    console.error(
      'Loopback protocol fixture failed:',
      error instanceof Error ? error.name : 'unknown',
    );
    outgoing.destroy();
  });
});

function latestInput(items = []) {
  let latest = null;
  for (const item of items) {
    if (item.type !== 'message') continue;
    const text =
      typeof item.content === 'string'
        ? item.content
        : (item.content ?? []).map((part) => part.text ?? '').join('\n');
    for (const candidate of text.matchAll(/\{[^\n]*"source":"companion\.service"[^\n]*\}/g)) {
      try {
        const value = JSON.parse(candidate[0]);
        if (typeof value.id === 'string' && typeof value.text === 'string') latest = value;
      } catch {
        /* Other transcript JSON is not a companion ingress envelope. */
      }
    }
  }
  return latest;
}

await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
const address = gateway.address();
if (!address || typeof address === 'string') throw new Error('Missing protocol fixture address');
const gatewayBaseUrl = `http://127.0.0.1:${address.port}/v1`;
let upstreamUrl = '';
// A loopback-only test proxy supplies a non-loopback authority to exercise the real read-only projection.
const readonlyProxy = createServer((incoming, outgoing) => {
  if (!upstreamUrl) {
    outgoing.writeHead(503);
    outgoing.end();
    return;
  }
  const request = proxyRequest(
    upstreamUrl + incoming.url,
    {
      method: incoming.method,
      headers: { ...incoming.headers, host: 'readonly-model-test.invalid' },
    },
    (response) => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(outgoing);
    },
  );
  request.on('error', () => outgoing.destroy());
  outgoing.once('close', () => request.destroy());
  incoming.pipe(request);
});
await new Promise((resolve) => readonlyProxy.listen(0, '127.0.0.1', resolve));
const proxyAddress = readonlyProxy.address();
if (!proxyAddress || typeof proxyAddress === 'string')
  throw new Error('Missing readonly proxy address');
const readonlyUrl = `http://127.0.0.1:${proxyAddress.port}`;
const service = await createCompanionService({
  dataDirectory: path.join(directory, 'profile'),
  token,
  port: 0,
  publicOrigin: readonlyUrl,
  mode: 'scripted',
  ...(process.env.PET_CLOUD_EXEC_IMAGE ? { image: process.env.PET_CLOUD_EXEC_IMAGE } : {}),
});
upstreamUrl = service.url;
const infoPath = path.join(directory, 'connection.json');
await writeFile(
  infoPath,
  JSON.stringify({
    url: service.url,
    token,
    gatewayBaseUrl,
    gatewayKey,
    readonlyUrl,
    model: 'loopback-ok',
    unsupportedModel: 'loopback-error',
    hangingModel: 'loopback-hang',
    statsUrl: `http://127.0.0.1:${address.port}/stats`,
    dataDirectory: path.join(directory, 'profile'),
  }),
  { mode: 0o600, flag: 'wx' },
);
console.log(
  JSON.stringify({
    url: service.url,
    infoPath,
    protocolFixture: gatewayBaseUrl,
    realUpstream: false,
  }),
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  try {
    readonlyProxy.closeAllConnections();
    await new Promise((resolve, reject) =>
      readonlyProxy.close((error) => (error ? reject(error) : resolve())),
    );
    await service.close();
    gateway.closeAllConnections();
    await new Promise((resolve, reject) =>
      gateway.close((error) => (error ? reject(error) : resolve())),
    );
    console.log('Model API preview closed');
  } catch {
    console.error('Model API preview cleanup was not fully confirmed');
    process.exitCode = 1;
  }
}
process.once('SIGTERM', () => void stop());
process.once('SIGINT', () => void stop());
