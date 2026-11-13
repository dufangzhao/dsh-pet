import assert from 'node:assert/strict';
import test from 'node:test';
import { KernelFault } from '@pet/host-kernel';
import { makeError } from '@pet/contracts';
import type { QQIoOutcome } from '@pet/companion-runtime';
import { OneBotQqDriver } from './driver.js';
import type { OneBotDriverObserver, OneBotDriverStatus, OneBotIo, OneBotPeer } from './ports.js';
import type { OneBotActionFrame } from './wire.js';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
class Queue<T> implements AsyncIterable<T> {
  private values: T[] = [];
  private readers: ((value: IteratorResult<T>) => void)[] = [];
  private ended = false;
  push(value: T): void {
    if (this.ended) return;
    const read = this.readers.shift();
    if (read) read({ done: false, value });
    else this.values.push(value);
  }
  end(): void {
    this.ended = true;
    this.values = [];
    for (const read of this.readers.splice(0)) read({ done: true, value: undefined });
  }
  next(): Promise<IteratorResult<T>> {
    const value = this.values.shift();
    if (value !== undefined) return Promise.resolve({ done: false, value });
    if (this.ended) return Promise.resolve({ done: true, value: undefined });
    return new Promise((resolve) => this.readers.push(resolve));
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => this.next(),
      return: async () => {
        this.end();
        return { done: true, value: undefined };
      },
    };
  }
}
class Peer implements OneBotPeer {
  openMedia(): never {
    throw new KernelFault('not-ready');
  }
  readonly lifetime = new AbortController();
  readonly signal = this.lifetime.signal;
  readonly frames = new Queue<string>();
  readonly physical = deferred<void>();
  readonly settled = this.physical.promise;
  readonly writes = new Queue<OneBotActionFrame>();
  readonly sent: OneBotActionFrame[] = [];
  readonly signals: AbortSignal[] = [];
  writeOutcome: QQIoOutcome<null> = { ok: true, value: null };
  readonly closingStarted = deferred<void>();
  closeGate: Promise<void> = Promise.resolve();
  writeGate: Promise<void> = Promise.resolve();
  closeError: Error | null = null;
  closeCount = 0;
  private closing: Promise<void> | null = null;
  constructor(
    readonly id: string,
    readonly selfId = '10001',
  ) {}
  reply(frame: OneBotActionFrame, data: unknown, status = 'ok', retcode = 0): void {
    this.frames.push(JSON.stringify({ status, retcode, data, echo: frame.echo }));
  }
  async send(frame: OneBotActionFrame, signal: AbortSignal): Promise<QQIoOutcome<null>> {
    signal.throwIfAborted();
    this.signals.push(signal);
    if (this.writeOutcome.ok || this.writeOutcome.dispatched) {
      this.sent.push(frame);
      this.writes.push(frame);
    }
    await this.writeGate;
    return this.writeOutcome;
  }
  close(): Promise<void> {
    this.lifetime.abort(new KernelFault('network'));
    this.closing ??= (async () => {
      this.closeCount++;
      this.frames.end();
      this.closingStarted.resolve();
      await this.closeGate;
      if (this.closeError) {
        this.physical.reject(this.closeError);
        throw this.closeError;
      }
      this.physical.resolve();
    })();
    return this.closing;
  }
}
class Io implements OneBotIo {
  readonly incoming = new Queue<Peer>();
  readonly peers: Peer[] = [];
  accepts = 0;
  closes = 0;
  private closing: Promise<void> | null = null;
  add(peer: Peer): void {
    this.peers.push(peer);
    this.incoming.push(peer);
  }
  async nextPeer(signal: AbortSignal): Promise<OneBotPeer> {
    this.accepts++;
    signal.throwIfAborted();
    const next = await this.incoming.next();
    if (next.done) throw new KernelFault('cancelled');
    return next.value;
  }
  close(): Promise<void> {
    this.closing ??= (async () => {
      this.closes++;
      this.incoming.end();
      await Promise.all(this.peers.map((peer) => peer.close()));
    })();
    return this.closing;
  }
}
function observer(): {
  observer: OneBotDriverObserver;
  states: Queue<OneBotDriverStatus>;
  events: string[];
} {
  const states = new Queue<OneBotDriverStatus>();
  const events: string[] = [];
  return {
    states,
    events,
    observer: {
      onStatus: (state) => states.push(state),
      onEvent: async (event, connectionId) => {
        events.push(`${connectionId}:${event.kind}`);
      },
    },
  };
}
async function phase(
  states: Queue<OneBotDriverStatus>,
  name: OneBotDriverStatus['phase'],
): Promise<OneBotDriverStatus> {
  for (;;) {
    const next = await states.next();
    if (next.done) throw new Error();
    if (next.value.phase === name) return next.value;
  }
}
async function written(peer: Peer): Promise<OneBotActionFrame> {
  const next = await peer.writes.next();
  if (next.done) throw new Error();
  return next.value;
}
const text = { user_id: 30001, message: [{ type: 'text', data: { text: 'mandatory text' } }] };

test(
  'OneBot captured A is refused after awaited authorization observes replacement B',
  { timeout: 3000 },
  async (t) => {
    const io = new Io();
    const first = new Peer('capture-a');
    const second = new Peer('capture-b');
    io.add(first);
    io.add(second);
    const sink = observer();
    const driver = new OneBotQqDriver('10001', io, sink.observer);
    t.after(() => driver.close());
    const running = driver.start(new AbortController().signal);
    const captured = (await phase(sink.states, 'ready')).connectionId;
    assert.ok(captured);
    const authorization = deferred<void>();
    const delayed = (async () => {
      await authorization.promise;
      return driver.call('send_private_msg', text, new AbortController().signal, captured);
    })();
    first.lifetime.abort(new KernelFault('network'));
    assert.equal((await phase(sink.states, 'ready')).connectionId, second.id);
    authorization.resolve();
    const result = await delayed;
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'stale-owner');
    assert.equal(first.sent.length, 0);
    assert.equal(second.sent.length, 0);
    const fresh = driver.call('send_private_msg', text, new AbortController().signal, second.id);
    const sent = await written(second);
    second.reply(sent, { message_id: 7 });
    assert.ok((await fresh).ok);
    await driver.close();
    await running;
  },
);

test(
  'OneBot physical retirement fences a pre-write await even while event admission is parked',
  { timeout: 3000 },
  async (t) => {
    const io = new Io();
    const first = new Peer('auth-a');
    const second = new Peer('auth-b');
    io.add(first);
    io.add(second);
    const physical = deferred<void>();
    first.closeGate = physical.promise;
    const authorization = deferred<void>();
    const writeEntered = deferred<void>();
    const admitted = deferred<void>();
    const admission = deferred<void>();
    const sink = observer();
    let nativeWrites = 0;
    const operationSignals: AbortSignal[] = [];
    first.send = async (_frame, signal) => {
      operationSignals.push(signal);
      writeEntered.resolve();
      await authorization.promise;
      if (signal.aborted)
        return { ok: false, error: makeError('cancelled', false), dispatched: false };
      nativeWrites++;
      return { ok: true, value: null };
    };
    const driver = new OneBotQqDriver('10001', io, {
      onStatus: sink.observer.onStatus,
      onEvent: async (_frame, _id, signal) => {
        admitted.resolve();
        await admission.promise;
        assert.equal(signal.aborted, true);
      },
    });
    t.after(async () => {
      authorization.resolve();
      admission.resolve();
      physical.resolve();
      await driver.close();
    });
    const running = driver.start(new AbortController().signal);
    await phase(sink.states, 'ready');
    const call = driver.call('send_private_msg', text, new AbortController().signal, first.id);
    await writeEntered.promise;
    first.frames.push(
      JSON.stringify({
        post_type: 'message',
        time: 1,
        self_id: 10001,
        user_id: 30001,
        message_type: 'private',
        sub_type: 'friend',
        message_id: -1,
        sender: { user_id: 30001 },
        message: [{ type: 'text', data: { text: 'input' } }],
      }),
    );
    await admitted.promise;
    first.lifetime.abort(new KernelFault('network'));
    assert.equal(operationSignals[0]?.aborted, true);
    authorization.resolve();
    const result = await call;
    assert.equal(result.ok, false);
    assert.equal(nativeWrites, 0);
    admission.resolve();
    physical.resolve();
    assert.equal((await phase(sink.states, 'ready')).connectionId, second.id);
    assert.equal(second.sent.length, 0);
    await driver.close();
    await running;
  },
);

test(
  'OneBot already-started A write retires as unknown after settlement and never moves to B',
  { timeout: 3000 },
  async (t) => {
    const io = new Io();
    const first = new Peer('written-a');
    const second = new Peer('written-b');
    const writeGate = deferred<void>();
    first.writeGate = writeGate.promise;
    first.closeGate = writeGate.promise;
    first.writeOutcome = { ok: false, error: makeError('cancelled', false), dispatched: true };
    io.add(first);
    io.add(second);
    const sink = observer();
    const driver = new OneBotQqDriver('10001', io, sink.observer);
    t.after(async () => {
      writeGate.resolve();
      await driver.close();
    });
    const running = driver.start(new AbortController().signal);
    await phase(sink.states, 'ready');
    const call = driver.call('send_private_msg', text, new AbortController().signal, first.id);
    const original = await written(first);
    let settled = false;
    void call.then(() => {
      settled = true;
    });
    first.lifetime.abort(new KernelFault('network'));
    assert.equal(first.signals[0]?.aborted, true);
    await Promise.resolve();
    assert.equal(settled, false);
    writeGate.resolve();
    const outcome = await call;
    assert.ok(outcome.ok);
    assert.equal(outcome.value.kind, 'unknown');
    assert.equal(outcome.value.connectionId, first.id);
    assert.equal((await phase(sink.states, 'ready')).connectionId, second.id);
    second.reply(original, { message_id: 999 });
    assert.equal(first.sent.length, 1);
    assert.equal(second.sent.length, 0);
    await driver.close();
    await running;
  },
);

test(
  'OneBot host predispatch refusal stays definite and produces no peer write',
  { timeout: 3000 },
  async (t) => {
    const io = new Io();
    const peer = new Peer('denied');
    peer.writeOutcome = { ok: false, error: makeError('auth-failed', false), dispatched: false };
    io.add(peer);
    const sink = observer();
    const driver = new OneBotQqDriver('10001', io, sink.observer);
    t.after(() => driver.close());
    const running = driver.start(new AbortController().signal);
    await phase(sink.states, 'ready');
    const denied = await driver.call(
      'send_private_msg',
      text,
      new AbortController().signal,
      driver.status.connectionId ?? 'not-connected',
    );
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.error.code, 'auth-failed');
    assert.equal(peer.sent.length, 0);
    assert.equal(driver.pendingCount, 0);
    peer.writeOutcome = { ok: false, error: makeError('network', false), dispatched: true };
    const unknown = await driver.call(
      'send_private_msg',
      text,
      new AbortController().signal,
      driver.status.connectionId ?? 'not-connected',
    );
    assert.ok(unknown.ok);
    assert.equal(unknown.value.kind, 'unknown');
    assert.equal(peer.sent.length, 1);
    await driver.close();
    await running;
  },
);

test(
  'OneBot joins a timed-out write and retains an acknowledgement received before its settlement',
  { timeout: 3000 },
  async (t) => {
    const io = new Io();
    const peer = new Peer('late-write');
    const gate = deferred<void>();
    peer.writeGate = gate.promise;
    io.add(peer);
    const sink = observer();
    const driver = new OneBotQqDriver('10001', io, sink.observer, { requestTimeoutMs: 10 });
    t.after(async () => {
      gate.resolve();
      await driver.close();
    });
    const running = driver.start(new AbortController().signal);
    await phase(sink.states, 'ready');
    const call = driver.call(
      'send_private_msg',
      text,
      new AbortController().signal,
      driver.status.connectionId ?? 'not-connected',
    );
    const frame = await written(peer);
    let settled = false;
    void call.then(() => {
      settled = true;
    });
    const writeSignal = peer.signals[0];
    assert.ok(writeSignal);
    await new Promise<void>((resolve) => {
      if (writeSignal.aborted) resolve();
      else writeSignal.addEventListener('abort', () => resolve(), { once: true });
    });
    assert.equal(settled, false);
    assert.equal(driver.pendingCount, 1);
    peer.reply(frame, { message_id: 'known-after-watchdog' });
    await Promise.resolve();
    gate.resolve();
    const result = await call;
    assert.ok(result.ok);
    assert.equal(result.value.kind, 'response');
    if (result.value.kind === 'response')
      assert.deepEqual(result.value.response.data, { message_id: 'known-after-watchdog' });
    await driver.close();
    await running;
  },
);

test(
  'OneBot dormant source, concurrent echo correlation and async acceptance stay distinct',
  { timeout: 3000 },
  async (t) => {
    const io = new Io();
    const peer = new Peer('peer-a');
    io.add(peer);
    const sink = observer();
    const driver = new OneBotQqDriver('10001', io, sink.observer);
    t.after(() => driver.close());
    assert.equal(io.accepts, 0);
    assert.equal(
      (await driver.call('get_status', {}, new AbortController().signal, 'not-connected')).ok,
      false,
    );
    const running = driver.start(new AbortController().signal);
    await phase(sink.states, 'ready');
    const first = driver.call(
      'send_private_msg',
      text,
      new AbortController().signal,
      driver.status.connectionId ?? 'not-connected',
    );
    const a = await written(peer);
    const second = driver.call(
      'send_private_msg',
      text,
      new AbortController().signal,
      driver.status.connectionId ?? 'not-connected',
    );
    const b = await written(peer);
    assert.notEqual(a.echo, b.echo);
    peer.reply({ ...a, echo: 'unmatched' }, { message_id: -99 });
    peer.reply(b, null, 'async', 1);
    peer.reply(a, { message_id: -7 });
    const one = await first;
    const two = await second;
    assert.ok(one.ok && two.ok);
    assert.equal(one.value.kind, 'response');
    assert.equal(two.value.kind, 'response');
    if (one.value.kind !== 'response' || two.value.kind !== 'response') throw new Error();
    assert.deepEqual(one.value.response.data, { message_id: -7 });
    assert.equal(two.value.response.status, 'async');
    peer.reply(a, { message_id: -88 });
    assert.equal(driver.pendingCount, 0);
    assert.equal(peer.sent.length, 2);
    await driver.close();
    await running;
    assert.equal(peer.closeCount, 1);
    assert.equal(io.closes, 1);
  },
);

test(
  'OneBot disconnected pending actions become unknown and are never replayed on a new peer',
  { timeout: 3000 },
  async (t) => {
    const io = new Io();
    const first = new Peer('old');
    const second = new Peer('new');
    io.add(first);
    io.add(second);
    const sink = observer();
    const driver = new OneBotQqDriver('10001', io, sink.observer);
    t.after(() => driver.close());
    const running = driver.start(new AbortController().signal);
    await phase(sink.states, 'ready');
    const call = driver.call(
      'send_private_msg',
      text,
      new AbortController().signal,
      driver.status.connectionId ?? 'not-connected',
    );
    const oldFrame = await written(first);
    first.frames.end();
    const outcome = await call;
    assert.ok(outcome.ok);
    assert.equal(outcome.value.kind, 'unknown');
    assert.equal(outcome.value.connectionId, 'old');
    assert.equal((await phase(sink.states, 'ready')).connectionId, 'new');
    assert.equal(second.sent.length, 0);
    const next = driver.call(
      'send_private_msg',
      text,
      new AbortController().signal,
      driver.status.connectionId ?? 'not-connected',
    );
    const newFrame = await written(second);
    second.reply(oldFrame, { message_id: 8 });
    second.reply(newFrame, { message_id: 9 });
    const result = await next;
    assert.ok(result.ok);
    assert.equal(result.value.echo, newFrame.echo);
    assert.notEqual(oldFrame.echo, newFrame.echo);
    await driver.close();
    await running;
  },
);

test(
  'OneBot per-call cancellation does not stop another call or pretend the write never happened',
  { timeout: 3000 },
  async (t) => {
    const io = new Io();
    const peer = new Peer('cancel');
    io.add(peer);
    const sink = observer();
    const driver = new OneBotQqDriver('10001', io, sink.observer);
    t.after(() => driver.close());
    const running = driver.start(new AbortController().signal);
    await phase(sink.states, 'ready');
    const caller = new AbortController();
    const first = driver.call('send_private_msg', text, caller.signal, peer.id);
    const a = await written(peer);
    const second = driver.call(
      'send_private_msg',
      text,
      new AbortController().signal,
      driver.status.connectionId ?? 'not-connected',
    );
    const b = await written(peer);
    caller.abort();
    peer.reply(b, { message_id: 12 });
    const uncertain = await first;
    const accepted = await second;
    assert.ok(uncertain.ok && accepted.ok);
    assert.equal(uncertain.value.kind, 'unknown');
    assert.equal(accepted.value.kind, 'response');
    peer.reply(a, { message_id: 11 });
    assert.equal(driver.status.phase, 'ready');
    assert.equal(driver.pendingCount, 0);
    const before = new AbortController();
    const notSent = driver.call('send_private_msg', text, before.signal, peer.id);
    before.abort();
    const stopped = await notSent;
    assert.equal(stopped.ok, false);
    assert.equal(peer.sent.length, 2);
    await driver.close();
    await running;
  },
);

test(
  'OneBot timeouts are unknown, bounded pending rejects before another write',
  { timeout: 3000 },
  async (t) => {
    const io = new Io();
    const peer = new Peer('timeout');
    io.add(peer);
    const sink = observer();
    const driver = new OneBotQqDriver('10001', io, sink.observer, {
      requestTimeoutMs: 10,
      maxPending: 1,
    });
    t.after(() => driver.close());
    const running = driver.start(new AbortController().signal);
    await phase(sink.states, 'ready');
    const call = driver.call(
      'send_private_msg',
      text,
      new AbortController().signal,
      driver.status.connectionId ?? 'not-connected',
    );
    await written(peer);
    const overflow = await driver.call(
      'send_private_msg',
      text,
      new AbortController().signal,
      driver.status.connectionId ?? 'not-connected',
    );
    assert.equal(overflow.ok, false);
    if (!overflow.ok) assert.equal(overflow.error.code, 'quota-exceeded');
    const result = await call;
    assert.ok(result.ok);
    assert.equal(result.value.kind, 'unknown');
    if (result.value.kind === 'unknown') assert.equal(result.value.error.code, 'timeout');
    assert.equal(peer.sent.length, 1);
    assert.equal(driver.pendingCount, 0);
    await driver.close();
    await running;
  },
);

test(
  'SnowLuma file action sends once, and a mixed text/file native batch is refused before IO',
  { timeout: 3000 },
  async (t) => {
    const io = new Io();
    const peer = new Peer('files');
    io.add(peer);
    const sink = observer();
    const driver = new OneBotQqDriver('10001', io, sink.observer);
    t.after(() => driver.close());
    const running = driver.start(new AbortController().signal);
    await phase(sink.states, 'ready');
    const mixed = await driver.call(
      'send_private_msg',
      { user_id: 30001, message: [...text.message, { type: 'file', data: { file_id: 'f' } }] },
      new AbortController().signal,
      peer.id,
    );
    assert.equal(mixed.ok, false);
    assert.equal(peer.sent.length, 0);
    const upload = driver.call(
      'upload_private_file',
      { user_id: 30001, file: '/remote/fixture.txt' },
      new AbortController().signal,
      peer.id,
    );
    const frame = await written(peer);
    assert.equal(frame.params['upload_file'], true);
    peer.reply(frame, { file_id: 'real-file-id' });
    const outcome = await upload;
    assert.ok(outcome.ok);
    assert.equal(outcome.value.kind, 'response');
    if (outcome.value.kind !== 'response') throw new Error();
    assert.deepEqual(outcome.value.response.data, { file_id: 'real-file-id' });
    assert.equal(peer.sent.length, 1);
    await driver.close();
    await running;
  },
);

test(
  'OneBot rejects a host peer or frame with a different account instead of granting it a session',
  { timeout: 3000 },
  async (t) => {
    const io = new Io();
    const peer = new Peer('wrong', '10002');
    io.add(peer);
    const sink = observer();
    const driver = new OneBotQqDriver('10001', io, sink.observer);
    t.after(() => driver.close());
    await assert.rejects(driver.start(new AbortController().signal), /errors.auth-failed/u);
    assert.equal(sink.events.length, 0);
    assert.equal(peer.sent.length, 0);
    assert.equal(peer.closeCount, 1);
  },
);

test(
  'OneBot close waits for a pending transport write and physical peer settlement',
  { timeout: 3000 },
  async (t) => {
    const io = new Io();
    const peer = new Peer('drain');
    const write = deferred<void>();
    const physical = deferred<void>();
    peer.writeGate = write.promise;
    peer.closeGate = physical.promise;
    io.add(peer);
    const sink = observer();
    const driver = new OneBotQqDriver('10001', io, sink.observer);
    t.after(async () => {
      write.resolve();
      physical.resolve();
      await driver.close();
    });
    const running = driver.start(new AbortController().signal);
    await phase(sink.states, 'ready');
    const call = driver.call(
      'send_private_msg',
      text,
      new AbortController().signal,
      driver.status.connectionId ?? 'not-connected',
    );
    await written(peer);
    let callDone = false;
    void call.then(() => {
      callDone = true;
    });
    let closed = false;
    const closing = driver.close().then(() => {
      closed = true;
    });
    await peer.closingStarted.promise;
    await Promise.resolve();
    assert.equal(closed, false);
    assert.equal(callDone, false);
    write.resolve();
    const result = await call;
    assert.ok(result.ok);
    assert.equal(result.value.kind, 'unknown');
    assert.equal(closed, false);
    physical.resolve();
    await closing;
    await running;
    assert.equal(driver.status.phase, 'stopped');
  },
);

test(
  'OneBot failed close stops accepting replacements and rejects disposer settlement',
  { timeout: 3000 },
  async (t) => {
    const io = new Io();
    const peer = new Peer('bad-close');
    peer.closeError = new Error('synthetic peer close failed');
    io.add(peer);
    const sink = observer();
    const driver = new OneBotQqDriver('10001', io, sink.observer);
    t.after(() => driver.close().catch(() => {}));
    const running = driver.start(new AbortController().signal);
    await phase(sink.states, 'ready');
    peer.frames.end();
    await assert.rejects(running, /synthetic peer close failed/u);
    await assert.rejects(driver.close(), /synthetic peer close failed/u);
    assert.equal(io.accepts, 1);
    assert.equal(driver.status.phase, 'failed');
  },
);
