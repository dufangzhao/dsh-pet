// M0 host-only experiment; product plugins must use the project SDK, not Context.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { Context } from '@deepseek-ai/cordis';

declare module '@deepseek-ai/cordis' {
  interface Events {
    'm0/pulse'(): void;
  }
}

export async function verifyDependencies() {
  const root = new Context();
  const external = new EventEmitter();
  const baseline = root.registry.size;
  const counts = { starts: 0, stops: 0, timers: 0, ticks: 0, pulses: 0, external: 0 };
  try {
    const consumer = root.plugin({
      inject: ['m0.counter'],
      apply(ctx: Context) {
        const dependency: unknown = ctx.get('m0.counter');
        assert.deepEqual(dependency, { value: 42 });
        counts.starts += 1;
        ctx.on('m0/pulse', () => {
          counts.pulses += 1;
        });
        ctx.effect(() => {
          counts.timers += 1;
          const timer = setInterval(() => {
            counts.ticks += 1;
          }, 5);
          return () => {
            clearInterval(timer);
            counts.timers -= 1;
          };
        }, 'm0.interval');
        ctx.effect(() => {
          const listener = () => {
            counts.external += 1;
          };
          external.on('pulse', listener);
          return () => {
            external.off('pulse', listener);
          };
        }, 'm0.external-listener');
        return () => {
          counts.stops += 1;
        };
      },
    });
    await consumer.await();
    assert.equal(counts.starts, 0, 'missing dependency must not start consumer');
    root.emit('m0/pulse');
    assert.equal(counts.pulses, 0);
    for (let cycle = 1; cycle <= 3; cycle += 1) {
      const provider = root.plugin((ctx: Context) => {
        ctx.provide('m0.counter', { value: 42 });
      });
      await provider.await();
      await consumer.await();
      assert.equal(counts.starts, cycle);
      assert.equal(counts.timers, 1);
      assert.equal(external.listenerCount('pulse'), 1);
      root.emit('m0/pulse');
      external.emit('pulse');
      assert.equal(counts.pulses, cycle);
      assert.equal(counts.external, cycle);
      const before = counts.ticks;
      const deadline = performance.now() + 1500;
      while (counts.ticks === before && performance.now() < deadline) await delay(10);
      assert.ok(counts.ticks > before, 'owned interval should run while active');
      await provider.dispose();
      await consumer.await();
      assert.equal(root.get('m0.counter'), undefined);
      assert.equal(counts.timers, 0);
      assert.equal(external.listenerCount('pulse'), 0);
      assert.equal(counts.stops, cycle);
      const ticks = counts.ticks;
      root.emit('m0/pulse');
      external.emit('pulse');
      await delay(30);
      assert.equal(counts.ticks, ticks, 'disposed interval must stop');
      assert.equal(counts.pulses, cycle, 'Cordis listener must be removed');
      assert.equal(counts.external, cycle, 'external listener disposer must run');
    }
    await consumer.dispose();
    assert.equal(root.registry.size, baseline, 'no plugin runtime left after disposal');
    return { cycles: 3, ...counts, residualExternalListeners: external.listenerCount('pulse') };
  } finally {
    await root.fiber.dispose();
  }
}

export async function verifyRollback(mode: 'sync' | 'async') {
  const root = new Context();
  let resources = 0;
  let pulses = 0;
  let hiddenWhileLoading = false;
  const prepare = (ctx: Context) => {
    ctx.provide('m0.partial', { value: 'half-registered' });
    hiddenWhileLoading = root.get('m0.partial') === undefined;
    ctx.on('m0/pulse', () => {
      pulses += 1;
    });
    ctx.effect(() => {
      resources += 1;
      return () => {
        resources -= 1;
      };
    });
  };
  try {
    const plugin =
      mode === 'sync'
        ? (ctx: Context) => {
            prepare(ctx);
            throw new Error('intentional-m0-startup-failure');
          }
        : async (ctx: Context) => {
            prepare(ctx);
            await Promise.resolve();
            throw new Error('intentional-m0-startup-failure');
          };
    const fiber = root.plugin(plugin);
    await assert.rejects(fiber.await(), /intentional-m0-startup-failure/);
    assert.equal(hiddenWhileLoading, true, 'partial service must not be available during loading');
    assert.equal(resources, 0, 'startup failure must roll back owned effects');
    assert.equal(root.get('m0.partial'), undefined);
    assert.equal(root.get('m0.partial', false), undefined, 'no hidden implementation may remain');
    root.emit('m0/pulse');
    assert.equal(pulses, 0, 'failed activation must not leave event handlers');
    await fiber.dispose();
    return { mode, hiddenWhileLoading, residualResources: resources, latePulses: pulses };
  } finally {
    await root.fiber.dispose();
  }
}

export async function verifyAsyncDisposal() {
  const root = new Context();
  const order: string[] = [];
  let pluginContext: Context | undefined;
  try {
    const fiber = root.plugin((ctx: Context) => {
      pluginContext = ctx;
      ctx.effect(() => async () => {
        await delay(5);
        order.push('first');
      });
      ctx.effect(() => async () => {
        await delay(5);
        order.push('second');
      });
    });
    await fiber.await();
    await fiber.dispose();
    assert.deepEqual(order, ['second', 'first'], 'dispose awaits reverse-order cleanup');
    await fiber.dispose();
    assert.deepEqual(order, ['second', 'first'], 'dispose is idempotent');
    const disposedContext = pluginContext;
    assert.ok(disposedContext);
    assert.throws(() => disposedContext.effect(() => () => {}), /inactive|INACTIVE_EFFECT/i);
    return { order, idempotent: true, inactiveEffectRejected: true };
  } finally {
    await root.fiber.dispose();
  }
}

export async function runCordisProbe() {
  return {
    dependencies: await verifyDependencies(),
    rollback: [await verifyRollback('sync'), await verifyRollback('async')],
    disposal: await verifyAsyncDisposal(),
  };
}
