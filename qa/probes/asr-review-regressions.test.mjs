// Lead regressions for the previously rejected downloader, including publication cleanup.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { runDownload, processFile } from './asr-download.mjs';

const bytes = Buffer.from('public-review-fixture');
const revision = '1'.repeat(40);
const repository = 'review/fixture';
function spec(filePath = 'tokens.txt') {
  return { path: filePath, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
    url: 'https://huggingface.co/' + repository + '/resolve/' + revision + '/' + filePath };
}
function model(filePath) { return { id: 'review-model', repository, revision, files: [spec(filePath)] }; }
async function fixture(filePath) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-lead-asr-review-'));
  const repo = path.join(root, 'repo');
  const outside = path.join(root, 'outside-intended-cache');
  await fs.mkdir(repo);
  await fs.mkdir(outside);
  const value = model(filePath);
  await fs.writeFile(path.join(repo, 'fixture.json'), JSON.stringify({ schemaVersion: 1, models: [value] }));
  return { root, repo, outside, value };
}

test('reject a junction in an ancestor of the cache root before any download', async (t) => {
  const f = await fixture('tokens.txt');
  try {
    try { await fs.symlink(f.outside, path.join(f.repo, '.cache'), 'junction'); }
    catch (error) {
      if (error.code === 'EPERM' || error.code === 'EACCES') { t.skip('OS refused test junction'); return; }
      throw error;
    }
    await assert.rejects(runDownload({ repoRoot: f.repo, manifestPath: 'fixture.json',
      fetchImpl: async () => new Response(bytes) }),
    (error) => error.code === 'E_REPARSE_POINT');
    assert.deepEqual(await fs.readdir(f.outside), []);
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});

test('offline verification rejects a junction in an intermediate sample directory', async (t) => {
  const f = await fixture('test_wavs/zh.wav');
  try {
    const modelDir = path.join(f.repo, '.cache/asr-models/review-model');
    await fs.mkdir(modelDir, { recursive: true });
    await fs.writeFile(path.join(f.outside, 'zh.wav'), bytes);
    try { await fs.symlink(f.outside, path.join(modelDir, 'test_wavs'), 'junction'); }
    catch (error) {
      if (error.code === 'EPERM' || error.code === 'EACCES') { t.skip('OS refused test junction'); return; }
      throw error;
    }
    const result = await runDownload({ repoRoot: f.repo, manifestPath: 'fixture.json', checkOnly: true,
      fetchImpl: async () => { throw new Error('Offline mode must not fetch'); } });
    assert.equal(result.receipt.ok, false);
    assert.equal(result.receipt.models[0].files[0].error.code, 'E_REPARSE_POINT');
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});

test('atomic publication never overwrites a file appearing after the existence check', async () => {
  const f = await fixture('tokens.txt');
  const target = path.join(f.repo, 'tokens.txt');
  const originalRename = fs.rename;
  const originalLink = fs.link;
  // Deterministically inject a concurrent writer at the publication system call.
  const inject = (original) => async (source, destination) => {
    if (destination === target) await fs.writeFile(target, 'other-writer', { flag: 'wx' });
    return original(source, destination);
  };
  fs.rename = inject(originalRename);
  fs.link = inject(originalLink);
  try {
    const outcome = await processFile({ model: f.value, file: f.value.files[0], modelDir: f.repo,
      fetchImpl: async () => new Response(bytes) }).then(() => 'published', () => 'refused');
    assert.equal(await fs.readFile(target, 'utf8'), 'other-writer', 'concurrent content must remain intact');
    assert.equal(outcome, 'refused');
  } finally {
    fs.rename = originalRename;
    fs.link = originalLink;
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test('reports cleanup failure rather than claiming a fully cleaned download', async () => {
  const f = await fixture('tokens.txt');
  const originalRm = fs.rm;
  fs.rm = async (target, options) => {
    if (typeof target === 'string' && target.startsWith(f.repo + path.sep) && target.endsWith('.part')) {
      const error = new Error('synthetic cleanup failure'); error.code = 'EPERM'; throw error;
    }
    return originalRm(target, options);
  };
  try {
    await assert.rejects(processFile({ model: f.value, file: f.value.files[0], modelDir: f.repo,
      fetchImpl: async () => new Response(bytes) }), /synthetic cleanup failure/);
    assert.deepEqual(await fs.readFile(path.join(f.repo, 'tokens.txt')), bytes);
  } finally {
    fs.rm = originalRm;
    await fs.rm(f.root, { recursive: true, force: true });
  }
});
