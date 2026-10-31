import { respondCompatible, testModelConnection } from './responses.mjs';
import { definePlugin, type PluginTask } from '@pet/plugin-sdk';
import {
  MODEL_SERVICE_ENDPOINTS,
  MODEL_REASONING_EFFORTS,
  modelProviderId,
  type ModelReasoningEffort,
  type JsonValue,
  type JsonObject,
} from '@pet/contracts';
const object = (value: JsonValue) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : null;
export default definePlugin({
  activate(ctx) {
    for (const endpoint of MODEL_SERVICE_ENDPOINTS.filter((item) => item.available)) {
      const selected = async () => {
        const cfg = await ctx.host.config.get();
        if (!cfg.ok) return null;
        const models = object(cfg.value.data['models'] ?? null);
        const efforts = object(cfg.value.data['reasoningEfforts'] ?? null);
        return {
          model:
            endpoint.id === 'deepseek' && typeof cfg.value.data['model'] === 'string'
              ? cfg.value.data['model']
              : typeof models?.[endpoint.id] === 'string'
                ? (models[endpoint.id] as string)
                : endpoint.defaultModel,
          reasoningEffort: (efforts?.[endpoint.id] ?? 'default') as ModelReasoningEffort,
        };
      };
      const request = async (
        task: PluginTask,
        input: JsonValue,
        diagnostic: boolean,
      ): Promise<JsonValue> => {
        const value = object(input);
        const origins = value?.['origins'];
        if (
          origins !== undefined &&
          (!Array.isArray(origins) ||
            !origins.every((entry) => {
              const row = object(entry);
              const origin = object(row?.['origin'] ?? null);
              return (
                typeof row?.['id'] === 'string' &&
                !!origin &&
                ['instance', 'module', 'model', 'compatibilityDomain'].every(
                  (key) => typeof origin[key] === 'string',
                )
              );
            }))
        )
          return { errorCode: 'invalid-input' };
        const config = await selected();
        const body = object(value?.['request'] ?? null);
        if ((!diagnostic && !body) || !config || !ctx.host.credentials)
          return { errorCode: 'not-ready' };
        const used = await ctx.host.credentials.withSecret(
          task,
          endpoint.secretKey,
          async (secret, signal) => {
            const started = performance.now();
            try {
              let selectedModel = config.model;
              if (diagnostic && endpoint.auth === 'browser' && value?.['chooseModel'] === true) {
                const listed = await fetch(endpoint.baseUrl + '/models', {
                  headers: { authorization: 'Bearer ' + secret },
                  redirect: 'error',
                  signal,
                });
                if (!listed.ok)
                  throw Object.assign(new Error('Model list failed'), { status: listed.status });
                const rows = object((await listed.json()) as JsonValue)?.['models'];
                const models = Array.isArray(rows)
                  ? rows
                      .slice(0, 2000)
                      .map(object)
                      .filter(
                        (row) =>
                          row?.['visibility'] === 'list' &&
                          typeof row['slug'] === 'string' &&
                          row['slug'].length > 0 &&
                          row['slug'].length <= 128,
                      )
                      .map((row) => row!['slug'] as string)
                  : [];
                if (!models.length)
                  return {
                    ok: false,
                    elapsedMs: Math.round(performance.now() - started),
                    reason: 'ChatGPT暂时没有可用模型',
                  };
                selectedModel = models.includes(config.model) ? config.model : models[0]!;
              }
              const requestEndpoint = { ...endpoint, reasoningEffort: config.reasoningEffort };
              if (diagnostic)
                return await testModelConnection(requestEndpoint, selectedModel, secret, signal);
              return await respondCompatible(
                secret,
                selectedModel,
                { ...body, model: selectedModel } as JsonObject,
                signal,
                requestEndpoint,
                false,
                value?.['origins'],
              );
            } catch (error) {
              const status =
                error !== null && typeof error === 'object' && 'status' in error
                  ? error.status
                  : undefined;
              const errorCode = signal.aborted
                ? 'cancelled'
                : error !== null &&
                    typeof error === 'object' &&
                    'code' in error &&
                    error.code === 'invalid-input'
                  ? 'invalid-input'
                  : status === 401 || status === 403
                    ? 'auth-failed'
                    : status === 429
                      ? 'rate-limited'
                      : status === 408 || status === 504
                        ? 'timeout'
                        : 'network';
              return diagnostic
                ? {
                    ok: false,
                    elapsedMs: Math.round(performance.now() - started),
                    reason: errorCode,
                  }
                : { errorCode };
            }
          },
        );
        return used.ok ? used.value : { errorCode: used.error.code };
      };
      ctx.provide(modelProviderId(endpoint.id), {
        describe: async () => ({
          ...(await selected()),
          baseUrl: endpoint.baseUrl,
          label: endpoint.label,
          service: endpoint.id,
        }),
        respond: (task, input) => request(task, input, false),
        test: (task, input) => request(task, input, true),
      });
    }
    ctx.provide('deepseek', {
      respond: async (task, input) => {
        const body = object(input);
        if (!body || typeof body['text'] !== 'string' || [...body['text']].length > 4000)
          return { text: '', mode: 'deepseek', errorCode: 'invalid-input' };
        if (!ctx.host.credentials) return { text: '', mode: 'deepseek', errorCode: 'not-ready' };
        const config = await ctx.host.config.get();
        if (!config.ok || typeof config.value.data['model'] !== 'string')
          return { text: '', mode: 'deepseek', errorCode: 'not-ready' };
        const efforts = object(config.value.data['reasoningEfforts'] ?? null);
        const effort = efforts?.['deepseek'] ?? 'default';
        if (!MODEL_REASONING_EFFORTS.includes(effort as ModelReasoningEffort))
          return { text: '', mode: 'deepseek', errorCode: 'invalid-input' };
        const messages: Array<{ role: string; content: string }> = [
          { role: 'system', content: '你是桌宠中的助手。清楚、简洁地回答用户。' },
        ];
        if (Array.isArray(body['context']))
          for (const item of body['context'].slice(-6)) {
            const row = object(item);
            if (
              !row ||
              !['user', 'assistant'].includes(String(row['role'])) ||
              typeof row['content'] !== 'string' ||
              row['content'].length > 4000
            )
              return { text: '', mode: 'deepseek', errorCode: 'invalid-input' };
            messages.push({ role: row['role'] as string, content: row['content'] });
          }
        messages.push({ role: 'user', content: body['text'] });
        const output = await ctx.host.media.openOutput(task);
        if (!output.ok) return { text: '', mode: 'deepseek', errorCode: output.error.code };
        let text = '';
        try {
          const used = await ctx.host.credentials.withSecret(
            task,
            'api-key',
            async (secret, signal) => {
              try {
                const response = await fetch('https://api.deepseek.com/chat/completions', {
                  method: 'POST',
                  redirect: 'error',
                  signal,
                  headers: {
                    'content-type': 'application/json',
                    authorization: 'Bearer ' + secret,
                  },
                  body: JSON.stringify({
                    model: config.value.data['model'],
                    stream: true,
                    max_tokens: 512,
                    ...(effort !== 'default' ? { reasoning_effort: effort } : {}),
                    messages,
                  }),
                });
                if (response.status === 401 || response.status === 403) {
                  await response.body?.cancel();
                  return { errorCode: 'auth-failed' };
                }
                if (!response.ok || !response.body) {
                  await response.body?.cancel();
                  return { errorCode: 'unavailable' };
                }
                const reader = response.body.getReader(),
                  decoder = new TextDecoder('utf-8', { fatal: true });
                let buffer = '',
                  finished = false;
                try {
                  while (!finished) {
                    const chunk = await reader.read();
                    if (chunk.done) break;
                    buffer += decoder.decode(chunk.value, { stream: true });
                    if (buffer.length > 65536) return { errorCode: 'quota-exceeded' };
                    let index: number;
                    while ((index = buffer.indexOf('\n')) >= 0) {
                      const line = buffer.slice(0, index).trim();
                      buffer = buffer.slice(index + 1);
                      if (!line.startsWith('data:')) continue;
                      const data = line.slice(5).trim();
                      if (data === '[DONE]') {
                        finished = true;
                        break;
                      }
                      const parsed = JSON.parse(data),
                        delta: unknown = parsed?.choices?.[0]?.delta?.content;
                      if (delta === undefined || delta === null) continue;
                      if (typeof delta !== 'string' || [...(text + delta)].length > 4000)
                        return { errorCode: 'quota-exceeded' };
                      text += delta;
                      const sent = await output.value.write(new TextEncoder().encode(delta));
                      if (!sent.ok) return { errorCode: sent.error.code };
                    }
                  }
                  return finished && text ? { errorCode: null } : { errorCode: 'network' };
                } finally {
                  await reader.cancel();
                }
              } catch {
                return { errorCode: signal.aborted ? 'cancelled' : 'network' };
              }
            },
          );
          if (!used.ok) return { text: '', mode: 'deepseek', errorCode: used.error.code };
          const result = object(used.value);
          if (typeof result?.['errorCode'] === 'string')
            return { text: '', mode: 'deepseek', errorCode: result['errorCode'] };
          const ended = await output.value.end();
          return {
            text: ended.ok ? text : '',
            mode: 'deepseek',
            errorCode: ended.ok ? null : ended.error.code,
          };
        } finally {
          output.value.cancel();
        }
      },
    });
  },
});
