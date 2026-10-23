'use strict';
const { createRequire } = require('node:module');
const path = require('node:path');
const koffi = require('koffi');
const sherpa = require('sherpa-onnx-node');
const sherpaRequire = createRequire(require.resolve('sherpa-onnx-node'));
const systemRoot = process.env.SystemRoot;
if (!systemRoot || process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('This M0 probe requires Windows x64 and SystemRoot');
}
const user32 = koffi.load(path.join(systemRoot, 'System32', 'user32.dll'));
try {
  const keyState = user32.func('short __stdcall GetAsyncKeyState(int vKey)');
  const report = {
    node: process.versions.node,
    electron: process.versions.electron,
    modules: process.versions.modules,
    napi: process.versions.napi,
    platform: process.platform,
    arch: process.arch,
    koffi: koffi.version,
    sherpaWrapper: require('sherpa-onnx-node/package.json').version,
    sherpaBinary: sherpaRequire('sherpa-onnx-win-x64/package.json').version,
    offlineRecognizer: typeof sherpa.OfflineRecognizer === 'function',
    onlineRecognizer: typeof sherpa.OnlineRecognizer === 'function',
    keyReadReturnedNumber: typeof keyState(0x87) === 'number',
  };
  if (report.electron !== '45.0.0' || report.koffi !== '3.3.1' ||
      report.sherpaWrapper !== '1.13.8' || report.sherpaBinary !== '1.13.8' ||
      !report.offlineRecognizer || !report.onlineRecognizer || !report.keyReadReturnedNumber) {
    throw new Error('Runtime baseline or native API check failed');
  }
  process.send({ type: 'm0-runtime', report });
} finally {
  user32.unload();
  process.disconnect();
}
