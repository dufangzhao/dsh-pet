import fs from 'node:fs/promises';
import path from 'node:path';
import { APPLICATION_DEFAULTS, APPLICATION_PROFILE_SCHEMA } from '@pet/contracts';

const object = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
const json = (value) => JSON.parse(JSON.stringify(value));
const origin = (model) => ({
  instance: 'desktop',
  module: 'openai-responses-compat',
  model,
  compatibilityDomain: 'pet.desktop',
});
const generation = (id, name, args) => ({
  response: {
    id,
    object: 'response',
    created_at: 0,
    status: 'completed',
    model: 'offline-script',
    output: [
      {
        type: 'function_call',
        id: id + '-item',
        call_id: id + '-call',
        name,
        arguments: JSON.stringify(args),
        status: 'completed',
      },
    ],
    usage: null,
  },
  origin: origin('offline-script'),
  attempts: [
    {
      id: id + '-attempt',
      generationId: id,
      ordinal: 1,
      origin: origin('offline-script'),
      startedAt: new Date().toISOString(),
      elapsedMs: 0,
      requestId: null,
      responseId: id,
      outcome: 'completed',
      status: null,
      serviceTier: null,
      meters: {
        input: null,
        output: null,
        total: null,
        cachedInput: null,
        uncachedInput: null,
        reasoning: null,
        native: null,
      },
      charges: [],
    },
  ],
});

export async function activateAgent(ctx) {
  if (!ctx.dataDirectory) throw new Error('Owned agent data directory unavailable');
  process.env.TSX_DISABLE_CACHE = '1';
  const { register } = await import('tsx/esm/api');
  const unregister = register();
  const { Core } = await import('cortico/core/core.ts');
  const { CORE_DEFAULTS } = await import('cortico/core/config.ts');
  const cfg = structuredClone(CORE_DEFAULTS);
  cfg.displayName = APPLICATION_DEFAULTS.petName;
  cfg.providers = {
    desktop: {
      kind: 'openai-responses-compat',
      baseUrl: 'https://api.deepseek.com',
      spec: { model: 'deepseek-chat' },
    },
  };
  cfg.activeProvider = 'desktop';
  cfg.batching = { quietGapMs: 50, minBatchAgeMs: 0, maxBatchAgeMs: 500, maxBatchSize: 64 };
  cfg.logging = { file: 'warn', stdout: 'error', areas: '' };
  let current = { revision: 0, data: { ...APPLICATION_DEFAULTS } };
  let pending = null;
  let builtProfile = current;
  let promptState = 'saved';
  let promptError = null;
  let active = null;
  let worldHost;
  let closed = false;
  let stopping;
  let core;
  const segments = (profile = current) => [
    {
      id: 'persona.identity',
      label: '名字与表达',
      text:
        'Your name is ' +
        profile.data.petName +
        '. Address the user as ' +
        profile.data.userName +
        '. Reply language: ' +
        profile.data.replyLanguage +
        '. Style: ' +
        profile.data.style +
        '.',
    },
    { id: 'persona.body', label: '完整人设正文', text: profile.data.personaPrompt },
    {
      id: 'world.desktop',
      label: '桌面交互说明',
      text: 'Use pet_say for visible speech. Use configure_pet only for a requested permitted settings change. User interaction history and application guidance share this desktop World. Only report actions that succeeded.',
    },
  ];
  const state = () => ({
    revision: current.revision,
    promptState,
    promptError,
    segments: segments(),
    busy: active !== null,
    paused: core?.bus.isPaused() ?? false,
    cursor: core?.store.latestCursor() ?? 0,
  });
  const readProfile = async (task) => {
    const result = await ctx.host.capabilities.invoke(task, 'app.profile@1', 'read', null);
    const body = result.ok ? object(result.value) : null;
    if (!body || body.errorCode || !object(body.data) || !Number.isSafeInteger(body.revision))
      throw new Error(result.ok ? String(body?.errorCode ?? 'not-ready') : result.error.code);
    return { revision: body.revision, data: body.data };
  };
  const applyProfile = async (next) => {
    if (next.revision === current.revision && !pending && promptState !== 'error') return;
    pending = next;
    promptState = 'pending';
    try {
      await core.loop.reloadSystemPrefix();
      current = builtProfile;
      if (pending?.revision === current.revision) pending = null;
      promptState = pending ? 'pending' : 'applied';
      promptError = null;
    } catch {
      promptState = 'error';
      promptError = '提示词已保存，暂未应用';
    }
  };
  const archive = async (kind, text, meta = {}) =>
    worldHost.pushEvent(
      {
        type: 'pet.' + kind,
        source: 'pet.desktop',
        origin: 'internal',
        ts: new Date().toISOString(),
        text,
        meta: { ...meta, text },
      },
      { deliver: false },
    );
  const tools = [
    {
      name: 'pet_say',
      description: 'Say a visible reply to the user.',
      tags: ['speak'],
      barrierAfter: true,
      endsTurn: true,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { text: { type: 'string', maxLength: 4000 } },
        required: ['text'],
      },
      handler: async ({ text }) => {
        if (!active || typeof text !== 'string' || !text.trim() || [...text].length > 4000)
          return { text: 'Speech was not presented.', failed: true };
        const turn = active;
        const sent = await turn.writer.write(
          new TextEncoder().encode(JSON.stringify({ kind: 'reply', text })),
        );
        if (!sent.ok || active !== turn || turn.task.signal.aborted)
          return { text: 'Presentation was canceled.', failed: true };
        await archive('speech', text, { mode: turn.mode, via: turn.via });
        turn.reply = text;
        return 'The reply is available in the shared pet interaction record.';
      },
    },
    {
      name: 'configure_pet',
      description:
        'Apply a requested update to the pet name, address, reply language, style, persona prompt or appearance. Preserve unrelated settings.',
      tags: ['write'],
      barrierAfter: true,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          changes: {
            type: 'object',
            minProperties: 1,
            additionalProperties: false,
            properties: APPLICATION_PROFILE_SCHEMA.properties,
          },
        },
        required: ['changes'],
      },
      handler: async ({ changes }) => {
        if (!active || !object(changes))
          return { text: 'Settings change unavailable.', failed: true };
        const result = await ctx.host.capabilities.invoke(active.task, 'app.profile@1', 'change', {
          expectedRevision: current.revision,
          patch: changes,
        });
        const body = result.ok ? object(result.value) : null;
        if (!body || body.errorCode)
          return {
            text:
              'Settings were not changed: ' +
              (result.ok ? String(body?.errorCode ?? 'unavailable') : result.error.code),
            failed: true,
          };
        await archive('application', '已保存桌宠设置', {
          action: 'profile-change',
          revision: body.revision,
        });
        void applyProfile({ revision: body.revision, data: body.data });
        return 'Settings saved; the updated prompt applies after the current batch ends.';
      },
    },
  ];
  const world = {
    id: 'pet.desktop',
    envPromptVars: () => null,
    tools: () => tools,
    start: async (host) => {
      worldHost = host;
    },
    stop: async () => {},
  };
  const persona = {
    memoryDir: path.join(ctx.dataDirectory, 'memory'),
    blobs: {
      put: () => {
        throw new Error('Persona attachments not configured');
      },
      get: () => null,
      list: () => [],
    },
    attach() {},
    systemSegments: async () => {
      builtProfile = pending ?? current;
      return segments(builtProfile).map((s) => ({ title: s.label, text: s.text }));
    },
    declareSessions: () => [
      {
        id: 'everyday',
        label: '日常互动',
        persistent: true,
        receivesEvents: true,
        eventDelivery: 'user',
        rounds: () => ({ soft: 6, hard: 10 }),
        tools: () => tools,
      },
    ],
    onIdle: () => {
      const turn = active;
      if (!turn) return;
      active = null;
      turn.resolve({
        text: turn.reply,
        transcript: turn.text,
        reply: turn.reply,
        mode: turn.mode,
        revision: current.revision,
        errorCode: turn.reply ? null : 'unavailable',
      });
    },
  };
  const client = {
    respond: async (request, options = {}) => {
      const turn = active;
      if (!turn || turn.task.signal.aborted || options.signal?.aborted)
        throw new DOMException('Canceled', 'AbortError');
      if (turn.mode === 'demo') {
        const chinese = current.data.replyLanguage === 'zh-CN';
        const time = new Intl.DateTimeFormat(chinese ? 'zh-CN' : 'en', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }).format(new Date());
        const response = /时间|几点|time/i.test(turn.text)
          ? chinese
            ? '离线脚本演示：现在是 ' + time + '。'
            : 'Offline scripted demo: the time is ' + time + '.'
          : chinese
            ? '离线脚本演示：' + current.data.userName + '，已收到你的消息。'
            : 'Offline scripted demo: message received, ' + current.data.userName + '.';
        return generation('script-' + crypto.randomUUID(), 'pet_say', { text: response });
      }
      const origins = (options.context ?? []).flatMap((entry) => {
        const origin = entry.context?.origin;
        return entry.item?.type === 'reasoning' && entry.item.id && origin
          ? [
              {
                id: entry.item.id,
                origin: {
                  instance: origin.instance,
                  module: origin.module,
                  model: origin.model,
                  compatibilityDomain: origin.compatibilityDomain,
                },
              },
            ]
          : [];
      });
      const used = await ctx.host.capabilities.invoke(turn.task, 'llm.responses@1', 'respond', {
        request: json(request),
        ...(origins.length ? { origins: json(origins) } : {}),
      });
      const value = used.ok ? object(used.value) : null;
      if (!value || value.errorCode || !object(value.response) || !Array.isArray(value.attempts))
        throw new Error(used.ok ? String(value?.errorCode ?? 'network') : used.error.code);
      return value;
    },
  };
  const createCore = () =>
    new Core(
      {
        config: cfg,
        secret: () => '',
        rootDir: ctx.dataDirectory,
        memoryDir: persona.memoryDir,
        dataDir: path.join(ctx.dataDirectory, 'data'),
      },
      { persona, worlds: [world], llm: client },
    );
  core = createCore();
  await core.start();
  const stop = () =>
    (stopping ??= (async () => {
      closed = true;
      if (active) {
        active.resolve({ text: active.reply, mode: active.mode, errorCode: 'cancelled' });
        active = null;
      }
      const failed = await core.stop();
      unregister();
      if (failed.length) throw new Error('Agent resource cleanup incomplete');
    })());
  ctx.effect(() => stop);
  ctx.provide('conversation', {
    state: async () => state(),
    importLegacy: async (_task, input) => {
      const rows = object(input)?.messages;
      if (!Array.isArray(rows) || rows.length > 20) return { errorCode: 'invalid-input' };
      const known = new Set(
        core.store
          .range({ source: 'pet.desktop' })
          .map((e) => e.meta?.legacyId)
          .filter(Boolean),
      );
      for (const row of rows) {
        if (
          !object(row) ||
          typeof row.id !== 'string' ||
          !['user', 'assistant'].includes(row.role) ||
          typeof row.text !== 'string' ||
          row.text.length > 4000 ||
          !Number.isSafeInteger(row.at)
        )
          return { errorCode: 'invalid-input' };
        if (known.has(row.id)) continue;
        await worldHost.pushEvent(
          {
            type: row.role === 'user' ? 'pet.message' : 'pet.speech',
            source: 'pet.desktop',
            origin: row.role === 'user' ? 'external' : 'internal',
            ts: new Date(row.at).toISOString(),
            text: row.text,
            meta: { legacyId: row.id, mode: row.mode, via: 'console' },
          },
          { trigger: 'piggyback' },
        );
        known.add(row.id);
      }
      return { cursor: core.store.latestCursor(), errorCode: null };
    },
    clear: async () => {
      if (active) return { errorCode: 'not-ready' };
      const failure = await core.stop();
      if (failure.length) return { errorCode: 'unavailable' };
      for (const name of ['data', 'memory']) {
        const target = path.resolve(ctx.dataDirectory, name);
        if (path.dirname(target) !== path.resolve(ctx.dataDirectory))
          throw new Error('Invalid data target');
        await fs.rm(target, { recursive: true, force: true });
      }
      core = createCore();
      await core.start();
      promptState = 'applied';
      return { cursor: 0, errorCode: null };
    },

    run: async (_task, input) => {
      const request = object(input);
      if (!request || !['pause', 'resume'].includes(request.action))
        return { errorCode: 'invalid-input' };
      core.bus.setPaused(request.action === 'pause');
      return state();
    },
    reload: async (task) => {
      await applyProfile(await readProfile(task));
      return state();
    },
    interact: async (_task, input) => {
      const body = object(input);
      if (
        !body ||
        typeof body.kind !== 'string' ||
        !['poke', 'pat', 'drag', 'blush', 'happy', 'application', 'guide', 'update'].includes(
          body.kind,
        )
      )
        return { errorCode: 'invalid-input' };
      const labels = {
        poke: '你戳了桌宠一下',
        pat: '你摸了摸桌宠',
        drag: '你移动了桌宠',
        blush: '桌宠脸红了',
        happy: '桌宠露出笑容',
      };
      const text =
        labels[body.kind] ?? (typeof body.text === 'string' ? body.text : '应用状态已更新');
      const event = await archive(
        ['application', 'guide', 'update'].includes(body.kind) ? 'application' : 'interaction',
        text,
        { kind: body.kind },
      );
      return { cursor: event.cursor };
    },
    history: async (_task, input) => {
      const body = object(input) ?? {};
      const limit = Number.isSafeInteger(body.limit) ? Math.max(1, Math.min(200, body.limit)) : 200;
      const latest = core.store.latestCursor();
      const delta = Number.isSafeInteger(body.after) && body.after >= 0;
      const scanned = delta ? Math.min(latest, body.after + limit) : latest;
      const events = core.store.range({
        source: 'pet.desktop',
        ...(delta
          ? { fromCursor: body.after + 1, toCursor: scanned }
          : {
              ...(Number.isSafeInteger(body.before) && body.before > 0
                ? { toCursor: body.before - 1 }
                : {}),
              limit,
            }),
      });
      const first = events[0]?.cursor ?? null;
      const more =
        first !== null &&
        core.store.range({ source: 'pet.desktop', toCursor: first - 1, limit: 1 }).length > 0;
      return {
        cursor: scanned,
        before: first,
        more,
        items: events.map((e) => ({
          id: 'event-' + e.cursor,
          cursor: e.cursor,
          at: Date.parse(e.ts),
          kind:
            e.type === 'pet.message'
              ? 'user'
              : e.type === 'pet.speech'
                ? 'pet'
                : e.type === 'pet.interaction'
                  ? 'interaction'
                  : 'application',
          text: e.text,
          ...(e.meta?.mode ? { mode: e.meta.mode } : {}),
          ...(e.meta?.via ? { via: e.meta.via } : {}),
          ...(e.meta?.kind && ['poke', 'pat', 'drag', 'blush', 'happy'].includes(e.meta.kind)
            ? { reaction: e.meta.kind }
            : {}),
        })),
      };
    },
    turn: async (task, input) => {
      const body = object(input);
      if (closed || active) return { errorCode: 'not-ready' };
      if (
        !body ||
        typeof body.text !== 'string' ||
        !body.text.trim() ||
        [...body.text].length > 4000 ||
        !['demo', 'deepseek'].includes(body.mode)
      )
        return { errorCode: 'invalid-input' };
      if (body.mode === 'deepseek') {
        const described = await ctx.host.capabilities.invoke(
          task,
          'llm.responses@1',
          'describe',
          null,
        );
        const model = described.ok ? object(described.value)?.model : null;
        if (typeof model !== 'string')
          return { errorCode: described.ok ? 'not-ready' : described.error.code };
        cfg.providers.desktop.spec.model = model;
        const baseUrl = described.ok ? object(described.value)?.baseUrl : null;
        if (typeof baseUrl === 'string') cfg.providers.desktop.baseUrl = baseUrl;
      }
      await applyProfile(await readProfile(task));
      if (promptState === 'error') return { errorCode: 'unavailable' };
      if (task.signal.aborted) return { errorCode: 'cancelled' };
      const opened = await ctx.host.media.openOutput(task);
      if (!opened.ok) return { errorCode: opened.error.code };
      let resolve;
      const finished = new Promise((done) => {
        resolve = done;
      });
      const turn = {
        task,
        text: body.text,
        mode: body.mode,
        via: body.via ?? 'console',
        reply: '',
        writer: opened.value,
        resolve,
      };
      active = turn;
      const cancel = () => {
        if (active === turn) {
          active = null;
          core.loop.interruptCurrentRound();
        }
        resolve({ text: turn.reply, mode: turn.mode, errorCode: 'cancelled' });
      };
      task.signal.addEventListener('abort', cancel, { once: true });
      try {
        await worldHost.pushEvent(
          {
            type: 'pet.message',
            source: 'pet.desktop',
            ts: new Date().toISOString(),
            text: body.text,
            meta: {
              via: ['voice', 'bubble'].includes(body.via) ? body.via : 'console',
              mode: body.mode,
            },
          },
          { trigger: 'flush' },
        );
        const result = await finished;
        if (!task.signal.aborted) await opened.value.end();
        return result;
      } finally {
        task.signal.removeEventListener('abort', cancel);
        opened.value.cancel();
        if (active === turn) active = null;
      }
    },
  });
}
