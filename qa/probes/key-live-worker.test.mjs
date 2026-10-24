import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
const source = fs.readFileSync(new URL('./key-live-worker.cjs', import.meta.url), 'utf8');
function fixture(target = '42') {
  let clock = 0, fg = 0, down = false, nativeReads = 0, unloaded = 0, nextId = 1;
  const intervals = new Map(), timeouts = new Map(), handlers = new Map(), messages = [];
  const process = { argv: ['electron','worker',target], env: { SystemRoot: 'C:/Windows' }, versions: { electron:'45.0.0',node:'24.22.0' }, connected: true,
    send(message) { if (!this.connected) throw new Error('send after disconnect'); messages.push(structuredClone(message)); },
    disconnect() { this.connected = false; handlers.get('disconnect')?.(); },
    on(type, callback) { handlers.set(type, callback); } };
  const koffi = { load() { return { func(declaration) {
    if (declaration.includes('GetForegroundWindow')) return () => fg;
    if (declaration.includes('GetAsyncKeyState')) return key => { assert.equal(key, 0x77); nativeReads++; return down ? -32768 : 0; };
    throw new Error('Unexpected native API');
  }, unload() { unloaded++; } }; } };
  const context = { require(name) { if(name==='koffi')return koffi;if(name==='node:path')return path;throw new Error('Unexpected dependency'); }, process,
    performance: { now: () => clock }, Date: { now: () => 1000000 + clock },
    setInterval(fn) { const id=nextId++;intervals.set(id,fn);return id; }, clearInterval(id) {intervals.delete(id);},
    setTimeout(fn) {const id=nextId++;timeouts.set(id,fn);return id;}, clearTimeout(id) {timeouts.delete(id);} };
  vm.runInNewContext(source, context);
  return { messages, focus(value) {fg=value;}, down(value) {down=value;}, tick(ms=10) {clock+=ms;for(const fn of [...intervals.values()])fn();},
    stop() {handlers.get('message')?.({type:'stop'});}, disconnect() {process.disconnect();}, expire() {[...timeouts.values()][0]?.();},
    counts: () => ({nativeReads,unloaded,intervals:intervals.size,timeouts:timeouts.size}) };
}
test('never samples F8 outside the owned foreground window', () => {
  const f=fixture();f.down(true);f.tick();f.focus(99);f.tick();assert.equal(f.counts().nativeReads,0);f.stop();
  const r=f.messages.find(x=>x.type==='result').report;assert.equal(r.outsideFocusPolls,2);assert.deepEqual(r.edges,[]);
});
test('only emits transitions and samples exactly F8', () => {
  const f=fixture();f.focus(42);f.tick();f.down(true);f.tick();f.tick();f.down(false);f.tick();f.stop();
  assert.deepEqual(f.messages.filter(x=>x.type==='edge').map(x=>x.edge.type),['down','up']);
  assert.equal(f.counts().nativeReads,4);
});
test('stop is idempotent and frees every owned timer/native handle', () => {
  const f=fixture();f.stop();f.stop();assert.deepEqual(f.counts(),{nativeReads:0,unloaded:1,intervals:0,timeouts:0});
  assert.equal(f.messages.filter(x=>x.type==='result').length,1);
});
test('disconnect cleans up without sending on a closed IPC channel', () => {
  const f=fixture();assert.doesNotThrow(()=>f.disconnect());assert.equal(f.counts().unloaded,1);assert.equal(f.counts().intervals,0);
});
test('watchdog ends sampling and reports bounded timing summary', () => {
  const f=fixture();f.tick(15);f.tick(20);f.expire();const r=f.messages.find(x=>x.type==='result').report;
  assert.equal(r.gapSummary.max,20);assert.equal(r.gapSummary.count,2);assert.equal('gapsMs' in r,false);
});
test('invalid and null HWND values cannot arm the sampler', () => {
  for(const value of ['0','-1','not-a-handle','']) assert.throws(()=>fixture(value),/Invalid owned HWND/);
});
