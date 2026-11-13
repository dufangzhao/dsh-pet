import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This prepares reviewed public build inputs only. It installs nothing and runs no codec/model.
const project = fileURLToPath(new URL('../../', import.meta.url));
const root = path.resolve(project, '.cache/qa/companion-qq-codec');
if (root !== path.join(project, '.cache/qa/companion-qq-codec')) throw new Error('Unexpected dependency root');
await mkdir(root, { recursive: true, mode: 0o700 });
if (await realpath(root) !== root) throw new Error('Dependency root must not be a symlink');
const downloads = path.join(root, 'downloads');
await mkdir(downloads, { recursive: true, mode: 0o700 });
const integrity = 'sha512-mXPwLRtZxrYV3TZx41jMAeKc80wvmyrcXIcs8HctFxK15Ahz2OJQENYhNgEPeCEOdI6Mbx1NxQsqxzwc3DKerw==';
const sources = [
  ['silk-wasm-3.7.1.tgz', 'https://registry.npmjs.org/silk-wasm/-/silk-wasm-3.7.1.tgz', 1024 * 1024],
  ['ffmpeg-7.1.2.tar.xz', 'https://ffmpeg.org/releases/ffmpeg-7.1.2.tar.xz', 32 * 1024 * 1024],
  ['ffmpeg-7.1.2.tar.xz.asc', 'https://ffmpeg.org/releases/ffmpeg-7.1.2.tar.xz.asc', 16 * 1024],
  ['ffmpeg-devel.asc', 'https://ffmpeg.org/ffmpeg-devel.asc', 32 * 1024],
  ['lame_3.100.orig.tar.gz', 'https://deb.debian.org/debian/pool/main/l/lame/lame_3.100.orig.tar.gz', 8 * 1024 * 1024],
  ['lame_3.100-6.dsc', 'https://deb.debian.org/debian/pool/main/l/lame/lame_3.100-6.dsc', 32 * 1024],
  ['silk-sdk-license.txt', 'https://raw.githubusercontent.com/idranme/silk-wasm/5971995be3ce05d4a1bf820fdf9d7ccdc942e945/binding/libSilkCodec/silk/LICENSE', 32 * 1024],
];
const results = [];
async function download([name, url, maxBytes]) {
  const target = path.join(downloads, name);
  if (path.dirname(target) !== downloads) throw new Error('Unexpected artifact target');
  let bytes;
  try { bytes = await readFile(target); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (bytes === undefined) {
    const response = await fetch(url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(90_000) });
    if (!response.ok || !response.body) throw new Error(`${name}: HTTP ${response.status}`);
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > maxBytes) throw new Error(`${name}: artifact budget exceeded`);
      chunks.push(chunk);
    }
    bytes = Buffer.concat(chunks);
    if (name === 'silk-wasm-3.7.1.tgz' && `sha512-${createHash('sha512').update(bytes).digest('base64')}` !== integrity)
      throw new Error('SILK registry integrity mismatch');
    await writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
  }
  if (bytes.byteLength > maxBytes) throw new Error(`${name}: existing artifact over budget`);
  if (name === 'silk-wasm-3.7.1.tgz' && `sha512-${createHash('sha512').update(bytes).digest('base64')}` !== integrity)
    throw new Error('Existing SILK artifact integrity mismatch');
  const result = { name, url, bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
  console.log(JSON.stringify(result));
  return result;
}
const jobs = await Promise.allSettled(sources.map(download));
for (let at = 0; at < jobs.length; at++) {
  const job = jobs[at];
  if (job.status === 'fulfilled') results.push(job.value);
  else results.push({ name: sources[at][0], error: String(job.reason?.message ?? job.reason) });
}
const record = { schemaVersion: 1, root, silkVersion: '3.7.1', silkGitHead: '5971995be3ce05d4a1bf820fdf9d7ccdc942e945', silkIntegrity: integrity,
  ffmpegVersion: '7.1.2', ffmpegSigningFingerprint: 'FCF986EA15E6E293A5644F10B4322F04D67658D8',
  baseImageId: 'sha256:a9975a0df83b07f6ef3a57098174a8303cb0e322570e1d2f175ceba33f417a72',
  baseImageDigest: '1panel/deepseek-harness@sha256:72c58e3b343cce588a05d0d107abb362f6b4c52eb313d54afe3a28ef4cef6d7f',
  baseNode: '24.21.0', results };
const manifest = path.join(root, 'download-observation.json');
let previous;
try { previous = await readFile(manifest, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (previous !== undefined && previous !== JSON.stringify(record, null, 2) + '\n')
  throw new Error('Existing dependency observation differs; review it before replacement');
if (previous === undefined) await writeFile(manifest, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
if (results.some(result => result.error)) process.exitCode = 1;
