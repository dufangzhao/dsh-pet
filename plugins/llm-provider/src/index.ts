import { respondCompatible } from './responses.mjs';
import { definePlugin } from '@pet/plugin-sdk';
import type { JsonValue } from '@pet/contracts';
const object = (value: JsonValue) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : null;
export default definePlugin({
  activate(ctx) {
    ctx.provide('responses', {
      describe: async () => {
        const cfg = await ctx.host.config.get();
        return cfg.ok ? { model: cfg.value.data['model'] ?? null } : { errorCode: cfg.error.code };
      },
      respond: async (task, input) => {
        const body = object(input);
        const request = object(body?.['request'] ?? null);
        if (!request) return { errorCode: 'invalid-input' };
        const config = await ctx.host.config.get();
        if (!config.ok || typeof config.value.data['model'] !== 'string')
          return { errorCode: config.ok ? 'not-ready' : config.error.code };
        if (!ctx.host.credentials) return { errorCode: 'credential-unavailable' };
        const used = await ctx.host.credentials.withSecret(
          task,
          'api-key',
          async (secret, signal) => {
            try {
              return await respondCompatible(
                secret,
                config.value.data['model'] as string,
                request,
                signal,
              );
            } catch (error) {
              const status =
                error !== null && typeof error === 'object' && 'status' in error
                  ? error.status
                  : undefined;
              return {
                errorCode: signal.aborted
                  ? 'cancelled'
                  : status === 401 || status === 403
                    ? 'auth-failed'
                    : 'network',
              };
            }
          },
        );
        return used.ok ? used.value : { errorCode: used.error.code };
      },
    });
    ctx.provide('deepseek', {
      respond: async (task, input) => {
        const body = object(input);
        if (!body || typeof body['text'] !== 'string' || [...body['text']].length > 4000)
          return { text: '', mode: 'deepseek', errorCode: 'invalid-input' };
        if (!ctx.host.credentials) return { text: '', mode: 'deepseek', errorCode: 'not-ready' };
        const config = await ctx.host.config.get();
        if (!config.ok || typeof config.value.data['model'] !== 'string')
          return { text: '', mode: 'deepseek', errorCode: 'not-ready' };
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
