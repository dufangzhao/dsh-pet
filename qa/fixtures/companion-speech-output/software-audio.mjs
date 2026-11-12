// Private null-only Pulse server. No product or audio stream starts on import.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../..', import.meta.url));
async function within(work, label) {
  let timer;
  try { return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timeout`)), 10000); })]); }
  finally { clearTimeout(timer); }
}
export async function startNullAudio(toolDirectory) {
  const tools = path.resolve(toolDirectory);
  assert.ok(tools.startsWith(path.join(root, '.companion-data/tooling') + path.sep));
  const binary = path.join(tools, 'root/usr/bin/pulseaudio'), pactl = path.join(tools, 'root/usr/bin/pactl');
  const runtime = await mkdtemp(path.join(os.tmpdir(), 'speech-null-'));
  const home = path.join(runtime, 'home'); await mkdir(home, { mode: 0o700 });
  const config = path.join(runtime, 'null.pa'), socket = path.join(runtime, 'native');
  const clientConfig = path.join(runtime, 'client.conf');
  await writeFile(clientConfig, 'autospawn = no\nenable-shm = no\n', { mode: 0o600 });
  await writeFile(config, `load-module module-native-protocol-unix socket=${socket} auth-anonymous=1\nload-module module-null-sink sink_name=qa_speech_null rate=48000 channels=2\nset-default-sink qa_speech_null\n`, { mode: 0o600 });
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, 'config'), XDG_DATA_HOME: path.join(home, 'data'),
    XDG_CACHE_HOME: path.join(home, 'cache'), XDG_RUNTIME_DIR: runtime, PULSE_RUNTIME_PATH: runtime,
    PULSE_STATE_PATH: path.join(runtime, 'state'), PULSE_SERVER: `unix:${socket}`, PULSE_SINK: 'qa_speech_null',
    PULSE_CLIENTCONFIG: clientConfig,
    ALSA_CONFIG_PATH: path.join(root, 'qa/fixtures/companion-speech-output/null-only-alsa.conf'),
    LD_LIBRARY_PATH: [path.join(tools, 'root/usr/lib/x86_64-linux-gnu/pulseaudio'), path.join(tools, 'root/usr/lib/x86_64-linux-gnu'), path.join(tools, 'root/usr/lib/pulse-15.99.1+dfsg1/modules'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') };
  const modulesPath = path.join(tools, 'root/usr/lib/pulse-15.99.1+dfsg1/modules');
  const child = spawn(binary, ['-n', `--file=${config}`, `--dl-search-path=${modulesPath}`, '--daemonize=no', '--use-pid-file=no',
    '--exit-idle-time=-1', '--disable-shm=true', '--realtime=no', '--high-priority=no', '--log-level=info', '--log-target=stderr'],
  { env, stdio: ['ignore', 'ignore', 'pipe'] });
  const ended = once(child, 'exit'); const ready = Promise.withResolvers(); let log = '';
  child.stderr.on('data', bytes => { log = (log + bytes).slice(-16000); if (log.includes('Daemon startup complete')) ready.resolve(); });
  child.once('error', error => ready.reject(error));
  child.once('exit', code => ready.reject(new Error(`Private Pulse exited ${code}: ${log.slice(-1200)}`)));
  const query = async name => JSON.parse((await exec(pactl, ['-s', env.PULSE_SERVER, '-f', 'json', 'list', name], { env, timeout: 5000 })).stdout);
  async function verify() {
    const sinks = await query('sinks'), modules = await query('modules'), inputs = await query('sink-inputs');
    assert.equal(sinks.length, 1); const sink = sinks[0];
    assert.equal(sink.name, env.PULSE_SINK); assert.equal(sink.driver, 'module-null-sink.c');
    assert.match(sink.sample_specification, /48000Hz/); assert.match(sink.sample_specification, /2ch/);
    assert.deepEqual(modules.map(item => item.name).sort(), ['module-native-protocol-unix', 'module-null-sink']);
    return { serverPid: child.pid, server: env.PULSE_SERVER, sink: { index: sink.index, name: sink.name, driver: sink.driver,
      sampleSpecification: sink.sample_specification }, modules: modules.map(item => ({ index: item.index, name: item.name })), sinkInputs: inputs.length };
  }
  let closePromise;
  const close = () => closePromise ??= (async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    const [code, signal] = await within(ended, 'private Pulse close');
    assert.equal(code, 0, `private Pulse close signal ${signal}`);
    let connectionRejected = false;
    try { await query('sinks'); } catch { connectionRejected = true; }
    assert.equal(connectionRejected, true);
    return { code, signal, connectionRejected, pid: child.pid };
  })();
  try {
    await within(ready.promise, 'private Pulse startup'); const proof = await verify();
    return { env, proof, verify, query,
      async ownedInputs(mainPid) {
        const streams = await query('sink-inputs'); const sink = (await query('sinks'))[0]; const owned = [];
        for (const stream of streams) {
          const pid = Number(stream.properties?.['application.process.id']);
          if (!Number.isSafeInteger(pid) || pid < 1) continue;
          let cursor = pid;
          for (let depth = 0; depth < 16 && cursor > 1; depth++) {
            if (cursor === mainPid) { assert.equal(stream.sink, sink.index); owned.push({ index: stream.index, sink: stream.sink, processId: pid }); break; }
            let status; try { status = await readFile(`/proc/${cursor}/status`, 'utf8'); } catch { break; }
            cursor = Number(/^PPid:\s+(\d+)/m.exec(status)?.[1] ?? 0);
          }
        }
        return owned;
      }, close, log: () => log };
  } catch (error) { await close(); throw error; }
}
