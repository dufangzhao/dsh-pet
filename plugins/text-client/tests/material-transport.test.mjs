/**
 * 材料读取的协议回归。
 *
 * 起一个真的 127.0.0.1 服务，用真的 fetch 验证四件事：
 * - 全文与下载都走带认证的请求，token 不进 URL。
 * - 超过上限按真实字节数拒绝，不把半截内容当正文。
 * - 服务端错误映射成明确的失败，而不是空字符串。
 * - 文件名从 Content-Disposition 取；没有就不编。
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import {
  MATERIAL_DOWNLOAD_MAX_BYTES,
  MATERIAL_TEXT_MAX_BYTES,
  readMaterialBlob,
  readMaterialText,
} from '../src/client/material-transport.ts';

/** 真服务：按路径返回固定字节，并记录收到的请求头。 */
async function serve(handler) {
  const requests = [];
  const server = createServer(async (request, response) => {
    requests.push({ url: request.url, headers: request.headers });
    await handler(request, response);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    transport: { baseUrl: `http://127.0.0.1:${port}`, token: 'synthetic-token' },
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test('全文走带认证的 GET，token 不进 URL', async () => {
  const service = await serve((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('完整正文');
  });
  try {
    const result = await readMaterialText(service.transport, 'mat-1');
    assert.equal(result.ok, true);
    assert.equal(result.value, '完整正文');
    const sent = service.requests[0];
    assert.equal(sent.url, '/api/materials/mat-1');
    assert.equal(sent.headers.authorization, 'Bearer synthetic-token');
    // 关键：token 不能出现在 URL 里。
    assert.doesNotMatch(sent.url, /token/i);
  } finally {
    await service.close();
  }
});

test('超过全文上限按真实字节数拒绝，不返回截断内容', async () => {
  const oversized = 'x'.repeat(MATERIAL_TEXT_MAX_BYTES + 1);
  const service = await serve((_request, response) => {
    // 故意不报 Content-Length：走实际字节数那条判断。
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.end(oversized);
  });
  try {
    const result = await readMaterialText(service.transport, 'mat-big');
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'quota-exceeded');
  } finally {
    await service.close();
  }
});

test('服务端说 Content-Length 超限时提前拒绝，不读完', async () => {
  const service = await serve((_request, response) => {
    response.writeHead(200, {
      'Content-Type': 'text/plain',
      'Content-Length': String(MATERIAL_TEXT_MAX_BYTES + 10),
    });
    response.end('x'.repeat(MATERIAL_TEXT_MAX_BYTES + 10));
  });
  try {
    const result = await readMaterialText(service.transport, 'mat-declared');
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'quota-exceeded');
  } finally {
    await service.close();
  }
});

test('404 映射成不可用，不是空正文', async () => {
  const service = await serve((_request, response) => {
    response.writeHead(404).end('{"ok":false}');
  });
  try {
    const result = await readMaterialText(service.transport, 'mat-missing');
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'unavailable');
  } finally {
    await service.close();
  }
});

test('403 映射成认证失败', async () => {
  const service = await serve((_request, response) => {
    response.writeHead(403).end();
  });
  try {
    const result = await readMaterialText(service.transport, 'mat-denied');
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'auth-failed');
  } finally {
    await service.close();
  }
});

test('下载取原始字节并从 Content-Disposition 取文件名', async () => {
  const bytes = new Uint8Array([0x01, 0x02, 0x03, 0x00, 0xff]);
  const service = await serve((_request, response) => {
    response.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': "attachment; filename*=UTF-8''%E5%BD%95%E9%9F%B3.silk",
    });
    response.end(Buffer.from(bytes));
  });
  try {
    const result = await readMaterialBlob(service.transport, 'mat-file');
    assert.equal(result.ok, true);
    assert.equal(result.value.filename, '录音.silk');
    assert.deepEqual(new Uint8Array(await result.value.blob.arrayBuffer()), bytes);
  } finally {
    await service.close();
  }
});

test('下载没有文件名时不编一个', async () => {
  const service = await serve((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    response.end(Buffer.from([1, 2]));
  });
  try {
    const result = await readMaterialBlob(service.transport, 'mat-noname');
    assert.equal(result.ok, true);
    assert.equal(result.value.filename, null);
  } finally {
    await service.close();
  }
});

test('下载超过上限拒绝', async () => {
  const service = await serve((_request, response) => {
    response.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(MATERIAL_DOWNLOAD_MAX_BYTES + 1),
    });
    response.end();
  });
  try {
    const result = await readMaterialBlob(service.transport, 'mat-huge');
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'quota-exceeded');
  } finally {
    await service.close();
  }
});

test('材料 id 会被 URL 编码，不能拼出别的路径', async () => {
  const service = await serve((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.end('ok');
  });
  try {
    await readMaterialText(service.transport, '../secrets');
    assert.equal(service.requests[0].url, '/api/materials/..%2Fsecrets');
  } finally {
    await service.close();
  }
});

test('无 Content-Length 时按块计数，越界立即取消而不是读完', async () => {
  // 直接替换 fetch：body 是一个能数「客户端拉了几次」的流。
  // 这样断言的是**客户端**行为，而不是服务端怎么推。
  const chunk = new Uint8Array(32 * 1024).fill(7);
  let pulls = 0;
  let cancelled = false;
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            pulls += 1;
            if (pulls > 8) {
              controller.close();
              return;
            }
            controller.enqueue(chunk);
          },
          cancel() {
            cancelled = true;
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/plain' } },
      );
    const result = await readMaterialText({ baseUrl: '', token: 't' }, 'mat-chunked');
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'quota-exceeded');
    // 64KiB 上限 + 32KiB 块：第 3 块就超了，绝不该读到第 9 块。
    assert.ok(pulls <= 4, `越界后应当立即停止，实际拉了 ${pulls} 块`);
    assert.equal(cancelled, true, '越界后必须 cancel 剩余传输');
  } finally {
    globalThis.fetch = original;
  }
});
