import { afterEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  APPLICATION_PLUGIN_IDS,
  DEMO_PLUGIN_IDS,
  makeError,
  voiceInputModel,
  type VoiceInputEngine,
  type JsonValue,
  type OwnerRef,
  type TaskContext,
} from '@pet/contracts';
import {
  TaskSupervisor,
  type MediaReadEndpoint,
  type MediaWriteEndpoint,
  type TaskMediaReference,
} from '@pet/host-kernel';
import { jsonPreflight } from '@pet/contracts/validation';
import voicePlugin from '../../../../plugins/voice-chat/src/index.js';
import type { DesktopHost } from './desktop-host.js';
import { DemoController } from './demo-controller.js';
vi.mock('../../../../plugins/asr-local/src/model-store.js', () => ({
  modelPresent: async () => true,
}));
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
class Queue<T> implements AsyncIterable<T> {
  items: T[] = [];
  done = false;
  wake: (() => void) | null = null;
  constructor(signal: AbortSignal) {
    signal.addEventListener('abort', () => this.cancel(), { once: true });
  }
  push(value: T): void {
    if (this.done) return;
    this.items.push(value);
    this.notify();
  }
  end(): void {
    this.done = true;
    this.notify();
  }
  cancel(): void {
    this.items = [];
    this.end();
  }
  private notify(): void {
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }
  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    for (;;) {
      const item = this.items.shift();
      if (item !== undefined) yield item;
      else if (this.done) return;
      else
        await new Promise<void>((resolve) => {
          this.wake = resolve;
        });
    }
  }
}
const stops: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});
async function fixture(autoSend = true, engine: VoiceInputEngine = 'sensevoice') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-live-intent-'));
  const generations = new Map<string, number>(),
    signals = new Map<string, AbortController>();
  const owner = (id: string): OwnerRef => ({
    pluginId: id,
    instanceId: 'default',
    generation: generations.get(id) ?? 1,
  });
  const signal = (id: string) => {
    let current = signals.get(id);
    if (!current) {
      current = new AbortController();
      signals.set(id, current);
    }
    return current;
  };
  const active = (ref: OwnerRef) =>
    ref.generation === (generations.get(ref.pluginId) ?? 1) && !signal(ref.pluginId).signal.aborted;
  const tasks = new TaskSupervisor({
    isActive: active,
    isLive: active,
    signal: (ref) => signal(ref.pluginId).signal,
  });
  const reply = deferred<void>(),
    spoken = vi.fn();
  let voiceMethods: Readonly<
    Record<string, (task: TaskContext, input: JsonValue) => Promise<JsonValue>>
  > = {};
  const sessions: {
    reference: TaskMediaReference;
    output: Queue<Uint8Array>;
    seen: Uint8Array[];
    ended: boolean;
  }[] = [];
  let voiceTurns = 0,
    coreTurns = 0,
    history: JsonValue[] = [],
    microphoneEnds = 0;
  const invoke = (
    who: OwnerRef,
    capability: string,
    method: string,
    input: JsonValue,
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
    parent?: string,
  ) => {
    const started = tasks.run(
      who,
      async (context) => {
        if (capability === 'chat.session@1') {
          if (method === 'turn') voiceTurns++;
          const operation = voiceMethods[method];
          if (!operation) throw new Error('Unknown voice method');
          return operation(context, input);
        }
        if (capability === 'speech.asr@1') {
          if (method === 'prepare') return { modelId: voiceInputModel(engine), errorCode: null };
          const incoming = new Queue<{ bytes: Uint8Array; ack: () => void }>(context.signal),
            output = new Queue<Uint8Array>(context.signal);
          const reference = {
            owner: who,
            taskId: context.taskId,
            streamId: 'asr-' + context.taskId,
          };
          const session = { reference, output, seen: [] as Uint8Array[], ended: false };
          sessions.push(session);
          const writer = {
            write: (bytes: Uint8Array) =>
              new Promise<{ ok: true; value: null }>((resolve) => {
                incoming.push({ bytes, ack: () => resolve({ ok: true, value: null }) });
              }),
            end: async () => {
              incoming.end();
              return { ok: true, value: null };
            },
            cancel: () => incoming.cancel(),
          } as unknown as MediaWriteEndpoint;
          demo.input(reference, writer);
          demo.output(reference, {
            reference,
            cancel: () => output.cancel(),
            [Symbol.asyncIterator]: () => output[Symbol.asyncIterator](),
          } as MediaReadEndpoint);
          for await (const frame of incoming) {
            session.seen.push(frame.bytes);
            output.push(new TextEncoder().encode('partial ' + sessions.indexOf(session)));
            frame.ack();
          }
          if (context.signal.aborted) return { text: '', errorCode: 'cancelled' };
          session.ended = true;
          output.push(new TextEncoder().encode('final transcript'));
          output.end();
          return { text: 'final transcript', errorCode: null };
        }
        if (capability === 'agent.conversation@1') {
          if (method === 'state') return { paused: false };
          if (method === 'history') return { items: history };
          if (method === 'turn') {
            coreTurns++;
            await reply.promise;
            if (context.signal.aborted) return { errorCode: 'cancelled' };
            history = [
              { id: 'user-1', kind: 'user', text: 'final transcript', mode: 'demo', at: 1 },
              { id: 'reply-1', kind: 'pet', text: 'one reply', mode: 'demo', at: 2 },
            ];
            return { text: 'one reply', errorCode: null };
          }
        }
        throw new Error('Unexpected capability');
      },
      options,
    );
    if (started.ok && parent) demo.capabilityTask(parent, started.value, capability, method);
    return started;
  };
  const host = {
    dataDirectories: { get: async () => ({ ok: true, value: directory }) },
    tasks,
    manager: {
      get: ({ pluginId }: { pluginId: string }) => ({
        owner: owner(pluginId),
        origin: 'builtin',
        state: 'active',
        manifest: { displayName: { 'zh-CN': pluginId }, version: '0.1.0' },
      }),
      isActive: active,
      signal: (ref: OwnerRef) => signal(ref.pluginId).signal,
      select: () => ({ ok: true, value: null }),
    },
    configs: {
      inspect: async ({ pluginId }: { pluginId: string }) => ({
        ok: true,
        value: {
          snapshot: {
            revision: 1,
            data:
              pluginId === DEMO_PLUGIN_IDS.voice
                ? { mode: 'demo', autoSend, engine }
                : { model: 'sensevoice-small-int8' },
          },
        },
      }),
      get: async ({ pluginId }: { pluginId: string }) => ({
        ok: true,
        value: { data: pluginId === APPLICATION_PLUGIN_IDS.profile ? { voiceEnabled: true } : {} },
      }),
    },
    describeTrust: () => ({ trusted: true, digest: 'fixture' }),
    permissionControl: { inspect: () => ({ preset: 'local', blocked: false }) },
    permissions: {
      run: async (
        _who: OwnerRef,
        _id: string,
        _permission: unknown,
        operation: (signal: AbortSignal) => Promise<unknown>,
        parent: AbortSignal,
      ) => {
        const lease = new AbortController();
        try {
          return { ok: true, value: await operation(AbortSignal.any([parent, lease.signal])) };
        } finally {
          microphoneEnds++;
          lease.abort();
        }
      },
    },
  } as unknown as DesktopHost;
  vi.spyOn(tasks, 'invokeCapability').mockImplementation(
    (_manager, who, capability, method, input, _authorize, options = {}) => {
      const checked = jsonPreflight(input);
      if (!checked.ok) return { ok: false, error: makeError('invalid-input', false) };
      return invoke(who, capability, method, checked.value, options);
    },
  );
  await voicePlugin.activate({
    owner: owner(DEMO_PLUGIN_IDS.voice),
    signal: signal(DEMO_PLUGIN_IDS.voice).signal,
    config: {},
    provide: (_id, methods) => {
      voiceMethods = methods;
    },
    contribute: () => {},
    effect: () => {},
    host: {
      version: 1,
      config: { get: async () => ({ ok: false, error: makeError('not-ready', false) }) },
      media: {
        openInput: async () => ({ ok: false, error: makeError('not-ready', false) }),
        openOutput: async () => ({ ok: false, error: makeError('not-ready', false) }),
      },
      capabilities: {
        invoke: async (parent, capability, method, input) => {
          const selected = owner(
            capability === 'speech.asr@1' ? DEMO_PLUGIN_IDS.asr : APPLICATION_PLUGIN_IDS.agent,
          );
          const child = invoke(
            selected,
            capability,
            method,
            input,
            { signal: parent.signal },
            parent.taskId,
          );
          return child.ok ? await child.value.result : child;
        },
      },
    },
  });
  const demo = await DemoController.create(host, directory, vi.fn(), spoken);
  stops.push(async () => {
    demo.close();
    reply.resolve();
    tasks.shutdown();
    await vi.waitFor(() => expect(tasks.diagnostics().pendingWork).toBe(0));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const begin = async () => {
    const ticket = await demo.beginRecording(7);
    if (!ticket.ok) throw new Error(ticket.error.code);
    expect(demo.captureReady(ticket.value.token, 7, 16000)).toEqual({ ok: true, value: null });
    return ticket.value;
  };
  return {
    demo,
    tasks,
    sessions,
    spoken,
    begin,
    reply,
    counts: () => ({ voiceTurns, coreTurns, microphoneEnds, history: history.length }),
    disableAsr: () => signal(DEMO_PLUGIN_IDS.asr).abort(),
    reviveAsr: () => {
      generations.set(DEMO_PLUGIN_IDS.asr, 2);
      signals.set(DEMO_PLUGIN_IDS.asr, new AbortController());
    },
  };
}
it('publishes live text without ending capture and finalizes one ASR/Core turn only after explicit finish', async () => {
  const f = await fixture(),
    ticket = await f.begin();
  const id = (await f.demo.snapshot()).intentId;
  expect(
    f.demo.pushAudio(ticket.token, 7, 0, new Uint8Array(new Float32Array(1600).buffer)),
  ).toEqual({ ok: true, value: null });
  await vi.waitFor(async () =>
    expect((await f.demo.snapshot()).partialTranscript).toBe('partial 0'),
  );
  expect((await f.demo.snapshot()).phase).toBe('recording');
  expect(f.demo.microphoneAllowed(7)).toBe(true);
  expect(f.counts()).toMatchObject({ voiceTurns: 1, coreTurns: 0, microphoneEnds: 0 });
  expect(f.sessions[0]?.ended).toBe(false);
  expect(
    f.demo.pushAudio(ticket.token, 7, 1, new Uint8Array(new Float32Array(800).buffer)),
  ).toEqual({ ok: true, value: null });
  await vi.waitFor(() => expect(f.sessions[0]?.seen).toHaveLength(2));
  expect(f.demo.finishRecording(ticket.token, 7, 2)).toEqual({ ok: true, value: null });
  await vi.waitFor(async () =>
    expect((await f.demo.snapshot()).transcript).toBe('final transcript'),
  );
  const state = await f.demo.snapshot();
  expect(state.intentId).toBe(id);
  expect(state.partialTranscript).toBe('');
  expect(f.demo.microphoneAllowed(7)).toBe(false);
  expect(f.counts()).toMatchObject({ voiceTurns: 1, coreTurns: 1, microphoneEnds: 1 });
  expect(f.sessions).toHaveLength(1);
  f.reply.resolve();
  await vi.waitFor(async () => expect((await f.demo.snapshot()).phase).toBe('idle'));
  expect(f.spoken).toHaveBeenCalledOnce();
  expect(f.counts().history).toBe(2);
  expect(f.demo.finishRecording(ticket.token, 7, 2)).toMatchObject({ ok: false });
  expect(f.counts().voiceTurns).toBe(1);
});
it('keeps a final transcript without sending Core when auto-send is off', async () => {
  const f = await fixture(false),
    ticket = await f.begin();
  f.demo.pushAudio(ticket.token, 7, 0, new Uint8Array(new Float32Array(1600).buffer));
  await vi.waitFor(() => expect(f.sessions[0]?.seen).toHaveLength(1));
  f.demo.finishRecording(ticket.token, 7, 1);
  await vi.waitFor(async () => expect((await f.demo.snapshot()).phase).toBe('idle'));
  expect((await f.demo.snapshot()).transcript).toBe('final transcript');
  expect(f.counts().coreTurns).toBe(0);
  expect(f.spoken).not.toHaveBeenCalled();
});
it('cancels live media on navigation close and rejects stale output from an earlier intent', async () => {
  const f = await fixture(),
    first = await f.begin();
  f.demo.pushAudio(first.token, 7, 0, new Uint8Array(new Float32Array(1600).buffer));
  await vi.waitFor(async () =>
    expect((await f.demo.snapshot()).partialTranscript).toBe('partial 0'),
  );
  const old = f.sessions[0];
  if (!old) throw new Error('Missing old session');
  old.output.push(new TextEncoder().encode('stale partial'));
  await f.demo.cancel();
  const next = await f.begin();
  f.demo.pushAudio(next.token, 7, 0, new Uint8Array(new Float32Array(1600).buffer));
  await vi.waitFor(async () =>
    expect((await f.demo.snapshot()).partialTranscript).toBe('partial 1'),
  );
  const rejected = vi.fn();
  f.demo.output(old.reference, {
    cancel: rejected,
    async *[Symbol.asyncIterator]() {
      yield new TextEncoder().encode('old final');
    },
  } as unknown as MediaReadEndpoint);
  expect(rejected).toHaveBeenCalledOnce();
  expect((await f.demo.snapshot()).partialTranscript).toBe('partial 1');
  f.demo.onConsoleClosed();
  await vi.waitFor(async () => expect((await f.demo.snapshot()).phase).toBe('idle'));
  expect(f.demo.microphoneAllowed(7)).toBe(false);
  expect(f.counts().coreTurns).toBe(0);
});
it('owner disable cancels waiting ASR input without publishing a final result or history', async () => {
  const f = await fixture(),
    ticket = await f.begin();
  f.demo.pushAudio(ticket.token, 7, 0, new Uint8Array(new Float32Array(1600).buffer));
  await vi.waitFor(async () =>
    expect((await f.demo.snapshot()).partialTranscript).toBe('partial 0'),
  );
  f.disableAsr();
  await vi.waitFor(async () => expect((await f.demo.snapshot()).phase).toBe('idle'));
  expect(f.demo.microphoneAllowed(7)).toBe(false);
  expect((await f.demo.snapshot()).partialTranscript).toBe('');
  expect((await f.demo.snapshot()).transcript).toBe('');
  expect(f.counts().coreTurns).toBe(0);
  expect(f.demo.pushAudio(ticket.token, 7, 1, new Uint8Array(4))).toMatchObject({ ok: false });
  f.reviveAsr();
  const next = await f.begin();
  f.demo.pushAudio(next.token, 7, 0, new Uint8Array(new Float32Array(1600).buffer));
  await vi.waitFor(async () =>
    expect((await f.demo.snapshot()).partialTranscript).toBe('partial 1'),
  );
  const active = f.sessions[1];
  if (!active) throw new Error('Missing replacement session');
  const rejected = vi.fn();
  f.demo.output({ ...active.reference, owner: { ...active.reference.owner, generation: 1 } }, {
    cancel: rejected,
    async *[Symbol.asyncIterator]() {
      yield new TextEncoder().encode('stale generation');
    },
  } as unknown as MediaReadEndpoint);
  expect(rejected).toHaveBeenCalledOnce();
  expect((await f.demo.snapshot()).partialTranscript).toBe('partial 1');
});
it('counts the full20second capture budget even after ASR drains earlier audio frames', async () => {
  const f = await fixture(),
    ticket = await f.begin(),
    frame = new Uint8Array(new Float32Array(1600).buffer);
  for (let sequence = 0; sequence < 200; sequence++)
    expect(f.demo.pushAudio(ticket.token, 7, sequence, frame)).toEqual({ ok: true, value: null });
  await vi.waitFor(() => expect(f.sessions[0]?.seen).toHaveLength(200));
  expect(f.demo.pushAudio(ticket.token, 7, 200, new Uint8Array(4))).toMatchObject({
    ok: false,
    error: { code: 'invalid-input' },
  });
  expect((await f.demo.snapshot()).phase).toBe('recording');
  expect(f.demo.microphoneAllowed(7)).toBe(true);
  expect(f.counts().microphoneEnds).toBe(0);
  await f.demo.cancel();
});
it('starts a final-only provider after capture finish so its recognition deadline excludes recording', async () => {
  const f = await fixture(true, 'whisper-small'),
    ticket = await f.begin();
  f.demo.pushAudio(ticket.token, 7, 0, new Uint8Array(new Float32Array(1600).buffer));
  expect((await f.demo.snapshot()).phase).toBe('recording');
  expect(f.counts().voiceTurns).toBe(0);
  expect(f.sessions).toHaveLength(0);
  expect(f.demo.microphoneAllowed(7)).toBe(true);
  f.demo.finishRecording(ticket.token, 7, 1);
  await vi.waitFor(async () =>
    expect((await f.demo.snapshot()).transcript).toBe('final transcript'),
  );
  expect(f.counts().voiceTurns).toBe(1);
  expect(f.counts().coreTurns).toBe(1);
  f.reply.resolve();
});
