// M0-04 下载脚本单元测试。
// 全部使用临时目录与本机 fixture / 假响应，不下载真实模型、不访问网络。

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  AsrDownloadError,
  DEFAULT_CACHE_ROOT,
  DEFAULT_DOWNLOAD_TIMEOUT_MS,
  DEFAULT_HEADERS_TIMEOUT_MS,
  DEFAULT_MANIFEST_PATH,
  MAX_FILE_BYTES,
  RECEIPT_NAME,
  assertNoReparsePoint,
  assertSafeDirectoryChain,
  compareHash,
  ensureSafeDirectory,
  expectedHashOf,
  gitBlobHeader,
  gitBlobSha1OfBuffer,
  hashFileAt,
  isAllowedRedirectHost,
  loadManifest,
  main,
  processFile,
  publishNoOverwrite,
  resolveTargetPath,
  runDownload,
  sha256OfBuffer,
  fetchWithRedirects,
  safeUrlForLog,
  streamResponseToFile,
  toSafeSegmentsWithin,
  validateDownloadUrl,
  validateManifest,
  validateModelId,
  validateRedirectUrl,
  validateRelativePath,
} from './asr-download.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');

// 本机固定 fixture（内容与哈希都预先算好，不依赖下载）
const FIXTURE_TEXT = 'test content\n';
const FIXTURE_BYTES = Buffer.from(FIXTURE_TEXT, 'utf8');
const FIXTURE_GIT_BLOB = 'd670460b4b4aece5915caf5c68d12f560a9fe3e4';
const FIXTURE_SHA256 = 'a1fff0ffefb9eace7230c24e50731f0a91c62f9cefdfe77121c2f607125dffae';

const REPO = 'csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17';
const REV = '2365baeacb507f821a0c8120fcee3d484dba7a07';
const FILE = 'tokens.txt';
const GOOD_URL = 'https://huggingface.co/' + REPO + '/resolve/' + REV + '/' + FILE;

let tmpRoot;
before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'asr-download-test-'));
});
after(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true });
});

let counter = 0;
async function newTempDir(label) {
  counter += 1;
  const dir = path.join(tmpRoot, label + '-' + counter);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/** 构造一个内容固定的假响应。 */
function fakeResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(body, { status, headers });
}

/** 构造一个假 fetch：按 URL 返回预设响应，并记录每次调用的参数。 */
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const route = routes[url];
    if (!route) throw new Error('unexpected fetch: ' + url);
    return typeof route === 'function' ? route(url, init) : route;
  };
  impl.calls = calls;
  return impl;
}

function makeFileSpec(overrides = {}) {
  return {
    path: FILE,
    bytes: FIXTURE_BYTES.length,
    gitBlobSha1: FIXTURE_GIT_BLOB,
    url: GOOD_URL,
    ...overrides,
  };
}

function makeModel(overrides = {}) {
  return {
    id: 'sensevoice-small-int8',
    repository: REPO,
    revision: REV,
    source: 'https://huggingface.co/api/models/' + REPO + '?blobs=true',
    files: [makeFileSpec()],
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */

describe('model.id 校验', () => {
  test('接受清单里的真实 id', () => {
    assert.equal(validateModelId('sensevoice-small-int8'), 'sensevoice-small-int8');
    assert.equal(validateModelId('streaming-paraformer-zh-en-int8'), 'streaming-paraformer-zh-en-int8');
  });

  for (const bad of ['', '../evil', 'a/b', 'a\\b', 'C:tmp', 'CON', 'con', 'nul.txt', 'x.', 'Upper', '.hidden', '-lead']) {
    test('拒绝危险 id: ' + JSON.stringify(bad), () => {
      assert.throws(() => validateModelId(bad), (error) => error instanceof AsrDownloadError);
    });
  }
});

describe('相对路径校验', () => {
  test('接受清单里的真实路径', () => {
    assert.deepEqual(validateRelativePath('model.int8.onnx'), ['model.int8.onnx']);
    assert.deepEqual(validateRelativePath('test_wavs/zh.wav'), ['test_wavs', 'zh.wav']);
  });

  for (const bad of ['/etc/passwd', 'C:/windows/x', 'C:\\windows\\x', '../escape.txt', 'a/../../b', 'a//b', 'a\\b', 'con/x.txt', 'x.txt:stream', './a', 'a/.', 'a/ ']) {
    test('拒绝危险路径: ' + JSON.stringify(bad), () => {
      assert.throws(() => validateRelativePath(bad), (error) => error instanceof AsrDownloadError);
    });
  }

  test('解析后的路径不会逃出模型目录', async () => {
    const modelDir = await newTempDir('resolve');
    assert.equal(resolveTargetPath(modelDir, 'test_wavs/zh.wav'), path.join(modelDir, 'test_wavs', 'zh.wav'));
    assert.throws(() => resolveTargetPath(modelDir, '../escape.txt'), /路径/);
  });
});

describe('下载地址校验', () => {
  const ctx = { repository: REPO, revision: REV, filePath: FILE };

  test('接受清单里的真实地址', () => {
    assert.equal(validateDownloadUrl(GOOD_URL, ctx), GOOD_URL);
  });

  test('拒绝 http', () => {
    assert.throws(() => validateDownloadUrl(GOOD_URL.replace('https:', 'http:'), ctx), /https/);
  });

  test('拒绝内嵌凭据', () => {
    assert.throws(
      () => validateDownloadUrl(GOOD_URL.replace('https://', 'https://user:pass@'), ctx),
      /凭据/,
    );
  });

  test('拒绝非 huggingface.co 主机', () => {
    assert.throws(
      () => validateDownloadUrl(GOOD_URL.replace('huggingface.co', 'evil.example.com'), ctx),
      /主机/,
    );
  });

  test('拒绝非 443 端口', () => {
    assert.throws(() => validateDownloadUrl(GOOD_URL.replace('huggingface.co', 'huggingface.co:8443'), ctx), /端口/);
  });

  test('拒绝 revision 不是 40 位', () => {
    assert.throws(() => validateDownloadUrl(GOOD_URL, { ...ctx, revision: 'main' }), /revision/);
    assert.throws(() => validateDownloadUrl(GOOD_URL.replace(REV, 'abc'), ctx), /前缀/);
  });

  test('拒绝 revision 与地址不一致', () => {
    const other = '0'.repeat(40);
    assert.throws(() => validateDownloadUrl(GOOD_URL.replace(REV, other), ctx), /前缀/);
  });

  test('拒绝文件名与 path 不一致', () => {
    assert.throws(() => validateDownloadUrl(GOOD_URL, { ...ctx, filePath: 'other.txt' }), /文件名/);
  });

  test('拒绝查询串', () => {
    assert.throws(() => validateDownloadUrl(GOOD_URL + '?download=1', ctx), /查询串/);
  });

  test('重定向主机白名单', () => {
    assert.equal(isAllowedRedirectHost('huggingface.co'), true);
    assert.equal(isAllowedRedirectHost('cdn-lfs.huggingface.co'), true);
    assert.equal(isAllowedRedirectHost('cdn-lfs-us-1.hf.co'), true);
    assert.equal(isAllowedRedirectHost('evil-huggingface.co'), false);
    assert.equal(isAllowedRedirectHost('huggingface.co.evil.com'), false);
    assert.equal(isAllowedRedirectHost('evil.com'), false);
  });

  test('重定向目标必须 https 且在允许域', () => {
    assert.equal(
      validateRedirectUrl('https://cdn-lfs.huggingface.co/x/y', GOOD_URL),
      'https://cdn-lfs.huggingface.co/x/y',
    );
    assert.throws(() => validateRedirectUrl('https://evil.com/x', GOOD_URL), /允许列表/);
    assert.throws(() => validateRedirectUrl('http://cdn-lfs.huggingface.co/x', GOOD_URL), /https/);
  });
});

describe('哈希计算', () => {
  test('git blob 头格式为 blob <n>\\0', () => {
    assert.deepEqual([...gitBlobHeader(13)], [...Buffer.from('blob 13\u0000')]);
    assert.throws(() => gitBlobHeader(-1), /非负整数/);
  });

  test('git blob sha1 与已知向量一致', () => {
    assert.equal(gitBlobSha1OfBuffer(FIXTURE_BYTES), FIXTURE_GIT_BLOB);
  });

  test('sha256 与已知向量一致', () => {
    assert.equal(sha256OfBuffer(FIXTURE_BYTES), FIXTURE_SHA256);
  });

  test('hashFileAt 同时给出字节数、sha256、git blob sha1', async () => {
    const dir = await newTempDir('hash');
    const file = path.join(dir, 'fixture.bin');
    await fs.writeFile(file, FIXTURE_BYTES);
    const actual = await hashFileAt(file);
    assert.deepEqual(actual, {
      bytes: FIXTURE_BYTES.length,
      sha256: FIXTURE_SHA256,
      gitBlobSha1: FIXTURE_GIT_BLOB,
    });
  });

  test('hashFileAt 拒绝符号链接', async (t) => {
    const dir = await newTempDir('hash-link');
    const target = path.join(dir, 'real.bin');
    const link = path.join(dir, 'link.bin');
    await fs.writeFile(target, FIXTURE_BYTES);
    try {
      await fs.symlink(target, link, 'file');
    } catch (error) {
      // 无建链权限时必须显式 skip：直接 return 会被统计成 pass，掩盖分支未执行。
      if (error.code === 'EPERM' || error.code === 'EACCES') {
        t.skip('OS refused test symlink: ' + error.code);
        return;
      }
      throw error;
    }
    await assert.rejects(hashFileAt(link), /符号链接/);
  });

  test('compareHash 先比字节数再比哈希', () => {
    const actual = { bytes: 13, sha256: FIXTURE_SHA256, gitBlobSha1: FIXTURE_GIT_BLOB };
    assert.equal(compareHash(actual, { algorithm: 'git-blob-sha1', value: FIXTURE_GIT_BLOB }, 13), null);
    assert.equal(compareHash(actual, { algorithm: 'sha256', value: FIXTURE_SHA256 }, 13), null);
    assert.equal(compareHash(actual, { algorithm: 'sha256', value: FIXTURE_SHA256 }, 14).code, 'E_SIZE_MISMATCH');
    assert.equal(compareHash(actual, { algorithm: 'sha256', value: '0'.repeat(64) }, 13).code, 'E_HASH_MISMATCH');
  });

  test('expectedHashOf 按条目选择算法并拒绝无效值', () => {
    assert.deepEqual(expectedHashOf({ sha256: FIXTURE_SHA256 }), { algorithm: 'sha256', value: FIXTURE_SHA256 });
    assert.deepEqual(expectedHashOf({ gitBlobSha1: FIXTURE_GIT_BLOB }), { algorithm: 'git-blob-sha1', value: FIXTURE_GIT_BLOB });
    assert.throws(() => expectedHashOf({}), /既没有/);
    assert.throws(() => expectedHashOf({ sha256: 'xyz' }), /sha256/);
    assert.throws(() => expectedHashOf({ gitBlobSha1: 'abc' }), /gitBlobSha1/);
  });
});

describe('流式落盘', () => {
  test('按块写入并返回实测哈希', async () => {
    const dir = await newTempDir('stream');
    const partPath = path.join(dir, 'a.part');
    const body = Readable.toWeb(Readable.from([
      FIXTURE_BYTES.subarray(0, 4),
      FIXTURE_BYTES.subarray(4),
    ]));
    const actual = await streamResponseToFile({ body, partPath, expectedBytes: FIXTURE_BYTES.length });
    assert.equal(actual.sha256, FIXTURE_SHA256);
    assert.equal(actual.gitBlobSha1, FIXTURE_GIT_BLOB);
    assert.deepEqual(await fs.readFile(partPath), FIXTURE_BYTES);
  });

  test('超过声明字节数立即中止', async () => {
    const dir = await newTempDir('stream-over');
    const partPath = path.join(dir, 'b.part');
    const body = Readable.toWeb(Readable.from([Buffer.alloc(64, 1)]));
    await assert.rejects(
      streamResponseToFile({ body, partPath, expectedBytes: 10 }),
      (error) => error instanceof AsrDownloadError && error.code === 'E_TOO_LARGE',
    );
  });

  test('字节数不足时报 E_SIZE_MISMATCH', async () => {
    const dir = await newTempDir('stream-short');
    const partPath = path.join(dir, 'c.part');
    const body = Readable.toWeb(Readable.from([Buffer.alloc(4, 1)]));
    await assert.rejects(
      streamResponseToFile({ body, partPath, expectedBytes: 10 }),
      (error) => error instanceof AsrDownloadError && error.code === 'E_SIZE_MISMATCH',
    );
  });

  test('拒绝超过单文件上限的期望字节数', async () => {
    const dir = await newTempDir('stream-limit');
    const body = Readable.toWeb(Readable.from([Buffer.alloc(1)]));
    await assert.rejects(
      streamResponseToFile({ body, partPath: path.join(dir, 'd.part'), expectedBytes: MAX_FILE_BYTES + 1 }),
      /上限/,
    );
  });
});

describe('清单校验', () => {
  test('仓库中的真实清单通过校验', async () => {
    const { manifest, sha256 } = await loadManifest(path.resolve(REPO_ROOT, DEFAULT_MANIFEST_PATH));
    assert.equal(manifest.models.length, 2);
    assert.equal(manifest.models[0].id, 'sensevoice-small-int8');
    assert.match(sha256, /^[0-9a-f]{64}$/);
    const counts = validateManifest(manifest);
    assert.equal(counts.fileCount, 12);
    assert.ok(counts.totalBytes > 400 * 1024 * 1024);
  });

  test('拒绝重复 id', () => {
    assert.throws(() => validateManifest({ schemaVersion: 1, models: [makeModel(), makeModel()] }), /重复/);
  });

  test('拒绝非 40 位 revision', () => {
    assert.throws(() => validateManifest({ schemaVersion: 1, models: [makeModel({ revision: 'main' })] }), /revision/);
  });

  test('拒绝绝对路径', () => {
    const model = makeModel({ files: [makeFileSpec({ path: '/etc/passwd', url: GOOD_URL })] });
    assert.throws(() => validateManifest({ schemaVersion: 1, models: [model] }), /绝对路径/);
  });

  test('拒绝缺少哈希的条目', () => {
    const model = makeModel({ files: [{ path: FILE, bytes: 13, url: GOOD_URL }] });
    assert.throws(() => validateManifest({ schemaVersion: 1, models: [model] }), /既没有/);
  });

  test('拒绝与清单不一致的地址', () => {
    const model = makeModel({ files: [makeFileSpec({ url: 'https://evil.example.com/' + REPO + '/resolve/' + REV + '/' + FILE })] });
    assert.throws(() => validateManifest({ schemaVersion: 1, models: [model] }), /主机/);
  });

  test('拒绝超过单文件上限的声明字节数', () => {
    const model = makeModel({ files: [makeFileSpec({ bytes: MAX_FILE_BYTES + 1 })] });
    assert.throws(() => validateManifest({ schemaVersion: 1, models: [model] }), /上限/);
  });

  test('拒绝不支持的 schemaVersion', () => {
    assert.throws(() => validateManifest({ schemaVersion: 2, models: [makeModel()] }), /schemaVersion/);
  });
});

describe('日志脱敏', () => {
  test('去掉 CDN 签名查询串', () => {
    assert.equal(
      safeUrlForLog('https://cdn-lfs.huggingface.co/repos/a/b?Signature=secret&Key-Pair-Id=x'),
      'https://cdn-lfs.huggingface.co/repos/a/b',
    );
    assert.equal(safeUrlForLog('not a url'), '<invalid-url>');
  });
});

describe('缓存目录安全', () => {
  test('assertNoReparsePoint 对普通文件返回 true，对不存在返回 false', async () => {
    const dir = await newTempDir('reparse');
    const file = path.join(dir, 'plain.bin');
    await fs.writeFile(file, FIXTURE_BYTES);
    assert.equal(await assertNoReparsePoint(file, '文件'), true);
    assert.equal(await assertNoReparsePoint(path.join(dir, 'missing.bin'), '文件'), false);
  });

  test('assertNoReparsePoint 拒绝目录联接点（junction）', async (t) => {
    const dir = await newTempDir('junction');
    const target = path.join(dir, 'target');
    const link = path.join(dir, 'link');
    await fs.mkdir(target);
    try {
      await fs.symlink(target, link, 'junction');
    } catch (error) {
      if (error.code === 'EPERM' || error.code === 'EACCES') {
        t.skip('OS refused test junction: ' + error.code);
        return;
      }
      throw error;
    }
    await assert.rejects(assertNoReparsePoint(link, '目录'), /符号链接|联接点/);
  });

  test('ensureSafeDirectory 拒绝联接点形式的模型目录', async (t) => {
    const root = await newTempDir('ensure-root');
    const outside = await newTempDir('ensure-outside');
    try {
      await fs.symlink(outside, path.join(root, 'sensevoice-small-int8'), 'junction');
    } catch (error) {
      if (error.code === 'EPERM' || error.code === 'EACCES') {
        t.skip('OS refused test junction: ' + error.code);
        return;
      }
      throw error;
    }
    await assert.rejects(ensureSafeDirectory(root, ['sensevoice-small-int8']), /符号链接|联接点/);
  });

  test('ensureSafeDirectory 创建缺失的多级目录', async () => {
    const root = await newTempDir('ensure-create');
    const dir = await ensureSafeDirectory(root, ['m1']);
    assert.equal(dir, path.join(root, 'm1'));
    assert.ok((await fs.stat(dir)).isDirectory());
  });
});

describe('processFile', () => {
  test('下载成功时发布文件并返回实测哈希', async () => {
    const modelDir = await newTempDir('pf-ok');
    const fetchImpl = fakeFetch({ [GOOD_URL]: fakeResponse(FIXTURE_BYTES) });
    const entry = await processFile({
      model: makeModel(),
      file: makeFileSpec(),
      modelDir,
      fetchImpl,
    });
    assert.equal(entry.status, 'downloaded');
    assert.equal(entry.actualSha256, FIXTURE_SHA256);
    assert.equal(entry.actualGitBlobSha1, FIXTURE_GIT_BLOB);
    assert.deepEqual(await fs.readFile(path.join(modelDir, FILE)), FIXTURE_BYTES);
    assert.deepEqual((await fs.readdir(modelDir)).sort(), [FILE]);
  });

  test('子目录中的文件会自动创建父目录', async () => {
    const modelDir = await newTempDir('pf-subdir');
    const nested = makeFileSpec({
      path: 'test_wavs/zh.wav',
      url: 'https://huggingface.co/' + REPO + '/resolve/' + REV + '/test_wavs/zh.wav',
    });
    const fetchImpl = fakeFetch({ [nested.url]: fakeResponse(FIXTURE_BYTES) });
    const entry = await processFile({ model: makeModel({ files: [nested] }), file: nested, modelDir, fetchImpl });
    assert.equal(entry.status, 'downloaded');
    assert.deepEqual(await fs.readFile(path.join(modelDir, 'test_wavs', 'zh.wav')), FIXTURE_BYTES);
  });

  test('父目录是联接点时拒绝写入', async (t) => {
    const modelDir = await newTempDir('pf-subdir-link');
    const outside = await newTempDir('pf-subdir-outside');
    try {
      await fs.symlink(outside, path.join(modelDir, 'test_wavs'), 'junction');
    } catch (error) {
      if (error.code === 'EPERM' || error.code === 'EACCES') {
        t.skip('OS refused test junction: ' + error.code);
        return;
      }
      throw error;
    }
    const nested = makeFileSpec({
      path: 'test_wavs/zh.wav',
      url: 'https://huggingface.co/' + REPO + '/resolve/' + REV + '/test_wavs/zh.wav',
    });
    await assert.rejects(
      processFile({ model: makeModel(), file: nested, modelDir, fetchImpl: fakeFetch({}) }),
      /符号链接|联接点/,
    );
    assert.deepEqual(await fs.readdir(outside), []);
  });

  test('已存在且正确的文件被跳过，且不发起请求', async () => {
    const modelDir = await newTempDir('pf-skip');
    await fs.writeFile(path.join(modelDir, FILE), FIXTURE_BYTES);
    const fetchImpl = fakeFetch({});
    const entry = await processFile({ model: makeModel(), file: makeFileSpec(), modelDir, fetchImpl });
    assert.equal(entry.status, 'skipped');
    assert.equal(fetchImpl.calls.length, 0);
  });

  test('已存在但哈希不符时拒绝，且不覆盖用户文件', async () => {
    const modelDir = await newTempDir('pf-corrupt');
    const target = path.join(modelDir, FILE);
    await fs.writeFile(target, 'user file that must survive\n');
    const fetchImpl = fakeFetch({});
    await assert.rejects(
      processFile({ model: makeModel(), file: makeFileSpec(), modelDir, fetchImpl }),
      (error) => error instanceof AsrDownloadError && error.code === 'E_EXISTING_MISMATCH',
    );
    assert.equal(fetchImpl.calls.length, 0);
    assert.equal(await fs.readFile(target, 'utf8'), 'user file that must survive\n');
  });

  test('下载内容哈希不符时不发布，并清理自己创建的 .part', async () => {
    const modelDir = await newTempDir('pf-badhash');
    // 长度与清单一致、内容不同，才会走到哈希比对而不是长度中止
    const fetchImpl = fakeFetch({ [GOOD_URL]: fakeResponse(Buffer.from('tamperedit13\n')) });
    await assert.rejects(
      processFile({ model: makeModel(), file: makeFileSpec(), modelDir, fetchImpl }),
      (error) => error instanceof AsrDownloadError && error.code === 'E_HASH_MISMATCH',
    );
    assert.deepEqual(await fs.readdir(modelDir), []);
  });

  test('服务器 Content-Length 与清单不符时拒绝下载', async () => {
    const modelDir = await newTempDir('pf-length');
    const fetchImpl = fakeFetch({
      [GOOD_URL]: fakeResponse(FIXTURE_BYTES, { headers: { 'content-length': '999' } }),
    });
    await assert.rejects(
      processFile({ model: makeModel(), file: makeFileSpec(), modelDir, fetchImpl }),
      /Content-Length/,
    );
    assert.deepEqual(await fs.readdir(modelDir), []);
  });

  test('跟随到 Hugging Face CDN 的重定向', async () => {
    const modelDir = await newTempDir('pf-redirect');
    const cdn = 'https://cdn-lfs.huggingface.co/repos/x/y?response-content-disposition=attachment';
    const fetchImpl = fakeFetch({
      [GOOD_URL]: fakeResponse(null, { status: 302, headers: { location: cdn } }),
      [cdn]: fakeResponse(FIXTURE_BYTES),
    });
    const entry = await processFile({ model: makeModel(), file: makeFileSpec(), modelDir, fetchImpl });
    assert.equal(entry.status, 'downloaded');
    assert.equal(fetchImpl.calls.length, 2);
    assert.equal(fetchImpl.calls[1].url, cdn);
  });

  test('拒绝重定向到非 Hugging Face 主机', async () => {
    const modelDir = await newTempDir('pf-badredir');
    const fetchImpl = fakeFetch({
      [GOOD_URL]: fakeResponse(null, { status: 302, headers: { location: 'https://evil.example.com/payload' } }),
    });
    await assert.rejects(
      processFile({ model: makeModel(), file: makeFileSpec(), modelDir, fetchImpl }),
      (error) => error instanceof AsrDownloadError && error.code === 'E_REDIRECT',
    );
    assert.deepEqual(await fs.readdir(modelDir), []);
  });

  test('重定向次数有上限', async () => {
    const modelDir = await newTempDir('pf-loop');
    const fetchImpl = fakeFetch({
      [GOOD_URL]: fakeResponse(null, { status: 302, headers: { location: GOOD_URL } }),
    });
    await assert.rejects(
      processFile({ model: makeModel(), file: makeFileSpec(), modelDir, fetchImpl }),
      (error) => error instanceof AsrDownloadError && error.code === 'E_REDIRECT',
    );
  });

  test('不携带任何凭据：请求头无 Authorization/Cookie，credentials 为 omit', async () => {
    const modelDir = await newTempDir('pf-creds');
    const fetchImpl = fakeFetch({ [GOOD_URL]: fakeResponse(FIXTURE_BYTES) });
    await processFile({ model: makeModel(), file: makeFileSpec(), modelDir, fetchImpl });
    const init = fetchImpl.calls[0].init;
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'manual');
    const headerNames = Object.keys(init.headers).map((name) => name.toLowerCase());
    assert.ok(!headerNames.includes('authorization'));
    assert.ok(!headerNames.includes('cookie'));
  });

  test('HTTP 非 200 明确失败', async () => {
    const modelDir = await newTempDir('pf-404');
    const fetchImpl = fakeFetch({ [GOOD_URL]: fakeResponse('not found', { status: 404 }) });
    await assert.rejects(
      processFile({ model: makeModel(), file: makeFileSpec(), modelDir, fetchImpl }),
      (error) => error instanceof AsrDownloadError && error.code === 'E_HTTP_STATUS',
    );
  });
});

describe('runDownload 端到端（假网络）', () => {
  async function writeManifest(dir, models) {
    const manifestPath = path.join(dir, 'manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, models }, null, 2));
    return manifestPath;
  }

  test('下载清单文件并写出收据', async () => {
    const dir = await newTempDir('run-ok');
    const manifestPath = await writeManifest(dir, [makeModel()]);
    const cacheRoot = path.join(dir, 'cache');
    const fetchImpl = fakeFetch({ [GOOD_URL]: fakeResponse(FIXTURE_BYTES) });
    const { receipt, receiptPath } = await runDownload({
      repoRoot: dir,
      manifestPath,
      cacheRoot,
      fetchImpl,
    });
    assert.equal(receipt.ok, true);
    assert.equal(receipt.totals.downloaded, 1);
    assert.equal(receipt.totals.failed, 0);
    assert.equal(receipt.models[0].files[0].actualSha256, FIXTURE_SHA256);
    assert.equal(receipt.models[0].files[0].status, 'downloaded');
    assert.match(receipt.manifest.sha256, /^[0-9a-f]{64}$/);
    assert.equal(receiptPath, path.join(cacheRoot, RECEIPT_NAME));
    const written = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
    assert.equal(written.models[0].files[0].actualSha256, FIXTURE_SHA256);
    assert.ok(!JSON.stringify(written).includes(dir)); // 收据里不写绝对路径
  });

  test('第二次运行跳过已校验文件', async () => {
    const dir = await newTempDir('run-skip');
    const manifestPath = await writeManifest(dir, [makeModel()]);
    const cacheRoot = path.join(dir, 'cache');
    const fetchImpl = fakeFetch({ [GOOD_URL]: fakeResponse(FIXTURE_BYTES) });
    await runDownload({ repoRoot: dir, manifestPath, cacheRoot, fetchImpl });
    const second = fakeFetch({});
    const { receipt } = await runDownload({ repoRoot: dir, manifestPath, cacheRoot, fetchImpl: second });
    assert.equal(receipt.totals.skipped, 1);
    assert.equal(second.calls.length, 0);
  });

  test('--check 模式只校验不联网，缺文件时报失败', async () => {
    const dir = await newTempDir('run-check');
    const manifestPath = await writeManifest(dir, [makeModel()]);
    const cacheRoot = path.join(dir, 'cache');
    const fetchImpl = fakeFetch({});
    const { receipt } = await runDownload({
      repoRoot: dir,
      manifestPath,
      cacheRoot,
      fetchImpl,
      checkOnly: true,
    });
    assert.equal(receipt.ok, false);
    assert.equal(receipt.totals.failed, 1);
    assert.equal(receipt.models[0].files[0].error.code, 'E_MISSING');
    assert.equal(fetchImpl.calls.length, 0);
  });

  test('--check 模式校验通过时报告 verified', async () => {
    const dir = await newTempDir('run-check-ok');
    const manifestPath = await writeManifest(dir, [makeModel()]);
    const cacheRoot = path.join(dir, 'cache');
    const modelDir = path.join(cacheRoot, 'sensevoice-small-int8');
    await fs.mkdir(modelDir, { recursive: true });
    await fs.writeFile(path.join(modelDir, FILE), FIXTURE_BYTES);
    const { receipt } = await runDownload({
      repoRoot: dir,
      manifestPath,
      cacheRoot,
      checkOnly: true,
      fetchImpl: fakeFetch({}),
    });
    assert.equal(receipt.ok, true);
    assert.equal(receipt.totals.skipped, 1);
    assert.equal(receipt.models[0].files[0].status, 'verified');
  });

  test('单个文件失败不会中断其它文件，但收据标记失败', async () => {
    const dir = await newTempDir('run-partial');
    const secondFile = makeFileSpec({
      path: 'test_wavs/zh.wav',
      url: 'https://huggingface.co/' + REPO + '/resolve/' + REV + '/test_wavs/zh.wav',
    });
    const manifestPath = await writeManifest(dir, [makeModel({ files: [makeFileSpec(), secondFile] })]);
    const cacheRoot = path.join(dir, 'cache');
    const fetchImpl = fakeFetch({
      [GOOD_URL]: fakeResponse(FIXTURE_BYTES),
      [secondFile.url]: fakeResponse('server error', { status: 500 }),
    });
    const { receipt } = await runDownload({ repoRoot: dir, manifestPath, cacheRoot, fetchImpl });
    assert.equal(receipt.ok, false);
    assert.equal(receipt.totals.downloaded, 1);
    assert.equal(receipt.totals.failed, 1);
    assert.equal(receipt.models[0].status, 'failed');
  });

  test('未知 model.id 明确失败', async () => {
    const dir = await newTempDir('run-unknown');
    const manifestPath = await writeManifest(dir, [makeModel()]);
    await assert.rejects(
      runDownload({ repoRoot: dir, manifestPath, cacheRoot: path.join(dir, 'cache'), only: 'nope' }),
      (error) => error instanceof AsrDownloadError && error.code === 'E_UNKNOWN_MODEL',
    );
  });
});

describe('返修回归：逐段路径检查（R1/R2）', () => {
  test('assertSafeDirectoryChain 拒绝祖先联接点，且不穿过它创建目录', async (t) => {
    const root = await newTempDir('chain-root');
    const outside = await newTempDir('chain-outside');
    try {
      await fs.symlink(outside, path.join(root, '.cache'), 'junction');
    } catch (error) {
      if (error.code === 'EPERM' || error.code === 'EACCES') {
        t.skip('OS refused test junction: ' + error.code);
        return;
      }
      throw error;
    }
    await assert.rejects(
      assertSafeDirectoryChain(root, ['.cache', 'asr-models']),
      (error) => error instanceof AsrDownloadError && error.code === 'E_REPARSE_POINT',
    );
    // 关键：没有在链接目标里创建 asr-models。
    assert.deepEqual(await fs.readdir(outside), []);
  });

  test('assertSafeDirectoryChain 不存在的根直接失败', async () => {
    const root = await newTempDir('chain-missing-root');
    await assert.rejects(
      assertSafeDirectoryChain(path.join(root, 'nope'), ['x']),
      (error) => error instanceof AsrDownloadError && error.code === 'E_CACHE_ROOT',
    );
  });

  test('runDownload 在 .cache 是联接点时失败且不发起下载', async (t) => {
    const dir = await newTempDir('run-junction-cache');
    const outside = await newTempDir('run-junction-outside');
    const manifestPath = path.join(dir, 'manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, models: [makeModel()] }));
    try {
      await fs.symlink(outside, path.join(dir, '.cache'), 'junction');
    } catch (error) {
      if (error.code === 'EPERM' || error.code === 'EACCES') {
        t.skip('OS refused test junction: ' + error.code);
        return;
      }
      throw error;
    }
    let fetched = 0;
    await assert.rejects(
      runDownload({
        repoRoot: dir,
        manifestPath,
        cacheRoot: '.cache/asr-models',
        fetchImpl: async () => { fetched += 1; return fakeResponse(FIXTURE_BYTES); },
      }),
      (error) => error instanceof AsrDownloadError && error.code === 'E_REPARSE_POINT',
    );
    assert.equal(fetched, 0, '拒绝路径时不应发起任何请求');
    assert.deepEqual(await fs.readdir(outside), []);
  });

  test('--check 也逐段检查中间目录，联接点不能验成通过', async (t) => {
    const dir = await newTempDir('run-check-junction');
    const outside = await newTempDir('run-check-outside');
    const nested = makeFileSpec({
      path: 'test_wavs/zh.wav',
      url: 'https://huggingface.co/' + REPO + '/resolve/' + REV + '/test_wavs/zh.wav',
    });
    const manifestPath = path.join(dir, 'manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, models: [makeModel({ files: [nested] })] }));
    const modelDir = path.join(dir, 'cache', 'sensevoice-small-int8');
    await fs.mkdir(modelDir, { recursive: true });
    await fs.writeFile(path.join(outside, 'zh.wav'), FIXTURE_BYTES);
    try {
      await fs.symlink(outside, path.join(modelDir, 'test_wavs'), 'junction');
    } catch (error) {
      if (error.code === 'EPERM' || error.code === 'EACCES') {
        t.skip('OS refused test junction: ' + error.code);
        return;
      }
      throw error;
    }
    const { receipt } = await runDownload({
      repoRoot: dir,
      manifestPath,
      cacheRoot: 'cache',
      checkOnly: true,
      fetchImpl: async () => { throw new Error('离线模式不应联网'); },
    });
    assert.equal(receipt.ok, false);
    assert.equal(receipt.models[0].files[0].error.code, 'E_REPARSE_POINT');
  });

  test('cacheRoot 参数不能逃出 repoRoot', async () => {
    const dir = await newTempDir('run-escape');
    const manifestPath = path.join(dir, 'manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, models: [makeModel()] }));
    await assert.rejects(
      runDownload({ repoRoot: dir, manifestPath, cacheRoot: '../outside-cache', fetchImpl: fakeFetch({}) }),
      (error) => error instanceof AsrDownloadError && error.code === 'E_CACHE_ROOT',
    );
  });

  test('toSafeSegmentsWithin 拒绝绝对路径与穿越', () => {
    const root = path.resolve('C:/ws-root');
    assert.deepEqual(toSafeSegmentsWithin(root, '.cache/asr-models', 'E_X').segments, ['.cache', 'asr-models']);
    assert.throws(() => toSafeSegmentsWithin(root, '../x', 'E_X'), /repoRoot/);
    assert.throws(() => toSafeSegmentsWithin(root, 'C:/Windows', 'E_X'), /repoRoot/);
  });
});

describe('返修回归：原子不覆盖发布（R3）', () => {
  test('publishNoOverwrite 对已存在目标报 E_EXISTING_MISMATCH 且保留原内容', async () => {
    const dir = await newTempDir('publish-exists');
    const part = path.join(dir, 'a.part');
    const target = path.join(dir, 'a.bin');
    await fs.writeFile(part, 'new-content');
    await fs.writeFile(target, 'other-writer');
    await assert.rejects(
      publishNoOverwrite(part, target),
      (error) => error instanceof AsrDownloadError && error.code === 'E_EXISTING_MISMATCH',
    );
    assert.equal(await fs.readFile(target, 'utf8'), 'other-writer');
  });

  test('publishNoOverwrite 不支持硬链接时失败，绝不退回覆盖改名', async () => {
    const dir = await newTempDir('publish-unsupported');
    const part = path.join(dir, 'b.part');
    const target = path.join(dir, 'b.bin');
    await fs.writeFile(part, 'new-content');
    const original = fs.link;
    fs.link = async () => {
      const error = new Error('operation not supported');
      error.code = 'EPERM';
      throw error;
    };
    try {
      await assert.rejects(
        publishNoOverwrite(part, target),
        (error) => error instanceof AsrDownloadError && error.code === 'E_PUBLISH_UNSUPPORTED',
      );
    } finally {
      fs.link = original;
    }
    await assert.rejects(fs.stat(target), /ENOENT/);
    assert.equal(await fs.readFile(part, 'utf8'), 'new-content');
  });

  test('processFile 发布后只删自己的 part，目标内容正确', async () => {
    const modelDir = await newTempDir('publish-clean');
    const entry = await processFile({
      model: makeModel(),
      file: makeFileSpec(),
      modelDir,
      fetchImpl: fakeFetch({ [GOOD_URL]: fakeResponse(FIXTURE_BYTES) }),
    });
    assert.equal(entry.status, 'downloaded');
    assert.deepEqual(await fs.readdir(modelDir), [FILE]);
    assert.deepEqual(await fs.readFile(path.join(modelDir, FILE)), FIXTURE_BYTES);
  });

  test('并发写入者在发布前抢先创建目标时，processFile 失败且不覆盖', async () => {
    const modelDir = await newTempDir('publish-race');
    const target = path.join(modelDir, FILE);
    const original = fs.link;
    fs.link = async (source, destination) => {
      if (destination === target) await fs.writeFile(target, 'other-writer', { flag: 'wx' });
      return original(source, destination);
    };
    try {
      await assert.rejects(
        processFile({
          model: makeModel(),
          file: makeFileSpec(),
          modelDir,
          fetchImpl: fakeFetch({ [GOOD_URL]: fakeResponse(FIXTURE_BYTES) }),
        }),
        (error) => error instanceof AsrDownloadError && error.code === 'E_EXISTING_MISMATCH',
      );
    } finally {
      fs.link = original;
    }
    assert.equal(await fs.readFile(target, 'utf8'), 'other-writer');
    assert.deepEqual(await fs.readdir(modelDir), [FILE], '自己的 part 必须被清理');
  });
});

describe('返修回归：超时与响应体释放', () => {
  test('等待响应头超时会中止并报 E_HEADERS_TIMEOUT', async () => {
    const controllerSeen = [];
    const hangingFetch = (url, init) => new Promise((resolve, reject) => {
      controllerSeen.push(init?.signal);
      init.signal?.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    });
    await assert.rejects(
      fetchWithRedirects(GOOD_URL, { fetchImpl: hangingFetch, headersTimeoutMs: 30 }),
      (error) => error instanceof AsrDownloadError && error.code === 'E_HEADERS_TIMEOUT',
    );
    assert.equal(controllerSeen.length, 1);
    assert.equal(controllerSeen[0].aborted, true);
  });

  test('请求本身抛错时报 E_NETWORK，不泄露原始堆栈', async () => {
    await assert.rejects(
      fetchWithRedirects(GOOD_URL, {
        fetchImpl: async () => { throw new Error('socket hang up'); },
      }),
      (error) => error instanceof AsrDownloadError && error.code === 'E_NETWORK',
    );
  });

  test('非 200 响应会取消未消费的响应体', async () => {
    let cancelled = false;
    const response = {
      status: 404,
      headers: new Headers(),
      body: { cancel: async () => { cancelled = true; } },
    };
    await assert.rejects(
      fetchWithRedirects(GOOD_URL, { fetchImpl: async () => response }),
      (error) => error instanceof AsrDownloadError && error.code === 'E_HTTP_STATUS',
    );
    assert.equal(cancelled, true);
  });

  test('重定向响应也会取消响应体', async () => {
    let cancelled = 0;
    const redirect = {
      status: 302,
      headers: new Headers({ location: 'https://cdn-lfs.huggingface.co/x' }),
      body: { cancel: async () => { cancelled += 1; } },
    };
    await assert.rejects(
      fetchWithRedirects(GOOD_URL, {
        fetchImpl: async (url) => (url === GOOD_URL ? redirect : (() => {
          throw new Error('unexpected second hop');
        })()),
      }),
    );
    assert.equal(cancelled, 1);
  });

  test('processFile 在响应头校验失败时取消响应体，且不落盘', async () => {
    const modelDir = await newTempDir('pf-cancel');
    let cancelled = false;
    const fetchImpl = async () => ({
      status: 200,
      headers: new Headers({ 'content-length': '999' }),
      body: { cancel: async () => { cancelled = true; } },
    });
    await assert.rejects(
      processFile({ model: makeModel(), file: makeFileSpec(), modelDir, fetchImpl }),
      /Content-Length/,
    );
    assert.equal(cancelled, true);
    assert.deepEqual(await fs.readdir(modelDir), []);
  });

  test('下载总时限超时会中止流并报 E_DOWNLOAD_TIMEOUT', async () => {
    const dir = await newTempDir('stream-timeout');
    const partPath = path.join(dir, 'slow.part');
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
        // 之后不再产出数据，靠总时限中止
      },
    });
    await assert.rejects(
      streamResponseToFile({ body, partPath, expectedBytes: 8, timeoutMs: 40 }),
      (error) => error instanceof AsrDownloadError && error.code === 'E_DOWNLOAD_TIMEOUT',
    );
  });

  test('空闲看门狗仍会在长时间无数据时报 E_IDLE_TIMEOUT', async () => {
    const dir = await newTempDir('stream-idle');
    const partPath = path.join(dir, 'idle.part');
    const body = new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array([1])); },
    });
    await assert.rejects(
      streamResponseToFile({ body, partPath, expectedBytes: 8, idleTimeoutMs: 1000, timeoutMs: 0 }),
      (error) => error instanceof AsrDownloadError && error.code === 'E_IDLE_TIMEOUT',
    );
  });

  test('默认超时常量为正数', () => {
    assert.ok(DEFAULT_HEADERS_TIMEOUT_MS > 0);
    assert.ok(DEFAULT_DOWNLOAD_TIMEOUT_MS > 0);
  });
});

describe('返修回归：CLI 不再开放任意路径', () => {
  test('--manifest 被拒绝并返回 2', async () => {
    const code = await main(['--manifest', 'qa/M0-asr-fixtures.json']);
    assert.equal(code, 2);
  });

  test('--cache 被拒绝并返回 2', async () => {
    const code = await main(['--cache', 'C:/tmp/x']);
    assert.equal(code, 2);
  });

  test('未知参数仍被拒绝', async () => {
    assert.equal(await main(['--bogus']), 2);
  });
});

describe('脚本自身约束', () => {
  test('默认路径指向仓库清单与忽略缓存目录', () => {
    assert.equal(DEFAULT_MANIFEST_PATH, 'qa/M0-asr-fixtures.json');
    assert.equal(DEFAULT_CACHE_ROOT, '.cache/asr-models');
  });

  test('源码不读取环境凭据，也不发送 Authorization', async () => {
    const source = await fs.readFile(path.join(SCRIPT_DIR, 'asr-download.mjs'), 'utf8');
    assert.ok(!/process\.env/.test(source), '不应读取环境变量（避免任何 Key 被带上）');
    assert.ok(!/authorization/i.test(source), '不应出现鉴权头字段');
    assert.ok(!/cookie/i.test(source), '不应出现会话凭据头字段');
    assert.match(source, /credentials: 'omit'/);
    assert.ok(!/http:\/\//.test(source), '不应出现明文 http 来源');
  });

  test('只依赖 Node 内置模块', async () => {
    const source = await fs.readFile(path.join(SCRIPT_DIR, 'asr-download.mjs'), 'utf8');
    const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
    assert.ok(specifiers.length > 0);
    for (const specifier of specifiers) {
      assert.ok(specifier.startsWith('node:'), '非内置依赖: ' + specifier);
    }
  });

  test('仓库 .gitignore 忽略 .cache/', async () => {
    const ignore = await fs.readFile(path.resolve(REPO_ROOT, '.gitignore'), 'utf8');
    assert.match(ignore, /^\.cache\/$/m);
  });
});
