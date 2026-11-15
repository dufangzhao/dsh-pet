import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { CompanionClient } from '../src/client/client.ts';
import { setRequestTimeoutMs, streamEvents } from '../src/client/protocol.ts';
import { event, modelView, snapshot, sseText, task } from './fixtures.mjs';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * 保持打开的 SSE 响应。真实服务端不会在发几条事件后立刻关流，
 * 所以「流关闭」在客户端就是连接结束，必须转 offline。
 */
function openStream() {
  const encoder = new TextEncoder();
  let controller = null;
  const response = new Response(
    new ReadableStream({
      start(inner) {
        controller = inner;
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );
  return {
    response,
    push: (text) => controller?.enqueue(encoder.encode(text)),
    close: () => controller?.close(),
  };
}

/** 记录每个请求的 URL 与 init，方便断言认证与去重行为。 */
function recordFetch(handler) {
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push({ url, init });
    return handler(url, init);
  };
  return calls;
}

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

async function connectLive(client, stream) {
  void client.connect('t');
  for (let index = 0; index < 50 && client.getState().phase !== 'live'; index += 1) {
    await tick(4);
  }
  assert.equal(client.getState().phase, 'live');
  return stream;
}

test('connects with the bearer token in a header, never in the URL', async () => {
  const stream = openStream();
  const calls = recordFetch((url) =>
    url.startsWith('/api/events') ? stream.response : jsonResponse({ ok: true, value: snapshot() }),
  );
  const client = new CompanionClient({ refreshDelayMs: 5 });
  await connectLive(client, stream);

  assert.equal(calls[0].url, '/api/snapshot');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer t');
  const events = calls.find((call) => call.url.startsWith('/api/events'));
  assert.equal(events.init.headers.Authorization, 'Bearer t');
  assert.match(events.url, /after=4&epoch=epoch-1/);
  for (const call of calls) assert.doesNotMatch(call.url, /Bearer|secret/);
  client.dispose();
});

test('an auth failure ends in offline with the fixed auth copy', async () => {
  recordFetch(() =>
    jsonResponse(
      {
        ok: false,
        error: { code: 'auth-failed', messageKey: 'errors.auth-failed', retryable: false },
      },
      401,
    ),
  );
  const client = new CompanionClient({ refreshDelayMs: 5 });
  await client.connect('wrong');
  const state = client.getState();
  assert.equal(state.phase, 'offline');
  assert.equal(state.error?.code, 'auth-failed');
  assert.equal(state.snapshot, null);
  client.dispose();
});

test('events coalesce into one snapshot refresh and idle stays quiet', async () => {
  const stream = openStream();
  let snapshotReads = 0;
  recordFetch((url) => {
    if (url.startsWith('/api/snapshot')) {
      snapshotReads += 1;
      return jsonResponse({ ok: true, value: snapshot({ cursor: snapshotReads }) });
    }
    return stream.response;
  });
  const client = new CompanionClient({ refreshDelayMs: 5 });
  await connectLive(client, stream);

  stream.push(
    sseText([
      { id: '1', event: 'companion', data: JSON.stringify(event(1)) },
      { id: '2', event: 'companion', data: JSON.stringify(event(2)) },
    ]),
  );
  await tick(60);
  assert.equal(snapshotReads, 2);

  // 空闲不再读快照：没有轮询。
  await tick(120);
  assert.equal(snapshotReads, 2);
  client.dispose();
});

test('a refresh hint without an id merges into one snapshot read', async () => {
  const stream = openStream();
  let snapshotReads = 0;
  recordFetch((url) => {
    if (url.startsWith('/api/snapshot')) {
      snapshotReads += 1;
      return jsonResponse({ ok: true, value: snapshot() });
    }
    return stream.response;
  });
  const client = new CompanionClient({ refreshDelayMs: 5 });
  await connectLive(client, stream);

  stream.push(sseText([{ event: 'refresh', data: '{}' }]));
  await tick(40);
  assert.equal(snapshotReads, 2);
  client.dispose();
});

test('an epoch mismatch re-reads the snapshot instead of trusting the delta', async () => {
  // 服务端换世代时，旧流结束，新流按新 epoch/cursor 重开。
  const streams = [];
  let reads = 0;
  recordFetch((url) => {
    if (url.startsWith('/api/snapshot')) {
      reads += 1;
      return jsonResponse({
        ok: true,
        value: snapshot({ epoch: reads === 1 ? 'epoch-1' : 'epoch-2', cursor: reads }),
      });
    }
    const stream = openStream();
    streams.push(stream);
    return stream.response;
  });
  const client = new CompanionClient({ refreshDelayMs: 5 });
  await connectLive(client, streams[0]);

  // 旧世代结束：客户端应重新对账到新快照并继续连着，而不是显示断线。
  streams[0].close();
  for (let index = 0; index < 50 && streams.length < 2; index += 1) {
    await tick(4);
  }
  assert.equal(client.getState().snapshot.epoch, 'epoch-2');
  assert.equal(client.getState().phase, 'live');
  client.dispose();
});

test('a closed stream without an epoch change reports offline and keeps last confirmed data', async () => {
  const stream = openStream();
  recordFetch((url) =>
    url.startsWith('/api/snapshot')
      ? jsonResponse({ ok: true, value: snapshot({ tasks: [task()] }) })
      : stream.response,
  );
  const client = new CompanionClient({ refreshDelayMs: 5 });
  await connectLive(client, stream);

  stream.close();
  for (let index = 0; index < 50 && client.getState().phase !== 'offline'; index += 1) {
    await tick(4);
  }
  const state = client.getState();
  assert.equal(state.phase, 'offline');
  assert.equal(state.snapshot.tasks.length, 1);
  client.dispose();
});

test('an uncertain send retries with the same command id and never duplicates', async () => {
  const stream = openStream();
  const commands = [];
  let failNext = true;
  recordFetch((url, init) => {
    if (url === '/api/messages') {
      const body = JSON.parse(init.body);
      commands.push(body);
      if (failNext) {
        failNext = false;
        throw new TypeError('connection reset');
      }
      return jsonResponse({
        ok: true,
        value: { commandId: body.commandId, status: 'accepted', messageId: 'm9', taskId: null },
      });
    }
    if (url.startsWith('/api/snapshot')) return jsonResponse({ ok: true, value: snapshot() });
    return stream.response;
  });

  const client = new CompanionClient({ refreshDelayMs: 5, newCommandId: () => 'cmd-fixed' });
  await connectLive(client, stream);
  await client.submit('整理记录');

  assert.equal(client.getState().outbox.length, 1);
  assert.equal(client.getState().outbox[0].uncertain, true);

  await client.submit('整理记录');
  assert.equal(commands.length, 2);
  assert.equal(commands[0].commandId, commands[1].commandId);
  assert.equal(client.getState().outbox.length, 0);
  client.dispose();
});

test('an edited text gets a new command id instead of reusing the uncertain one', async () => {
  const stream = openStream();
  const commands = [];
  let failNext = true;
  recordFetch((url, init) => {
    if (url === '/api/messages') {
      const body = JSON.parse(init.body);
      commands.push(body);
      if (failNext) {
        failNext = false;
        throw new TypeError('connection reset');
      }
      return jsonResponse({
        ok: true,
        value: { commandId: body.commandId, status: 'accepted', messageId: 'm', taskId: null },
      });
    }
    if (url.startsWith('/api/snapshot')) return jsonResponse({ ok: true, value: snapshot() });
    return stream.response;
  });

  let counter = 0;
  const client = new CompanionClient({ refreshDelayMs: 5, newCommandId: () => `cmd-${++counter}` });
  await connectLive(client, stream);
  await client.submit('原话');
  await client.submit('改过的话');
  assert.equal(commands[0].commandId, 'cmd-1');
  assert.equal(commands[1].commandId, 'cmd-2');
  client.dispose();
});

test('stop is a request until a terminal snapshot arrives', async () => {
  const stream = openStream();
  const stopCalls = [];
  let current = task({ status: 'running' });
  recordFetch((url, init) => {
    if (url.startsWith('/api/tasks/') && url.endsWith('/stop')) {
      stopCalls.push({ url, body: JSON.parse(init.body) });
      return jsonResponse({
        ok: true,
        value: { commandId: 'stop-1', status: 'accepted', messageId: null, taskId: 'task-1' },
      });
    }
    if (url.startsWith('/api/snapshot')) {
      return jsonResponse({ ok: true, value: snapshot({ tasks: [current] }) });
    }
    return stream.response;
  });

  const client = new CompanionClient({ refreshDelayMs: 5, newCommandId: () => 'stop-1' });
  await connectLive(client, stream);
  await client.requestStop('task-1');

  assert.equal(stopCalls[0].body.commandId, 'stop-1');
  // 受理不是退出：任务仍是 running，只多了停止意图。
  assert.equal(client.getState().snapshot.tasks[0].status, 'running');
  assert.equal(client.getState().stops['task-1'].uncertain, false);

  current = task({ status: 'cancelled' });
  await tick(40);
  assert.equal(client.getState().snapshot.tasks[0].status, 'cancelled');
  assert.deepEqual(client.getState().stops, {});
  client.dispose();
});

test('artifact bytes come from an authenticated request, not a token URL', async () => {
  const stream = openStream();
  const calls = recordFetch((url) => {
    if (url.startsWith('/api/artifacts/')) return new Response(new Uint8Array([1, 2, 3]));
    if (url.startsWith('/api/snapshot')) {
      return jsonResponse({
        ok: true,
        value: snapshot({
          tasks: [
            task({
              status: 'completed',
              artifacts: [
                {
                  id: 'a1',
                  taskId: 'task-1',
                  name: 'out.txt',
                  mediaType: 'text/plain',
                  sizeBytes: 3,
                },
              ],
            }),
          ],
        }),
      });
    }
    return stream.response;
  });

  const blobs = [];
  const names = [];
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;
  const realDocument = globalThis.document;
  URL.createObjectURL = (blob) => {
    blobs.push(blob);
    return 'blob:test';
  };
  URL.revokeObjectURL = () => {};
  globalThis.document = {
    createElement: () => ({
      set href(value) {
        void value;
      },
      set download(value) {
        names.push(value);
      },
      set rel(value) {
        void value;
      },
      click() {},
      remove() {},
    }),
    body: { append() {} },
  };

  try {
    const client = new CompanionClient({ refreshDelayMs: 5 });
    await connectLive(client, stream);
    const artifact = client.getState().snapshot.tasks[0].artifacts[0];
    const result = await client.downloadArtifact(artifact);
    assert.equal(result.ok, true);
    const call = calls.find((entry) => entry.url.startsWith('/api/artifacts/'));
    assert.equal(call.url, '/api/artifacts/a1');
    assert.equal(call.init.headers.Authorization, 'Bearer t');
    assert.deepEqual(names, ['out.txt']);
    assert.equal(blobs.length, 1);
    client.dispose();
  } finally {
    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
    globalThis.document = realDocument;
  }
});

test('a corrupt snapshot body fails the connection instead of crashing the UI', async () => {
  recordFetch(
    () =>
      new Response(JSON.stringify({ ok: true, value: { epoch: 'e', cursor: 'nope' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  const client = new CompanionClient({ refreshDelayMs: 5 });
  await client.connect('t');
  const state = client.getState();
  assert.equal(state.phase, 'offline');
  assert.equal(state.snapshot, null);
  assert.equal(state.error?.code, 'unavailable');
  client.dispose();
});

test('an out-of-range timestamp fails the connection instead of crashing a render', async () => {
  // 有限但超出 Date 范围的时间戳会通过「是个数字」的检查，然后在 Intl 里抛错。
  recordFetch(() =>
    jsonResponse({
      ok: true,
      value: snapshot({
        messages: [
          {
            id: 'm1',
            role: 'user',
            text: '会崩的时间',
            createdAt: 1e300,
            inputId: null,
            taskId: null,
          },
        ],
      }),
    }),
  );
  const client = new CompanionClient({ refreshDelayMs: 5 });
  await client.connect('t');
  const state = client.getState();
  assert.equal(state.phase, 'offline');
  assert.equal(state.snapshot, null);
  assert.equal(state.error?.code, 'unavailable');
  client.dispose();
});

test('a receipt for another command leaves the send uncertain, not confirmed', async () => {
  const stream = openStream();
  recordFetch((url) => {
    if (url === '/api/messages') {
      return jsonResponse({
        ok: true,
        // 受理了别的意图：不能拿来清掉这一条待确认消息。
        value: { commandId: 'not-ours', status: 'accepted', messageId: 'm', taskId: null },
      });
    }
    if (url.startsWith('/api/snapshot')) return jsonResponse({ ok: true, value: snapshot() });
    return stream.response;
  });
  const client = new CompanionClient({ refreshDelayMs: 5, newCommandId: () => 'c1' });
  await connectLive(client, stream);
  const outcome = await client.submit('一条消息');
  assert.equal(outcome, 'uncertain');
  assert.equal(client.getState().outbox.length, 1);
  assert.equal(client.getState().outbox[0].commandId, 'c1');
  client.dispose();
});

test('a failed snapshot refresh reports offline instead of staying live', async () => {
  const stream = openStream();
  let failReads = false;
  recordFetch((url) => {
    if (url.startsWith('/api/snapshot')) {
      // 建连成功；之后断网，合并刷新取不到快照。
      if (failReads) throw new TypeError('connection reset');
      return jsonResponse({ ok: true, value: snapshot({ tasks: [task()] }) });
    }
    return stream.response;
  });
  const client = new CompanionClient({ refreshDelayMs: 5 });
  await connectLive(client, stream);

  failReads = true;
  stream.push(sseText([{ id: '1', event: 'companion', data: JSON.stringify(event(1)) }]));
  for (let index = 0; index < 50 && client.getState().phase !== 'offline'; index += 1) {
    await tick(4);
  }
  const state = client.getState();
  assert.equal(state.phase, 'offline');
  assert.equal(state.error?.code, 'network');
  // 最后确认的数据保留，但任务标成未知。
  assert.equal(state.snapshot.tasks.length, 1);
  client.dispose();
});

test('a stream that stops sending keepalives reports offline', async () => {
  // 断网时浏览器不会让 fetch 立刻失败，只有服务端心跳停止才能证明连接已死。
  const stream = openStream();
  recordFetch((url) =>
    url.startsWith('/api/snapshot')
      ? jsonResponse({ ok: true, value: snapshot() })
      : stream.response,
  );
  const client = new CompanionClient({ refreshDelayMs: 5, streamIdleTimeoutMs: 40 });
  await connectLive(client, stream);

  // 不推任何字节：心跳超时后应判定断线，而不是一直显示「已连接」。
  for (let index = 0; index < 100 && client.getState().phase !== 'offline'; index += 1) {
    await tick(5);
  }
  const state = client.getState();
  assert.equal(state.phase, 'offline');
  assert.equal(state.error?.code, 'network');
  client.dispose();
});

test('keepalive comment lines keep an idle stream alive', async () => {
  const stream = openStream();
  recordFetch((url) =>
    url.startsWith('/api/snapshot')
      ? jsonResponse({ ok: true, value: snapshot() })
      : stream.response,
  );
  const client = new CompanionClient({ refreshDelayMs: 5, streamIdleTimeoutMs: 120 });
  await connectLive(client, stream);

  // 每次心跳都重新计时：总时长远超 120ms，但任何两个心跳之间都不到 120ms。
  for (let index = 0; index < 10; index += 1) {
    await tick(60);
    stream.push(': keepalive\n\n');
    assert.equal(client.getState().phase, 'live', `dropped at beat ${index}`);
  }
  // 心跳停下之后才允许判定断开。
  for (let index = 0; index < 100 && client.getState().phase !== 'offline'; index += 1) {
    await tick(5);
  }
  assert.equal(client.getState().phase, 'offline');
  assert.equal(client.getState().error?.code, 'network');
  client.dispose();
});

test('a user-initiated disconnect is not misreported as a network timeout', async () => {
  const stream = openStream();
  recordFetch((url) =>
    url.startsWith('/api/snapshot')
      ? jsonResponse({ ok: true, value: snapshot() })
      : stream.response,
  );
  // 看门狗窗口远小于测试时长：如果主动断开被误判成超时，就会留下 network 错误。
  const client = new CompanionClient({ refreshDelayMs: 5, streamIdleTimeoutMs: 60_000 });
  await connectLive(client, stream);

  client.disconnect();
  assert.equal(client.getState().phase, 'idle');
  assert.equal(client.getState().error, null);
  assert.equal(client.getState().snapshot, null);
  client.dispose();
});

test('the idle timeout actually aborts the fetch request', async () => {
  let observedSignal = null;
  recordFetch((url, init) => {
    if (url.startsWith('/api/snapshot')) return jsonResponse({ ok: true, value: snapshot() });
    observedSignal = init.signal;
    // 模拟断网：连接永不产出字节，也不主动结束。
    return new Response(new ReadableStream({ start() {} }), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  });
  const client = new CompanionClient({ refreshDelayMs: 5, streamIdleTimeoutMs: 40 });
  void client.connect('t');
  for (let index = 0; index < 100 && client.getState().phase !== 'live'; index += 1) {
    await tick(4);
  }
  for (let index = 0; index < 200 && client.getState().phase !== 'offline'; index += 1) {
    await tick(5);
  }
  assert.equal(client.getState().phase, 'offline');
  // 请求 signal 必须真的被 abort，而不是只让循环先返回。
  assert.ok(observedSignal !== null, 'stream request was never made');
  assert.equal(observedSignal.aborted, true);
  client.dispose();
});

test('repeated stream attempts do not accumulate abort listeners', async () => {
  // #follow 在重连时复用同一个 signal；每次开流都必须摘掉自己的监听。
  const controller = new AbortController();
  let added = 0;
  let removed = 0;
  const realAdd = controller.signal.addEventListener.bind(controller.signal);
  const realRemove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.addEventListener = (...args) => {
    added += 1;
    return realAdd(...args);
  };
  controller.signal.removeEventListener = (...args) => {
    removed += 1;
    return realRemove(...args);
  };

  recordFetch(
    () => new Response(new ReadableStream({ start: (inner) => inner.close() }), { status: 200 }),
  );
  for (let index = 0; index < 4; index += 1) {
    await streamEvents(
      { baseUrl: '', token: 't' },
      { after: 0, epoch: 'e', signal: controller.signal },
      () => {},
    );
  }
  assert.equal(added, 4);
  assert.equal(removed, 4);
});

test('a snapshot request that never answers times out instead of hanging forever', async () => {
  // 断网时 TCP 只是挂起：没有请求超时，getSnapshot 会永远等下去，
  // 上层就会一直显示「已连接」。
  setRequestTimeoutMs(150);
  try {
    // 模拟真实 fetch：永不返回响应，但 signal 中止时会拒绝。
    recordFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            {
              once: true,
            },
          );
        }),
    );
    const client = new CompanionClient({ refreshDelayMs: 5 });
    const started = Date.now();
    await client.connect('t');
    const elapsed = Date.now() - started;
    const state = client.getState();
    assert.equal(state.phase, 'offline');
    assert.equal(state.error?.code, 'timeout');
    assert.ok(elapsed < 5_000, `took ${elapsed}ms`);
    client.dispose();
  } finally {
    setRequestTimeoutMs(20_000);
  }
});

test('a dead stream goes offline at once, even while the follow-up snapshot hangs', async () => {
  // 流一失效就失去了实时确认：后续对账哪怕挂起 20s，也不能继续显示「已连接」。
  let hangSnapshot = false;
  const stream = openStream();
  recordFetch((url, init) => {
    if (url.startsWith('/api/snapshot')) {
      if (!hangSnapshot) return jsonResponse({ ok: true, value: snapshot() });
      // 模拟 TCP 挂起：永不返回，但 abort 时拒绝。
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true },
        );
      });
    }
    return stream.response;
  });
  setRequestTimeoutMs(3_000);
  try {
    const client = new CompanionClient({ refreshDelayMs: 5, streamIdleTimeoutMs: 5_000 });
    await connectLive(client, stream);
    assert.equal(client.getState().phase, 'live');

    // 流断掉后立刻把对账快照挂起，观察中间态。
    hangSnapshot = true;
    stream.close();
    for (let index = 0; index < 100 && client.getState().phase === 'live'; index += 1) {
      await tick(5);
    }
    const state = client.getState();
    assert.equal(state.phase, 'offline', 'must not stay live while the snapshot hangs');
    assert.equal(state.error?.code, 'network');
    // 最后确认的数据保留，任务标为未知。
    assert.equal(state.snapshot.messages.length, 2);
    client.dispose();
  } finally {
    setRequestTimeoutMs(20_000);
  }
});

test('a non-JSON body is reported as an unavailable service', async () => {
  recordFetch(() => new Response('<html>proxy error</html>', { status: 200 }));
  const client = new CompanionClient({ refreshDelayMs: 5 });
  await client.connect('t');
  assert.equal(client.getState().phase, 'offline');
  assert.equal(client.getState().error?.code, 'unavailable');
  client.dispose();
});

test('an unsupported protocol version stops at the gate and names the version', async () => {
  recordFetch(() => jsonResponse({ ok: true, value: { ...snapshot(), protocolVersion: 2 } }));
  const client = new CompanionClient({ refreshDelayMs: 5 });
  await client.connect('t');
  const state = client.getState();
  assert.equal(state.phase, 'offline');
  assert.equal(state.snapshot, null);
  assert.equal(state.error?.code, 'unavailable');
  assert.equal(state.protocolMismatch, 2);
  client.dispose();
});

test('a non-numeric protocol version is reported without inventing a number', async () => {
  recordFetch(() => jsonResponse({ ok: true, value: { ...snapshot(), protocolVersion: 'v2' } }));
  const client = new CompanionClient({ refreshDelayMs: 5 });
  await client.connect('t');
  assert.equal(client.getState().phase, 'offline');
  assert.equal(client.getState().protocolMismatch, null);
  client.dispose();
});

test('a receipt with a broken shape leaves the send uncertain, not confirmed', async () => {
  const stream = openStream();
  recordFetch((url) => {
    if (url === '/api/messages') return jsonResponse({ ok: true, value: { commandId: 'c1' } });
    if (url.startsWith('/api/snapshot')) return jsonResponse({ ok: true, value: snapshot() });
    return stream.response;
  });
  const client = new CompanionClient({ refreshDelayMs: 5, newCommandId: () => 'c1' });
  await connectLive(client, stream);
  const outcome = await client.submit('一条消息');
  // 服务端可能已经受理，只是回执读不懂：按结果未知处理，重试复用同一 commandId。
  assert.equal(outcome, 'uncertain');
  assert.equal(client.getState().outbox.length, 1);
  assert.equal(client.getState().outbox[0].uncertain, true);
  assert.equal(client.getState().outbox[0].commandId, 'c1');
  client.dispose();
});

test('a corrupt event frame is ignored and the stream keeps working', async () => {
  const stream = openStream();
  let reads = 0;
  recordFetch((url) => {
    if (url.startsWith('/api/snapshot')) {
      reads += 1;
      return jsonResponse({ ok: true, value: snapshot() });
    }
    return stream.response;
  });
  const client = new CompanionClient({ refreshDelayMs: 5 });
  await connectLive(client, stream);
  assert.equal(reads, 1);

  // 坏 JSON、坏 sequence、未知事件名都不该让流退出或触发刷新。
  stream.push('id: 1\nevent: companion\ndata: {oops\n\n');
  stream.push(`id: 2\nevent: companion\ndata: ${JSON.stringify(event(-5))}\n\n`);
  stream.push('event: telemetry\ndata: {}\n\n');
  await tick(60);
  assert.equal(reads, 1);
  assert.equal(client.getState().phase, 'live');

  // 正常事件仍然触发一次合并刷新。
  stream.push(`id: 3\nevent: companion\ndata: ${JSON.stringify(event(3))}\n\n`);
  await tick(60);
  assert.equal(reads, 2);
  client.dispose();
});

/* ---- 模型设置 ---- */

/** 让快照带模型视图，其余请求交给 handler。 */
function withModel(handler) {
  const stream = openStream();
  const calls = recordFetch((url, init) => {
    if (url === '/api/snapshot') {
      return jsonResponse({ ok: true, value: snapshot({ model: modelView() }) });
    }
    if (url.startsWith('/api/model')) return handler(url, init);
    return stream.response;
  });
  return { stream, calls };
}

const MODEL_APPLIED = {
  connectorId: 'pet.model-connection-magpie/magpie',
  configRevision: 2,
  credentialVersion: 'process:1',
};

test('saving posts one command, returns the view and never sends the key', async () => {
  const next = modelView({
    desired: { mode: 'model', connectorId: 'pet.model-connection-magpie/magpie' },
    applied: MODEL_APPLIED,
    enabled: true,
  });
  const { stream, calls } = withModel((url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(url, '/api/model');
    assert.equal(body.config.model, 'gpt-4.1-mini');
    assert.equal(body.expectedConfigRevision, 1);
    return jsonResponse({
      ok: true,
      value: {
        receipt: { commandId: body.commandId, status: 'accepted', messageId: null, taskId: null },
        view: next,
      },
    });
  });
  const client = new CompanionClient({ refreshDelayMs: 5, newCommandId: () => 'cmd-model' });
  await connectLive(client, stream);
  const result = await client.saveModel({
    commandId: 'cmd-model',
    expectedProfileRevision: 1,
    connectorId: 'pet.model-connection-magpie/magpie',
    expectedConfigRevision: 1,
    mode: 'model',
    config: {
      baseUrl: 'http://127.0.0.1:3425/v1',
      model: 'gpt-4.1-mini',
      authMode: 'local-client-id',
    },
  });
  assert.equal(result.ok, true);
  assert.equal(calls.filter((call) => call.url === '/api/model').length, 1);
  // 命令响应只交给调用方，不直接写全局快照。
  assert.equal(result.value.enabled, true);
  // 快照仍然由权威读取决定：这里是连接时那一份，没有被命令响应改写。
  assert.equal(client.getState().snapshot.model.applied, null);
  client.dispose();
});

test('a receipt for another command leaves the model view untouched', async () => {
  const { stream } = withModel(() => {
    return jsonResponse({
      ok: true,
      value: {
        receipt: { commandId: 'someone-else', status: 'accepted', messageId: null, taskId: null },
        view: modelView({ enabled: true }),
      },
    });
  });
  const client = new CompanionClient({ refreshDelayMs: 5 });
  await connectLive(client, stream);
  const result = await client.saveModel({
    commandId: 'cmd-model',
    expectedProfileRevision: 1,
    connectorId: 'pet.model-connection-magpie/magpie',
    expectedConfigRevision: 1,
    mode: 'model',
  });
  assert.equal(result.ok, false);
  assert.equal(client.getState().snapshot.model.enabled, false);
  client.dispose();
});

test('a malformed model view in the command result is rejected, not half-applied', async () => {
  const { stream } = withModel((url, init) => {
    const body = JSON.parse(init.body);
    return jsonResponse({
      ok: true,
      value: {
        receipt: { commandId: body.commandId, status: 'accepted', messageId: null, taskId: null },
        view: { ...modelView(), desired: { mode: 'auto', connectorId: 'x' } },
      },
    });
  });
  const client = new CompanionClient({ refreshDelayMs: 5 });
  await connectLive(client, stream);
  const result = await client.saveModel({
    commandId: 'cmd-model',
    expectedProfileRevision: 1,
    connectorId: 'pet.model-connection-magpie/magpie',
    expectedConfigRevision: 1,
    mode: 'model',
  });
  assert.equal(result.ok, false);
  assert.equal(client.getState().snapshot.model.desired.mode, 'scripted');
  client.dispose();
});

test('the key travels only in its own request body and is never kept in state', async () => {
  const next = modelView({
    connectors: [
      {
        ...modelView().connectors[0],
        credential: {
          required: true,
          available: true,
          source: 'memory',
          version: 'process:9',
          writable: true,
        },
      },
    ],
  });
  const bodies = [];
  const { stream } = withModel((url, init) => {
    bodies.push({ url, body: JSON.parse(init.body) });
    return jsonResponse({ ok: true, value: next });
  });
  const client = new CompanionClient({ refreshDelayMs: 5 });
  await connectLive(client, stream);
  const result = await client.writeModelCredential({
    connectorId: 'pet.model-connection-magpie/magpie',
    expectedConfigRevision: 1,
    expectedCredentialVersion: 'process:1',
    apiKey: 'canary-key-value',
  });
  assert.equal(result.ok, true);
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].url, '/api/model/credential');
  assert.equal(bodies[0].body.apiKey, 'canary-key-value');
  assert.doesNotMatch(JSON.stringify(client.getState()), /canary-key-value/);
  client.dispose();
});

test('an explicit key removal sends null instead of an empty string', async () => {
  const bodies = [];
  const { stream } = withModel((url, init) => {
    bodies.push(JSON.parse(init.body));
    return jsonResponse({ ok: true, value: modelView() });
  });
  const client = new CompanionClient({ refreshDelayMs: 5 });
  await connectLive(client, stream);
  await client.writeModelCredential({
    connectorId: 'pet.model-connection-magpie/magpie',
    expectedConfigRevision: 1,
    expectedCredentialVersion: 'process:1',
    apiKey: null,
  });
  assert.equal(bodies[0].apiKey, null);
  client.dispose();
});

test('a test admission is one request and its 503 is a refusal, not a result', async () => {
  const { stream, calls } = withModel(() =>
    jsonResponse(
      { ok: false, error: { code: 'not-ready', messageKey: 'errors.not-ready', retryable: true } },
      503,
    ),
  );
  const client = new CompanionClient({ refreshDelayMs: 5 });
  await connectLive(client, stream);
  const result = await client.testModel({
    commandId: 'cmd-test',
    connectorId: 'pet.model-connection-magpie/magpie',
    expectedConfigRevision: 1,
    expectedCredentialVersion: 'process:1',
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'not-ready');
  assert.equal(calls.filter((call) => call.url === '/api/model/test').length, 1);
  assert.equal(client.getState().snapshot.model.check.state, 'unconfigured');
  client.dispose();
});
