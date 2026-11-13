import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, realpath, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const project = fileURLToPath(new URL('../../', import.meta.url));
const qaRoot = path.resolve(project, '.cache/qa/companion-qq-codec');
assert.equal(await realpath(qaRoot), qaRoot);
const pinPath = path.resolve(process.argv[2] ?? path.join(qaRoot, 'codec-image-f104fbb3f01ea965.json'));
assert.equal(path.dirname(pinPath), qaRoot);
const pin = JSON.parse(await readFile(pinPath, 'utf8'));
const require = createRequire(import.meta.url);
const { build } = await import(pathToFileURL(require.resolve('esbuild', { paths: [path.join(project, 'plugins/tts-magpie')] })).href);
const compiled = await build({ stdin: { contents: "export { CodecDockerRunner } from './plugins/qq-media-codec/src/job.ts'; export { codecDocker } from './plugins/qq-media-codec/src/docker.ts';", resolveDir: project }, bundle: true,
  platform: 'node', format: 'esm', target: 'node26', write: false,
  alias: { '@pet/contracts': path.join(project, 'packages/contracts/src/index.ts'), '@pet/host-kernel': path.join(project, 'packages/host-kernel/src/kernel-fault.ts') } });
const bytes = compiled.outputFiles[0]?.contents;
assert.ok(bytes);
const hash = data => createHash('sha256').update(data).digest('hex');
const bundle = path.join(qaRoot, `host-runner-${hash(bytes).slice(0, 16)}.mjs`);
let old; try { old = await readFile(bundle); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (old) assert.ok(old.equals(bytes)); else await writeFile(bundle, bytes, { flag: 'wx', mode: 0o600 });
const { CodecDockerRunner, codecDocker } = await import(pathToFileURL(bundle).href);
const directory = path.join(qaRoot, `run-${randomUUID()}`);
await mkdir(directory, { mode: 0o700 });
const receipts = [], cases = [], runners = [];
async function runner(options = {}) {
  const instance = await CodecDockerRunner.create({ directory: path.join(directory, `owner-${runners.length}`), pin,
    observe: receipt => receipts.push(receipt), ...options }); runners.push(instance); return instance;
}
async function* stream(bytes) { for (let at = 0; at < bytes.length; at += 64 * 1024) yield bytes.subarray(at, at + 64 * 1024); }
const signal = () => new AbortController().signal;
function pcm(rate, seconds) {
  const output = Buffer.alloc(Math.round(rate * seconds) * 2);
  for (let at = 0; at < output.length / 2; at++) {
    const frequency = 220 + Math.floor(at / rate / 20) * 73;
    output.writeInt16LE(Math.round(12000 * Math.sin(2 * Math.PI * frequency * at / rate)), at * 2);
  }
  return output;
}
function wav(bytes, rate) {
  const header = Buffer.alloc(44); header.write('RIFF'); header.writeUInt32LE(bytes.length + 36, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(bytes.length, 40);
  return Buffer.concat([header, bytes]);
}
async function collect(meta, data) {
  const chunks = []; for await (const chunk of data) chunks.push(chunk);
  const bytes = Buffer.concat(chunks); assert.equal(bytes.length, meta.sizeBytes); assert.equal(hash(bytes), meta.sha256);
  return { meta, bytes };
}
function settled(receipt) {
  assert.ok(receipt); assert.equal(receipt.stopped, true); assert.equal(receipt.removed, true); assert.equal(receipt.workspaceRemoved, true);
}
async function compressed(format, source) {
  const name = `pet-qq-codec-fixture-${randomUUID()}`;
  const folder = path.join(directory, name);
  const input = path.join(folder, 'input'), output = path.join(folder, 'output');
  await mkdir(input, { recursive: true, mode: 0o755 }); await mkdir(output, { mode: 0o755 });
  await writeFile(path.join(input, 'synthetic.wav'), source, { flag: 'wx', mode: 0o444 });
  const settings = {
    mp3: ['-c:a', 'libmp3lame', '-f', 'mp3'], aac: ['-c:a', 'aac', '-f', 'adts'],
    m4a: ['-c:a', 'aac', '-f', 'mp4'], flac: ['-c:a', 'flac', '-f', 'flac'],
    vorbis: ['-c:a', 'vorbis', '-strict', '-2', '-ac', '2', '-f', 'ogg'],
    opus: ['-c:a', 'opus', '-strict', '-2', '-ar', '48000', '-f', 'ogg'],
  }[format];
  assert.ok(settings);
  const cli = path.join(directory, 'fixture-docker-config'); await mkdir(cli, { recursive: true, mode: 0o700 });
  try {
    const reply = await codecDocker(cli, ['run', '--rm', '--pull', 'never', '--name', name, '--label', `pet.qq-codec.fixture=${path.basename(directory)}`,
      '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges=true', '--user', `${process.getuid()}:${process.getgid()}`,
      '--memory', '512m', '--memory-swap', '512m', '--cpus', '1', '--pids-limit', '32', '--ulimit', 'fsize=2097152:2097152',
      '--mount', `type=bind,source=${input},target=/input,readonly`, '--mount', `type=bind,source=${output},target=/output`,
      '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=16m', '--entrypoint', '/usr/bin/env', pin.imageId,
      '-i', 'HOME=/tmp', 'LANG=C', '/codec/bin/ffmpeg', '-nostdin', '-v', 'error', '-threads', '1', '-filter_threads', '1',
      '-i', '/input/synthetic.wav', '-map', '0:a:0', ...settings, '/output/fixture.bin'], 20_000);
    assert.equal(reply.failed, false, reply.stderr); assert.equal(reply.code, 0, reply.stderr);
    return await readFile(path.join(output, 'fixture.bin'));
  } finally {
    const candidates = await codecDocker(cli, ['ps', '-a', '--no-trunc', '--filter', `name=^/${name}$`, '--format', '{{.ID}}']);
    assert.equal(candidates.failed, false);
    if (candidates.stdout.trim()) {
      const id = candidates.stdout.trim(); assert.match(id, /^[a-f0-9]{64}$/);
      const check = await codecDocker(cli, ['inspect', '--format', '{"Image":{{json .Image}},"owner":{{json (index .Config.Labels "pet.qq-codec.fixture")}}}', id]);
      const identity = JSON.parse(check.stdout); assert.equal(identity.Image, pin.imageId); assert.equal(identity.owner, path.basename(directory));
      await codecDocker(cli, ['stop', '--time', '1', id]);
      const stopped = await codecDocker(cli, ['inspect', '--format', '{{.State.Running}} {{.State.Pid}}', id]);
      if (stopped.code === 0) { assert.equal(stopped.stdout.trim(), 'false 0'); await codecDocker(cli, ['rm', id]); }
    }
    const left = await codecDocker(cli, ['ps', '-a', '--no-trunc', '--filter', `name=^/${name}$`, '--format', '{{.ID}}']);
    assert.equal(left.code, 0); assert.equal(left.stdout.trim(), '');
    assert.equal(path.dirname(folder), directory); assert.equal(await realpath(folder), folder);
    await rm(folder, { recursive: true });
  }
}
async function sandboxAudit() {
  const name = `pet-qq-codec-audit-${randomUUID()}`, folder = path.join(directory, name);
  const input = path.join(folder, 'input'), output = path.join(folder, 'output');
  await mkdir(input, { recursive: true, mode: 0o755 }); await mkdir(output, { mode: 0o755 });
  await writeFile(path.join(input, 'probe'), 'synthetic', { mode: 0o444 });
  const config = path.join(directory, 'audit-config'); await mkdir(config, { mode: 0o700 });
  const code = `const fs=require('fs'),os=require('os'),cp=require('child_process');(async()=>{let runtime,input;try{fs.writeFileSync('/codec/__readonly_probe','x');runtime='writable'}catch(e){runtime=e.code}try{fs.writeFileSync('/input/__readonly_probe','x');input='writable'}catch(e){input=e.code}fs.writeFileSync('/output/owned','ok');const children=[],waits=[];let rejected=0;for(let at=0;at<64;at++){const child=cp.spawn('/bin/sleep',['5'],{stdio:'ignore'});children.push(child);waits.push(new Promise(resolve=>{child.once('error',e=>{if(e.code==='EAGAIN')rejected++});child.once('close',resolve)}))}for(const child of children)child.kill('SIGKILL');await Promise.all(waits);const started=performance.now();while(performance.now()-started<400){}console.log(JSON.stringify({env:Object.keys(process.env).sort(),runtime,input,network:Object.keys(os.networkInterfaces()),memory:fs.readFileSync('/sys/fs/cgroup/memory.max','utf8').trim(),pids:fs.readFileSync('/sys/fs/cgroup/pids.max','utf8').trim(),cpu:fs.readFileSync('/sys/fs/cgroup/cpu.max','utf8').trim(),cpuStat:fs.readFileSync('/sys/fs/cgroup/cpu.stat','utf8'),rejected}));})().catch(e=>{console.error(e);process.exitCode=1})`;
  try {
    const reply = await codecDocker(config, ['run','--rm','--pull','never','--name',name,'--label','pet.qq-codec.audit=synthetic',
      '--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges=true','--user',`${process.getuid()}:${process.getgid()}`,
      '--memory','512m','--memory-swap','512m','--cpus','0.1','--pids-limit','32','--ulimit','nofile=256:256',
      '--mount',`type=bind,source=${input},target=/input,readonly`,'--mount',`type=bind,source=${output},target=/output`,
      '--tmpfs','/tmp:rw,nosuid,nodev,noexec,size=16m','--entrypoint','/usr/bin/env',pin.imageId,
      '-i','LANG=C','HOME=/tmp','UV_THREADPOOL_SIZE=1','/usr/local/bin/node','--v8-pool-size=1','-e',code],20_000);
    assert.equal(reply.failed,false,reply.stderr); assert.equal(reply.code,0,reply.stderr);
    const value=JSON.parse(reply.stdout); assert.deepEqual(value.env,['HOME','LANG','UV_THREADPOOL_SIZE']);
    assert.equal(value.runtime,'EROFS'); assert.equal(value.input,'EROFS'); assert.deepEqual(value.network,['lo']);
    assert.equal(value.memory,String(512*1024*1024)); assert.equal(value.pids,'32'); assert.equal(value.cpu,'10000 100000');
    assert.ok(value.rejected>0); assert.match(value.cpuStat,/nr_throttled [1-9][0-9]*/);
    assert.equal(await readFile(path.join(output,'owned'),'utf8'),'ok'); return value;
  } finally {
    const left=await codecDocker(config,['ps','-a','--no-trunc','--filter',`name=^/${name}$`,'--format','{{.ID}}']);
    assert.equal(left.code,0);
    if (left.stdout.trim()) {
      const id=left.stdout.trim(); assert.match(id,/^[a-f0-9]{64}$/);
      const check=await codecDocker(config,['inspect','--format','{"image":{{json .Image}},"audit":{{json (index .Config.Labels "pet.qq-codec.audit")}}}',id]);
      const own=JSON.parse(check.stdout); assert.equal(own.image,pin.imageId); assert.equal(own.audit,'synthetic');
      await codecDocker(config,['stop','--time','1',id]);
      const absent=await codecDocker(config,['ps','-a','--no-trunc','--filter',`name=^/${name}$`,'--format','{{.ID}}']);
      assert.equal(absent.code,0); assert.equal(absent.stdout.trim(),'');
    }
    assert.equal(path.dirname(folder),directory); assert.equal(await realpath(folder),folder); await rm(folder,{recursive:true});
  }
}
let failure;
try {
  const audit = await sandboxAudit(); cases.push({ name: 'actual-sandbox-mount-env-cgroup-cpu-pid', ...audit });
  console.log(JSON.stringify(cases.at(-1)));
  const codec = await runner();
  const smallPcm = pcm(16000, 1), small = await codec.decode(stream(wav(smallPcm, 16000)), collect, signal());
  assert.equal(small.meta.frames, 16000); assert.equal(small.meta.encoding, 'pcm-f32le');
  for (let frame = 0; frame < 16000; frame++) assert.equal(small.bytes.readFloatLE(frame * 4), smallPcm.readInt16LE(frame * 2) / 32768);
  settled(receipts.at(-1)); cases.push({ name: 'wav-actual-decode-f32', frames: small.meta.frames, sha256: small.meta.sha256 });
  console.log(JSON.stringify(cases.at(-1)));

  for (const format of ['mp3', 'aac', 'm4a', 'flac', 'vorbis', 'opus']) {
    const encoded = await compressed(format, wav(smallPcm, 16000));
    const decoded = await codec.decode(stream(encoded), collect, signal());
    assert.ok(decoded.meta.frames >= 14_000 && decoded.meta.frames <= 19_000);
    assert.ok(decoded.bytes.some(value => value !== 0)); settled(receipts.at(-1));
    cases.push({ name: `actual-${format}-decode`, encodedBytes: encoded.length, frames: decoded.meta.frames, sha256: decoded.meta.sha256 });
    console.log(JSON.stringify(cases.at(-1)));
  }
  const longPcm = pcm(16000, 120), decoded = await codec.decode(stream(wav(longPcm, 16000)), collect, signal());
  assert.equal(decoded.meta.frames, 1_920_000); assert.equal(decoded.meta.spans.length, 6);
  const expected = Buffer.alloc(1_920_000 * 4);
  for (let frame = 0; frame < 1_920_000; frame++) expected.writeFloatLE(longPcm.readInt16LE(frame * 2) / 32768, frame * 4);
  assert.ok(decoded.bytes.equals(expected));
  const spans = decoded.meta.spans.map((span, index) => {
    assert.deepEqual(span, { startFrame: index * 320_000, frames: 320_000 });
    return { ...span, sha256: hash(decoded.bytes.subarray(span.startFrame * 4, (span.startFrame + span.frames) * 4)) };
  });
  settled(receipts.at(-1)); cases.push({ name: '120s-exact-nonoverlap-six-spans', frames: decoded.meta.frames, bytes: decoded.bytes.length, spans });
  console.log(JSON.stringify(cases.at(-1)));

  const original24 = pcm(24000, 120), encoded = await codec.encode(stream(original24), collect, signal());
  assert.equal(encoded.meta.encoding, 'tencent-silk-v3'); assert.equal(encoded.meta.frames, 2_880_000);
  assert.ok(encoded.bytes.subarray(0, 10).equals(Buffer.from('\x02#!SILK_V3')));
  settled(receipts.at(-1)); cases.push({ name: 'actual-24k-pcm-120s-silk-encode-and-validated-decode', frames: encoded.meta.frames, bytes: encoded.bytes.length, sha256: encoded.meta.sha256 });
  console.log(JSON.stringify(cases.at(-1)));
  const roundtrip = await codec.decode(stream(encoded.bytes), collect, signal());
  assert.equal(roundtrip.meta.frames, 1_920_000); assert.equal(roundtrip.meta.spans.length, 6);
  // Each 20s region has a distinct frequency. Detect it independent of codec phase/delay.
  const tones = [];
  for (let segment = 0; segment < 6; segment++) {
    const powers = [];
    for (let candidate = 0; candidate < 6; candidate++) {
      const frequency = 220 + candidate * 73; let sine = 0, cosine = 0;
      for (let at = 0; at < 16000; at++) {
        const frame = segment * 320_000 + 160_000 + at;
        const value = roundtrip.bytes.readFloatLE(frame * 4), angle = 2 * Math.PI * frequency * at / 16000;
        sine += value * Math.sin(angle); cosine += value * Math.cos(angle);
      }
      powers.push(sine * sine + cosine * cosine);
    }
    assert.equal(powers.indexOf(Math.max(...powers)), segment); tones.push(220 + segment * 73);
  }
  settled(receipts.at(-1)); cases.push({ name: 'silk-120s-complete-decode-six-real-content-regions', frames: roundtrip.meta.frames, tones });
  console.log(JSON.stringify(cases.at(-1)));

  for (const [name, bytes, mode, code] of [
    ['unknown-format', Buffer.from('this is not audio'), 'decode', 'audio-format'],
    ['truncated-silk', encoded.bytes.subarray(0, encoded.bytes.length - 1), 'decode', 'audio-format'],
    ['odd-raw-pcm', Buffer.from([1]), 'encode', 'audio-format'],
    ['duration-over-120-no-successful-truncation', wav(pcm(16000, 120 + 1 / 16000), 16000), 'decode', 'quota-exceeded'],
  ]) {
    let consumed = false;
    await assert.rejects(codec[mode](stream(bytes), async (...args) => { consumed = true; return collect(...args); }, signal()), error => error.error?.code === code);
    assert.equal(consumed, false); settled(receipts.at(-1)); assert.equal(codec.activeJobs, 0); cases.push({ name, code, consumed });
    console.log(JSON.stringify(cases.at(-1)));
  }

  const bounded = await runner({ memoryBytes: 16 * 1024 * 1024 });
  await assert.rejects(bounded.encode(stream(pcm(24000, 20)), collect, signal()));
  const memoryReceipt = receipts.at(-1); settled(memoryReceipt); assert.ok(memoryReceipt.oomKilled || memoryReceipt.exitCode !== 0);
  cases.push({ name: 'actual-memory-cgroup-rejection', oomKilled: memoryReceipt.oomKilled, exitCode: memoryReceipt.exitCode });
  console.log(JSON.stringify(cases.at(-1)));

  const fileLimited = await runner({ fileBytes: 1024 });
  let fileConsumed = false;
  await assert.rejects(fileLimited.decode(stream(wav(smallPcm,16000)), async (...args) => { fileConsumed = true; return collect(...args); }, signal()), error => error.error?.code === 'quota-exceeded');
  assert.equal(fileConsumed,false); settled(receipts.at(-1)); cases.push({ name: 'actual-file-size-rlimit', consumed: fileConsumed, exitCode: receipts.at(-1).exitCode });
  console.log(JSON.stringify(cases.at(-1)));

  let startResolve; const started = new Promise(resolve => { startResolve = resolve; });
  const cancelled = await runner({ cpus: 0.1, onStarted: state => { assert.ok(state.pid > 0); startResolve(state); } });
  const abort = new AbortController();
  const work = cancelled.encode(stream(original24), collect, abort.signal).then(() => null, error => error);
  const running = await started; abort.abort();
  assert.equal((await work)?.error?.code, 'cancelled'); settled(receipts.at(-1)); assert.equal(cancelled.activeJobs, 0);
  cases.push({ name: 'cancel-joins-actual-running-container', containerId: running.containerId, pidObserved: running.pid, exitCode: receipts.at(-1).exitCode });
  console.log(JSON.stringify(cases.at(-1)));
} catch (error) { failure = error; console.error(error); }
const closes = await Promise.allSettled(runners.map(instance => instance.close()));
if (closes.some(value => value.status === 'rejected')) failure ??= new Error('Unconfirmed codec cleanup');
const evidence = { version: 1, imageId: pin.imageId, manifestSha256: pin.manifestSha256, success: !failure,
  activeJobs: runners.map(instance => instance.activeJobs), cases, receipts,
  scope: 'synthetic local codec/Docker only; no platform/model/device/account or delivery test' };
const evidencePath = path.join(qaRoot, `acceptance-${path.basename(directory)}.json`);
await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ evidencePath, success: !failure, activeJobs: evidence.activeJobs }));
if (!failure) {
  assert.equal(path.dirname(directory), qaRoot); assert.ok(path.basename(directory).startsWith('run-'));
  assert.equal(await realpath(directory), directory); await rm(directory, { recursive: true });
} else process.exitCode = 1;
