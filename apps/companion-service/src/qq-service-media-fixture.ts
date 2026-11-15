import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { watch } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import WebSocket from 'ws';
import { expect } from 'vitest';
import {
  QQ_ONEBOT_PLUGIN_ID,
  VOICE_ASR_PROVIDER,
  SPEECH_TTS_PROVIDER,
  isQQView,
  type JsonObject,
  type QQView,
  type QQInputReceipt,
  type QQDeliveryView,
} from '@pet/contracts';
import { KernelFault } from '@pet/host-kernel';
import { createFixtureModelClient, type RuntimeInputTerminal } from '@pet/companion-runtime';
import type { ResponseClient } from '@pet/harness-cortico';
import { createCompanionService, type CompanionService } from './service.js';
import { deliveryId } from './qq-delivery-plan.js';

export const CLOUD_IMAGE =
  'sha256:a9975a0df83b07f6ef3a57098174a8303cb0e322570e1d2f175ceba33f417a72';
export const hashBytes = (value: Uint8Array): string =>
  createHash('sha256').update(value).digest('hex');
export function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
export async function bounded<T>(
  work: Promise<T>,
  label: string,
  milliseconds = 30000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
export function pngBytes(): Buffer {
  const chunk = (kind: string, data: Buffer): Buffer => {
    const result = Buffer.alloc(data.length + 12);
    result.writeUInt32BE(data.length);
    result.write(kind, 4);
    data.copy(result, 8);
    result.writeUInt32BE(crc32(result.subarray(4, result.length - 4)), result.length - 4);
    return result;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, 0, 255, 0, 255]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
export function waveBytes(seconds = 0.25, rate = 16000): Buffer {
  const frames = Math.round(seconds * rate),
    bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(frames * 2, 40);
  for (let at = 0; at < frames; at++)
    bytes.writeInt16LE(Math.round(10000 * Math.sin((at * 2 * Math.PI * 220) / rate)), 44 + at * 2);
  return bytes;
}
export interface CurrentInput {
  id: string;
  text: string;
  kind: 'user' | 'work-result';
  taskId?: string;
}
export interface ModelTurn {
  readonly request: Parameters<ResponseClient['respond']>[0];
  readonly options: Parameters<ResponseClient['respond']>[1];
  readonly input: CurrentInput;
  readonly reference: {
    materials?: Array<{ id: string; kind: string; name: string; sizeBytes: number }>;
  };
  readonly history: {
    tasks?: Array<{ id: string; status: string; artifacts: Array<{ id: string; name: string }> }>;
  };
  readonly step: number;
}
export type NativeOutput = Awaited<ReturnType<ResponseClient['respond']>>['response']['output'];
export function tool(name: string, args: JsonObject): NativeOutput[number] {
  return {
    type: 'function_call',
    id: randomUUID(),
    call_id: randomUUID(),
    name,
    arguments: JSON.stringify(args),
    status: 'completed',
  };
}
function texts(request: ModelTurn['request']): string[] {
  if (!Array.isArray(request.input)) throw new Error('Native input is not an item list');
  return request.input.flatMap((item) =>
    item.type === 'message' && Array.isArray(item.content)
      ? item.content.flatMap((part) => (part.type === 'input_text' ? [part.text] : []))
      : [],
  );
}
export function syntheticModel(script: (turn: ModelTurn) => NativeOutput | Promise<NativeOutput>): {
  client: ResponseClient;
  calls: ModelTurn[];
} {
  const base = createFixtureModelClient(),
    calls: ModelTurn[] = [],
    steps = new Map<string, number>();
  const client: ResponseClient = {
    async respond(request, options = {}) {
      options.signal?.throwIfAborted();
      const source = texts(request);
      let input: CurrentInput | undefined;
      for (const value of source) {
        try {
          const parsed: unknown = JSON.parse(value);
          if (
            parsed &&
            typeof parsed === 'object' &&
            'source' in parsed &&
            parsed.source === 'companion.service' &&
            'id' in parsed &&
            typeof parsed.id === 'string' &&
            'text' in parsed &&
            typeof parsed.text === 'string' &&
            'kind' in parsed &&
            (parsed.kind === 'user' || parsed.kind === 'work-result')
          ) {
            input = {
              id: parsed.id,
              text: parsed.text,
              kind: parsed.kind,
              ...('taskId' in parsed && typeof parsed.taskId === 'string'
                ? { taskId: parsed.taskId }
                : {}),
            };
          }
        } catch {
          /* Historical projection text is not the current native input JSON. */
        }
      }
      if (!input) throw new Error('Missing current input in actual Core request');
      const parsedPart = (prefix: string): unknown => {
        const found = source.find((value) => value.startsWith(prefix));
        return found ? JSON.parse(found.slice(found.indexOf('\n') + 1)) : {};
      };
      const step = steps.get(input.id) ?? 0;
      steps.set(input.id, step + 1);
      const turn: ModelTurn = {
        request,
        options,
        input,
        step,
        reference: parsedPart(
          `Reference data for current input ${input.id}:`,
        ) as ModelTurn['reference'],
        history: parsedPart('Previously committed visible product context') as ModelTurn['history'],
      };
      calls.push(turn);
      const output = await script(turn);
      options.signal?.throwIfAborted();
      const value = await base.respond(request, options);
      return {
        ...value,
        response: { ...value.response, output },
        attempts: [
          {
            id: randomUUID(),
            generationId: value.response.id,
            ordinal: 0,
            origin: value.origin,
            startedAt: new Date().toISOString(),
            elapsedMs: 0,
            requestId: null,
            responseId: value.response.id,
            outcome: 'completed',
            status: null,
            serviceTier: null,
            purpose: 'generation',
            charges: [],
            meters: {
              input: null,
              output: null,
              total: null,
              cachedInput: null,
              uncachedInput: null,
              reasoning: null,
              native: null,
            },
          },
        ],
      };
    },
  };
  return { client, calls };
}
interface Packet {
  action: string;
  params: Record<string, unknown>;
  echo: string;
}
interface Asset {
  name: string;
  bytes: Buffer;
}
interface Uploaded {
  path: string;
  name: string;
  bytes: Buffer;
  sha256: string;
  transferId: string;
}
export interface MediaServiceFixture {
  readonly service: CompanionService;
  readonly root: string;
  readonly assets: Map<string, Asset>;
  readonly packets: Packet[];
  readonly uploads: Uploaded[];
  readonly asr: Array<{ samples: number; sha256: string }>;
  readonly tts: Array<{ text: string; textAccepted: boolean }>;
  readonly errors: unknown[];
  readonly terminals: RuntimeInputTerminal[];
  readonly receipts: QQInputReceipt[];
  request(route: string, body?: unknown): Promise<Response>;
  send(id: number, scene: 'private' | 'group', segments: readonly unknown[]): void;
  terminal(predicate: (event: RuntimeInputTerminal) => boolean): Promise<RuntimeInputTerminal>;
  delivery(event: RuntimeInputTerminal): Promise<QQDeliveryView>;
  state<T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T>;
  configureAudio(): Promise<void>;
  voiceOutput(enabled: boolean): Promise<void>;
  holdText(): { readonly entered: Promise<void>; release(outcome?: 'accepted' | 'unknown'): void };
  reconnect(): Promise<void>;
  started(): Promise<string>;
  close(): Promise<void>;
}
export async function mediaService(
  client: ResponseClient,
  work = false,
): Promise<MediaServiceFixture> {
  const root = await mkdtemp(path.join(tmpdir(), 'qq-service-media-'));
  const token = `isolated-media-operator-${randomUUID()}`,
    key = `isolated-media-onebot-${randomUUID()}`;
  const assets = new Map<string, Asset>(),
    uploads: Uploaded[] = [],
    packets: Packet[] = [],
    errors: unknown[] = [],
    fatalErrors: unknown[] = [];
  const asr: Array<{ samples: number; sha256: string }> = [],
    tts: Array<{ text: string; textAccepted: boolean }> = [];
  const terminals: RuntimeInputTerminal[] = [],
    receipts: QQInputReceipt[] = [],
    listeners = new Set<() => void>();
  const cleanups: Array<() => void> = [];
  const listening = deferred<number>();
  let service: CompanionService | undefined,
    peer: WebSocket | undefined,
    expectedVoiceInput: string | undefined;
  let hold:
    | {
        entered: ReturnType<typeof deferred<void>>;
        pending: Packet | undefined;
        outcome?: 'accepted' | 'unknown';
      }
    | undefined;
  const pendingUploads = new Map<
    string,
    { chunks: Buffer[]; size: number; name: string; hash: string }
  >();
  const report = (error: unknown): void => {
    errors.push(error);
    for (const callback of listeners) callback();
  };
  const fatal = (error: unknown): void => {
    fatalErrors.push(error);
    report(error);
  };
  const native = createServer((request, response) => {
    void (async () => {
      if (request.method === 'GET') {
        const id = decodeURIComponent(
          new URL(request.url ?? '/', 'http://fixture').pathname.slice('/asset/'.length),
        );
        const asset = assets.get(id);
        if (!asset) {
          response.writeHead(404).end();
          return;
        }
        response.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': asset.bytes.length,
        });
        response.end(asset.bytes);
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString()) as {
        model: string;
        messages: Array<{ content: string | Array<{ input_audio?: { data: string } }> }>;
      };
      expect(request.url).toBe('/v1/magpie/native/xiaomi/v1/chat/completions');
      if (body.model === 'mimo-v2.5-asr') {
        const parts = body.messages[0]?.content;
        if (!Array.isArray(parts)) throw new Error('No ASR audio');
        const encoded = parts.find((part) => part.input_audio)?.input_audio?.data;
        if (!encoded?.startsWith('data:audio/wav;base64,')) throw new Error('No actual ASR WAV');
        const bytes = Buffer.from(encoded.slice('data:audio/wav;base64,'.length), 'base64');
        expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
        expect(bytes.readUInt32LE(24)).toBe(16000);
        asr.push({ samples: (bytes.length - 44) / 2, sha256: hashBytes(bytes) });
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify({
            choices: [{ message: { content: 'ASR_FROM_REAL_CODEC' }, finish_reason: 'stop' }],
          }),
        );
      } else {
        expect(body.model).toBe('mimo-v2.5-tts');
        const text = body.messages[0]?.content;
        if (typeof text !== 'string') throw new Error('No TTS text');
        if (!service || !expectedVoiceInput) throw new Error('TTS before a known terminal/input');
        const delivery = await service.runtime.state('getDelivery', {
          id: deliveryId(expectedVoiceInput),
          scope: { kind: 'management' },
        });
        const textAccepted = delivery.parts
          .filter((part) => part.requirement === 'mandatory-text')
          .every(
            (part) =>
              part.send?.outcome === 'accepted' ||
              (part.upload?.operation === 'upload-and-send' && part.upload.outcome === 'accepted'),
          );
        tts.push({ text, textAccepted });
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const pcm = waveBytes(0.2, 24000).subarray(44);
        response.write(
          `data: ${JSON.stringify({ id: 'tts', model: body.model, choices: [{ index: 0, delta: { audio: { id: 'audio', data: pcm.toString('base64') } }, finish_reason: null }] })}\n\n`,
        );
        response.end(
          `data: ${JSON.stringify({ id: 'tts', model: body.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
        );
      }
    })().catch((error) => {
      fatal(error);
      response.destroy();
    });
  });
  await new Promise<void>((resolve) => native.listen(0, '127.0.0.1', resolve));
  const address = native.address();
  if (!address || typeof address === 'string') throw new Error('No native fixture address');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const knownService = (): CompanionService => {
    if (!service) throw new Error('No service');
    return service;
  };
  const request = (route: string, body?: unknown): Promise<Response> =>
    new Promise((resolve, reject) => {
      const outgoing = httpRequest(
        new URL(route, knownService().url),
        {
          method: body === undefined ? 'GET' : 'POST',
          signal: AbortSignal.timeout(15000),
          headers: {
            Authorization: `Bearer ${token}`,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
        },
        (incoming) => {
          const bytes: Buffer[] = [];
          incoming.on('data', (chunk: Buffer) => bytes.push(chunk));
          incoming.on('error', reject);
          incoming.on('end', () =>
            resolve(new Response(Buffer.concat(bytes), { status: incoming.statusCode ?? 500 })),
          );
        },
      );
      outgoing.on('error', reject);
      outgoing.end(body === undefined ? undefined : JSON.stringify(body));
    });
  const value = async <T>(route: string, body?: unknown): Promise<T> => {
    const response = await request(route, body);
    const result: unknown = await response.json();
    if (
      !response.ok ||
      !result ||
      typeof result !== 'object' ||
      !('ok' in result) ||
      result.ok !== true ||
      !('value' in result)
    )
      throw new Error(`Owner API ${route} failed ${response.status}: ${JSON.stringify(result)}`);
    return result.value as T;
  };
  const qq = async (route = '/api/qq', body?: unknown): Promise<QQView> => {
    const result = await value<unknown>(route, body);
    if (!isQQView(result)) throw new Error('Invalid QQ view');
    return result;
  };
  const reply = (packet: Packet, data: unknown, stream = false, unknown = false): void => {
    if (!peer || peer.readyState !== WebSocket.OPEN)
      throw new Error('No connected controlled peer');
    peer.send(
      JSON.stringify({
        status: unknown ? 'async' : 'ok',
        retcode: unknown ? 1 : 0,
        data,
        ...(stream ? { stream: 'stream-action' } : {}),
        echo: packet.echo,
      }),
    );
  };
  const textAck = (packet: Packet, outcome: 'accepted' | 'unknown'): void =>
    reply(
      packet,
      outcome === 'accepted' ? { message_id: 90000 + packets.length } : {},
      false,
      outcome === 'unknown',
    );
  const handle = async (packet: Packet): Promise<void> => {
    packets.push(packet);
    if (packet.action === 'get_private_file_url' || packet.action === 'get_group_file_url') {
      const id = String(packet.params['file_id']);
      if (!assets.has(id)) throw new Error(`Unknown file lookup ${id}`);
      reply(packet, { url: `${baseUrl}/asset/${encodeURIComponent(id)}` });
      return;
    }
    if (packet.action.startsWith('download_file_')) {
      let asset: Asset | undefined;
      if (packet.action === 'download_file_stream') {
        const url = new URL(String(packet.params['file']));
        if (url.origin !== baseUrl) throw new Error('Unexpected download target');
        const id = decodeURIComponent(url.pathname.slice('/asset/'.length));
        const response = await fetch(url);
        if (!response.ok) throw new Error('Asset HTTP failed');
        const original = assets.get(id);
        if (!original) throw new Error('Missing asset name');
        asset = { name: original.name, bytes: Buffer.from(await response.arrayBuffer()) };
      } else asset = assets.get(String(packet.params['file_id']));
      if (!asset) throw new Error('Unknown media stream');
      const size = Number(packet.params['chunk_size']);
      reply(
        packet,
        {
          type: 'stream',
          data_type: 'file_info',
          file_name: asset.name,
          file_size: asset.bytes.length,
          chunk_size: size,
        },
        true,
      );
      let count = 0;
      for (let at = 0; at < asset.bytes.length; at += size) {
        const bytes = asset.bytes.subarray(at, at + size),
          data = bytes.toString('base64');
        reply(
          packet,
          {
            type: 'stream',
            data_type: 'file_chunk',
            index: count++,
            size: bytes.length,
            base64_size: data.length,
            data,
          },
          true,
        );
      }
      reply(
        packet,
        {
          type: 'response',
          data_type: 'file_complete',
          file_name: asset.name,
          total_chunks: count,
          total_bytes: asset.bytes.length,
        },
        true,
      );
      return;
    }
    if (packet.action === 'upload_file_stream') {
      const id = String(packet.params['stream_id']);
      let staged = pendingUploads.get(id);
      if (!staged) {
        staged = {
          chunks: [],
          size: Number(packet.params['file_size']),
          name: String(packet.params['filename']),
          hash: String(packet.params['expected_sha256']),
        };
        pendingUploads.set(id, staged);
      }
      if (packet.params['is_complete'] === true) {
        const bytes = Buffer.concat(staged.chunks);
        expect(bytes.length).toBe(staged.size);
        expect(hashBytes(bytes)).toBe(staged.hash);
        const remotePath = `/remote/${id}_${staged.name}`;
        uploads.push({
          path: remotePath,
          name: staged.name,
          bytes,
          sha256: staged.hash,
          transferId: id,
        });
        reply(
          packet,
          {
            type: 'response',
            status: 'file_complete',
            stream_id: id,
            received_chunks: staged.chunks.length,
            total_chunks: packet.params['total_chunks'],
            file_path: remotePath,
            file_name: staged.name,
            file_size: bytes.length,
            sha256: staged.hash,
          },
          true,
        );
      } else {
        expect(packet.params['chunk_index']).toBe(staged.chunks.length);
        staged.chunks.push(Buffer.from(String(packet.params['chunk_data']), 'base64'));
        reply(
          packet,
          {
            type: 'stream',
            status: 'chunk_received',
            stream_id: id,
            received_chunks: staged.chunks.length,
            total_chunks: packet.params['total_chunks'],
          },
          true,
        );
      }
      return;
    }
    if (packet.action === 'upload_private_file' || packet.action === 'upload_group_file') {
      if (!uploads.some((upload) => upload.path === packet.params['file']))
        throw new Error('File publication without actual staged bytes');
      expect(packet.params['upload_file']).toBe(true);
      reply(packet, { file_id: `native-file-${uploads.length}` });
      return;
    }
    if (packet.action === 'send_private_msg' || packet.action === 'send_group_msg') {
      const segments = packet.params['message'];
      const record =
        Array.isArray(segments) &&
        segments.some(
          (part: unknown) =>
            part && typeof part === 'object' && 'type' in part && part.type === 'record',
        );
      if (!record && hold) {
        hold.pending = packet;
        hold.entered.resolve();
        if (hold.outcome) textAck(packet, hold.outcome);
        return;
      }
      if (record && !uploads.length) throw new Error('Record send without encoded upload');
      textAck(packet, 'accepted');
      return;
    }
    throw new Error(`Unhandled real wire action ${packet.action}`);
  };
  let socketPort = 0;
  const connect = async (): Promise<void> => {
    peer = new WebSocket(`ws://127.0.0.1:${socketPort}/qq-media`, {
      headers: {
        Authorization: `Bearer ${key}`,
        'X-Self-ID': '10001',
        'X-Client-Role': 'Universal',
      },
    });
    peer.on('message', (bytes) => {
      void handle(JSON.parse(bytes.toString()) as Packet).catch(fatal);
    });
    await bounded(once(peer, 'open'), 'reverse WS open');
  };
  const stopPeer = async (): Promise<void> => {
    if (peer && peer.readyState !== WebSocket.CLOSED) {
      const done = once(peer, 'close');
      peer.terminate();
      await done;
    }
  };
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    let failure: unknown;
    try {
      await service?.close();
    } catch (error) {
      failure = error;
    }
    await stopPeer();
    native.closeAllConnections();
    await new Promise<void>((resolve) => native.close(() => resolve()));
    if (failure) throw failure;
    if (service) expect(service.host.tasks.diagnostics().pendingWork).toBe(0);
    const resolved = await realpath(root);
    if (
      path.dirname(resolved) !== (await realpath(tmpdir())) ||
      !path.basename(resolved).startsWith('qq-service-media-')
    )
      throw new Error('Unsafe fixture cleanup root');
    await rm(resolved, { recursive: true });
  };
  try {
    service = await createCompanionService({
      dataDirectory: root,
      token,
      hostname: '127.0.0.1',
      port: 0,
      mode: 'model',
      model: 'media-integration-fixture',
      client,
      ...(work ? { image: CLOUD_IMAGE } : {}),
      qqController: { onebotTest: { onListening: (current) => listening.resolve(current.port) } },
      onQQInputReceipt: (receipt) => {
        receipts.push(receipt);
        if (receipt.state === 'rejected')
          fatal(new Error(`Controlled ingress rejected: ${JSON.stringify(receipt)}`));
        for (const listener of listeners) listener();
      },
      onError: report,
    });
    cleanups.push(
      service.runtime.onInputTerminal((event) => {
        terminals.push(event);
        expectedVoiceInput = event.admission.id;
        for (const callback of listeners) callback();
      }),
    );
    let view = await qq();
    const initial = view.sources.find((source) => source.protocol === 'onebot-v11');
    if (!initial) throw new Error('No OneBot source');
    view = await qq('/api/qq/source', {
      protocol: 'onebot-v11',
      expectedRevision: initial.configRevision,
      settings: {
        protocol: 'onebot-v11',
        accountId: '10001',
        mode: 'reverse-ws',
        channelMode: 'universal',
        mediaProfile: 'snowluma-v11',
        listenHost: '127.0.0.1',
        listenPort: 0,
        path: '/qq-media',
      },
    });
    const account = {
      protocol: 'onebot-v11' as const,
      sourcePluginId: QQ_ONEBOT_PLUGIN_ID,
      instanceId: 'default' as const,
      accountId: '10001',
    };
    view = await qq('/api/qq/policy', {
      expectedRevision: view.policy.revision,
      settings: {
        ...view.policy.settings,
        privateAllowlist: [{ account, scene: 'private', senderId: '30001' }],
        groupAllowlist: [{ account, groupId: '40001' }],
      },
    });
    const source = view.sources.find((item) => item.protocol === 'onebot-v11');
    if (!source) throw new Error('No configured source');
    await qq('/api/qq/credential', {
      protocol: 'onebot-v11',
      expectedRevision: source.configRevision,
      expectedCredentialVersion: source.credential.version,
      value: key,
    });
    await value(`/api/plugins/${QQ_ONEBOT_PLUGIN_ID}`, { commandId: randomUUID(), enabled: true });
    socketPort = await bounded(listening.promise, 'OneBot listener');
    await connect();
  } catch (error) {
    await close();
    throw error;
  }
  const current = knownService();
  const state = <T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> => {
    let running = false,
      dirty = false,
      done = false;
    const result = deferred<T>();
    const check = () => {
      dirty = true;
      if (running || done) return;
      running = true;
      void (async () => {
        do {
          dirty = false;
          try {
            const value = await read();
            if (ready(value)) {
              done = true;
              off();
              result.resolve(value);
              return;
            }
          } catch (error) {
            if (!(error instanceof KernelFault && error.error.code === 'unavailable')) {
              done = true;
              off();
              result.reject(error);
              return;
            }
          }
          if (fatalErrors.length) {
            done = true;
            off();
            result.reject(fatalErrors[0]);
            return;
          }
        } while (dirty && !done);
      })().finally(() => {
        running = false;
        if (dirty && !done) check();
      });
    };
    const off = current.runtime.onChanged(check);
    cleanups.push(() => {
      done = true;
      off();
    });
    check();
    return bounded(result.promise, 'State condition');
  };
  return {
    service: current,
    root,
    assets,
    packets,
    uploads,
    asr,
    tts,
    errors,
    terminals,
    receipts,
    request,
    state,
    send(id, scene, segments) {
      if (!peer || peer.readyState !== WebSocket.OPEN) throw new Error('No peer');
      peer.send(
        JSON.stringify({
          post_type: 'message',
          self_id: 10001,
          time: Math.floor(Date.now() / 1000),
          message_type: scene,
          sub_type: scene === 'private' ? 'friend' : 'normal',
          message_id: id,
          user_id: 30001,
          ...(scene === 'group' ? { group_id: 40001 } : { target_id: 10001 }),
          sender: { user_id: 30001, nickname: 'controlled member', role: 'member' },
          message: [
            ...(scene === 'group' ? [{ type: 'at', data: { qq: 10001 } }] : []),
            ...segments,
          ],
        }),
      );
    },
    terminal(predicate) {
      const result = deferred<RuntimeInputTerminal>();
      const check = () => {
        const found = terminals.find(predicate);
        if (found) {
          listeners.delete(check);
          result.resolve(found);
        } else if (fatalErrors.length) {
          listeners.delete(check);
          result.reject(fatalErrors[0]);
        }
      };
      listeners.add(check);
      cleanups.push(() => listeners.delete(check));
      check();
      return bounded(result.promise, 'input terminal');
    },
    delivery(event) {
      if (!event.outputs.length)
        return Promise.reject(new Error(`No canonical output for terminal ${event.admission.id}`));
      return state(
        () =>
          current.runtime.state('getDelivery', {
            id: deliveryId(event.admission.id),
            scope: { kind: 'management' },
          }),
        (delivery) => ['blocked', 'terminal'].includes(delivery.phase),
      );
    },
    async configureAudio() {
      const voice = await current.voice.view(),
        speech = await current.speech.view();
      const asrProvider = voice.providers.find(
        (provider) => provider.providerRef === VOICE_ASR_PROVIDER,
      );
      const ttsProvider = speech.providers.find(
        (provider) => provider.providerRef === SPEECH_TTS_PROVIDER,
      );
      if (!asrProvider || !ttsProvider) throw new Error('Missing builtin audio providers');
      await value('/api/voice/provider', {
        providerRef: VOICE_ASR_PROVIDER,
        expectedRevision: asrProvider.configRevision,
        settings: {
          baseUrl: `${baseUrl}/v1`,
          modelRef: 'xiaomi/mimo-v2.5-asr',
          authMode: 'local-client-id',
          protocol: 'mimo-native',
        },
      });
      await value('/api/speech/provider', {
        providerRef: SPEECH_TTS_PROVIDER,
        expectedRevision: ttsProvider.configRevision,
        settings: {
          baseUrl: `${baseUrl}/v1`,
          modelRef: 'xiaomi/mimo-v2.5-tts',
          authMode: 'local-client-id',
          protocol: 'mimo-native-pcm16-sse',
          voice: 'Mia',
        },
      });
      expect((await current.audio.preflightCodec()).source).toBe('ready');
    },
    async voiceOutput(enabled) {
      const view = await qq();
      await qq('/api/qq/policy', {
        expectedRevision: view.policy.revision,
        settings: { ...view.policy.settings, voiceOutputEnabled: enabled },
      });
    },
    holdText() {
      const entered = deferred<void>();
      hold = { entered, pending: undefined };
      return {
        entered: entered.promise,
        release(outcome = 'accepted') {
          if (!hold) throw new Error('No text gate');
          hold.outcome = outcome;
          if (hold.pending) textAck(hold.pending, outcome);
        },
      };
    },
    async reconnect() {
      await stopPeer();
      await state(
        () => qq(),
        (view) =>
          view.sources.some(
            (source) =>
              source.protocol === 'onebot-v11' && ['connecting', 'offline'].includes(source.phase),
          ),
      );
      await connect();
      await state(
        () => qq(),
        (view) =>
          view.sources.some(
            (source) => source.protocol === 'onebot-v11' && source.phase === 'ready',
          ),
      );
    },
    started() {
      const result = deferred<string>();
      const watcher = watch(root, { recursive: true }, (_kind, filename) => {
        if (typeof filename !== 'string') return;
        const match =
          /^plugin-data\/pet\.cloud-exec\/jobs\/([a-f0-9-]{36})\/work\/started\.txt$/u.exec(
            filename,
          );
        if (match?.[1]) {
          watcher.close();
          result.resolve(match[1]);
        }
      });
      cleanups.push(() => watcher.close());
      return bounded(result.promise, 'real worker marker');
    },
    close,
  };
}
export async function dockerForJob(jobId: string): Promise<string> {
  if (!/^[a-f0-9-]{36}$/u.test(jobId)) throw new Error('Invalid owned job ID');
  const result = await promisify(execFile)(
    'docker',
    ['ps', '-a', '--filter', `label=pet.cloud-exec.job=${jobId}`, '--format', '{{.ID}}'],
    { timeout: 10000 },
  );
  return result.stdout.trim();
}
