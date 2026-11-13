import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import test from 'node:test';
import { ModelPermit } from '../src/model-permit.ts';

const deferred = () => Promise.withResolvers();

test('FIFO dispatch waits actual settlement even after the active caller aborts', async () => {
  const permit = new ModelPermit();
  const first = new AbortController();
  const actual = deferred();
  const entered = deferred();
  const order = [];
  const a = permit.run(first.signal, async () => {
    order.push('A');
    entered.resolve();
    await actual.promise;
    return 'A physically settled';
  });
  await entered.promise;
  const b = permit.run(new AbortController().signal, async () => order.push('B'));
  const c = permit.run(new AbortController().signal, async () => order.push('C'));
  first.abort();
  await Promise.resolve();
  assert.deepEqual(order, ['A']);
  assert.deepEqual(permit.diagnostics(), { active: true, waiting: 2 });
  actual.resolve();
  assert.equal(await a, 'A physically settled');
  await Promise.all([b, c]);
  assert.deepEqual(order, ['A', 'B', 'C']);
  assert.deepEqual(permit.diagnostics(), { active: false, waiting: 0 });
});

test('a cancelled parked input is removed without entering its borrow callback', async () => {
  const permit = new ModelPermit();
  const actual = deferred();
  const entered = deferred();
  const a = permit.run(new AbortController().signal, async () => {
    entered.resolve();
    await actual.promise;
  });
  await entered.promise;
  const parked = new AbortController();
  const reason = new Error('input retired');
  let borrowed = 0;
  const b = permit.run(parked.signal, async () => borrowed++);
  const rejected = assert.rejects(b, (error) => error === reason);
  const c = permit.run(new AbortController().signal, async () => 'next');
  assert.equal(getEventListeners(parked.signal, 'abort').length, 1);
  parked.abort(reason);
  await rejected;
  assert.equal(borrowed, 0);
  assert.equal(getEventListeners(parked.signal, 'abort').length, 0);
  assert.deepEqual(permit.diagnostics(), { active: true, waiting: 1 });
  actual.resolve();
  await a;
  assert.equal(await c, 'next');
  assert.deepEqual(permit.diagnostics(), { active: false, waiting: 0 });
});

test('already-aborted and granted-then-aborted calls never enter native work', async () => {
  const permit = new ModelPermit();
  const reason = new Error('cancel before dispatch');
  let borrowed = 0;
  await assert.rejects(
    permit.run(AbortSignal.abort(reason), async () => borrowed++),
    (error) => error === reason,
  );
  const caller = new AbortController();
  const running = permit.run(caller.signal, async () => borrowed++);
  caller.abort(reason);
  await assert.rejects(running, (error) => error === reason);
  assert.equal(borrowed, 0);
  assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
  assert.equal(await permit.run(new AbortController().signal, async () => 'healthy'), 'healthy');
  assert.deepEqual(permit.diagnostics(), { active: false, waiting: 0 });
});

test('native errors retain identity and release the permit for the next input', async () => {
  const permit = new ModelPermit();
  const reason = new Error('native error with private metadata');
  const a = permit.run(new AbortController().signal, async () => {
    throw reason;
  });
  const b = permit.run(new AbortController().signal, async () => 'B');
  await assert.rejects(a, (error) => error === reason);
  assert.equal(await b, 'B');
  assert.deepEqual(permit.diagnostics(), { active: false, waiting: 0 });
});
