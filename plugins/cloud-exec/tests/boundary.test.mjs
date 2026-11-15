import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseConfig, parseRequest } from '../src/index.ts';
import { retainArtifacts, checkedDirectory } from '../src/workspace.ts';
import { fixture, task } from './fixtures.mjs';

test('request rejects traversal, absolute paths, unknown execution switches and oversize input', () => {
  const config = parseConfig({ image: 'node:22' }).value;
  for (const unsafe of [
    '../secret',
    '/tmp/secret',
    'a/../../b',
    'a\\b',
    'a//b',
    '.',
    'a/.hidden',
    'a\u0000b',
  ]) {
    assert.equal(parseRequest({ code: '1', outputs: [{ path: unsafe }] }, config).ok, false);
    assert.equal(
      parseRequest({ code: '1', files: [{ path: unsafe, content: '' }] }, config).ok,
      false,
    );
  }
  assert.equal(parseRequest({ code: '1', image: 'other' }, config).ok, false);
  assert.equal(parseRequest({ code: '1', network: true }, config).ok, false);
  assert.equal(parseRequest({ code: 'x'.repeat(16_385) }, config).ok, false);
  assert.equal(parseRequest({ code: '1', timeoutMs: config.timeoutMs + 1 }, config).ok, false);
  assert.equal(
    parseRequest({ code: '1', outputs: [{ path: 'out.txt' }, { path: 'out.txt' }] }, config).ok,
    false,
  );
  for (const executionId of ['', '../escape', 'a'.repeat(201), 'with space']) {
    assert.equal(parseRequest({ executionId, code: '1' }, config).ok, false);
  }
  assert.equal(parseConfig({ image: '--privileged' }).ok, false);
  assert.equal(parseConfig({ image: 'node:22', workspaceDirectory: '../other' }).ok, false);
});

test('artifact collection refuses symlinks, symlink ancestors and directory escape', async (t) => {
  const { root } = await fixture(t);
  for (const [index, unsafe] of ['link', 'dir/file', '../secret'].entries()) {
    const job = path.join(root, `job-${index}`);
    await mkdir(path.join(job, 'work'), { recursive: true });
    await writeFile(path.join(job, 'secret'), 'never expose');
    await symlink('../secret', path.join(job, 'work/link'));
    await symlink('..', path.join(job, 'work/dir'));
    await assert.rejects(retainArtifacts(root, `job-${index}`, [{ path: unsafe }], 1024));
  }
  await symlink(root, path.join(root, 'redirect'));
  await assert.rejects(checkedDirectory(path.join(root, 'redirect')));
});

test('reconcile rejects invalid cursors and limits at the provider boundary', async (t) => {
  const { executor } = await fixture(t);
  for (const input of [
    null,
    [],
    { after: '../escape' },
    { limit: 0 },
    { limit: 9 },
    { limit: 1.5 },
    { unknown: true },
  ]) {
    const result = await executor.reconcile(input);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'invalid-input');
  }
  assert.deepEqual(await executor.reconcile({ limit: 1 }), {
    ok: true,
    value: { receipts: [], nextCursor: null },
  });
});

test('missing Docker reports unavailable without creating workspace jobs', async (t) => {
  const { executor } = await fixture(t);
  const previous = process.env['PATH'];
  process.env['PATH'] = '';
  try {
    const result = await executor.execute(task(), { code: 'console.log("never host executed")' });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'unavailable');
  } finally {
    if (previous === undefined) delete process.env['PATH'];
    else process.env['PATH'] = previous;
  }
});
