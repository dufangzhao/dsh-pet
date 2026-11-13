import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { makeError } from '@pet/contracts';
import { createCloudExecPlugin } from '../src/index.ts';
import { docker } from '../src/docker.ts';
import { fixture, task, owner } from './fixtures.mjs';

const enabled = process.env['PET_CLOUD_EXEC_DOCKER_TEST'] === '1';
const integration = (name, body) => test(name, { skip: !enabled, timeout: 60_000 }, body);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const ok = { ok: true, value: null };

integration(
  'host-private binary material reaches real Docker once with unchanged text and output budgets',
  async (t) => {
    const { root, config } = await fixture(t);
    const current = task();
    const executionId = 'authorized-material-execution';
    const bytes = Buffer.alloc(2 * 1024 * 1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
    let readerCalls = 0;
    let execute;
    const definition = createCloudExecPlugin({
      readMaterial: async (input, consume) => {
        // Synthetic equivalent of the parent's existing ActiveWork identity + captured grant check.
        if (
          input.task.taskId !== current.taskId ||
          input.executionId !== executionId ||
          input.selection.materialId !== 'owned-private-material'
        )
          return { ok: false, error: makeError('permission-denied') };
        readerCalls++;
        await consume({
          sizeBytes: bytes.length,
          sha256: sha(bytes),
          check: async () => {
            assert.equal(input.task.signal.aborted, false);
          },
          chunks: (async function* () {
            for (let offset = 0; offset < bytes.length; offset += 65_536)
              yield bytes.subarray(offset, offset + 65_536);
          })(),
        });
        return ok;
      },
    });
    definition.activate({
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
    const request = {
      executionId,
      code: `import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const bytes = await readFile('incoming/blob.bin');
const text = await readFile('old.txt','utf8');
await appendFile('effects.txt', 'once\\n');
await writeFile('result.json', JSON.stringify({size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),text}));`,
      files: [{ path: 'old.txt', content: 'legacy text remains' }],
      materials: [{ materialId: 'owned-private-material', inputName: 'incoming/blob.bin' }],
      outputs: [{ path: 'result.json', mediaType: 'application/json' }, { path: 'effects.txt' }],
    };
    const [first, duplicate] = await Promise.all([
      execute(current, request),
      execute(current, request),
    ]);
    assert.equal(first.ok, true);
    assert.equal(first.value.exitCode, 0);
    assert.equal(first.value.error, null);
    assert.equal(first.value.settled, true);
    assert.deepEqual(duplicate, first);
    assert.equal(readerCalls, 1);
    const workspace = path.join(root, config.workspaceDirectory);
    const report = JSON.parse(
      await readFile(path.join(workspace, first.value.artifacts[0].relativePath), 'utf8'),
    );
    assert.deepEqual(report, {
      size: bytes.length,
      sha256: sha(bytes),
      text: 'legacy text remains',
    });
    assert.equal(
      await readFile(path.join(workspace, first.value.artifacts[1].relativePath), 'utf8'),
      'once\n',
    );
    assert.deepEqual(await execute(task(), request), first);
    assert.equal(readerCalls, 1);
    assert.equal(
      (
        await execute(current, {
          ...request,
          materials: [{ materialId: 'different', inputName: 'incoming/blob.bin' }],
        })
      ).error.code,
      'conflict',
    );
    const containers = await docker([
      'ps',
      '-a',
      '--filter',
      `label=pet.cloud-exec.job=${first.value.jobId}`,
      '--format',
      '{{.ID}}',
    ]);
    assert.equal(containers.code, 0);
    assert.equal(containers.stdout.trim(), '');
  },
);

integration(
  'guessed execution ID cannot read bytes without matching the host ActiveWork task binding',
  async (t) => {
    const allowedTask = task();
    let consumed = false;
    const { root, executor } = await fixture(t, {}, async (input, consume) => {
      if (input.task.taskId !== allowedTask.taskId || input.executionId !== 'logical-work')
        return { ok: false, error: makeError('permission-denied') };
      consumed = true;
      await consume({
        sizeBytes: 0,
        sha256: sha(Buffer.alloc(0)),
        check: async () => {},
        chunks: (async function* () {})(),
      });
      return ok;
    });
    const result = await executor.execute(task(), {
      executionId: 'logical-work',
      code: 'throw new Error("must not execute")',
      materials: [{ materialId: 'private', inputName: 'secret.bin' }],
    });
    assert.equal(result.error.code, 'permission-denied');
    assert.equal(consumed, false);
    for (const job of (await readdir(root)).filter((name) => !name.startsWith('.'))) {
      assert.deepEqual(await readdir(path.join(root, job, 'work')), []);
      const listed = await docker([
        'ps',
        '-a',
        '--filter',
        `label=pet.cloud-exec.job=${job}`,
        '--format',
        '{{.ID}}',
      ]);
      assert.equal(listed.stdout.trim(), '');
    }
  },
);

integration(
  'cancellation and configured timeout during staging join the reader and leave no binary or container',
  async (t) => {
    for (const mode of ['cancel', 'timeout']) {
      await t.test(mode, async (t) => {
        const controller = new AbortController();
        let copied;
        const firstChunk = new Promise((resolve) => {
          copied = resolve;
        });
        let closed = false;
        const bytes = Buffer.alloc(131_072, 0x8f);
        const { root, executor } = await fixture(t, {}, async (input, consume) => {
          await consume({
            sizeBytes: bytes.length,
            sha256: sha(bytes),
            check: async () => {},
            chunks: (async function* () {
              try {
                yield bytes.subarray(0, 65_536);
                copied();
                await new Promise((resolve) => {
                  if (input.task.signal.aborted) resolve();
                  else input.task.signal.addEventListener('abort', resolve, { once: true });
                });
              } finally {
                closed = true;
              }
            })(),
          });
          return ok;
        });
        const pending = executor.execute(task(controller), {
          executionId: `copy-${mode}`,
          timeoutMs: mode === 'timeout' ? 1000 : 10_000,
          code: 'throw new Error("must not execute")',
          materials: [{ materialId: 'private', inputName: 'secret.bin' }],
        });
        await firstChunk;
        if (mode === 'cancel') controller.abort();
        const result = await pending;
        assert.equal(result.error.code, mode === 'timeout' ? 'timeout' : 'cancelled');
        assert.equal(closed, true);
        for (const job of (await readdir(root)).filter((name) => !name.startsWith('.'))) {
          assert.deepEqual(await readdir(path.join(root, job, 'work')), []);
          const listed = await docker([
            'ps',
            '-a',
            '--filter',
            `label=pet.cloud-exec.job=${job}`,
            '--format',
            '{{.ID}}',
          ]);
          assert.equal(listed.code, 0);
          assert.equal(listed.stdout.trim(), '');
        }
      });
    }
  },
);
