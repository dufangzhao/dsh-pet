import { expect, it } from 'vitest';
import { ApprovalInbox } from './approval-inbox.js';
const owner = { pluginId: 'test.approval', instanceId: 'default', generation: 1 };
const prompt = {
  requestId: 'request',
  owner,
  taskId: 'task',
  permission: { kind: 'microphone' as const },
  permissionDigest: 'a'.repeat(64),
  policyEpoch: 1,
};
it('accepts only the current complete tuple and resolves explicit refusal normally', async () => {
  const inbox = new ApprovalInbox(1000),
    abort = new AbortController();
  const waiting = inbox.request(prompt, abort.signal);
  expect(inbox.answer({ ...prompt, permissionDigest: 'b'.repeat(64), approved: true })).toBe(false);
  expect(inbox.snapshot()).toHaveLength(1);
  const decision = {
    requestId: prompt.requestId,
    owner,
    taskId: prompt.taskId,
    permissionDigest: prompt.permissionDigest,
    approved: false,
  };
  expect(inbox.answer(decision)).toBe(true);
  expect(await waiting).toEqual(decision);
  expect(inbox.snapshot()).toEqual([]);
  expect(inbox.answer({ ...prompt, approved: true })).toBe(false);
});
it('removes cancelled requests and rejects late answers', async () => {
  const inbox = new ApprovalInbox(5),
    abort = new AbortController();
  const waiting = inbox.request(prompt, abort.signal).catch(() => 'cancelled');
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(inbox.answer({ ...prompt, approved: true })).toBe(false);
  abort.abort();
  expect(await waiting).toBe('cancelled');
  expect(inbox.snapshot()).toEqual([]);
});
it('clears all pending requests with one empty notification', async () => {
  const inbox = new ApprovalInbox(),
    counts: number[] = [];
  inbox.subscribe(() => counts.push(inbox.snapshot().length));
  const pending = ['one', 'two', 'three'].map((requestId) =>
    inbox.request({ ...prompt, requestId }, new AbortController().signal).catch(() => false),
  );
  counts.length = 0;
  inbox.clear();
  expect(counts).toEqual([0]);
  expect(await Promise.all(pending)).toEqual([false, false, false]);
});
