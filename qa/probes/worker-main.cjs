'use strict';
// Owned Electron main -> Electron RUN_AS_NODE worker, not a plugin security sandbox.
const { app } = require('electron');
const { fork } = require('node:child_process');
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const probes = {
  cordis: { entry: 'packages/host-kernel/dist/m0/cordis-worker.mjs', timeout: 20000 },
  asr: { entry: 'qa/probes/asr-worker.cjs', timeout: 120000 },
  key: { entry: 'qa/probes/key-worker.cjs', timeout: 20000 },
};
const kind = process.argv[2];
const selected = probes[kind];
if (!selected || process.versions.electron !== '45.0.0') app.exit(2);
else {
  const userData = path.join(root, '.cache/electron-m0');
  mkdirSync(userData, { recursive: true });
  app.setPath('userData', userData);
  let child;
  const watchdog = setTimeout(() => { child?.kill(); app.exit(1); }, selected.timeout + 10000);
  app.whenReady().then(async () => {
    const env = { ELECTRON_RUN_AS_NODE: '1' };
    for (const name of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH']) {
      if (process.env[name]) env[name] = process.env[name];
    }
    const result = await new Promise((resolve, reject) => {
      child = fork(path.join(root, selected.entry), process.argv.slice(3), {
        execPath: process.execPath, execArgv: [], env,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
      let report;
      let problem;
      let bytes = 0;
      const timer = setTimeout(() => { child.kill(); reject(new Error('worker timeout')); }, selected.timeout);
      for (const pipe of [child.stdout, child.stderr]) pipe.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 65536) { child.kill(); reject(new Error('worker output exceeded limit')); }
        else process.stderr.write(chunk);
      });
      child.on('message', message => {
        if (!message || JSON.stringify(message).length > 65536) {
          child.kill(); reject(new Error('invalid probe report')); return;
        }
        if (message.type === 'm0.stage' && /^[a-z-]{1,60}$/.test(message.stage)) process.stderr.write('M0 stage: ' + message.stage + '\n');
        if (message.type === 'm0.result') report = message.report;
        if (message.type === 'm0.error') problem = message.message;
      });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => {
        clearTimeout(timer);
        if (code === 0 && report && !problem) resolve(report);
        else reject(new Error(problem || 'worker exit without report: ' + code));
      });
    });
    console.log(JSON.stringify({ kind, electron: process.versions.electron, node: process.versions.node, report: result }));
    clearTimeout(watchdog);
    app.exit(0);
  }).catch(error => { console.error(error.message); child?.kill(); clearTimeout(watchdog); app.exit(1); });
}
