#!/usr/bin/env node
// M0-04 ASR 模型下载与校验脚本（本地兼容研究用，不是分发授权）
//
// 用法：
//   node qa/probes/asr-download.mjs              下载并校验清单中的全部文件
//   node qa/probes/asr-download.mjs --check      只校验缓存中已有文件，不联网
//   node qa/probes/asr-download.mjs --only <id>  只处理某个模型
//
// CLI 不接受自定义清单或缓存路径：清单固定为仓库内 qa/M0-asr-fixtures.json，
// 缓存固定为仓库内 .cache/asr-models。runDownload() 的 manifestPath/cacheRoot 参数
// 只留给测试传临时根目录，且解析结果必须仍在 repoRoot 之内。
//
// 设计约束（对应 docs/15-security-and-privacy.md 的 SEC-08 与任务书）：
//   - 只读清单 qa/M0-asr-fixtures.json，清单里的字节数与哈希是"下载前就已固定"的期望值。
//     脚本不会用下载后算出的哈希反向证明自己，只做期望值与实测值的比对。
//   - 只允许 https + huggingface.co 的固定 40 位 revision /resolve/ 地址；
//     跟随重定向时逐跳校验目标主机属于 Hugging Face 自有域，不接受任意 URL。
//   - 不携带任何凭据：不读环境变量里的令牌，请求头完全自建，不带鉴权字段或会话凭据。
//   - 路径穿越、绝对路径、危险 ID、超限下载一律拒绝。
//   - 缓存路径从可信 repoRoot 开始逐段 lstat/创建；任何一段是符号链接或联接点即拒绝，
//     不会先用递归 mkdir 穿过未检查的父目录。离线校验同样逐段检查中间目录。
//   - 已存在且校验通过的文件跳过；已存在但校验失败的文件拒绝覆盖。
//   - 下载写入唯一的 .part 临时文件，校验通过后用同卷硬链接"原子且不覆盖"地发布；
//     目标已存在（EEXIST）或文件系统不支持硬链接时直接失败，绝不退回覆盖式改名。
//   - 等待响应头和整个下载都有明确截止时间（AbortController / 计时器）；
//     失败路径会取消尚未消费的响应体。
//   - 失败即失败：不静默换来源、不做无限重试。
//
// 安全边界（不要夸大）：这些检查是路径与发布层面的防护，不是针对同一用户下
// 恶意程序的 OS 沙箱。lstat 与随后的读写之间仍有检查-使用竞争，同用户进程可以
// 在这段窗口里替换目录或抢先写入；硬链接发布能保证"不覆盖已存在文件"，
// 但不能阻止对方在你发布之后替换它。真正的隔离要靠宿主权限与安装来源信任。
//
// 只使用 Node 内置模块。

import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');

/** 相对仓库根目录的默认清单路径。 */
export const DEFAULT_MANIFEST_PATH = 'qa/M0-asr-fixtures.json';
/** 相对仓库根目录的默认缓存根。整个目录被 .gitignore 忽略。 */
export const DEFAULT_CACHE_ROOT = '.cache/asr-models';
/** 收据文件名，位于缓存根下。 */
export const RECEIPT_NAME = 'receipt.json';

/** 单个文件的字节数上限（清单里最大的权重约 239 MB）。 */
export const MAX_FILE_BYTES = 512 * 1024 * 1024;
/** 整份清单的字节数上限，防止被篡改的清单驱动无限下载。 */
export const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
/** 清单中文件条目数量上限。 */
export const MAX_FILES = 64;
/** 模型数量上限。 */
export const MAX_MODELS = 16;
/** 重定向跳数上限。 */
export const MAX_REDIRECTS = 5;
/** 流式读取时允许的最长无数据间隔（毫秒）。 */
export const DEFAULT_IDLE_TIMEOUT_MS = 60_000;
/** 等待响应头的最长毫秒数；超时后中止请求并报 E_HEADERS_TIMEOUT。 */
export const DEFAULT_HEADERS_TIMEOUT_MS = 30_000;
/** 单个文件从开始下载到写完的总时限（毫秒）；超时中止并报 E_DOWNLOAD_TIMEOUT。 */
export const DEFAULT_DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

/** 允许的下载主机：清单地址必须是 huggingface.co 本身。 */
const PRIMARY_HOST = 'huggingface.co';
/** 允许的重定向目标：Hugging Face 自有域及其公开 CDN。 */
const REDIRECT_HOST_EXACT = new Set(['huggingface.co', 'hf.co']);
const REDIRECT_HOST_SUFFIXES = ['.huggingface.co', '.hf.co'];

const SHA256_RE = /^[0-9a-f]{64}$/;
const GIT_BLOB_SHA1_RE = /^[0-9a-f]{40}$/;
const REVISION_RE = /^[0-9a-f]{40}$/;
const REPOSITORY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Windows 保留设备名，任何一段路径都不能用。 */
const WINDOWS_RESERVED = new Set([
  'con', 'prn', 'aux', 'nul', 'clock$',
  ...Array.from({ length: 9 }, (_, i) => 'com' + (i + 1)),
  ...Array.from({ length: 9 }, (_, i) => 'lpt' + (i + 1)),
]);

/** 带错误码的下载错误，便于测试与 CLI 分类汇报。 */
export class AsrDownloadError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'AsrDownloadError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

/* ------------------------------------------------------------------ */
/* 路径与标识符校验                                                     */
/* ------------------------------------------------------------------ */

function fail(code, message, details) {
  throw new AsrDownloadError(code, message, details);
}

/** 校验单个路径段（也用于 model.id）：拒绝保留名、尾点尾空格、非法字符。 */
function assertSafeSegment(segment, codePrefix) {
  if (typeof segment !== 'string' || segment.length === 0) {
    fail(codePrefix + '_EMPTY_SEGMENT', '路径段为空');
  }
  if (segment.length > 128) {
    fail(codePrefix + '_SEGMENT_TOO_LONG', '路径段过长: ' + segment.length);
  }
  if (segment === '.' || segment === '..') {
    fail(codePrefix + '_DOT_SEGMENT', '路径段不允许是 . 或 ..: ' + JSON.stringify(segment));
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f<>:"|?*\\/]/.test(segment)) {
    fail(codePrefix + '_ILLEGAL_CHAR', '路径段含非法字符: ' + JSON.stringify(segment));
  }
  if (/[. ]$/.test(segment)) {
    fail(codePrefix + '_TRAILING_DOT_OR_SPACE', '路径段不能以点或空格结尾: ' + JSON.stringify(segment));
  }
  const base = segment.split('.')[0].toLowerCase();
  if (WINDOWS_RESERVED.has(segment.toLowerCase()) || WINDOWS_RESERVED.has(base)) {
    fail(codePrefix + '_RESERVED_NAME', '路径段是 Windows 保留名: ' + JSON.stringify(segment));
  }
  return segment;
}

/**
 * 校验模型 id：必须是单段、安全的目录名。
 * 返回规范化后的 id（原样，不做大小写折叠）。
 */
export function validateModelId(modelId) {
  if (typeof modelId !== 'string') fail('E_BAD_MODEL_ID', 'model.id 不是字符串');
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(modelId)) {
    fail('E_BAD_MODEL_ID', 'model.id 只允许小写字母、数字、点、下划线、连字符，且以字母或数字开头: ' + JSON.stringify(modelId));
  }
  return assertSafeSegment(modelId, 'E_BAD_MODEL_ID');
}

/**
 * 校验清单里的相对文件路径（一律使用 / 分隔）。
 * 拒绝绝对路径、盘符、UNC、反斜杠、.. 穿越、空段、保留名。
 * 返回按 / 切分的段数组。
 */
export function validateRelativePath(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    fail('E_BAD_RELATIVE_PATH', '文件路径为空');
  }
  if (filePath.length > 240) {
    fail('E_BAD_RELATIVE_PATH', '文件路径过长: ' + filePath.length);
  }
  if (filePath.startsWith('/') || filePath.startsWith('\\')) {
    fail('E_ABSOLUTE_PATH', '拒绝绝对路径: ' + JSON.stringify(filePath));
  }
  if (/^[A-Za-z]:/.test(filePath)) {
    fail('E_ABSOLUTE_PATH', '拒绝盘符路径: ' + JSON.stringify(filePath));
  }
  if (filePath.includes('\\')) {
    fail('E_BAD_RELATIVE_PATH', '清单路径必须用 / 分隔，不允许反斜杠: ' + JSON.stringify(filePath));
  }
  if (filePath.includes('//')) {
    fail('E_BAD_RELATIVE_PATH', '路径含空段: ' + JSON.stringify(filePath));
  }
  if (filePath.includes(':')) {
    fail('E_BAD_RELATIVE_PATH', '路径不允许包含冒号（备用数据流）: ' + JSON.stringify(filePath));
  }
  const segments = filePath.split('/');
  for (const segment of segments) assertSafeSegment(segment, 'E_BAD_RELATIVE_PATH');
  return segments;
}

/**
 * 把清单相对路径解析成缓存内的绝对路径，并再次确认没有逃出模型目录。
 */
export function resolveTargetPath(modelDirAbs, filePath) {
  const segments = validateRelativePath(filePath);
  const target = path.resolve(modelDirAbs, ...segments);
  const rel = path.relative(modelDirAbs, target);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    fail('E_PATH_TRAVERSAL', '解析后的路径逃出模型目录: ' + JSON.stringify(filePath));
  }
  return target;
}

/* ------------------------------------------------------------------ */
/* URL 校验                                                             */
/* ------------------------------------------------------------------ */

/** 主机是否属于 Hugging Face 自有域（用于重定向目标）。 */
export function isAllowedRedirectHost(hostname) {
  if (typeof hostname !== 'string' || hostname.length === 0) return false;
  const host = hostname.toLowerCase();
  if (REDIRECT_HOST_EXACT.has(host)) return true;
  return REDIRECT_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/**
 * 校验清单里的下载地址：
 *   https://huggingface.co/<owner>/<repo>/resolve/<40位revision>/<path>
 * 且必须与同一条目的 repository / revision / path 完全一致。
 * 拒绝：非 https、非 huggingface.co、URL 内嵌凭据、非 443 端口、查询串、片段。
 */
export function validateDownloadUrl(rawUrl, { repository, revision, filePath }) {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
    fail('E_BAD_URL', '下载地址为空');
  }
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    fail('E_BAD_URL', '下载地址无法解析: ' + JSON.stringify(rawUrl));
  }
  if (url.protocol !== 'https:') {
    fail('E_BAD_URL', '只允许 https 下载地址: ' + url.protocol);
  }
  if (url.username !== '' || url.password !== '') {
    fail('E_BAD_URL', '下载地址不允许内嵌凭据');
  }
  if (url.port !== '' && url.port !== '443') {
    fail('E_BAD_URL', '下载地址不允许非 443 端口: ' + url.port);
  }
  if (url.hostname.toLowerCase() !== PRIMARY_HOST) {
    fail('E_BAD_URL', '下载地址主机必须是 ' + PRIMARY_HOST + '，实际 ' + url.hostname);
  }
  if (url.search !== '' || url.hash !== '') {
    fail('E_BAD_URL', '下载地址不允许查询串或片段');
  }
  if (!REVISION_RE.test(String(revision))) {
    fail('E_BAD_URL', 'revision 必须是 40 位小写十六进制: ' + JSON.stringify(revision));
  }
  const expectedPrefix = '/' + repository + '/resolve/' + revision + '/';
  if (!url.pathname.startsWith(expectedPrefix)) {
    fail('E_BAD_URL', '下载地址与清单的 repository/revision 不一致，期望前缀 ' + expectedPrefix);
  }
  const urlPath = decodeURIComponent(url.pathname.slice(expectedPrefix.length));
  if (urlPath !== filePath) {
    fail('E_BAD_URL', '下载地址中的文件名与清单 path 不一致: ' + JSON.stringify(urlPath) + ' != ' + JSON.stringify(filePath));
  }
  return url.href;
}

/** 重定向目标只允许 https + Hugging Face 自有域。 */
export function validateRedirectUrl(rawUrl, baseUrl) {
  let url;
  try {
    url = new URL(rawUrl, baseUrl);
  } catch {
    fail('E_REDIRECT', '重定向地址无法解析: ' + JSON.stringify(rawUrl));
  }
  if (url.protocol !== 'https:') fail('E_REDIRECT', '重定向到非 https 地址: ' + url.protocol);
  if (url.username !== '' || url.password !== '') fail('E_REDIRECT', '重定向地址不允许内嵌凭据');
  if (url.port !== '' && url.port !== '443') fail('E_REDIRECT', '重定向到非 443 端口: ' + url.port);
  if (!isAllowedRedirectHost(url.hostname)) {
    fail('E_REDIRECT', '重定向目标主机不在允许列表: ' + url.hostname);
  }
  return url.href;
}

/* ------------------------------------------------------------------ */
/* 哈希                                                                 */
/* ------------------------------------------------------------------ */

/** git blob sha1 的前缀：blob <字节数>\0 */
export function gitBlobHeader(byteLength) {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    fail('E_BAD_SIZE', 'git blob 头需要非负整数字节数: ' + byteLength);
  }
  return Buffer.from('blob ' + byteLength + '\u0000', 'utf8');
}

/** 对完整 Buffer 计算 git blob sha1。 */
export function gitBlobSha1OfBuffer(buffer) {
  const hash = createHash('sha1');
  hash.update(gitBlobHeader(buffer.length));
  hash.update(buffer);
  return hash.digest('hex');
}

/** 对完整 Buffer 计算 sha256。 */
export function sha256OfBuffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * 计算文件的字节数、sha256、git blob sha1。
 * git blob 头需要先知道字节数，因此用 stat 得到的长度写头，
 * 再校验实际读到的字节数与之相等；不一致视为读取期间文件被改动。
 */
export async function hashFileAt(absPath) {
  const stat = await fs.lstat(absPath);
  if (stat.isSymbolicLink()) fail('E_REPARSE_POINT', '拒绝读取符号链接: ' + absPath);
  if (!stat.isFile()) fail('E_NOT_A_FILE', '不是普通文件: ' + absPath);
  const expectedBytes = stat.size;
  const sha256 = createHash('sha256');
  const gitBlob = createHash('sha1');
  gitBlob.update(gitBlobHeader(expectedBytes));
  let bytes = 0;
  for await (const chunk of createReadStream(absPath)) {
    bytes += chunk.length;
    if (bytes > MAX_FILE_BYTES) fail('E_TOO_LARGE', '文件超过上限: ' + absPath);
    sha256.update(chunk);
    gitBlob.update(chunk);
  }
  if (bytes !== expectedBytes) {
    fail('E_UNSTABLE_FILE', '读取期间文件长度变化: ' + expectedBytes + ' -> ' + bytes);
  }
  return { bytes, sha256: sha256.digest('hex'), gitBlobSha1: gitBlob.digest('hex') };
}

/** 清单条目声明的期望值。 */
export function expectedHashOf(fileSpec) {
  if (typeof fileSpec.sha256 === 'string') {
    if (!SHA256_RE.test(fileSpec.sha256)) fail('E_MANIFEST', 'sha256 格式不正确: ' + fileSpec.sha256);
    return { algorithm: 'sha256', value: fileSpec.sha256.toLowerCase() };
  }
  if (typeof fileSpec.gitBlobSha1 === 'string') {
    if (!GIT_BLOB_SHA1_RE.test(fileSpec.gitBlobSha1)) {
      fail('E_MANIFEST', 'gitBlobSha1 格式不正确: ' + fileSpec.gitBlobSha1);
    }
    return { algorithm: 'git-blob-sha1', value: fileSpec.gitBlobSha1.toLowerCase() };
  }
  fail('E_MANIFEST', '条目既没有 sha256 也没有 gitBlobSha1: ' + JSON.stringify(fileSpec.path));
}

/**
 * 用期望值校验一份实测结果。
 * 返回 null 表示通过，否则返回不匹配的说明。
 */
export function compareHash(actual, expected, declaredBytes) {
  if (Number.isSafeInteger(declaredBytes) && actual.bytes !== declaredBytes) {
    return { code: 'E_SIZE_MISMATCH', message: '字节数不符：期望 ' + declaredBytes + '，实际 ' + actual.bytes };
  }
  const observed = expected.algorithm === 'sha256' ? actual.sha256 : actual.gitBlobSha1;
  if (observed !== expected.value) {
    return {
      code: 'E_HASH_MISMATCH',
      message: expected.algorithm + ' 不符：期望 ' + expected.value + '，实际 ' + observed,
    };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 流式落盘                                                             */
/* ------------------------------------------------------------------ */

/**
 * 把响应体流式写入 part 路径，同时计数并计算两个哈希。
 * 超过期望字节数立即中止（不把超限内容读完）。
 * 同时施加两个截止条件：
 *   - 空闲看门狗：连续 idleTimeoutMs 没有新数据就中止；
 *   - 总时限 timeoutMs：从开始读取算起的整体上限。
 * 任何失败路径都会取消尚未消费的响应体，避免连接挂着不释放。
 * 返回实测 { bytes, sha256, gitBlobSha1 }；不负责发布或删除文件。
 */
export async function streamResponseToFile({
  body,
  partPath,
  expectedBytes,
  idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  timeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS,
  signal = null,
}) {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0) {
    fail('E_BAD_SIZE', '期望字节数无效: ' + expectedBytes);
  }
  if (expectedBytes > MAX_FILE_BYTES) {
    fail('E_TOO_LARGE', '期望字节数超过单文件上限: ' + expectedBytes);
  }
  if (body === null || body === undefined) fail('E_EMPTY_BODY', '响应没有正文');

  const sha256 = createHash('sha256');
  const gitBlob = createHash('sha1');
  gitBlob.update(gitBlobHeader(expectedBytes));
  let bytes = 0;
  let lastChunkAt = Date.now();

  const verifier = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > expectedBytes) {
        callback(new AsrDownloadError(
          'E_TOO_LARGE',
          '响应体超过清单声明的 ' + expectedBytes + ' 字节，已中止',
        ));
        return;
      }
      lastChunkAt = Date.now();
      sha256.update(chunk);
      gitBlob.update(chunk);
      callback(null, chunk);
    },
  });

  // 统一成 Node 可读流：pipeline 只能可靠地销毁 Node 流；
  // 直接把 web ReadableStream 交给 pipeline 时，挂起的 read() 无法被中止。
  const source = typeof body.getReader === 'function' ? Readable.fromWeb(body) : body;
  const sink = createWriteStream(partPath, { flags: 'wx', mode: 0o600 });
  let stopped = false;
  const stop = (error) => {
    if (stopped) return;
    stopped = true;
    // 同时销毁两端：源端的 destroy 会取消底层 web 流，连接不会被挂住。
    source.destroy?.(error);
    sink.destroy(error);
  };

  const watchdog = setInterval(() => {
    if (Date.now() - lastChunkAt > idleTimeoutMs) {
      stop(new AsrDownloadError('E_IDLE_TIMEOUT', '下载停滞超过 ' + idleTimeoutMs + ' 毫秒'));
    }
  }, Math.max(1000, Math.floor(idleTimeoutMs / 4)));
  watchdog.unref?.();

  const deadline = timeoutMs > 0
    ? setTimeout(() => {
      stop(new AsrDownloadError('E_DOWNLOAD_TIMEOUT', '下载总时长超过 ' + timeoutMs + ' 毫秒'));
    }, timeoutMs)
    : null;
  deadline?.unref?.();

  const onAbort = () => {
    stop(new AsrDownloadError('E_ABORTED', '下载已被取消'));
  };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  let failure = null;
  try {
    await pipeline(source, verifier, sink);
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    clearInterval(watchdog);
    if (deadline) clearTimeout(deadline);
    signal?.removeEventListener?.('abort', onAbort);
    if (failure) {
      // 失败时释放连接：未被消费的响应体必须取消，不能留给垃圾回收。
      try {
        await body.cancel?.(failure);
      } catch {
        /* 取消失败不掩盖原始错误 */
      }
    }
  }

  if (bytes !== expectedBytes) {
    fail('E_SIZE_MISMATCH', '字节数不符：期望 ' + expectedBytes + '，实际 ' + bytes);
  }
  return { bytes, sha256: sha256.digest('hex'), gitBlobSha1: gitBlob.digest('hex') };
}

/* ------------------------------------------------------------------ */
/* 网络                                                                 */
/* ------------------------------------------------------------------ */

/** 取消一个尚未消费的响应体；取消失败不掩盖调用方要抛的错误。 */
async function cancelBody(response) {
  try {
    await response?.body?.cancel?.();
  } catch {
    /* 忽略取消响应体时的错误 */
  }
}

/**
 * 逐跳跟随重定向，每一跳都校验 https + 允许的主机。
 * 不发送任何凭据：headers 完全自建，不带鉴权字段或会话凭据。
 * 等待响应头有明确截止时间：headersTimeoutMs 到点即 abort，报 E_HEADERS_TIMEOUT。
 * 非 200 或重定向跳转时取消响应体，避免连接悬挂。
 */
export async function fetchWithRedirects(url, {
  fetchImpl = fetch,
  maxRedirects = MAX_REDIRECTS,
  headersTimeoutMs = DEFAULT_HEADERS_TIMEOUT_MS,
  signal = null,
} = {}) {
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (signal?.aborted) fail('E_ABORTED', '请求已被取消');
    // 每一跳独立计时：DNS/TLS/首字节都算在“等待响应头”里。
    const controller = new AbortController();
    const onOuterAbort = () => controller.abort(new AsrDownloadError('E_ABORTED', '请求已被取消'));
    if (signal) signal.addEventListener('abort', onOuterAbort, { once: true });
    let timedOut = false;
    const timer = headersTimeoutMs > 0
      ? setTimeout(() => {
        timedOut = true;
        controller.abort(new AsrDownloadError(
          'E_HEADERS_TIMEOUT',
          '等待响应头超过 ' + headersTimeoutMs + ' 毫秒: ' + safeUrlForLog(current),
        ));
      }, headersTimeoutMs)
      : null;
    timer?.unref?.();

    let response;
    try {
      response = await fetchImpl(current, {
        redirect: 'manual',
        credentials: 'omit',
        signal: controller.signal,
        headers: {
          accept: '*/*',
          'user-agent': 'dsh-desktop-pet-asr-download/1 (+local M0-04 fixture fetch)',
        },
      });
    } catch (error) {
      if (timedOut) {
        fail('E_HEADERS_TIMEOUT', '等待响应头超过 ' + headersTimeoutMs + ' 毫秒: ' + safeUrlForLog(current));
      }
      if (signal?.aborted) fail('E_ABORTED', '请求已被取消');
      if (error instanceof AsrDownloadError) throw error;
      fail('E_NETWORK', '请求失败: ' + (error?.message || String(error)));
    } finally {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener?.('abort', onOuterAbort);
    }

    const status = response.status;
    if (status === 301 || status === 302 || status === 303 || status === 307 || status === 308) {
      const location = response.headers?.get?.('location');
      await cancelBody(response);
      if (!location) fail('E_REDIRECT', 'HTTP ' + status + ' 没有 Location 头');
      current = validateRedirectUrl(location, current);
      continue;
    }
    if (status !== 200) {
      await cancelBody(response);
      fail('E_HTTP_STATUS', 'HTTP 状态不是 200: ' + status, { status, url: current });
    }
    return { response, finalUrl: current };
  }
  fail('E_REDIRECT', '重定向次数超过上限 ' + maxRedirects);
}

/* ------------------------------------------------------------------ */
/* 缓存目录安全检查                                                     */
/* ------------------------------------------------------------------ */

/** 拒绝符号链接 / 联接点（Windows junction 在 lstat 里也表现为 symlink）。 */
export async function assertNoReparsePoint(absPath, label) {
  let stat;
  try {
    stat = await fs.lstat(absPath);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  if (stat.isSymbolicLink()) {
    fail('E_REPARSE_POINT', (label || '路径') + ' 是符号链接或联接点，拒绝使用: ' + absPath);
  }
  return true;
}

/**
 * 从可信锚点 rootAbs 开始逐段前进，每一段都先 lstat 再决定是否创建。
 * 关键点：绝不使用递归 mkdir —— 递归创建会穿过尚未检查的父目录，
 * 一旦某一级是联接点，文件就被写到锚点之外。
 *
 * options.create=false 时用于离线校验：路径必须已存在，缺失报 missingCode。
 * 返回最终目录的绝对路径。
 */
export async function assertSafeDirectoryChain(rootAbs, segments, {
  create = true,
  missingCode = 'E_MISSING',
  rootLabel = '可信根目录',
} = {}) {
  const rootStat = await fs.lstat(rootAbs).catch((error) => {
    if (error.code === 'ENOENT') fail('E_CACHE_ROOT', rootLabel + '不存在: ' + rootAbs);
    throw error;
  });
  if (rootStat.isSymbolicLink()) {
    fail('E_REPARSE_POINT', rootLabel + ' 是符号链接或联接点，拒绝使用: ' + rootAbs);
  }
  if (!rootStat.isDirectory()) fail('E_NOT_DIRECTORY', rootLabel + ' 不是目录: ' + rootAbs);

  let current = rootAbs;
  for (const segment of segments) {
    assertSafeSegment(segment, 'E_BAD_MODEL_ID');
    current = path.join(current, segment);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!create) fail(missingCode, '路径不存在: ' + current);
      try {
        await fs.mkdir(current);
      } catch (mkdirError) {
        // 并发创建是允许的（EEXIST），其它错误照常上抛。
        if (mkdirError.code !== 'EEXIST') throw mkdirError;
      }
      stat = await fs.lstat(current);
    }
    if (stat.isSymbolicLink()) {
      fail('E_REPARSE_POINT', '路径段是符号链接或联接点，拒绝使用: ' + current);
    }
    if (!stat.isDirectory()) fail('E_NOT_DIRECTORY', '不是目录: ' + current);
  }
  return current;
}

/**
 * 兼容旧接口：从 rootAbs 起逐段创建目录，每段都拒绝链接。
 * 返回最终目录的绝对路径。
 */
export async function ensureSafeDirectory(rootAbs, segments) {
  return assertSafeDirectoryChain(rootAbs, segments, { create: true, rootLabel: '根目录' });
}

/**
 * 把 repoRoot 内的路径解析成"相对 repoRoot 的安全段数组"。
 * 用于测试注入的临时 cacheRoot / manifestPath：它们可以写成绝对路径，
 * 但必须落在 repoRoot 之内，不能借参数逃出工作区。
 */
export function toSafeSegmentsWithin(repoRootAbs, candidate, code) {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    fail(code, '路径参数为空');
  }
  const abs = path.resolve(repoRootAbs, candidate);
  const rel = path.relative(repoRootAbs, abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    fail(code, '路径必须位于 repoRoot 之内: ' + JSON.stringify(candidate));
  }
  const segments = rel.split(path.sep).filter((part) => part.length > 0);
  for (const segment of segments) assertSafeSegment(segment, code);
  return { abs, segments };
}

/**
 * 原子且不覆盖地发布 part → target。
 * 用同卷硬链接：目标已存在时内核返回 EEXIST，我们直接失败；
 * 不支持硬链接（例如跨卷、某些网络盘）也直接失败。
 * 任何情况下都不退回 rename —— rename 会静默覆盖另一写入者的文件。
 */
export async function publishNoOverwrite(partPath, targetPath) {
  try {
    await fs.link(partPath, targetPath);
  } catch (error) {
    if (error.code === 'EEXIST') {
      fail('E_EXISTING_MISMATCH', '发布时目标已存在，拒绝覆盖: ' + targetPath);
    }
    fail('E_PUBLISH_UNSUPPORTED',
      '无法原子发布（硬链接失败 ' + (error.code || error.message) + '），不退回覆盖式改名: ' + targetPath);
  }
}

/**
 * 原子写文件：先写唯一临时文件再改名。
 * 只用于收据这类可重建的元数据（覆盖上一次收据是预期行为），
 * 模型文件一律走 publishNoOverwrite，绝不用改名覆盖。
 */
export async function writeFileAtomic(targetPath, content) {
  const tempPath = targetPath + '.' + randomUUID() + '.tmp';
  try {
    await fs.writeFile(tempPath, content, { flag: 'wx' });
    await fs.rename(tempPath, targetPath);
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* 清单                                                                 */
/* ------------------------------------------------------------------ */

/**
 * 读取并校验清单结构。
 * 返回 { manifest, sha256, path }；任何结构问题都直接抛 E_MANIFEST。
 */
export async function loadManifest(manifestPathAbs) {
  let raw;
  try {
    raw = await fs.readFile(manifestPathAbs);
  } catch (error) {
    fail('E_MANIFEST', '读不到清单 ' + manifestPathAbs + ': ' + error.message);
  }
  const manifestSha256 = createHash('sha256').update(raw).digest('hex');
  let manifest;
  try {
    manifest = JSON.parse(raw.toString('utf8'));
  } catch (error) {
    fail('E_MANIFEST', '清单不是合法 JSON: ' + error.message);
  }
  validateManifest(manifest);
  return { manifest, sha256: manifestSha256, path: manifestPathAbs };
}

/** 校验清单结构与安全约束，并做跨条目一致性检查。 */
export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') fail('E_MANIFEST', '清单不是对象');
  if (manifest.schemaVersion !== 1) fail('E_MANIFEST', '不支持的 schemaVersion: ' + manifest.schemaVersion);
  if (!Array.isArray(manifest.models) || manifest.models.length === 0) {
    fail('E_MANIFEST', '清单没有 models 数组');
  }
  if (manifest.models.length > MAX_MODELS) fail('E_MANIFEST', '模型数量超过上限 ' + MAX_MODELS);

  const seenIds = new Set();
  let fileCount = 0;
  let totalBytes = 0;

  for (const model of manifest.models) {
    if (!model || typeof model !== 'object') fail('E_MANIFEST', '模型条目不是对象');
    const id = validateModelId(model.id);
    if (seenIds.has(id)) fail('E_MANIFEST', '重复的 model.id: ' + id);
    seenIds.add(id);
    if (typeof model.repository !== 'string' || !REPOSITORY_RE.test(model.repository)) {
      fail('E_MANIFEST', 'repository 格式不正确: ' + JSON.stringify(model.repository));
    }
    if (typeof model.revision !== 'string' || !REVISION_RE.test(model.revision)) {
      fail('E_MANIFEST', 'revision 必须是 40 位小写十六进制: ' + JSON.stringify(model.revision));
    }
    if (!Array.isArray(model.files) || model.files.length === 0) {
      fail('E_MANIFEST', '模型 ' + id + ' 没有 files');
    }
    const seenPaths = new Set();
    for (const file of model.files) {
      if (!file || typeof file !== 'object') fail('E_MANIFEST', '文件条目不是对象');
      validateRelativePath(file.path);
      if (seenPaths.has(file.path)) fail('E_MANIFEST', '模型 ' + id + ' 内重复的 path: ' + file.path);
      seenPaths.add(file.path);
      if (!Number.isSafeInteger(file.bytes) || file.bytes <= 0) {
        fail('E_MANIFEST', 'bytes 必须是正整数: ' + JSON.stringify(file.path));
      }
      if (file.bytes > MAX_FILE_BYTES) {
        fail('E_TOO_LARGE', '清单条目超过单文件上限: ' + file.path + ' ' + file.bytes);
      }
      expectedHashOf(file);
      validateDownloadUrl(file.url, { repository: model.repository, revision: model.revision, filePath: file.path });
      fileCount += 1;
      totalBytes += file.bytes;
      if (fileCount > MAX_FILES) fail('E_MANIFEST', '文件数量超过上限 ' + MAX_FILES);
      if (totalBytes > MAX_TOTAL_BYTES) fail('E_TOO_LARGE', '清单总字节数超过上限 ' + MAX_TOTAL_BYTES);
    }
  }
  return { fileCount, totalBytes };
}

/* ------------------------------------------------------------------ */
/* 单个文件的处理                                                       */
/* ------------------------------------------------------------------ */

/**
 * 处理一个清单文件：
 *   已存在 → 校验 → 通过则 skipped，不通过则拒绝（绝不覆盖）
 *   不存在 → 流式下载到 .part → 校验 → 发布
 * 返回收据用的条目对象。
 */
export async function processFile({
  model,
  file,
  modelDir,
  fetchImpl = fetch,
  log = () => {},
  headersTimeoutMs = DEFAULT_HEADERS_TIMEOUT_MS,
  downloadTimeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS,
}) {
  const expected = expectedHashOf(file);
  const segments = validateRelativePath(file.path);
  const targetPath = resolveTargetPath(modelDir, file.path);
  // 逐段创建父目录，每段都拒绝符号链接/联接点（清单里有 test_wavs/ 这样的子目录）。
  if (segments.length > 1) {
    await ensureSafeDirectory(modelDir, segments.slice(0, -1));
  }
  const entry = {
    path: file.path,
    bytes: file.bytes,
    expectedHash: expected,
    status: 'pending',
    actualSha256: null,
    actualGitBlobSha1: null,
  };

  const existed = await assertNoReparsePoint(targetPath, '目标文件');
  if (existed) {
    const stat = await fs.lstat(targetPath);
    if (!stat.isFile()) fail('E_NOT_A_FILE', '目标路径已存在但不是普通文件: ' + targetPath);
    let actual;
    try {
      actual = await hashFileAt(targetPath);
    } catch (error) {
      if (error instanceof AsrDownloadError) throw error;
      fail('E_HASH_READ_FAILED', '读取已有文件失败: ' + error.message);
    }
    const mismatch = compareHash(actual, expected, file.bytes);
    if (mismatch) {
      fail('E_EXISTING_MISMATCH',
        '已存在文件校验失败，拒绝覆盖，请人工确认后删除再重试：' + targetPath + '（' + mismatch.message + '）',
        { path: file.path, actual, expected });
    }
    entry.status = 'skipped';
    entry.actualSha256 = actual.sha256;
    entry.actualGitBlobSha1 = actual.gitBlobSha1;
    log('skip    ' + file.path + '  (已存在且校验通过)');
    return entry;
  }

  const partPath = targetPath + '.' + randomUUID() + '.part';
  let partCreated = false;
  let response = null;
  try {
    const fetched = await fetchWithRedirects(file.url, { fetchImpl, headersTimeoutMs });
    response = fetched.response;
    const contentLength = response.headers?.get?.('content-length');
    if (contentLength !== null && contentLength !== undefined && contentLength !== '') {
      const declared = Number(contentLength);
      if (!Number.isSafeInteger(declared) || declared < 0) {
        fail('E_BAD_HEADER', 'Content-Length 不是有效整数: ' + contentLength);
      }
      if (declared !== file.bytes) {
        fail('E_SIZE_MISMATCH',
          '服务器 Content-Length ' + declared + ' 与清单声明的 ' + file.bytes + ' 不一致，拒绝下载');
      }
    }
    // 只记录来源主机与路径：CDN 的签名查询串不进日志。
    log('fetch   ' + file.path + '  (' + file.bytes + ' 字节) <- ' + safeUrlForLog(fetched.finalUrl));
    partCreated = true;
    const actual = await streamResponseToFile({
      body: response.body,
      partPath,
      expectedBytes: file.bytes,
      timeoutMs: downloadTimeoutMs,
    });
    // 流读完后响应体已消费完，之后不需要再取消。
    response = null;
    const mismatch = compareHash(actual, expected, file.bytes);
    if (mismatch) {
      fail(mismatch.code, '下载内容校验失败：' + file.path + '（' + mismatch.message + '）', { path: file.path, actual, expected });
    }
    // 原子且不覆盖地发布：并发写入者先到就先赢，我们失败而不是覆盖它。
    await publishNoOverwrite(partPath, targetPath);
    // 发布成功后只删自己的 part（它与 target 是同一 inode 的两个链接）。
    // 删除失败不影响已发布文件，但仍属于本次失败，交给调用方记录。
    await fs.rm(partPath, { force: true });
    partCreated = false;
    entry.status = 'downloaded';
    entry.actualSha256 = actual.sha256;
    entry.actualGitBlobSha1 = actual.gitBlobSha1;
    log('ok      ' + file.path + '  sha256=' + actual.sha256);
    return entry;
  } finally {
    // 失败路径上如果响应体还没被消费，取消它，别把连接挂着。
    if (response) await cancelBody(response);
    // 只清理自己创建的 .part；发布成功后 part 已不存在，rm 是空操作。
    if (partCreated) await fs.rm(partPath, { force: true }).catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* 主流程                                                               */
/* ------------------------------------------------------------------ */

/** 收据里的相对路径表示（便于人工核对，不泄露绝对路径）。 */
function toPosixRelative(fromAbs, toAbs) {
  return path.relative(fromAbs, toAbs).split(path.sep).join('/');
}

/**
 * 执行一次完整运行。
 * checkOnly=true 时只校验已有文件，不发起网络请求。
 */
export async function runDownload({
  repoRoot = REPO_ROOT,
  manifestPath = DEFAULT_MANIFEST_PATH,
  cacheRoot = DEFAULT_CACHE_ROOT,
  only = null,
  checkOnly = false,
  fetchImpl = fetch,
  log = () => {},
} = {}) {
  const startedAt = Date.now();
  const repoRootAbs = path.resolve(repoRoot);
  // repoRoot 是整条路径检查的可信锚点，它本身不能是链接。
  await assertNoReparsePoint(repoRootAbs, '工作区根');
  // manifestPath / cacheRoot 可以由测试指向临时目录，但必须仍在 repoRoot 之内；
  // CLI 不允许传这两个参数，只能使用下面的默认值。
  const manifestAbs = toSafeSegmentsWithin(repoRootAbs, manifestPath, 'E_MANIFEST').abs;
  const cacheRel = toSafeSegmentsWithin(repoRootAbs, cacheRoot, 'E_CACHE_ROOT');
  const cacheAbs = cacheRel.abs;
  const { manifest, sha256: manifestSha256 } = await loadManifest(manifestAbs);

  const models = only ? manifest.models.filter((model) => model.id === only) : manifest.models;
  if (only && models.length === 0) {
    fail('E_UNKNOWN_MODEL', '清单里没有这个 model.id: ' + only);
  }

  // R1：从 repoRoot 开始逐段检查并创建缓存路径，绝不先递归 mkdir 再只查末级。
  // 例如 .cache 是联接点时，这里会在进入 .cache 之前就失败，不会写到链接目标里。
  await assertSafeDirectoryChain(repoRootAbs, cacheRel.segments, {
    create: true,
    missingCode: 'E_CACHE_ROOT',
    rootLabel: '工作区根',
  });

  const receipt = {
    schemaVersion: 1,
    kind: 'asr-model-receipt',
    purpose: 'M0-04 local compatibility fixtures, not product model defaults or redistribution approval',
    generatedAt: new Date().toISOString(),
    mode: checkOnly ? 'check' : 'download',
    node: process.version,
    platform: process.platform + '-' + process.arch,
    manifest: { path: toPosixRelative(repoRoot, manifestAbs), sha256: manifestSha256 },
    cacheRoot: toPosixRelative(repoRoot, cacheAbs),
    models: [],
    totals: { files: 0, downloaded: 0, skipped: 0, failed: 0, bytes: 0 },
    elapsedMs: 0,
    ok: true,
  };

  for (const model of models) {
    const modelEntry = {
      id: model.id,
      repository: model.repository,
      revision: model.revision,
      directory: toPosixRelative(repoRoot, path.join(cacheAbs, model.id)),
      status: 'complete',
      files: [],
    };
    receipt.models.push(modelEntry);
    let modelDir;
    try {
      modelDir = await assertSafeDirectoryChain(cacheAbs, [model.id], {
        create: true,
        missingCode: 'E_MISSING',
        rootLabel: '缓存根',
      });
    } catch (error) {
      modelEntry.status = 'failed';
      modelEntry.error = describeError(error);
      receipt.ok = false;
      receipt.totals.failed += model.files.length;
      receipt.totals.files += model.files.length;
      log('FAILED  ' + model.id + ': ' + error.message);
      continue;
    }
    for (const file of model.files) {
      receipt.totals.files += 1;
      if (checkOnly) {
        try {
          const fileSegments = validateRelativePath(file.path);
          // R2：离线校验也要逐段检查中间目录，否则 test_wavs 是联接点时
          // 会顺着链接读到缓存之外的文件并报"校验通过"。
          if (fileSegments.length > 1) {
            await assertSafeDirectoryChain(modelDir, fileSegments.slice(0, -1), {
              create: false,
              missingCode: 'E_MISSING',
              rootLabel: '模型目录',
            });
          }
          const targetPath = resolveTargetPath(modelDir, file.path);
          if (!(await assertNoReparsePoint(targetPath, '目标文件'))) {
            fail('E_MISSING', '缓存中没有这个文件: ' + file.path);
          }
          const actual = await hashFileAt(targetPath);
          const mismatch = compareHash(actual, expectedHashOf(file), file.bytes);
          if (mismatch) fail(mismatch.code, mismatch.message);
          modelEntry.files.push({
            path: file.path,
            bytes: file.bytes,
            expectedHash: expectedHashOf(file),
            status: 'verified',
            actualSha256: actual.sha256,
            actualGitBlobSha1: actual.gitBlobSha1,
          });
          receipt.totals.skipped += 1;
          receipt.totals.bytes += actual.bytes;
          log('verified ' + model.id + '/' + file.path);
        } catch (error) {
          modelEntry.status = 'failed';
          modelEntry.files.push({
            path: file.path,
            bytes: file.bytes,
            expectedHash: expectedHashOf(file),
            status: 'failed',
            error: describeError(error),
          });
          receipt.totals.failed += 1;
          receipt.ok = false;
          log('FAILED  ' + model.id + '/' + file.path + ': ' + error.message);
        }
        continue;
      }
      try {
        const entry = await processFile({ model, file, modelDir, fetchImpl, log });
        modelEntry.files.push(entry);
        receipt.totals[entry.status === 'skipped' ? 'skipped' : 'downloaded'] += 1;
        receipt.totals.bytes += file.bytes;
      } catch (error) {
        modelEntry.status = 'failed';
        modelEntry.files.push({
          path: file.path,
          bytes: file.bytes,
          expectedHash: expectedHashOf(file),
          status: 'failed',
          error: describeError(error),
        });
        receipt.totals.failed += 1;
        receipt.ok = false;
        log('FAILED  ' + model.id + '/' + file.path + ': ' + error.message);
      }
    }
  }

  receipt.elapsedMs = Date.now() - startedAt;
  const receiptPath = path.join(cacheAbs, RECEIPT_NAME);
  await writeFileAtomic(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  return { receipt, receiptPath };
}

/** 日志用的 URL 表示：去掉查询串与片段（CDN 签名参数不落日志）。 */
export function safeUrlForLog(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.origin + url.pathname;
  } catch {
    return '<invalid-url>';
  }
}

/** 把任意错误变成收据里可序列化的结构。 */
export function describeError(error) {
  if (error instanceof AsrDownloadError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: error?.code || 'E_UNKNOWN',
    message: error?.message || String(error),
  };
}

/* ------------------------------------------------------------------ */
/* CLI                                                                  */
/* ------------------------------------------------------------------ */

function parseArgs(argv) {
  const options = {
    only: null,
    checkOnly: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--check') options.checkOnly = true;
    else if (arg === '--only') {
      const value = argv[i + 1];
      if (!value) fail('E_USAGE', '--only 需要一个 model.id');
      options.only = value;
      i += 1;
    } else if (arg === '--manifest' || arg === '--cache') {
      // 固定缓存需求下不开放任意清单/缓存路径：否则 CLI 就成了任意路径写入工具。
      fail('E_USAGE', arg + ' 已移除：清单固定为 ' + DEFAULT_MANIFEST_PATH
        + '，缓存固定为 ' + DEFAULT_CACHE_ROOT + '（测试请直接调用 runDownload）');
    } else {
      fail('E_USAGE', '未知参数: ' + arg);
    }
  }
  return options;
}

function printHelp() {
  process.stdout.write([
    'M0-04 ASR 模型下载与校验',
    '',
    '  node qa/probes/asr-download.mjs                 下载并校验清单中的全部文件',
    '  node qa/probes/asr-download.mjs --check         只校验缓存中已有文件，不联网',
    '  node qa/probes/asr-download.mjs --only <id>     只处理指定 model.id',
    '',
    '清单固定为 ' + DEFAULT_MANIFEST_PATH + '，缓存固定为 ' + DEFAULT_CACHE_ROOT + '；',
    '不接受自定义路径。',
    '',
  ].join('\n'));
}

export async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(error.message + '\n');
    return 2;
  }
  if (options.help) {
    printHelp();
    return 0;
  }
  const log = (line) => process.stdout.write(line + '\n');
  try {
    const { receipt, receiptPath } = await runDownload({
      only: options.only,
      checkOnly: options.checkOnly,
      log,
    });
    log('');
    log('收据: ' + receiptPath);
    log('汇总: ' + JSON.stringify(receipt.totals) + ' 用时 ' + receipt.elapsedMs + ' ms');
    return receipt.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write('失败: ' + error.message + '\n');
    if (error.details) process.stderr.write(JSON.stringify(error.details, null, 2) + '\n');
    return 1;
  }
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write('未捕获错误: ' + (error?.stack || error) + '\n');
    process.exitCode = 1;
  });
}
