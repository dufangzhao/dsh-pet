import assert from 'node:assert/strict';
import test from 'node:test';
import { KernelFault } from '@pet/host-kernel';
import { makeError } from '@pet/contracts';
import type { QQIoOutcome } from '@pet/companion-runtime';
import { OfficialQqDriver } from './driver.js';
import { unusedOfficialMedia } from './media-test-helpers.js';
import type {
  OfficialDriverObserver,
  OfficialDriverStatus,
  OfficialGateway,
  OfficialHttpResponse,
  OfficialIo,
} from './ports.js';
import type { OfficialMessageRequest } from './wire.js';

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
    const reader = this.readers.shift();
    if (reader) reader({ done: false, value });
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
class Gateway implements OfficialGateway {
  readonly lifetime = new AbortController();
  readonly signal = this.lifetime.signal;
  readonly frames = new Queue<string>();
  readonly physical = deferred<void>();
  readonly settled = this.physical.promise;
  readonly identified = deferred<void>();
  readonly resumed = deferred<{ sessionId: string; sequence: number }>();
  readonly beats = new Queue<number | null>();
  readonly closingStarted = deferred<void>();
  identifyCount = 0;
  resumeCount = 0;
  closeCount = 0;
  closeGate: Promise<void> = Promise.resolve();
  closeError: Error | null = null;
  private closing: Promise<void> | null = null;
  constructor(readonly id: string) {}
  push(value: unknown): void {
    this.frames.push(JSON.stringify(value));
  }
  async identify(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    this.identifyCount++;
    this.identified.resolve();
  }
  async resume(input: { sessionId: string; sequence: number }, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    this.resumeCount++;
    this.resumed.resolve(input);
  }
  async heartbeat(sequence: number | null, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    this.beats.push(sequence);
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
class Io implements OfficialIo {
  readonly media = unusedOfficialMedia();
  readonly incoming = new Queue<Gateway>();
  readonly gateways: Gateway[] = [];
  readonly sends: OfficialMessageRequest[] = [];
  readonly uploads: OfficialMessageRequest[] = [];
  readonly sent = deferred<void>();
  opens = 0;
  closes = 0;
  sendResult: (signal: AbortSignal) => Promise<QQIoOutcome<OfficialHttpResponse>> = async () => ({
    ok: true,
    value: { status: 200, body: '{"id":"sent-fixture"}' },
  });
  uploadResult: (signal: AbortSignal) => Promise<QQIoOutcome<OfficialHttpResponse>> = async () => ({
    ok: true,
    value: {
      status: 200,
      body: '{"file_uuid":"file-fixture","file_info":"private-file-info","ttl":300}',
    },
  });
  private closing: Promise<void> | null = null;
  add(gateway: Gateway): void {
    this.gateways.push(gateway);
    this.incoming.push(gateway);
  }
  async openGateway(signal: AbortSignal): Promise<OfficialGateway> {
    this.opens++;
    signal.throwIfAborted();
    const next = await this.incoming.next();
    if (next.done) throw new KernelFault('cancelled');
    return next.value;
  }
  async send(
    request: OfficialMessageRequest,
    signal: AbortSignal,
  ): Promise<QQIoOutcome<OfficialHttpResponse>> {
    this.sends.push(request);
    this.sent.resolve();
    return this.sendResult(signal);
  }
  async upload(
    request: OfficialMessageRequest,
    signal: AbortSignal,
  ): Promise<QQIoOutcome<OfficialHttpResponse>> {
    signal.throwIfAborted();
    this.uploads.push(request);
    return this.uploadResult(signal);
  }
  close(): Promise<void> {
    this.closing ??= (async () => {
      this.closes++;
      this.incoming.end();
      await Promise.all(this.gateways.map((gateway) => gateway.close()));
    })();
    return this.closing;
  }
}
function observer(): {
  observer: OfficialDriverObserver;
  states: Queue<OfficialDriverStatus>;
  events: string[];
  delivered: ReturnType<typeof deferred<void>>;
} {
  const states = new Queue<OfficialDriverStatus>();
  const events: string[] = [];
  const delivered = deferred<void>();
  return {
    states,
    events,
    delivered,
    observer: {
      onStatus: (status) => states.push(status),
      onEvent: async (event, connectionId) => {
        events.push(`${connectionId}:${event.d.id}`);
        delivered.resolve();
      },
    },
  };
}
async function phase(
  states: Queue<OfficialDriverStatus>,
  name: OfficialDriverStatus['phase'],
): Promise<OfficialDriverStatus> {
  for (;;) {
    const next = await states.next();
    if (next.done) throw new Error('status stream ended');
    if (next.value.phase === name) return next.value;
  }
}
function ready(gateway: Gateway, session = 'gateway-session', sequence = 1): void {
  gateway.push({
    op: 0,
    t: 'READY',
    s: sequence,
    d: { session_id: session, user: { id: 'native-bot-id' } },
  });
}
function message(gateway: Gateway, sequence = 3): void {
  gateway.push({
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    s: sequence,
    id: `event-${sequence}`,
    d: {
      id: `message-${sequence}`,
      timestamp: '2026-11-13T00:00:00Z',
      author: { user_openid: 'sender-fixture', bot: false },
      content: 'text',
    },
  });
}
const text = { msg_type: 0, content: 'required text', msg_seq: 1, msg_id: 'original-message' };

test(
  'official captured A cannot become a send or upload through B after an awaited source check',
  { timeout: 3000 },
  async (t) => {
    const io = new Io();
    const first = new Gateway('captured-a');
    const second = new Gateway('replacement-b');
    io.add(first);
    io.add(second);
    const sink = observer();
    const driver = new OfficialQqDriver(io, sink.observer, {
      reconnectAttempts: 1,
      reconnectDelayMs: 0,
    });
    t.after(() => driver.close());
    const running = driver.start(new AbortController().signal);
    first.push({ op: 10, d: { heartbeat_interval: 60_000 } });
    await first.identified.promise;
    ready(first);
    const captured = (await phase(sink.states, 'ready')).connectionId;
    assert.ok(captured);
    const checked = deferred<void>();
    const sending = (async () => {
      await checked.promise;
      return driver.send('c2c', 'u', text, new AbortController().signal, captured);
    })();
    const uploading = (async () => {
      await checked.promise;
      return driver.upload(
        'c2c',
        'u',
        { file_type: 4, file_name: 'f.txt', upload_id: 'prepared', srv_send_msg: false },
        new AbortController().signal,
        captured,
      );
    })();
    first.push({ op: 7 });
    second.push({ op: 10, d: { heartbeat_interval: 60_000 } });
    await second.resumed.promise;
    second.push({ op: 0, t: 'RESUMED', s: 2, d: '' });
    assert.equal((await phase(sink.states, 'ready')).connectionId, second.id);
    checked.resolve();
    for (const result of await Promise.all([sending, uploading])) {
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error.code, 'stale-owner');
    }
    assert.equal(io.sends.length, 0);
    assert.equal(io.uploads.length, 0);
    const fresh = await driver.send('c2c', 'u', text, new AbortController().signal, second.id);
    assert.ok(fresh.ok);
    assert.equal(fresh.value.connectionId, second.id);
    await driver.close();
    await running;
  },
);

test(
  'official physical A loss aborts token-waiting REST work while frame admission and close remain blocked',
  { timeout: 3000 },
  async (t) => {
    const io = new Io();
    const first = new Gateway('token-a');
    const second = new Gateway('token-b');
    const physical = deferred<void>();
    first.closeGate = physical.promise;
    io.add(first);
    io.add(second);
    const admission = deferred<void>();
    const entered = deferred<void>();
    const tokenGate = deferred<void>();
    const prepared = deferred<void>();
    const sink = observer();
    const signals: AbortSignal[] = [];
    let nativePosts = 0;
    const waiting = async (signal: AbortSignal): Promise<QQIoOutcome<OfficialHttpResponse>> => {
      signals.push(signal);
      if (signals.length === 2) prepared.resolve();
      await tokenGate.promise;
      if (signal.aborted)
        return { ok: false, error: makeError('cancelled', false), dispatched: false };
      nativePosts++;
      return { ok: true, value: { status: 200, body: '{"id":"unexpected-send"}' } };
    };
    io.sendResult = waiting;
    io.uploadResult = waiting;
    const driver = new OfficialQqDriver(
      io,
      {
        onStatus: sink.observer.onStatus,
        onEvent: async (_event, _id, signal) => {
          entered.resolve();
          await admission.promise;
          assert.equal(signal.aborted, true);
        },
      },
      { reconnectAttempts: 1, reconnectDelayMs: 0 },
    );
    t.after(async () => {
      tokenGate.resolve();
      admission.resolve();
      physical.resolve();
      await driver.close();
    });
    const running = driver.start(new AbortController().signal);
    first.push({ op: 10, d: { heartbeat_interval: 60_000 } });
    await first.identified.promise;
    ready(first);
    await phase(sink.states, 'ready');
    const send = driver.send('c2c', 'u', text, new AbortController().signal, first.id);
    const upload = driver.upload(
      'c2c',
      'u',
      { file_type: 4, file_name: 'f.txt', upload_id: 'prepared', srv_send_msg: false },
      new AbortController().signal,
      first.id,
    );
    await prepared.promise;
    message(first);
    await entered.promise;
    first.lifetime.abort(new KernelFault('network'));
    assert.equal(signals.length, 2);
    assert.ok(signals.every((signal) => signal.aborted));
    const fenced = await driver.send('c2c', 'u', text, new AbortController().signal, first.id);
    assert.equal(fenced.ok, false);
    tokenGate.resolve();
    for (const result of await Promise.all([send, upload])) assert.equal(result.ok, false);
    assert.equal(nativePosts, 0);
    admission.resolve();
    physical.resolve();
    second.push({ op: 10, d: { heartbeat_interval: 60_000 } });
    await second.resumed.promise;
    second.push({ op: 0, t: 'RESUMED', s: 2, d: '' });
    await phase(sink.states, 'ready');
    assert.equal(nativePosts, 0);
    await driver.close();
    await running;
  },
);

test(
  'official native undispatched denial is definite while a dispatched failure stays unknown',
  { timeout: 3000 },
  async (t) => {
    const io = new Io();
    const gateway = new Gateway('dispatch-proof');
    io.add(gateway);
    const sink = observer();
    const driver = new OfficialQqDriver(io, sink.observer);
    t.after(() => driver.close());
    const running = driver.start(new AbortController().signal);
    gateway.push({ op: 10, d: { heartbeat_interval: 60_000 } });
    await gateway.identified.promise;
    ready(gateway);
    await phase(sink.states, 'ready');
    io.sendResult = async () => ({
      ok: false,
      error: makeError('permission-denied', false),
      dispatched: false,
    });
    const denied = await driver.send('c2c', 'u', text, new AbortController().signal, gateway.id);
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.error.code, 'permission-denied');
    io.sendResult = async () => ({
      ok: false,
      error: makeError('network', false),
      dispatched: true,
    });
    const uncertain = await driver.send('c2c', 'u', text, new AbortController().signal, gateway.id);
    assert.ok(uncertain.ok);
    assert.equal(uncertain.value.receipt.kind, 'unknown');
    assert.equal(io.sends.length, 2);
    await driver.close();
    await running;
  },
);

test(
  'official construction is dormant, READY gates HTTP, and uploads are not sends',
  { timeout: 3000 },
  async (t) => {
    const io = new Io();
    const gateway = new Gateway('epoch-1');
    io.add(gateway);
    const sink = observer();
    const driver = new OfficialQqDriver(io, sink.observer, { reconnectAttempts: 0 });
    t.after(() => driver.close());
    assert.equal(io.opens, 0);
    assert.equal(
      (await driver.send('c2c', 'u', text, new AbortController().signal, gateway.id)).ok,
      false,
    );
    const running = driver.start(new AbortController().signal);
    gateway.push({ op: 10, d: { heartbeat_interval: 60_000 } });
    await gateway.identified.promise;
    assert.equal(driver.status.phase, 'authenticating');
    assert.equal(
      (await driver.send('c2c', 'u', text, new AbortController().signal, gateway.id)).ok,
      false,
    );
    ready(gateway);
    await phase(sink.states, 'ready');
    const sent = await driver.send('c2c', 'u', text, new AbortController().signal, gateway.id);
    assert.ok(sent.ok);
    assert.equal(sent.value.receipt.kind, 'message-accepted');
    assert.equal(sent.value.connectionId, 'epoch-1');
    const uploaded = await driver.upload(
      'c2c',
      'u',
      { file_type: 4, file_name: 'file.txt', upload_id: 'upload-fixture', srv_send_msg: false },
      new AbortController().signal,
      gateway.id,
    );
    assert.ok(uploaded.ok);
    assert.equal(uploaded.value.receipt.kind, 'media-upload-accepted');
    io.sendResult = async () => {
      throw new Error('private native error must not escape');
    };
    const uncertain = await driver.send('c2c', 'u', text, new AbortController().signal, gateway.id);
    assert.ok(uncertain.ok);
    assert.equal(uncertain.value.receipt.kind, 'unknown');
    assert.equal(JSON.stringify(uncertain).includes('private native error'), false);
    assert.equal(io.sends.length, 2);
    assert.equal(io.uploads.length, 1);
    await driver.close();
    await running;
    assert.equal(gateway.closeCount, 1);
    assert.equal(io.closes, 1);
  },
);

test(
  'official Resume uses only the prior epoch session and admitted sequence',
  { timeout: 3000 },
  async (t) => {
    const io = new Io();
    const first = new Gateway('epoch-a');
    const second = new Gateway('epoch-b');
    io.add(first);
    io.add(second);
    const sink = observer();
    const driver = new OfficialQqDriver(io, sink.observer, {
      reconnectAttempts: 1,
      reconnectDelayMs: 0,
    });
    t.after(() => driver.close());
    const running = driver.start(new AbortController().signal);
    first.push({ op: 10, d: { heartbeat_interval: 60_000 } });
    await first.identified.promise;
    ready(first, 'native-session');
    await phase(sink.states, 'ready');
    message(first, 9);
    await sink.delivered.promise;
    first.push({ op: 7 });
    second.push({ op: 10, d: { heartbeat_interval: 60_000 } });
    assert.deepEqual(await second.resumed.promise, { sessionId: 'native-session', sequence: 9 });
    second.push({ op: 0, t: 'RESUMED', s: 10, d: '' });
    assert.equal((await phase(sink.states, 'ready')).connectionId, 'epoch-b');
    assert.deepEqual(sink.events, ['epoch-a:message-9']);
    assert.equal(second.identifyCount, 0);
    assert.equal(first.closeCount, 1);
    await driver.close();
    await running;
  },
);

test(
  'official InvalidSession resets Resume and recovery has a finite reopen budget',
  { timeout: 3000 },
  async (t) => {
    const io = new Io();
    const first = new Gateway('a');
    const second = new Gateway('b');
    io.add(first);
    io.add(second);
    const sink = observer();
    const driver = new OfficialQqDriver(io, sink.observer, {
      reconnectAttempts: 1,
      reconnectDelayMs: 0,
    });
    t.after(() => driver.close());
    const running = driver.start(new AbortController().signal);
    first.push({ op: 10, d: { heartbeat_interval: 60_000 } });
    await first.identified.promise;
    ready(first);
    await phase(sink.states, 'ready');
    first.push({ op: 9, d: false });
    second.push({ op: 10, d: { heartbeat_interval: 60_000 } });
    await second.identified.promise;
    assert.equal(second.resumeCount, 0);
    ready(second);
    await phase(sink.states, 'ready');
    second.frames.end();
    await assert.rejects(running, /errors.network/u);
    assert.equal(io.opens, 2);
    assert.equal(driver.status.phase, 'failed');
  },
);

test(
  'official heartbeat carries current sequence and a missing ACK retires the connection',
  { timeout: 3000 },
  async (t) => {
    const io = new Io();
    const gateway = new Gateway('heartbeat');
    io.add(gateway);
    const sink = observer();
    const driver = new OfficialQqDriver(io, sink.observer, { reconnectAttempts: 0 });
    t.after(() => driver.close());
    const running = driver.start(new AbortController().signal);
    gateway.push({ op: 10, d: { heartbeat_interval: 10 } });
    await gateway.identified.promise;
    ready(gateway);
    await phase(sink.states, 'ready');
    const beat = await gateway.beats.next();
    assert.equal(beat.value, 1);
    await assert.rejects(running, /errors.timeout/u);
    assert.equal(gateway.closeCount, 1);
  },
);

test(
  'official messages before READY fail closed without entering host admission',
  { timeout: 3000 },
  async (t) => {
    const io = new Io();
    const gateway = new Gateway('unauthenticated');
    io.add(gateway);
    const sink = observer();
    const driver = new OfficialQqDriver(io, sink.observer);
    t.after(() => driver.close());
    const running = driver.start(new AbortController().signal);
    message(gateway);
    await assert.rejects(running, /errors.invalid-input/u);
    assert.deepEqual(sink.events, []);
    assert.equal(io.opens, 1);
  },
);

test(
  'official close waits for callback, HTTP body and physical transport settlement',
  { timeout: 3000 },
  async (t) => {
    const io = new Io();
    const gateway = new Gateway('drain');
    const physical = deferred<void>();
    gateway.closeGate = physical.promise;
    io.add(gateway);
    const admission = deferred<void>();
    const entered = deferred<void>();
    const http = deferred<OfficialHttpResponse>();
    const sink = observer();
    const driver = new OfficialQqDriver(io, {
      onStatus: sink.observer.onStatus,
      onEvent: async (_event, _epoch, signal) => {
        entered.resolve();
        await admission.promise;
        assert.equal(signal.aborted, true);
      },
    });
    t.after(async () => {
      admission.resolve();
      http.resolve({ status: 200, body: '{"id":"late-real-receipt"}' });
      physical.resolve();
      await driver.close();
    });
    const running = driver.start(new AbortController().signal);
    gateway.push({ op: 10, d: { heartbeat_interval: 60_000 } });
    await gateway.identified.promise;
    ready(gateway);
    await phase(sink.states, 'ready');
    io.sendResult = async () => ({ ok: true, value: await http.promise });
    const send = driver.send('c2c', 'u', text, new AbortController().signal, gateway.id);
    await io.sent.promise;
    message(gateway);
    await entered.promise;
    let closed = false;
    const closing = driver.close().then(() => {
      closed = true;
    });
    await gateway.closingStarted.promise;
    await Promise.resolve();
    assert.equal(closed, false);
    assert.equal(
      (await driver.send('c2c', 'u', text, new AbortController().signal, gateway.id)).ok,
      false,
    );
    admission.resolve();
    http.resolve({ status: 200, body: '{"id":"late-real-receipt"}' });
    const result = await send;
    assert.ok(result.ok);
    assert.equal(result.value.receipt.kind, 'message-accepted');
    assert.equal(result.value.connectionId, 'drain');
    await Promise.resolve();
    assert.equal(closed, false);
    physical.resolve();
    await closing;
    await running;
    assert.equal(driver.status.phase, 'stopped');
  },
);

test(
  'official failed native closure blocks recovery and remains observable on close',
  { timeout: 3000 },
  async (t) => {
    const io = new Io();
    const gateway = new Gateway('bad-close');
    gateway.closeError = new Error('synthetic close failed');
    io.add(gateway);
    const sink = observer();
    const driver = new OfficialQqDriver(io, sink.observer, { reconnectDelayMs: 0 });
    t.after(() => driver.close().catch(() => {}));
    const running = driver.start(new AbortController().signal);
    gateway.push({ op: 10, d: { heartbeat_interval: 60_000 } });
    await gateway.identified.promise;
    ready(gateway);
    await phase(sink.states, 'ready');
    gateway.push({ op: 7 });
    await assert.rejects(running, /synthetic close failed/u);
    await assert.rejects(driver.close(), /synthetic close failed/u);
    assert.equal(io.opens, 1);
    assert.equal(driver.status.phase, 'failed');
  },
);
