'use strict';
const { app, safeStorage } = require('electron');
const { fork } = require('node:child_process');
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const userData = path.resolve(__dirname, '../../.cache/electron-m0');
mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);
const watchdog = setTimeout(() => app.exit(1), 30000);
app.whenReady().then(async () => {
  const available = await safeStorage.isAsyncEncryptionAvailable();
  if (!available) throw new Error('Async safeStorage unavailable');
  const encrypted = await safeStorage.encryptStringAsync('m0-public-fixture');
  const decrypted = await safeStorage.decryptStringAsync(encrypted);
  if (decrypted.result !== 'm0-public-fixture') throw new Error('safeStorage roundtrip failed');
  const env = { ELECTRON_RUN_AS_NODE: '1' };
  for (const name of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH']) {
    if (process.env[name]) env[name] = process.env[name];
  }
  const childReport = await new Promise((resolve, reject) => {
    const child = fork(path.join(__dirname, 'runtime-worker.cjs'), [], {
      execPath: process.execPath, execArgv: [], env,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let report;
    let outputBytes = 0;
    const timer = setTimeout(() => { child.kill(); reject(new Error('worker timed out')); }, 20000);
    for (const pipe of [child.stdout, child.stderr]) pipe.on('data', chunk => {
      outputBytes += chunk.length;
      if (outputBytes > 65536) { child.kill(); reject(new Error('worker output exceeded bound')); }
      else process.stderr.write(chunk);
    });
    child.on('message', message => {
      if (message && message.type === 'm0-runtime') report = message.report;
    });
    child.once('error', reject);
    child.once('exit', code => {
      clearTimeout(timer);
      if (code === 0 && report) resolve(report);
      else reject(new Error('worker exited without successful report: ' + code));
    });
  });
  console.log(JSON.stringify({
    main: { electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome },
    safeStorage: { asynchronous: true, available, roundTrip: true },
    child: childReport,
  }, null, 2));
  clearTimeout(watchdog);
  app.exit(0);
}).catch(error => { console.error(error.message); clearTimeout(watchdog); app.exit(1); });
