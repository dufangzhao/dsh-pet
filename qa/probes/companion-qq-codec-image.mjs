import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, chmod, realpath } from 'node:fs/promises';
import path from 'node:path';

const project = fileURLToPath(new URL('../../', import.meta.url));
const root = path.resolve(project, '.cache/qa/companion-qq-codec');
if (await realpath(root) !== root) throw new Error('Unexpected codec root');
const require = createRequire(import.meta.url);
const { build } = await import(pathToFileURL(require.resolve('esbuild', { paths: [path.join(project, 'plugins/tts-magpie')] })).href);
const compiled = await build({ entryPoints: [path.join(project, 'plugins/qq-media-codec/runtime/job-runner.mjs')],
  bundle: true, platform: 'node', target: 'node24', format: 'esm', write: false,
  alias: { '@pet/contracts': path.join(project, 'packages/contracts/src/index.ts') }, external: ['/codec/silk/index.mjs'] });
const runner = compiled.outputFiles[0]?.contents;
if (!runner) throw new Error('No runner artifact');
const tools = JSON.parse(await readFile(path.join(root, 'build-observation-muxer2.json'), 'utf8'));
const sources = JSON.parse(await readFile(path.join(root, 'download-observation.json'), 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = sha(Buffer.from(JSON.stringify({ imageSchema: 2, runner: sha(runner), tools, silk: sources.silkIntegrity })));
const context = path.join(root, `image-context-${identity.slice(0, 16)}`);
await mkdir(context, { recursive: true, mode: 0o700 });
if (await realpath(context) !== context) throw new Error('Unexpected image context');
await chmod(context, 0o755);
async function put(relative, bytes, mode = 0o644) {
  const target = path.join(context, relative);
  if (!target.startsWith(context + path.sep)) throw new Error('Unexpected context artifact');
  await mkdir(path.dirname(target), { recursive: true });
  let existing;
  try { existing = await readFile(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing && !existing.equals(Buffer.from(bytes))) throw new Error('Changed existing image input');
  if (!existing) await writeFile(target, bytes, { flag: 'wx', mode });
  await chmod(target, mode);
  return { path: relative, sha256: sha(bytes), sizeBytes: bytes.length };
}
const files = [await put('job-runner.mjs', runner)];
for (const tool of tools.files) {
  const bytes = await readFile(path.join(root, 'artifacts-muxer2', tool.name));
  if (sha(bytes) !== tool.sha256) throw new Error('Changed FFmpeg artifact');
  files.push(await put(`bin/${tool.name}`, bytes, 0o755));
}
for (const name of ['index.mjs', 'silk.wasm'])
  files.push(await put(`silk/${name}`, await readFile(path.join(root, 'sources/package/lib', name))));
const licenses = [
  ['ffmpeg-LGPL-2.1.txt', path.join(root, 'sources/ffmpeg-7.1.2/COPYING.LGPLv2.1')],
  ['lame-LGPL-2.txt', path.join(root, 'sources/lame-3.100/COPYING')],
  ['silk-wrapper-MIT.txt', path.join(root, 'sources/package/LICENSE')],
  ['silk-container-BSD.txt', path.join(root, 'downloads/silk-sdk-license.txt')],
  ['glibc-copyright.txt', '/usr/share/doc/libc6/copyright'],
  ['gcc-runtime-copyright.txt', '/usr/share/doc/gcc-11-base/copyright'],
];
for (const [name, source] of licenses) files.push(await put(`licenses/${name}`, await readFile(source)));
// The reviewed pinned source notice is retained locally; image assembly itself needs no network.
const header = await readFile(path.join(project, 'qa/fixtures/companion-qq-codec/notices/silk-Skype-BSD-notice.txt'), 'utf8');
const notice = header.slice(0, header.indexOf('*/') + 2);
if (!notice.includes('Skype Limited') || !notice.includes('PATENT RIGHTS')) throw new Error('Unexpected embedded SDK notice');
files.push(await put('licenses/silk-Skype-BSD-notice.txt', Buffer.from(notice + '\n')));
const manifest = { version: 1, baseImageId: sources.baseImageId, baseImageDigest: sources.baseImageDigest, nodeVersion: sources.baseNode,
  ffmpeg: tools.ffmpeg, ffmpegSourceSha256: sources.results.find(item => item.name === 'ffmpeg-7.1.2.tar.xz')?.sha256,
  ffmpegSigningFingerprint: sources.ffmpegSigningFingerprint, lame: tools.lame,
  silkVersion: sources.silkVersion, silkIntegrity: sources.silkIntegrity, silkGitHead: sources.silkGitHead, files };
const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
await put('runtime-manifest.json', manifestBytes);
await put('Dockerfile', Buffer.from(`FROM ${sources.baseImageId}\nLABEL pet.qq-codec.manifest=${sha(manifestBytes)}\nCOPY . /codec/\nUSER 65534:65534\nWORKDIR /codec\nENTRYPOINT ["/usr/bin/env","-i","LANG=C","HOME=/tmp","UV_THREADPOOL_SIZE=1","/usr/local/bin/node","--max-old-space-size=128","--v8-pool-size=1","/codec/job-runner.mjs"]\n`));
const config = path.join(root, 'docker-config'); await mkdir(config, { recursive: true, mode: 0o700 });
async function docker(args, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/docker', ['--host', 'unix:///var/run/docker.sock', ...args], { shell: false,
      env: { PATH: '/usr/bin:/bin', HOME: root, DOCKER_CONFIG: config, DOCKER_BUILDKIT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const capture = bytes => { output = (output + bytes.toString()).slice(-maxBytes); };
    child.stdout.on('data', capture); child.stderr.on('data', capture);
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve(output) : reject(new Error(`Docker exit ${code}\n${output}`)));
  });
}
await put('.dockerignore', Buffer.from('image.iid\n'));
const iid = path.join(context, 'image.iid');
const output = await docker(['build', '--pull=false', '--network', 'none', '--iidfile', iid,
  '-t', `pet-qq-media-codec:phase0-${identity.slice(0, 16)}`, context]);
console.log(output);
const imageId = (await readFile(iid, 'utf8')).trim();
if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error('Bad built image id');
const image = JSON.parse((await docker(['image', 'inspect', '--format', '{"Id":{{json .Id}},"Volumes":{{json .Config.Volumes}}}', imageId])).trim());
if (image.Id !== imageId || image.Volumes !== null && Object.keys(image.Volumes).length)
  throw new Error('Unexpected image identity/volumes');
const lock = { ...manifest, imageId, manifestSha256: sha(manifestBytes), contextIdentity: identity };
const destination = path.join(root, `codec-image-${identity.slice(0, 16)}.json`);
let previous;
try { previous = await readFile(destination, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const text = JSON.stringify(lock, null, 2) + '\n';
if (previous && previous !== text) throw new Error('Image observation changed');
if (!previous) await writeFile(destination, text, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ imageId, manifestSha256: lock.manifestSha256, lock: destination }));
