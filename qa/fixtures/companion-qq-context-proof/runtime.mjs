import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { register } from 'tsx/esm/api';

export const deferred = () => Promise.withResolvers();
export async function within(promise, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), 8000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export const call = (inputId, title, callId) => ({
  type: 'function_call',
  id: `item-${callId}`,
  call_id: callId,
  name: 'start_work',
  arguments: JSON.stringify({ inputId, title, code: `console.log(${JSON.stringify(title)})` }),
  status: 'completed',
});
export const message = (text, id) => ({
  type: 'message',
  id,
  role: 'assistant',
  status: 'completed',
  content: [{ type: 'output_text', text, annotations: [] }],
});

/** Test composition only: real Core/tasks/broker, synthetic grants, provider and work bodies. */
export async function createProofSource(root) {
  const events = new EventEmitter();
  const trace = [];
  const note = (kind, data = {}) => {
    trace.push({ sequence: trace.length + 1, kind, ...data });
    events.emit('change');
  };
  const previousCache = process.env.TSX_DISABLE_CACHE;
  process.env.TSX_DISABLE_CACHE = '1';
  const loader = register({ namespace: `qq-context-proof-${randomUUID()}` });
  const project = new URL('../../../', import.meta.url);
  const load = (file) => loader.import(new URL(file, project).href, import.meta.url);
  const [
    coreModule,
    configModule,
    protocol,
    generation,
    taskModule,
    credentialModule,
    storeModule,
    permitModule,
  ] = await Promise.all([
    load('plugins/harness-cortico/node_modules/cortico/src/core/core.ts'),
    load('plugins/harness-cortico/node_modules/cortico/src/core/config.ts'),
    load('plugins/harness-cortico/node_modules/cortico/src/protocol/open-responses/index.ts'),
    load('plugins/harness-cortico/node_modules/cortico/src/core/generation.ts'),
    load('packages/host-kernel/src/tasks/task-supervisor.ts'),
    load('packages/host-kernel/src/credentials/credential-broker.ts'),
    load('packages/host-kernel/src/credentials/ciphertext-store.ts'),
    load('plugins/harness-cortico/src/model-permit.ts'),
  ]).catch(async (error) => {
    await loader.unregister();
    if (previousCache === undefined) delete process.env.TSX_DISABLE_CACHE;
    else process.env.TSX_DISABLE_CACHE = previousCache;
    throw error;
  });
  note('loader.registered');
  const sourceAbort = new AbortController();
  const sourceOwner = { pluginId: 'pet.qq-context-proof', instanceId: 'default', generation: 1 };
  const providerOwner = { ...sourceOwner, pluginId: 'pet.qq-proof-provider' };
  const workerOwner = { ...sourceOwner, pluginId: 'pet.qq-proof-work' };
  const owners = [sourceOwner, providerOwner, workerOwner];
  const current = (owner) =>
    !sourceAbort.signal.aborted &&
    owners.some(
      (known) =>
        known.pluginId === owner.pluginId &&
        known.instanceId === owner.instanceId &&
        known.generation === owner.generation,
    );
  const tasks = new taskModule.TaskSupervisor({
    isActive: current,
    isLive: current,
    signal: (owner) => (current(owner) ? sourceAbort.signal : null),
  });
  const permit = new permitModule.ModelPermit();
  const calls = [];
  const requests = [];
  const contexts = [];
  const workers = [];
  const modelTasks = new Set();
  const taskLabels = new Map();
  let nativeActive = 0;
  let maxNativeActive = 0;
  let leases = 0;
  let cleanupError;
  let closing;
  const origin = {
    instance: 'qq-context-proof',
    module: 'openai-responses-compat',
    model: 'synthetic-proof',
    compatibilityDomain: 'qq-context-proof.invalid',
  };
  const broker = new credentialModule.CredentialBroker({
    store: new storeModule.MemoryCiphertextStore(),
    cipher: {
      encrypt: async () => {
        throw new Error('Proof must not persist a credential');
      },
      decrypt: async () => {
        throw new Error('Proof must not read a credential');
      },
    },
    authorize: async ({ owner, taskId, signal }) => {
      assert.deepEqual(owner, providerOwner);
      assert.ok(tasks.taskSignal(taskId, owner), 'borrow belongs to a real supervised task');
      const label = taskLabels.get(taskId);
      assert.ok(label);
      let closed = false;
      leases++;
      note('credential.borrow', { label, taskId });
      return {
        signal,
        isValid: () => !closed && !signal.aborted,
        close() {
          if (closed) return;
          closed = true;
          leases--;
          note('credential.release', { label, taskId });
        },
      };
    },
  });
  const native = (label, request, options) => {
    const done = deferred();
    const aborted = deferred();
    const index = calls.length + 1;
    const id = `proof-response-${index}`;
    const flight = {
      label,
      request,
      options,
      aborted: aborted.promise,
      settled: false,
      complete(output = []) {
        done.resolve({
          response: { ...protocol.createResponse(id, request), status: 'completed', output },
          origin,
          attempts: [
            {
              id: `attempt-${id}`,
              generationId: id,
              ordinal: 1,
              origin,
              startedAt: new Date().toISOString(),
              elapsedMs: 0,
              requestId: null,
              responseId: id,
              outcome: 'completed',
              status: 200,
              serviceTier: null,
              meters: generation.unknownMeters(),
              charges: [],
            },
          ],
        });
      },
      fail(error = new DOMException('Synthetic provider joined after abort', 'AbortError')) {
        done.reject(error);
      },
    };
    const onAbort = () => {
      note('native.abort', { label });
      aborted.resolve();
      // The probe releases this separately: abort must not masquerade as physical settlement.
    };
    options.signal.addEventListener('abort', onAbort, { once: true });
    if (options.signal.aborted) onAbort();
    nativeActive++;
    maxNativeActive = Math.max(maxNativeActive, nativeActive);
    calls.push(flight);
    note('native.enter', { label });
    return done.promise.finally(() => {
      options.signal.removeEventListener('abort', onAbort);
      flight.settled = true;
      nativeActive--;
      note('native.settled', { label });
    });
  };
  async function borrowed(label, request, options) {
    let returned;
    let actual;
    let error;
    const started = tasks.run(
      providerOwner,
      async (task) => {
        try {
          await broker.withSecretForHost(
            providerOwner,
            ['model-api-key'],
            'model-api-key',
            task,
            async (secret, signal) => {
              assert.equal(secret, 'isolated-proof-key');
              actual = native(label, request, { ...options, signal }).then(
                (value) => {
                  returned = value;
                },
                (caught) => {
                  error = caught;
                },
              );
              await actual;
              return null;
            },
            'isolated-proof-key',
          );
        } catch (caught) {
          error ??= caught;
        } finally {
          await actual;
        }
        return null;
      },
      { signal: options.signal },
    );
    assert.equal(started.ok, true);
    const handle = started.value;
    modelTasks.add(handle);
    taskLabels.set(handle.taskId, label);
    try {
      const logical = await handle.result;
      await handle.settled;
      if (error) throw error;
      if (!logical.ok) throw new Error(logical.error.code);
      assert.ok(returned);
      return returned;
    } finally {
      await handle.settled;
      handle.release();
      taskLabels.delete(handle.taskId);
      modelTasks.delete(handle);
      note('model-task.settled', { label });
    }
  }
  function track(set, promise) {
    set.add(promise);
    promise.then(
      () => set.delete(promise),
      () => set.delete(promise),
    );
    return promise;
  }
  const wait = async (predicate, label) => {
    if (predicate()) return;
    const done = deferred();
    const changed = () => {
      if (predicate()) done.resolve();
    };
    events.on('change', changed);
    try {
      await within(done.promise, label);
    } finally {
      events.off('change', changed);
    }
  };
  async function openContext(id, canary, { holdWorldStop = false } = {}) {
    const directory = path.join(root, id);
    const inputAbort = new AbortController();
    const finish = deferred();
    const ready = deferred();
    const worldStop = deferred();
    const worldEntered = deferred();
    if (!holdWorldStop) worldStop.resolve();
    const inFlight = new Set();
    const toolWork = new Set();
    let host;
    let core;
    let failure;
    let closed;
    let step = 0;
    let idleCount = 0;
    const effects = new Map();
    const context = {
      id,
      directory,
      canary,
      inputAbort,
      worldEntered: worldEntered.promise,
      releaseWorld: () => worldStop.resolve(),
      get core() {
        return core;
      },
      get idleCount() {
        return idleCount;
      },
      get pending() {
        return inFlight.size + toolWork.size;
      },
      async push() {
        assert.ok(host);
        await host.pushEvent(
          {
            type: 'proof.input',
            source: 'companion.qq-proof',
            origin: 'external',
            ts: new Date().toISOString(),
            text: JSON.stringify({ id, text: canary }),
          },
          { trigger: 'flush' },
        );
      },
      cancel() {
        handle.cancel('user');
      },
      close() {
        if (closed) return closed;
        inputAbort.abort();
        finish.resolve();
        closed = (async () => {
          const logical = await handle.result;
          await handle.settled;
          handle.release();
          if (failure) throw failure;
          if (!logical.ok && logical.error.code !== 'cancelled')
            throw new Error(logical.error.code);
          note('context.closed', { id });
        })();
        return closed;
      },
    };
    const started = tasks.run(sourceOwner, async (task) => {
      const signal = AbortSignal.any([task.signal, inputAbort.signal]);
      const stop = () => finish.resolve();
      signal.addEventListener('abort', stop, { once: true });
      const tools = [
        {
          name: 'start_work',
          description: 'Accept independent synthetic work and return its receipt.',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              inputId: { type: 'string' },
              title: { type: 'string' },
              code: { type: 'string' },
            },
            required: ['inputId', 'title', 'code'],
          },
          tags: ['write'],
          interruptible: true,
          handler: (args, toolContext) =>
            track(
              toolWork,
              Promise.resolve().then(() => {
                assert.equal(args.inputId, id);
                signal.throwIfAborted();
                toolContext.signal.throwIfAborted();
                const key = JSON.stringify(args);
                const previous = effects.get(key);
                if (previous) return { text: JSON.stringify({ ...previous, status: 'duplicate' }) };
                const release = deferred();
                const work = tasks.run(workerOwner, async () => {
                  await release.promise;
                  note('work.settled', { inputId: id, title: args.title });
                  return { title: args.title };
                });
                assert.equal(work.ok, true);
                const receipt = {
                  commandId: `${id}-${effects.size}`,
                  status: 'accepted',
                  messageId: null,
                  taskId: work.value.taskId,
                };
                effects.set(key, receipt);
                workers.push({
                  inputId: id,
                  title: args.title,
                  receipt,
                  handle: work.value,
                  release,
                });
                note('work.accepted', { inputId: id, title: args.title, taskId: receipt.taskId });
                return { text: JSON.stringify(receipt) };
              }),
            ),
        },
      ];
      const config = structuredClone(configModule.CORE_DEFAULTS);
      Object.assign(config, {
        displayName: 'One synthetic product Agent',
        timezone: 'UTC',
        logging: { file: 'warn', stdout: 'error', areas: '' },
        providers: {
          primary: {
            kind: origin.module,
            baseUrl: 'https://proof.invalid/v1',
            spec: { model: origin.model },
          },
        },
        activeProvider: 'primary',
      });
      try {
        core = new coreModule.Core(
          {
            config,
            secret: () => '',
            rootDir: directory,
            memoryDir: path.join(directory, 'memory'),
            dataDir: path.join(directory, 'data'),
          },
          {
            llm: {
              respond(request, options = {}) {
                const label = `${id}:${++step}`;
                const combined = AbortSignal.any([signal, options.signal]);
                requests.push({ label, request, options });
                const pending = permit.run(combined, () =>
                  borrowed(label, request, {
                    ...options,
                    signal: combined,
                    sessionId: `${id}:${options.sessionId}`,
                  }),
                );
                note('model.requested', { label });
                return track(inFlight, pending);
              },
            },
            persona: {
              memoryDir: path.join(directory, 'memory'),
              blobs: {
                put() {
                  throw new Error('No media in this scoped proof');
                },
                get: () => null,
                list: () => [],
              },
              attach() {},
              systemSegments: async () => [
                { title: 'Identity', text: 'One shared Agent; isolated input authority.' },
              ],
              sessionHead: () => [
                {
                  type: 'message',
                  role: 'user',
                  content: [{ type: 'input_text', text: `Only this audience: ${canary}` }],
                },
              ],
              declareSessions: () => [
                {
                  id: 'foreground',
                  label: 'Input-owned proof',
                  persistent: true,
                  receivesEvents: true,
                  eventDelivery: 'user',
                  rounds: () => ({ soft: 8, hard: 12 }),
                  tools: () => tools,
                  outputTap: { onEvent() {} },
                },
              ],
              onIdle() {
                idleCount++;
                note('context.idle', { id });
              },
            },
            worlds: [
              {
                id: 'companion.qq-proof',
                envPromptVars: () => null,
                tools: () => tools,
                async start(value) {
                  host = value;
                  note('world.started', { id });
                },
                async stop() {
                  worldEntered.resolve();
                  note('world.stopping', { id });
                  await worldStop.promise;
                  note('world.stopped', { id });
                },
              },
            ],
          },
        );
        await core.start();
        ready.resolve();
        await finish.promise;
      } catch (error) {
        failure = error;
        ready.reject(error);
      } finally {
        signal.removeEventListener('abort', stop);
        if (core) {
          let stopFailures = 0;
          try {
            stopFailures = (await core.stop()).length;
          } catch (error) {
            stopFailures = 1;
            failure ??= error;
          }
          const joined = await Promise.allSettled([...inFlight, ...toolWork]);
          note('context.joined', {
            id,
            stopFailures,
            remaining: context.pending,
            rejectedDuringStop: joined.filter((item) => item.status === 'rejected').length,
          });
          if (stopFailures || context.pending)
            failure ??= new Error(`Context ${id} cleanup incomplete`);
        }
      }
      if (failure) throw failure;
      return null;
    });
    assert.equal(started.ok, true);
    const handle = started.value;
    context.handle = handle;
    contexts.push(context);
    await within(ready.promise, `start ${id}`);
    return context;
  }
  async function finishWorkers() {
    for (const worker of workers) worker.release.resolve();
    for (const worker of workers) {
      const result = await worker.handle.result;
      await worker.handle.settled;
      assert.equal(result.ok, true);
      worker.handle.release();
    }
  }
  return {
    trace,
    calls,
    requests,
    contexts,
    workers,
    tasks,
    broker,
    permit,
    openContext,
    wait,
    finishWorkers,
    get nativeActive() {
      return nativeActive;
    },
    get maxNativeActive() {
      return maxNativeActive;
    },
    get leases() {
      return leases;
    },
    async next(label) {
      await wait(() => calls.some((flight) => flight.label === label), `native ${label}`);
      return calls.find((flight) => flight.label === label);
    },
    async close() {
      if (closing) return closing;
      closing = (async () => {
        try {
          for (const flight of calls) if (!flight.settled) flight.fail();
          for (const context of contexts) {
            context.releaseWorld();
            context.cancel();
          }
          const results = await Promise.allSettled(contexts.map((context) => context.close()));
          if (results.some((item) => item.status === 'rejected'))
            cleanupError = new Error('Context cleanup failed');
          await finishWorkers();
          await Promise.all([...modelTasks].map((handle) => handle.settled));
          broker.dispose();
          await broker.drainUses();
          await broker.drainWrites();
          tasks.shutdown();
          sourceAbort.abort();
          note('source.joined', {
            nativeActive,
            leases,
            pendingWork: tasks.diagnostics().pendingWork,
          });
          assert.equal(nativeActive, 0);
          assert.equal(leases, 0);
          assert.equal(tasks.diagnostics().pendingWork, 0);
          assert.deepEqual(permit.diagnostics(), { active: false, waiting: 0 });
          if (cleanupError) throw cleanupError;
        } finally {
          await loader.unregister();
          note('loader.unregistered');
          if (previousCache === undefined) delete process.env.TSX_DISABLE_CACHE;
          else process.env.TSX_DISABLE_CACHE = previousCache;
        }
      })();
      return closing;
    },
  };
}
