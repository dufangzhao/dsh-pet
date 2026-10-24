'use strict';
const koffi = require('koffi');
const path = require('node:path');
const dll = koffi.load(path.join(process.env.SystemRoot, 'System32/user32.dll'));
const keyState = dll.func('short __stdcall GetAsyncKeyState(int vKey)');
const foreground = dll.func('uintptr_t __stdcall GetForegroundWindow(void)');
const target = process.argv[2];
if (!/^[0-9]+$/.test(target || '') || BigInt(target) === 0n) throw new Error('Invalid owned HWND');
const report = { key: 'F8', periodMs: 10, edges: [], polls: 0, gapsMs: [], focusTransitions: [], outsideFocusPolls: 0 };
let prevDown = false, prevFocus = false, lastPoll = performance.now(), closed = false;
const timer = setInterval(() => {
  const now = performance.now(); const focused = String(foreground()) === target;
  report.gapsMs.push(now - lastPoll); lastPoll = now; report.polls++;
  if (report.gapsMs.length > 30000) report.gapsMs.shift();
  if (focused !== prevFocus) report.focusTransitions.push({ focused, at: Date.now() });
  if (!focused) { report.outsideFocusPolls++; prevDown = false; prevFocus = false; return; }
  const down = (keyState(0x77) & 0x8000) !== 0;
  if (down !== prevDown) {
    const edge = { type: down ? 'down' : 'up', at: Date.now(), monotonic: now };
    report.edges.push(edge); process.send?.({ type: 'edge', edge });
  }
  prevDown = down; prevFocus = focused;
}, 10);
function stop() {
  if (closed) return; closed = true; clearInterval(timer); clearTimeout(watchdog);
  const sorted = [...report.gapsMs].sort((a,b) => a-b);
  report.gapSummary = { count: sorted.length, p50: sorted[Math.floor(sorted.length*0.5)], p95: sorted[Math.floor(sorted.length*0.95)], max: sorted[sorted.length-1] };
  delete report.gapsMs;
  dll.unload(); if (process.connected) { process.send({ type: 'result', report }); process.disconnect(); }
}
const watchdog = setTimeout(stop, 5 * 60 * 1000);
process.on('message', message => { if (message?.type === 'stop') stop(); });
process.on('disconnect', stop);
process.send?.({ type: 'ready', runtime: { electron: process.versions.electron, node: process.versions.node } });
