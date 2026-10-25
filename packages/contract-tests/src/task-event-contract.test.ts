import { expect, it, vi } from 'vitest';
import { TaskSupervisor } from '@pet/host-kernel';
import type { Result } from '@pet/contracts';
const owner = { pluginId: 'test.task-events', instanceId: 'default', generation: 1 };
const get = <T>(result: Result<T>): T => {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
};
function setup() {
  const scope = new AbortController();
  const tasks = new TaskSupervisor({
    isLive: () => !scope.signal.aborted,
    isActive: () => !scope.signal.aborted,
    signal: () => scope.signal,
  });
  return { scope, tasks };
}
it('publishes frozen ordered metadata rather than the business result', async () => {
  const { tasks } = setup();
  const events: unknown[] = [];
  const stop = tasks.subscribe((event) => {
    events.push(event);
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.owner)).toBe(true);
  });
  const task = get(tasks.run(owner, async () => ({ privateBusiness: 'PUBLIC_EVENT_FIXTURE' })));
  expect((await task.result).ok).toBe(true);
  await task.settled;
  expect(events.map((e) => (e as { kind: string }).kind)).toEqual(['started', 'completed']);
  expect(events.map((e) => (e as { sequence: number }).sequence)).toEqual([0, 1]);
  expect(JSON.stringify(events)).not.toContain('PUBLIC_EVENT_FIXTURE');
  expect(Object.keys(events[0] as object).sort()).toEqual(['kind', 'owner', 'sequence', 'taskId']);
  stop();
  tasks.shutdown();
});
it('isolates a throwing observer from task completion', async () => {
  const { tasks } = setup();
  const later = vi.fn();
  tasks.subscribe(() => {
    throw new Error('private-observer');
  });
  tasks.subscribe(later);
  const task = get(tasks.run(owner, async () => true));
  expect(await task.result).toEqual({ ok: true, value: true });
  await task.settled;
  expect(later).toHaveBeenCalledTimes(2);
  expect(tasks.diagnostics().observerFailures).toBe(2);
  tasks.shutdown();
});
it('queues terminal events behind every observer of a reentrant started event', async () => {
  const { tasks } = setup(),
    seen: string[] = [],
    caller = new AbortController(),
    work = vi.fn(async () => true);
  tasks.subscribe((event) => {
    seen.push('A:' + event.kind);
    if (event.kind === 'started') caller.abort();
  });
  tasks.subscribe((event) => seen.push('B:' + event.kind));
  const task = get(tasks.run(owner, work, { signal: caller.signal }));
  expect(await task.result).toMatchObject({ ok: false, error: { code: 'cancelled' } });
  await task.settled;
  expect(seen).toEqual(['A:started', 'B:started', 'A:cancelled', 'B:cancelled']);
  expect(work).not.toHaveBeenCalled();
  tasks.shutdown();
});
it('bounds host observers and returns capacity after detaching', () => {
  const { tasks } = setup(),
    detach = [];
  for (let i = 0; i < 64; i++) detach.push(tasks.subscribe(() => {}));
  expect(() => tasks.subscribe(() => {})).toThrow();
  detach[0]!();
  expect(() => tasks.subscribe(() => {})).not.toThrow();
  tasks.shutdown();
});
