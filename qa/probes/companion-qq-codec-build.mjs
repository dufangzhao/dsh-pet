import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../../', import.meta.url));
const root = path.resolve(project, '.cache/qa/companion-qq-codec');
if (await realpath(root) !== root) throw new Error('Unexpected build root');
const downloadRoot = path.join(root, 'downloads');
const sourceRoot = path.join(root, 'sources');
const prefix = path.join(root, 'build-prefix');
const artifactRoot = path.join(root, 'artifacts-muxer2');
for (const directory of [sourceRoot, prefix, artifactRoot, path.join(root, 'gnupg')])
  await mkdir(directory, { recursive: true, mode: 0o700 });
const environment = { PATH: '/usr/bin:/bin', HOME: root, LC_ALL: 'C', LANG: 'C', SOURCE_DATE_EPOCH: '1750000000' };
async function command(executable, args, cwd = root, timeoutMs = 600_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, shell: false, detached: true, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; let timedOut = false;
    const capture = (bytes) => { output = (output + bytes.toString()).slice(-20_000); };
    child.stdout.on('data', capture); child.stderr.on('data', capture);
    const timeout = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') reject(error); } }, timeoutMs);
    child.once('error', reject);
    child.once('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0 || timedOut) reject(new Error(`${executable} ${args[0]} exit=${code} timeout=${timedOut}\n${output}`));
      else resolve(output);
    });
  });
}
const observed = JSON.parse(await readFile(path.join(root, 'download-observation.json'), 'utf8'));
for (const artifact of observed.results) {
  if (artifact.error) throw new Error('Incomplete dependency gate');
  const bytes = await readFile(path.join(downloadRoot, artifact.name));
  if (createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) throw new Error('Changed download');
}
const gpg = ['--batch', '--homedir', path.join(root, 'gnupg')];
await command('/usr/bin/gpg', [...gpg, '--import', path.join(downloadRoot, 'ffmpeg-devel.asc')]);
const keys = await command('/usr/bin/gpg', [...gpg, '--with-colons', '--fingerprint']);
if (!keys.includes('FCF986EA15E6E293A5644F10B4322F04D67658D8')) throw new Error('Unexpected FFmpeg signing key');
const signature = await command('/usr/bin/gpg', [...gpg, '--status-fd', '1', '--verify', path.join(downloadRoot, 'ffmpeg-7.1.2.tar.xz.asc'), path.join(downloadRoot, 'ffmpeg-7.1.2.tar.xz')]);
if (!signature.includes('VALIDSIG FCF986EA15E6E293A5644F10B4322F04D67658D8')) throw new Error('FFmpeg signature not verified');
const dsc = await readFile(path.join(downloadRoot, 'lame_3.100-6.dsc'), 'utf8');
if (!dsc.includes('ddfe36cab873794038ae2c1210557ad34857a4b6bdc515785d1da9e175b1da1e 1524133 lame_3.100.orig.tar.gz')) throw new Error('LAME source does not match Debian source checksum');
await command('/usr/bin/python3', ['-c', `
import tarfile,pathlib,os
root=pathlib.Path(${JSON.stringify(root)}).resolve()
for filename,expected in [('silk-wasm-3.7.1.tgz','package'),('ffmpeg-7.1.2.tar.xz','ffmpeg-7.1.2'),('lame_3.100.orig.tar.gz','lame-3.100')]:
 target=root/'sources'/expected
 if target.exists():
  if target.is_symlink() or target.resolve().parent != root/'sources': raise RuntimeError('Unexpected source target')
  continue
 with tarfile.open(root/'downloads'/filename) as archive:
  for member in archive.getmembers():
   relative=pathlib.PurePosixPath(member.name)
   if relative.is_absolute() or '..' in relative.parts or not relative.parts or relative.parts[0]!=expected: raise RuntimeError('Unsafe archive path')
   if not (member.isfile() or member.isdir()): raise RuntimeError('Unsupported archive member '+member.name)
  for member in archive.getmembers():
   destination=root/'sources'/member.name
   if member.isdir(): destination.mkdir(parents=True,exist_ok=True)
   else:
    destination.parent.mkdir(parents=True,exist_ok=True)
    with archive.extractfile(member) as source,open(destination,'xb') as output: output.write(source.read())
    os.chmod(destination,member.mode & 0o755)
`]);
const lameRoot = path.join(sourceRoot, 'lame-3.100');
const ffmpegRoot = path.join(sourceRoot, 'ffmpeg-7.1.2');
try { await readFile(path.join(prefix, 'lib/libmp3lame.a')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  console.log('Building isolated static LAME 3.100');
  await command(path.join(lameRoot, 'configure'), [`--prefix=${prefix}`, '--enable-static', '--disable-shared', '--disable-frontend', '--disable-decoder', '--disable-analyzer-hooks'], lameRoot);
  await command('/usr/bin/make', ['-j2'], lameRoot);
  await command('/usr/bin/make', ['install'], lameRoot);
}
const flags = [
  '--prefix=/codec/ffmpeg', '--disable-shared', '--enable-static', '--disable-x86asm', '--disable-doc', '--disable-debug', '--disable-network', '--disable-autodetect', '--disable-everything', '--disable-iconv', '--disable-zlib', '--disable-bzlib', '--disable-lzma', '--pkg-config=/usr/bin/false',
  '--enable-ffmpeg', '--enable-ffprobe', '--enable-avcodec', '--enable-avformat', '--enable-avfilter', '--enable-swresample',
  '--enable-protocol=file,pipe', '--enable-demuxer=wav,mp3,ogg,mov,aac,flac',
  '--enable-decoder=pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,pcm_f64le,mp3float,mp2float,aac,opus,vorbis,flac,alac',
  '--enable-parser=aac,mpegaudio,opus,vorbis,flac', '--enable-filter=aresample,aformat,anull',
  '--enable-encoder=pcm_s16le,pcm_f32le,aac,opus,vorbis,flac,libmp3lame', '--enable-libmp3lame',
  '--enable-muxer=wav,pcm_s16le,pcm_f32le,adts,ogg,flac,mp4,mp3',
  `--extra-cflags=-I${prefix}/include -ffile-prefix-map=${sourceRoot}=/usr/src/codec -fno-ident`,
  `--extra-ldflags=-static -L${prefix}/lib`,
];
console.log('Building fixed minimal static FFmpeg 7.1.2');
await command(path.join(ffmpegRoot, 'configure'), flags, ffmpegRoot);
await command('/usr/bin/make', ['-j2', 'ffmpeg', 'ffprobe'], ffmpegRoot);
const files = [];
for (const name of ['ffmpeg', 'ffprobe']) {
  const source = path.join(ffmpegRoot, name), destination = path.join(artifactRoot, name);
  let old;
  try { old = await readFile(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const bytes = await readFile(source);
  if (old && !old.equals(bytes)) throw new Error('Existing codec artifact differs; explicit review required');
  if (!old) await copyFile(source, destination);
  files.push({ name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const metadata = { version: 1, ffmpeg: '7.1.2', lame: '3.100', ffmpegSignature: 'FCF986EA15E6E293A5644F10B4322F04D67658D8', flags, files, compiler: (await command('/usr/bin/gcc', ['--version'])).split('\n')[0] };
const output = path.join(root, 'build-observation-muxer2.json');
let prior;
try { prior = await readFile(output, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const text = JSON.stringify(metadata, null, 2) + '\n';
if (prior && prior !== text) throw new Error('Build observation changed; review before replacement');
if (!prior) await writeFile(output, text, { flag: 'wx', mode: 0o600 });
console.log(text);
