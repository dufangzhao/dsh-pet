import { expect, it } from 'vitest';
import { TaskSupervisor, type TaskHandle } from './task-supervisor.js';
import type { Result } from '@pet/contracts';
const take = <T>(value: Result<T>): T => {
  if (!value.ok) throw new Error(value.error.code);
  return value.value;
};
const owner = { pluginId: 'test.stop-all', instanceId: 'default', generation: 1 };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function create(limit = 128) {
  const scope = new AbortController();
  return {
    scope,
    tasks: new TaskSupervisor(
      {
        isActive: () => !scope.signal.aborted,
        isLive: () => !scope.signal.aborted,
        signal: () => scope.signal,
      },
      limit,
    ),
  };
}
it('cancels every current task but retains actual work capacity until settlement', async () => {
  const { tasks, scope } = create(2),
    gate = deferred(),
    entered = deferred();
  let started = 0;
  try {
    const done = take(tasks.run(owner, async () => true));
    await done.result;
    await done.settled;
    const work = async () => {
      if (++started === 2) entered.resolve();
      await gate.promise;
      return 'late';
    };
    const a = take(tasks.run(owner, work)),
      b = take(tasks.run(owner, work));
    await entered.promise;
    expect(tasks.cancelAll()).toBe(2);
    for (const task of [a, b])
      expect(await task.result).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    expect(tasks.diagnostics()).toMatchObject({ activeTasks: 0, pendingWork: 2 });
    expect(tasks.run(owner, async () => null)).toMatchObject({
      ok: false,
      error: { code: 'quota-exceeded' },
    });
    expect(scope.signal.aborted).toBe(false);
    gate.resolve();
    await Promise.all([a.settled, b.settled]);
    expect(tasks.diagnostics().pendingWork).toBe(0);
    const next = take(tasks.run(owner, async () => true));
    expect(await next.result).toEqual({ ok: true, value: true });
    await next.settled;
    expect(tasks.cancelAll()).toBe(0);
  } finally {
    gate.resolve();
    tasks.shutdown();
  }
});
it('signals cooperative work without shutting down the supervisor', async () => {
  const { tasks } = create(),
    entered = deferred();
  let aborted = false;
  try {
    const task = take(
      tasks.run(owner, async (context) => {
        entered.resolve();
        return new Promise<null>((resolve) =>
          context.signal.addEventListener(
            'abort',
            () => {
              aborted = true;
              resolve(null);
            },
            { once: true },
          ),
        );
      }),
    );
    await entered.promise;
    expect(tasks.cancelAll()).toBe(1);
    expect(aborted).toBe(true);
    expect(await task.result).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    await task.settled;
    expect(tasks.diagnostics().pendingWork).toBe(0);
  } finally {
    tasks.shutdown();
  }
});
it('takes one batch so tasks created by a later host action remain usable', async () => {
  const { tasks } = create(),
    gate = deferred(),
    entered = deferred();
  let next: TaskHandle | undefined;
  tasks.subscribe((event) => {
    if (event.kind === 'cancelled' && !next) next = take(tasks.run(owner, async () => true));
  });
  try {
    const first = take(
      tasks.run(owner, async () => {
        entered.resolve();
        await gate.promise;
        return null;
      }),
    );
    await entered.promise;
    expect(tasks.cancelAll()).toBe(1);
    expect(await next!.result).toEqual({ ok: true, value: true });
    gate.resolve();
    await first.settled;
    await next!.settled;
  } finally {
    gate.resolve();
    tasks.shutdown();
  }
});
