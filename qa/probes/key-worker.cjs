'use strict';
const koffi = require('koffi');
const path = require('node:path');
const round = value => Math.round(value * 1000) / 1000;
const dll = koffi.load(path.join(process.env.SystemRoot, 'System32/user32.dll'));
const readKey = dll.func('short __stdcall GetAsyncKeyState(int vKey)');
async function measure(periodMs, durationMs, replayPulses) {
  const ticks = [];
  let transitions = 0;
  let previous = false;
  const cpuStart = process.cpuUsage();
  const start = performance.now();
  await new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      try {
        const down = (readKey(0x87) & 0x8000) !== 0;
        if (down !== previous) transitions += 1;
        previous = down; ticks.push(performance.now() - start);
      } catch (error) { clearInterval(interval); clearTimeout(end); reject(error); }
    }, periodMs);
    const end = setTimeout(() => { clearInterval(interval); resolve(); }, durationMs);
  });
  const elapsedMs = performance.now() - start;
  const cpu = process.cpuUsage(cpuStart);
  const gaps = ticks.map((tick, i) => tick - (ticks[i - 1] || 0)).sort((a, b) => a - b);
  return { periodMs, elapsedMs: round(elapsedMs), calls: ticks.length, observedF24Transitions: transitions,
    cpuMs: round((cpu.user + cpu.system) / 1000), cpuPercentOfOneCore: round((cpu.user + cpu.system) / (elapsedMs * 10)),
    gapMs: { p50: round(gaps[Math.floor(gaps.length * 0.5)]), p95: round(gaps[Math.floor(gaps.length * 0.95)]), max: round(gaps[gaps.length - 1]) },
    syntheticPulseReplay: [5, 10, 20, 30, 50, 100].map(ms => replayPulses(ticks, ms)) };
}
(async () => {
  const { replayPulses, TalkKeyGesture } = await import('../../packages/host-kernel/dist/m0/talk-key-probe.mjs');
  const polling = [await measure(30, 4000, replayPulses), await measure(10, 4000, replayPulses)];
  const g = new TalkKeyGesture(250);
  const intents = [g.key('down', 0), g.key('up', 50), g.key('down', 500), g.key('up', 550), g.key('down', 1000), g.key('up', 1300)].flat();
  process.send({ type: 'm0.result', report: { testKey: 'F24 read-only; no input injection', thresholdMs: 250,
    intents, polling, limitations: 'Pulse replay uses synthetic intervals on real polling times, not physical key presses.' } });
})().catch(error => { process.send?.({ type: 'm0.error', message: error.message }); process.exitCode = 1; })
  .finally(() => { dll.unload(); if (process.connected) process.disconnect(); });
