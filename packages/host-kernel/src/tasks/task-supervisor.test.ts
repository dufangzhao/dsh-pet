import { expect, it, vi } from 'vitest';
import type { OwnerRef, Result, TaskEvent } from '@pet/contracts';
import { TaskSupervisor } from './task-supervisor.js';
const owner: OwnerRef = { pluginId: 'test.task', instanceId: 'default', generation: 1 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const unwrap = <T>(r: Result<T>): T => {
  if (!r.ok) throw new Error(r.error.code);
  return r.value;
};
function setup(limit = 128, retained = 256) {
  const scope = new AbortController();
  let live = true;
  const tasks = new TaskSupervisor(
    { isActive: () => live, isLive: () => live, signal: () => scope.signal },
    limit,
    retained,
  );
  return {
    tasks,
    scope,
    expire: () => {
      live = false;
      scope.abort();
    },
  };
}
it('returns a bounded copied result with metadata-only ordered events', async () => {
  const f = setup();
  const events: TaskEvent<never>[] = [];
  f.tasks.subscribe((e) => events.push(e));
  const data = { text: 'public-fixture' };
  const task = unwrap(f.tasks.run(owner, async () => data));
  expect(await task.result).toEqual({ ok: true, value: data });
  await task.settled;
  expect(events.map((e) => [e.sequence, e.kind])).toEqual([
    [0, 'started'],
    [1, 'completed'],
  ]);
  expect(JSON.stringify(events)).not.toContain('public-fixture');
  data.text = 'changed';
  expect(await task.result).toEqual({ ok: true, value: { text: 'public-fixture' } });
  expect(task.release()).toBe(true);
  expect(f.tasks.diagnostics().retained).toBe(0);
});
it('does not run work cancelled before its microtask', async () => {
  const f = setup();
  const work = vi.fn(async () => null);
  const task = unwrap(f.tasks.run(owner, work));
  task.cancel();
  expect(await task.result).toMatchObject({ ok: false, error: { code: 'cancelled' } });
  await task.settled;
  expect(work).not.toHaveBeenCalled();
});
it('cancels results promptly but retains uncooperative work in the budget', async () => {
  const f = setup(1);
  const started = deferred<void>();
  const late = deferred<string>();
  const task = unwrap(
    f.tasks.run(owner, async () => {
      started.resolve();
      return late.promise;
    }),
  );
  await started.promise;
  task.cancel();
  expect(await task.result).toMatchObject({ ok: false, error: { code: 'cancelled' } });
  expect(f.tasks.diagnostics().pendingWork).toBe(1);
  expect(f.tasks.run(owner, async () => null)).toMatchObject({
    ok: false,
    error: { code: 'quota-exceeded' },
  });
  late.resolve('late-content');
  await task.settled;
  expect(await task.result).toMatchObject({ ok: false, error: { code: 'cancelled' } });
  expect(f.tasks.diagnostics().pendingWork).toBe(0);
});
it('drops late data from disabled owner generations', async () => {
  const f = setup();
  const late = deferred<null>();
  const began = deferred<void>();
  const task = unwrap(
    f.tasks.run(owner, async () => {
      began.resolve();
      return late.promise;
    }),
  );
  await began.promise;
  f.expire();
  expect(await task.result).toMatchObject({ ok: false, error: { code: 'stale-owner' } });
  late.resolve(null);
  await task.settled;
});
it('uses timeout as a terminal state and removes its timer', async () => {
  vi.useFakeTimers();
  try {
    const f = setup();
    const late = deferred<null>();
    const task = unwrap(f.tasks.run(owner, () => late.promise, { timeoutMs: 50 }));
    await vi.advanceTimersByTimeAsync(51);
    expect(await task.result).toMatchObject({ ok: false, error: { code: 'timeout' } });
    expect(task.snapshot().state).toBe('timed-out');
    expect(vi.getTimerCount()).toBe(0);
    late.resolve(null);
    await task.settled;
  } finally {
    vi.useRealTimers();
  }
});
it('checks the monotonic deadline even before the timeout callback runs', async () => {
  const f = setup();
  let now = 0;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  try {
    const task = unwrap(
      f.tasks.run(
        owner,
        async () => {
          now = 100;
          return 'late';
        },
        { timeoutMs: 50 },
      ),
    );
    expect(await task.result).toMatchObject({ ok: false, error: { code: 'timeout' } });
    await task.settled;
  } finally {
    clock.mockRestore();
  }
});
it('does not deliver duplicate terminal events after cancellation', async () => {
  const f = setup();
  const events: TaskEvent<never>[] = [];
  f.tasks.subscribe((e) => events.push(e));
  const task = unwrap(f.tasks.run(owner, async () => 1));
  expect(task.cancel()).toBe(true);
  expect(task.cancel()).toBe(false);
  await task.result;
  await task.settled;
  expect(events.filter((e) => e.kind !== 'started')).toHaveLength(1);
});
it('keeps observer re-entry ordered for every subscriber', async () => {
  const f = setup();
  let taskId = '';
  const other: string[] = [];
  f.tasks.subscribe((event) => {
    taskId = event.taskId;
    if (event.kind === 'started') f.tasks.shutdown();
  });
  f.tasks.subscribe((event) => other.push(event.kind));
  const task = unwrap(f.tasks.run(owner, async () => null));
  await task.result;
  await task.settled;
  expect(task.taskId).toBe(taskId);
  expect(other).toEqual(['started', 'cancelled']);
});
it('isolates observer errors and rejects unsafe or oversized results', async () => {
  const f = setup();
  f.tasks.subscribe(() => {
    throw new Error('private');
  });
  const a = unwrap(f.tasks.run(owner, async () => 'x'.repeat(65537)));
  expect(await a.result).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
  await a.settled;
  expect(f.tasks.diagnostics().observerFailures).toBe(2);
  const b = unwrap(
    f.tasks.run(owner, async () => {
      throw new Error('private-content');
    }),
  );
  expect(await b.result).toMatchObject({ ok: false, error: { code: 'internal' } });
  expect(JSON.stringify(await b.result)).not.toContain('private-content');
  await b.settled;
});
it('bounds retained terminal tasks and refuses cross-owner lookup/release', async () => {
  const f = setup(4, 1);
  const first = unwrap(f.tasks.run(owner, async () => 1));
  await first.settled;
  const second = unwrap(f.tasks.run(owner, async () => 2));
  await second.settled;
  expect(f.tasks.get(first.taskId, owner)).toBeNull();
  expect(f.tasks.get(second.taskId, { ...owner, generation: 2 })).toBeNull();
  expect(f.tasks.release(second.taskId, { ...owner, generation: 2 })).toBe(false);
  expect(f.tasks.diagnostics().retained).toBe(1);
});
it('shutdown cancels tasks and rejects new work', async () => {
  const f = setup();
  const task = unwrap(f.tasks.run(owner, async () => 1));
  f.tasks.shutdown();
  expect(await task.result).toMatchObject({ ok: false, error: { code: 'cancelled' } });
  await task.settled;
  expect(f.tasks.run(owner, async () => 1)).toMatchObject({ ok: false });
  expect(f.tasks.diagnostics().observers).toBe(0);
});
