import { afterEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { type DemoSnapshot, type JsonValue, type OwnerRef, type Result } from '@pet/contracts';
import type { TaskHandle } from '@pet/host-kernel';
import type { DesktopHost } from './desktop-host.js';
import { DemoController } from './demo-controller.js';
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
function task(result: Promise<Result<JsonValue>>): TaskHandle {
  return {
    taskId: Math.random().toString(36).slice(2),
    result,
    settled: result,
    cancel: vi.fn(),
    release: vi.fn(),
  } as unknown as TaskHandle;
}
async function fixture(onReply?: (text: string, id: string) => void): Promise<{
  demo: DemoController;
  invoke: ReturnType<typeof vi.fn>;
  signals: Map<string, AbortController>;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-demo-controller-'));
  roots.push(root);
  const signals = new Map<string, AbortController>();
  const controller = (id: string) => {
    let signal = signals.get(id);
    if (!signal) {
      signal = new AbortController();
      signals.set(id, signal);
    }
    return signal;
  };
  let history: JsonValue[] = [];
  let turns = 0;
  const invoke = vi.fn(
    (
      _manager: unknown,
      _owner: OwnerRef,
      _capability: string,
      method: string,
      input: JsonValue,
    ) => {
      if (method === 'turn') {
        turns++;
        const body = input as { text: string };
        history = [
          { kind: 'user', id: 'user-' + turns, text: body.text, at: turns, mode: 'demo' },
          { kind: 'pet', id: 'reply-' + turns, text: 'reply ' + turns, at: turns, mode: 'demo' },
        ];
        return {
          ok: true,
          value: task(
            Promise.resolve({
              ok: true,
              value: { transcript: body.text, reply: 'reply ' + turns, errorCode: null },
            }),
          ),
        };
      }
      return { ok: true, value: task(Promise.resolve({ ok: true, value: { items: history } })) };
    },
  );
  const host = {
    dataDirectories: { get: async () => ({ ok: true, value: root }) },
    manager: {
      get: ({ pluginId }: { pluginId: string }) => ({
        owner: { pluginId, instanceId: 'default', generation: 1 },
        origin: 'builtin',
      }),
      isActive: () => true,
      signal: (owner: OwnerRef) => controller(owner.pluginId).signal,
      select: () => ({ ok: true, value: null }),
    },
    tasks: {
      invokeCapability: invoke,
      run: (
        _owner: OwnerRef,
        operation: (context: { taskId: string; signal: AbortSignal }) => Promise<JsonValue>,
      ) => ({
        ok: true,
        value: task(
          operation({ taskId: 'root-turn', signal: new AbortController().signal }).then(
            (value) => ({ ok: true as const, value }),
          ),
        ),
      }),
    },
  } as unknown as DesktopHost;
  const demo = await DemoController.create(host, root, vi.fn(), onReply);
  vi.spyOn(demo, 'snapshot').mockResolvedValue({
    canSend: true,
    canRecord: true,
    settings: {
      asrOwner: null,
      asrRevision: 1,
      modelId: 'sensevoice-small-int8',
      voiceOwner: null,
      voiceRevision: 1,
      replyMode: 'demo',
      autoSend: true,
      readError: null,
    },
  } as DemoSnapshot);
  return { demo, invoke, signals };
}
it('sends recording requests to the one registered Console owner and reports unavailable dispatch', async () => {
  const { demo } = await fixture(),
    dispatch = vi.fn(() => true),
    begin = vi.spyOn(demo, 'beginRecording');
  expect(await demo.requestRecording({ action: 'toggle' })).toMatchObject({
    error: { code: 'not-ready' },
  });
  demo.setRecordingOwner(8, dispatch);
  expect(await demo.requestRecording({ action: 'toggle' })).toMatchObject({
    ok: true,
    value: { action: 'toggle' },
  });
  expect(dispatch).toHaveBeenCalledOnce();
  expect(begin).not.toHaveBeenCalled();
  dispatch.mockReturnValue(false);
  expect(await demo.requestRecording({ action: 'finish' })).toMatchObject({
    error: { code: 'unavailable' },
  });
  demo.setRecordingOwner(null);
  expect(await demo.requestRecording({ action: 'toggle' })).toMatchObject({
    error: { code: 'not-ready' },
  });
  demo.close();
});
it('notifies independent speech only after Core history is read with the committed assistant ID', async () => {
  const spoken = vi.fn(),
    { demo, invoke } = await fixture(spoken);
  expect(await demo.sendText('first')).toEqual({ ok: true, value: null });
  await vi.waitFor(() => expect(spoken).toHaveBeenCalledWith('reply 1', 'reply-1'));
  expect(await demo.sendText('second')).toEqual({ ok: true, value: null });
  await vi.waitFor(() => expect(spoken).toHaveBeenCalledWith('reply 2', 'reply-2'));
  expect(spoken).toHaveBeenCalledTimes(2);
  expect(invoke.mock.calls.map((call) => call[3])).toEqual(['turn', 'history', 'turn', 'history']);
  demo.close();
});
it('a cancelled pending snapshot cannot later arm another recording', async () => {
  const { demo } = await fixture();
  let read: (value: DemoSnapshot) => void = () => {};
  vi.mocked(demo.snapshot).mockReturnValueOnce(
    new Promise((resolve) => {
      read = resolve;
    }),
  );
  const started = demo.beginRecording(8);
  await demo.cancel();
  read({ canRecord: true, settings: { modelId: 'sensevoice-small-int8' } } as DemoSnapshot);
  expect(await started).toMatchObject({ error: { code: 'cancelled' } });
  demo.close();
});
