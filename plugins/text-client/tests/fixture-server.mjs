/**
 * 本地协议夹具服务器：只用于验证已构建页面的真实交互。
 *
 * 它按 implementation-contract.md 的路径与形状返回固定数据，不是产品服务，
 * 也不代表真实模型或真实执行。启动：
 *   node tests/fixture-server.mjs 4319
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = path.join(root, 'dist');
const TOKEN = 'fixture-token';

const now = Date.now();
let tasks = [
  {
    id: 'task-1',
    executionId: 'exec-1',
    title: '统计会议记录字数',
    status: 'running',
    createdAt: now - 90_000,
    updatedAt: now - 30_000,
    exitCode: null,
    stdout: '',
    stderr: '',
    logsTruncated: false,
    artifacts: [],
    error: null,
  },
  {
    id: 'task-2',
    executionId: 'exec-2',
    title: '导出上周待办清单',
    status: 'completed',
    createdAt: now - 900_000,
    updatedAt: now - 600_000,
    exitCode: 0,
    stdout: '写入 1 个文件\n完成',
    stderr: '',
    logsTruncated: false,
    artifacts: [
      {
        id: 'a1',
        taskId: 'task-2',
        name: 'todo-2026-11-07.md',
        mediaType: 'text/markdown',
        sizeBytes: 412,
      },
    ],
    error: null,
  },
];

let messages = [
  {
    id: 'm1',
    role: 'user',
    text: '帮我把上周的待办整理成一份清单。',
    createdAt: now - 960_000,
    inputId: 'seed-1',
    taskId: null,
  },
  {
    id: 'm2',
    role: 'assistant',
    text: '已经交给后台任务处理，完成后会把文件放在右侧。',
    createdAt: now - 950_000,
    inputId: null,
    taskId: 'task-2',
  },
];

let sequence = 2;
let epoch = 'fixture-epoch';
const streams = new Set();

function snapshot() {
  return {
    protocolVersion: 1,
    epoch,
    cursor: sequence,
    now: Date.now(),
    agent: {
      id: 'agent-fixture',
      name: '助手',
      profileRevision: 1,
      harness: 'fixture',
      mode: 'scripted',
      status: 'ready',
      error: null,
    },
    messages,
    tasks,
    facts: [],
    plugins: [],
    projection: { hasMoreMessages: false, hasMoreTasks: false, taskDetailsTruncated: false },
  };
}

function push(kind, data) {
  sequence += 1;
  const payload = `id: ${sequence}\nevent: companion\ndata: ${JSON.stringify({
    id: `e${sequence}`,
    epoch,
    sequence,
    time: Date.now(),
    kind,
    data,
  })}\n\n`;
  for (const stream of streams) stream.write(payload);
}

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(body);
}

function authorized(request) {
  return request.headers.authorization === `Bearer ${TOKEN}`;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const pathname = url.pathname;

  if (pathname === '/' || pathname === '/index.html') {
    const html = await readFile(path.join(dist, 'index.html'));
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(html);
    return;
  }
  if (pathname === '/client.js' || pathname === '/client.css') {
    const file = await readFile(path.join(dist, pathname.slice(1)));
    response.writeHead(200, {
      'Content-Type': pathname.endsWith('.js')
        ? 'text/javascript; charset=utf-8'
        : 'text/css; charset=utf-8',
    });
    response.end(file);
    return;
  }

  if (pathname === '/api/snapshot' && request.method === 'GET') {
    if (!authorized(request))
      return json(response, 401, {
        ok: false,
        error: { code: 'auth-failed', messageKey: 'errors.auth-failed', retryable: false },
      });
    return json(response, 200, { ok: true, value: snapshot() });
  }

  if (pathname === '/api/events' && request.method === 'GET') {
    if (!authorized(request))
      return json(response, 401, {
        ok: false,
        error: { code: 'auth-failed', messageKey: 'errors.auth-failed', retryable: false },
      });
    if (url.searchParams.get('epoch') !== epoch) {
      return json(response, 409, {
        ok: false,
        error: { code: 'conflict', messageKey: 'errors.conflict', retryable: false },
      });
    }
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    response.write(': connected\n\n');
    streams.add(response);
    request.on('close', () => streams.delete(response));
    return;
  }

  if (pathname === '/api/messages' && request.method === 'POST') {
    if (!authorized(request))
      return json(response, 401, {
        ok: false,
        error: { code: 'auth-failed', messageKey: 'errors.auth-failed', retryable: false },
      });
    const body = JSON.parse(await read(request));
    const id = `m-${body.commandId}`;
    if (!messages.some((message) => message.id === id)) {
      messages = [
        ...messages,
        {
          id,
          role: 'user',
          text: body.text,
          createdAt: Date.now(),
          inputId: body.commandId,
          taskId: null,
        },
        {
          id: `${id}-reply`,
          role: 'assistant',
          text: '（夹具回复）收到了。',
          createdAt: Date.now(),
          inputId: null,
          taskId: null,
        },
      ];
      push('message', { id });
    }
    return json(response, 200, {
      ok: true,
      value: { commandId: body.commandId, status: 'accepted', messageId: id, taskId: null },
    });
  }

  const stopMatch = /^\/api\/tasks\/([^/]+)\/stop$/.exec(pathname);
  if (stopMatch !== null && request.method === 'POST') {
    if (!authorized(request))
      return json(response, 401, {
        ok: false,
        error: { code: 'auth-failed', messageKey: 'errors.auth-failed', retryable: false },
      });
    const taskId = decodeURIComponent(stopMatch[1]);
    const body = JSON.parse(await read(request));
    tasks = tasks.map((task) =>
      task.id === taskId ? { ...task, status: 'cancel-requested' } : task,
    );
    push('task', { id: taskId, status: 'cancel-requested' });
    // 真的终态随后到达，用来验证「请求 ≠ 完成」。
    setTimeout(() => {
      tasks = tasks.map((task) => (task.id === taskId ? { ...task, status: 'cancelled' } : task));
      push('task', { id: taskId, status: 'cancelled' });
    }, 1200);
    return json(response, 200, {
      ok: true,
      value: { commandId: body.commandId, status: 'accepted', messageId: null, taskId },
    });
  }

  if (pathname === '/api/artifacts/a1') {
    if (!authorized(request))
      return json(response, 401, {
        ok: false,
        error: { code: 'auth-failed', messageKey: 'errors.auth-failed', retryable: false },
      });
    response.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
    response.end('# 待办\n\n- 夹具产物\n');
    return;
  }

  json(response, 404, {
    ok: false,
    error: { code: 'unavailable', messageKey: 'errors.unavailable', retryable: false },
  });
});

function read(request) {
  return new Promise((resolve) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => resolve(body));
  });
}

const port = Number(process.argv[2] ?? 4319);
server.listen(port, '127.0.0.1', () => {
  console.log(`fixture server: http://127.0.0.1:${port} token=${TOKEN}`);
});
