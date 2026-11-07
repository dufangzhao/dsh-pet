import { timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  isKernelErrorCode,
  makeError,
  type CompanionFactCommand,
  type CompanionMessageCommand,
  type CompanionTaskCommand,
  type KernelError,
  type Result,
} from '@pet/contracts';
import { KernelFault } from '@pet/host-kernel';
import type { CompanionRuntime, CompanionPluginHost } from '@pet/companion-runtime';

const MAX_BODY = 64 * 1024;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const errorFor = (error: unknown): KernelError =>
  error instanceof KernelFault ? error.error : makeError('internal', false);

async function body(request: IncomingMessage): Promise<unknown> {
  if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json')
    throw new KernelFault('invalid-input');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += bytes.byteLength;
    if (size > MAX_BODY) throw new KernelFault('quota-exceeded');
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new KernelFault('invalid-input');
  }
}

function commandId(value: Record<string, unknown>): string {
  const id = value['commandId'];
  if (typeof id !== 'string' || !ID.test(id)) throw new KernelFault('invalid-input');
  return id;
}

function send<T>(response: ServerResponse, status: number, result: Result<T>): void {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(result));
}

function checkedRelative(root: string, relative: string): string {
  if (
    !relative ||
    relative.includes('\\') ||
    path.posix.isAbsolute(relative) ||
    relative.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new KernelFault('permission-denied');
  const target = path.resolve(root, ...relative.split('/'));
  const inside = path.relative(root, target);
  if (!inside || inside === '..' || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside))
    throw new KernelFault('permission-denied');
  return target;
}

/** Reject symlink ancestors as well as a substituted final artifact. */
async function openOwnedFile(
  root: string,
  relative: string,
): Promise<Awaited<ReturnType<typeof open>>> {
  const canonical = await realpath(root);
  const target = checkedRelative(canonical, relative);
  let current = canonical;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new KernelFault('permission-denied');
  }
  const resolved = await realpath(target);
  if (resolved !== target) throw new KernelFault('permission-denied');
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  const stat = await handle.stat();
  if (!stat.isFile() || stat.nlink !== 1) {
    await handle.close();
    throw new KernelFault('permission-denied');
  }
  return handle;
}

export interface TextServiceOptions {
  readonly runtime: CompanionRuntime;
  readonly host: CompanionPluginHost;
  readonly token: string;
  readonly hostname?: string;
  readonly port?: number;
  readonly publicOrigin?: string;
  readonly clientPluginId: string;
  readonly clientDirectory: string;
  readonly artifactRoots: ReadonlyMap<string, string>;
  readonly onError?: (error: unknown) => void;
}

export interface TextService {
  readonly url: string;
  close(): Promise<void>;
}

export async function serveText(options: TextServiceOptions): Promise<TextService> {
  if (
    Buffer.byteLength(options.token) < 24 ||
    Buffer.byteLength(options.token) > 512 ||
    /[\r\n]/.test(options.token)
  )
    throw new KernelFault('auth-failed');
  const expected = Buffer.from(`Bearer ${options.token}`);
  const streams = new Set<AbortController>();
  let closing = false;
  const allowedOrigins = new Set<string>();
  if (options.publicOrigin) allowedOrigins.add(new URL(options.publicOrigin).origin);

  const authorized = (request: IncomingMessage): boolean => {
    const authorization = request.headers.authorization;
    if (typeof authorization !== 'string') return false;
    const supplied = Buffer.from(authorization);
    return supplied.byteLength === expected.byteLength && timingSafeEqual(supplied, expected);
  };

  const sse = async (
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<void> => {
    if (streams.size >= 16) throw new KernelFault('quota-exceeded');
    const after = Number(url.searchParams.get('after') ?? '0');
    const epoch = url.searchParams.get('epoch');
    if (!Number.isSafeInteger(after) || after < 0 || !epoch) throw new KernelFault('invalid-input');
    let cursor = after;
    // Validate before committing SSE headers, so stale epochs remain ordinary 409 responses.
    await options.runtime.events(cursor, epoch);
    const controller = new AbortController();
    streams.add(controller);
    response.once('close', () => controller.abort());
    request.once('error', () => controller.abort());
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    let pumping = false;
    let dirty = false;
    const write = async (text: string): Promise<void> => {
      if (controller.signal.aborted) return;
      if (!response.write(text)) await once(response, 'drain', { signal: controller.signal });
    };
    const pump = async (): Promise<void> => {
      dirty = true;
      if (pumping || controller.signal.aborted) return;
      pumping = true;
      try {
        while (dirty && !controller.signal.aborted) {
          dirty = false;
          const page = await options.runtime.events(cursor, epoch);
          for (const event of page.events)
            await write(
              `id: ${event.sequence}\nevent: companion\ndata: ${JSON.stringify(event)}\n\n`,
            );
          cursor = page.cursor;
          if (page.hasMore) dirty = true;
        }
        await write('event: refresh\ndata: {}\n\n');
      } finally {
        pumping = false;
      }
    };
    const runPump = (): void => {
      void pump().catch((error: unknown) => {
        if (!controller.signal.aborted) options.onError?.(error);
        controller.abort();
      });
    };
    const off = options.runtime.onChanged(runPump);
    const heartbeat = setInterval(() => {
      if (!controller.signal.aborted && !response.writableNeedDrain)
        response.write(': keepalive\n\n');
    }, 15000);
    controller.signal.addEventListener(
      'abort',
      () => {
        off();
        clearInterval(heartbeat);
        streams.delete(controller);
        response.end();
      },
      { once: true },
    );
    runPump();
    if (!controller.signal.aborted) await once(controller.signal, 'abort');
  };

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (closing) throw new KernelFault('not-ready');
    const url = new URL(request.url ?? '/', 'http://service.invalid');
    const method = request.method ?? 'GET';
    const pathname = url.pathname;
    if (!pathname.startsWith('/api/')) {
      if (method !== 'GET' && method !== 'HEAD') {
        response.writeHead(405);
        response.end();
        return;
      }
      if (!options.host.isEnabled(options.clientPluginId)) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('文字入口插件未启用。核心服务仍可通过已授权接口管理。');
        return;
      }
      if (!options.host.verifySource(options.clientPluginId))
        throw new KernelFault('package-changed');
      const names: Readonly<Record<string, string>> = {
        '/': 'index.html',
        '/index.html': 'index.html',
        '/client.js': 'client.js',
        '/client.css': 'client.css',
      };
      const name = names[pathname];
      if (!name) {
        response.writeHead(404);
        response.end();
        return;
      }
      const file = await openOwnedFile(options.clientDirectory, name);
      const types: Readonly<Record<string, string>> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
      };
      response.writeHead(200, {
        'Content-Type': types[path.extname(name)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      });
      if (method === 'HEAD') {
        await file.close();
        response.end();
      } else await pipeline(file.createReadStream(), response);
      return;
    }
    if (!authorized(request)) throw new KernelFault('auth-failed');
    const origin = request.headers.origin;
    if (typeof origin === 'string' && !allowedOrigins.has(origin))
      throw new KernelFault('permission-denied');
    if (method === 'GET' && pathname === '/api/snapshot') {
      send(response, 200, { ok: true, value: await options.runtime.snapshot() });
      return;
    }
    if (method === 'GET' && pathname === '/api/plugins') {
      send(response, 200, { ok: true, value: options.host.views() });
      return;
    }
    if (method === 'GET' && pathname === '/api/events') {
      await sse(request, response, url);
      return;
    }
    const artifactMatch = /^\/api\/artifacts\/([A-Za-z0-9._-]+)$/.exec(pathname);
    if (method === 'GET' && artifactMatch?.[1]) {
      const artifact = await options.runtime.state('getArtifact', { id: artifactMatch[1] });
      const root = options.artifactRoots.get(artifact.provider);
      if (!root) throw new KernelFault('unavailable');
      const file = await openOwnedFile(root, artifact.relativePath);
      const stat = await file.stat();
      if (stat.size !== artifact.sizeBytes) {
        await file.close();
        throw new KernelFault('conflict');
      }
      const filename = path.posix.basename(artifact.name);
      const mediaType = /^[\w.+-]+\/[\w.+-]+$/.test(artifact.mediaType)
        ? artifact.mediaType
        : 'application/octet-stream';
      response.writeHead(200, {
        'Content-Type': mediaType,
        'Content-Length': stat.size,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      await pipeline(file.createReadStream(), response);
      return;
    }
    const taskMatch = /^\/api\/tasks\/([A-Za-z0-9._-]+)$/.exec(pathname);
    if (method === 'GET' && taskMatch?.[1]) {
      send(response, 200, {
        ok: true,
        value: await options.runtime.state('getTask', { id: taskMatch[1] }),
      });
      return;
    }
    if (method !== 'POST') {
      send(response, 404, { ok: false, error: makeError('unavailable') });
      return;
    }
    const input = object(await body(request));
    if (!input) throw new KernelFault('invalid-input');
    const id = commandId(input);
    if (pathname === '/api/messages') {
      const value = await options.runtime.message(input as unknown as CompanionMessageCommand);
      send(response, 202, { ok: true, value });
      return;
    }
    if (pathname === '/api/tasks') {
      const value = await options.runtime.startTask(input as unknown as CompanionTaskCommand);
      send(response, 202, { ok: true, value });
      return;
    }
    if (pathname === '/api/facts') {
      const value = await options.runtime.remember(input as unknown as CompanionFactCommand);
      send(response, 200, { ok: true, value });
      return;
    }
    const stopMatch = /^\/api\/tasks\/([A-Za-z0-9._-]+)\/stop$/.exec(pathname);
    if (stopMatch?.[1]) {
      send(response, 202, { ok: true, value: await options.runtime.stopTask(stopMatch[1], id) });
      return;
    }
    const pluginMatch = /^\/api\/plugins\/([a-z0-9.-]+)$/.exec(pathname);
    if (pluginMatch?.[1] && typeof input['enabled'] === 'boolean') {
      send(response, 200, {
        ok: true,
        value: await options.runtime.setPlugin(pluginMatch[1], input['enabled'], id),
      });
      return;
    }
    if (pathname === '/api/harness' && typeof input['harness'] === 'string') {
      send(response, 200, {
        ok: true,
        value: await options.runtime.selectHarness(input['harness'], id),
      });
      return;
    }
    if (pathname === '/api/foreground/stop') {
      await options.runtime.stopForeground();
      send(response, 200, { ok: true, value: null });
      return;
    }
    throw new KernelFault('invalid-input');
  };

  const server = createServer(
    { maxHeaderSize: 16 * 1024, requestTimeout: 30000, headersTimeout: 10000 },
    (request, response) => {
      void handle(request, response).catch((error: unknown) => {
        options.onError?.(error);
        if (response.headersSent) {
          response.destroy();
          return;
        }
        const problem = errorFor(error);
        const code = isKernelErrorCode(problem.code) ? problem.code : 'internal';
        const statuses: Partial<Record<KernelError['code'], number>> = {
          'auth-failed': 401,
          'permission-denied': 403,
          'invalid-input': 400,
          conflict: 409,
          'quota-exceeded': 413,
          'not-ready': 503,
          unavailable: 503,
        };
        send(response, statuses[code] ?? 500, { ok: false, error: problem });
      });
    },
  );
  server.listen(options.port ?? 0, options.hostname ?? '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new KernelFault('internal');
  }
  const hostname = options.hostname ?? '127.0.0.1';
  const browserHost = hostname === '0.0.0.0' ? '127.0.0.1' : hostname === '::' ? '[::1]' : hostname;
  const serviceUrl = `http://${browserHost}:${address.port}`;
  allowedOrigins.add(serviceUrl);
  if (['127.0.0.1', 'localhost', '::1', '0.0.0.0', '::'].includes(hostname)) {
    allowedOrigins.add(`http://127.0.0.1:${address.port}`);
    allowedOrigins.add(`http://localhost:${address.port}`);
    allowedOrigins.add(`http://[::1]:${address.port}`);
  }
  return {
    url: serviceUrl,
    async close() {
      if (closing) return;
      closing = true;
      for (const stream of streams) stream.abort();
      const closed = new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      server.closeAllConnections();
      await closed;
    },
  };
}
