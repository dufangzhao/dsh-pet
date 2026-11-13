import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  makeError,
  COMPANION_MATERIAL_INPUT_MAX_BYTES,
  COMPANION_TASK_MATERIAL_MAX,
} from '@pet/contracts';
import plugin, { DockerExecutor, parseConfig, parseRequest } from '../src/index.ts';
import { stageMaterials } from '../src/materials.ts';
import { createWorkspace } from '../src/workspace.ts';
import { expectedMounts, saveRecord, unknownResult } from '../src/records.ts';
import { fixture, task, owner } from './fixtures.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
function source(bytes, overrides = {}) {
  return {
    sizeBytes: bytes.length,
    sha256: sha(bytes),
    check: async () => {},
    chunks: (async function* () {
      yield bytes;
    })(),
    ...overrides,
  };
}
function reader(bytes) {
  return async (_request, consume) => {
    await consume(source(bytes));
    return { ok: true, value: null };
  };
}
async function staged(t, input = {}) {
  const value = await fixture(t);
  const request = {
    executionId: 'logical-material-execution',
    code: '1',
    materials: [{ materialId: 'material-1', inputName: 'input.bin' }],
    ...input,
  };
  assert.equal(parseRequest(request, value.config).ok, true);
  const jobId = randomUUID();
  await createWorkspace(value.root, jobId, request);
  return { ...value, request, jobId, work: path.join(value.root, jobId, 'work') };
}
async function rejectCode(pending, code) {
  await assert.rejects(pending, (error) => error.error?.code === code);
}

test('material selections reject host locators, traversal, collisions and oversized selection lists', () => {
  const config = parseConfig({ image: 'node:22' }).value;
  const selection = { materialId: 'material-1', inputName: 'input.bin' };
  for (const inputName of ['../secret', '/etc/passwd', 'a\\b', 'a//b', 'a/..', 'a\u0000b'])
    assert.equal(
      parseRequest({ code: '1', materials: [{ ...selection, inputName }] }, config).ok,
      false,
    );
  for (const extra of [
    { path: '/tmp/private' },
    { url: 'https://invalid.example' },
    { content: 'base64' },
    { sha256: 'a'.repeat(64) },
  ])
    assert.equal(
      parseRequest({ code: '1', materials: [{ ...selection, ...extra }] }, config).ok,
      false,
    );
  for (const [text, material] of [
    ['same', 'same'],
    ['dir', 'dir/file'],
    ['dir/file', 'dir'],
  ])
    assert.equal(
      parseRequest(
        {
          code: '1',
          files: [{ path: text, content: 'legacy' }],
          materials: [{ ...selection, inputName: material }],
        },
        config,
      ).ok,
      false,
    );
  assert.equal(
    parseRequest(
      {
        code: '1',
        materials: [selection, { materialId: 'material-2', inputName: 'input.bin/child' }],
      },
      config,
    ).ok,
    false,
  );
  assert.equal(
    parseRequest(
      { code: '1', materials: [selection, { ...selection, inputName: 'alias.bin' }] },
      config,
    ).ok,
    false,
  );
  assert.equal(parseRequest({ code: '1', materials: null }, config).ok, false);
  assert.equal(
    parseRequest(
      {
        code: '1',
        materials: Array.from({ length: COMPANION_TASK_MATERIAL_MAX + 1 }, (_, i) => ({
          materialId: `m-${i}`,
          inputName: `i-${i}`,
        })),
      },
      config,
    ).ok,
    false,
  );
  // The legacy string budget remains unchanged, regardless of an optional new field.
  assert.equal(
    parseRequest(
      { code: '1', files: [{ path: 'old.txt', content: 'a'.repeat(24_576) }], materials: [] },
      config,
    ).ok,
    true,
  );
  assert.equal(
    parseRequest({ code: '1', files: [{ path: 'old.txt', content: 'a'.repeat(24_577) }] }, config)
      .error.code,
    'quota-exceeded',
  );
});

test('default PluginDefinition refuses binary material requests without an injected reader', async (t) => {
  const { root, config } = await fixture(t);
  let execute;
  plugin.activate({
    owner,
    config,
    dataDirectory: root,
    signal: new AbortController().signal,
    provide(_id, methods) {
      execute = methods.execute;
    },
    effect(create) {
      t.after(create());
    },
  });
  const result = await execute(task(), {
    code: '1',
    materials: [{ materialId: 'guess', inputName: 'secret.bin' }],
  });
  assert.equal(result.error.code, 'unavailable');
  assert.deepEqual(await readdir(root), []);
});

test('private reader receives actual task and logical identity; verified binary bytes coexist with text inputs', async (t) => {
  const { root, request, jobId, work } = await staged(t, {
    files: [{ path: 'old.txt', content: 'unchanged' }],
  });
  const current = task();
  const bytes = Buffer.alloc(128 * 1024, 0xff);
  let reads = 0;
  await stageMaterials(
    root,
    jobId,
    request,
    current,
    request.executionId,
    async (input, consume) => {
      assert.equal(input.task.taskId, current.taskId);
      assert.equal(input.executionId, request.executionId);
      assert.deepEqual(input.selection, request.materials[0]);
      assert.deepEqual(Object.keys(input).sort(), ['executionId', 'selection', 'task']);
      assert.equal(Object.isFrozen(input.selection), true);
      reads++;
      await consume(source(bytes));
      return { ok: true, value: null };
    },
  );
  assert.equal(reads, 1);
  assert.deepEqual(await readFile(path.join(work, 'input.bin')), bytes);
  assert.equal(await readFile(path.join(work, 'old.txt'), 'utf8'), 'unchanged');
});

test('hash, exact size, skipped consumption and denied host authority all refuse and remove partial bytes', async (t) => {
  for (const mode of ['hash', 'short', 'long', 'skip', 'denied', 'swallowed', 'duplicate']) {
    await t.test(mode, async (t) => {
      const { root, request, jobId, work } = await staged(t);
      const bytes = Buffer.from('verified binary');
      const pending = stageMaterials(
        root,
        jobId,
        request,
        task(),
        request.executionId,
        async (_input, consume) => {
          if (mode === 'skip') return { ok: true, value: null };
          if (mode === 'denied') return { ok: false, error: makeError('permission-denied') };
          const value = source(bytes, {
            ...(mode === 'hash' || mode === 'swallowed' ? { sha256: '0'.repeat(64) } : {}),
            ...(mode === 'short' ? { sizeBytes: bytes.length + 1 } : {}),
            ...(mode === 'long' ? { sizeBytes: bytes.length - 1 } : {}),
          });
          if (mode === 'swallowed') {
            try {
              await consume(value);
            } catch {
              /* host fixture violation */
            }
          } else await consume(value);
          if (mode === 'duplicate') {
            try {
              await consume(source(bytes));
            } catch {
              /* host fixture violation */
            }
          }
          return { ok: true, value: null };
        },
      );
      await rejectCode(pending, mode === 'denied' ? 'permission-denied' : 'invalid-input');
      assert.deepEqual(await readdir(work), []);
    });
  }
});

test('revocation and cancellation before or during a copy join source cleanup and remove prior staged files', async (t) => {
  for (const mode of ['before', 'cancel', 'revoke']) {
    await t.test(mode, async (t) => {
      const { root, request, jobId, work } = await staged(t, {
        materials: [
          { materialId: 'one', inputName: 'one.bin' },
          { materialId: 'two', inputName: 'two.bin' },
        ],
      });
      const controller = new AbortController();
      const bytes = Buffer.from('abcd');
      let readCount = 0,
        returned = false,
        revoked = false;
      if (mode === 'before') controller.abort();
      const pending = stageMaterials(
        root,
        jobId,
        request,
        task(controller),
        request.executionId,
        async (input, consume) => {
          readCount++;
          if (input.selection.materialId === 'one') await consume(source(bytes));
          else
            await consume(
              source(bytes, {
                check: async () => {
                  if (revoked) throw { error: makeError('permission-denied') };
                },
                chunks: (async function* () {
                  try {
                    yield bytes.subarray(0, 2);
                    if (mode === 'cancel') controller.abort();
                    else revoked = true;
                    yield bytes.subarray(2);
                  } finally {
                    returned = true;
                  }
                })(),
              }),
            );
          return { ok: true, value: null };
        },
      );
      await rejectCode(pending, mode === 'revoke' ? 'permission-denied' : 'cancelled');
      assert.equal(readCount, mode === 'before' ? 0 : 2);
      if (mode !== 'before') assert.equal(returned, true);
      assert.deepEqual(await readdir(work), []);
    });
  }
});

test('the real aggregate input limit is 32 MiB, including text; overflow is refused before consuming bytes', async (t) => {
  const { root, request, jobId, work } = await staged(t);
  const block = Buffer.alloc(65_536, 0xab);
  const hash = createHash('sha256');
  for (let i = 0; i < COMPANION_MATERIAL_INPUT_MAX_BYTES / block.length; i++) hash.update(block);
  const digest = hash.digest('hex');
  await stageMaterials(
    root,
    jobId,
    request,
    task(),
    request.executionId,
    async (_input, consume) => {
      await consume({
        sizeBytes: COMPANION_MATERIAL_INPUT_MAX_BYTES,
        sha256: digest,
        check: async () => {},
        chunks: (async function* () {
          for (let i = 0; i < 512; i++) yield block;
        })(),
      });
      return { ok: true, value: null };
    },
  );
  assert.equal((await stat(path.join(work, 'input.bin'))).size, COMPANION_MATERIAL_INPUT_MAX_BYTES);
  assert.equal(sha(await readFile(path.join(work, 'input.bin'))), digest);
  const second = await staged(t, { files: [{ path: 'text.txt', content: 'x' }] });
  let consumed = false;
  await rejectCode(
    stageMaterials(
      second.root,
      second.jobId,
      second.request,
      task(),
      second.request.executionId,
      async (_input, consume) => {
        await consume({
          sizeBytes: COMPANION_MATERIAL_INPUT_MAX_BYTES,
          sha256: digest,
          check: async () => {},
          chunks: (async function* () {
            consumed = true;
            yield block;
          })(),
        });
        return { ok: true, value: null };
      },
    ),
    'quota-exceeded',
  );
  assert.equal(consumed, false);
  assert.deepEqual(await readdir(second.work), ['text.txt']);
});

test('copy refuses existing files and symlink ancestors without touching the target', async (t) => {
  const { root, request, jobId, work } = await staged(t);
  const outside = path.join(root, 'protected.txt');
  await writeFile(outside, 'private');
  await symlink(outside, path.join(work, 'input.bin'));
  await assert.rejects(
    stageMaterials(
      root,
      jobId,
      request,
      task(),
      request.executionId,
      reader(Buffer.from('replace')),
    ),
  );
  assert.equal(await readFile(outside, 'utf8'), 'private');
  const other = await staged(t, {
    materials: [{ materialId: 'm', inputName: 'link/protected.txt' }],
  });
  await symlink(root, path.join(other.work, 'link'));
  await assert.rejects(
    stageMaterials(
      other.root,
      other.jobId,
      other.request,
      task(),
      other.request.executionId,
      reader(Buffer.from('replace')),
    ),
  );
  assert.equal(await readFile(outside, 'utf8'), 'private');
});

test('legacy request fingerprints and terminal receipts survive the optional materials field', async (t) => {
  const { root, config } = await fixture(t);
  const executionId = 'legacy-exec';
  const request = {
    executionId,
    code: 'console.log("once")',
    files: [{ path: 'text.txt', content: 'old' }],
    outputs: [],
  };
  const hash = createHash('sha256')
    .update(
      JSON.stringify({ code: request.code, files: request.files, outputs: [], timeoutMs: null }),
    )
    .digest('hex');
  const jobId = randomUUID();
  const result = { ...unknownResult(jobId), settled: true };
  await saveRecord(root, {
    version: 1,
    executionId,
    requestHash: hash,
    owner: `${owner.pluginId}:test:1:${randomUUID()}`,
    taskId: 'old-kernel-task',
    jobId,
    containerName: `pet-cloud-exec-${jobId}`,
    containerId: null,
    mounts: expectedMounts(root, jobId),
    outputs: [],
    config,
    result,
  });
  const executor = new DockerExecutor({
    workspaceRoot: root,
    config,
    owner,
    readMaterial: async () => {
      throw new Error('must not read on replay');
    },
  });
  assert.deepEqual(await executor.execute(task(), request), { ok: true, value: result });
  assert.deepEqual(await executor.execute(task(), { ...request, materials: [] }), {
    ok: true,
    value: result,
  });
  assert.equal(
    (
      await executor.execute(task(), {
        ...request,
        materials: [{ materialId: 'changed', inputName: 'new.bin' }],
      })
    ).error.code,
    'conflict',
  );
  await executor.close();
});
