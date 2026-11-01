import { definePlugin } from '@pet/plugin-sdk';
import type { JsonValue } from '@pet/contracts';
const object = (value: JsonValue) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : null;
export default definePlugin({
  activate(ctx) {
    ctx.contribute('page');
    ctx.provide('voice', {
      prepare: async (task, input) => {
        const body = object(input);
        if (!body || typeof body['model'] !== 'string') return { errorCode: 'invalid-input' };
        const result = await ctx.host.capabilities.invoke(task, 'speech.asr@1', 'prepare', {
          model: body['model'],
          cloudModel: body['cloudModel'] ?? 'whisper-1',
          cloudBaseUrl: body['cloudBaseUrl'] ?? 'https://api.openai.com/v1',
        });
        return result.ok ? result.value : { errorCode: result.error.code };
      },
      turn: async (task, input) => {
        const body = object(input);
        if (
          !body ||
          !['text', 'voice'].includes(String(body['kind'])) ||
          (body['mode'] !== 'demo' && body['mode'] !== 'deepseek')
        )
          return { transcript: '', reply: '', errorCode: 'invalid-input' };
        const mode = body['mode'];
        let transcript: string;
        if (body['kind'] === 'voice') {
          if (typeof body['model'] !== 'string')
            return { transcript: '', reply: '', errorCode: 'invalid-input' };
          const heard = await ctx.host.capabilities.invoke(task, 'speech.asr@1', 'transcribe', {
            model: body['model'],
            cloudModel: body['cloudModel'] ?? 'whisper-1',
            cloudBaseUrl: body['cloudBaseUrl'] ?? 'https://api.openai.com/v1',
          });
          if (!heard.ok) return { transcript: '', reply: '', errorCode: heard.error.code };
          const value = object(heard.value);
          if (!value || value['errorCode'] || typeof value['text'] !== 'string')
            return {
              transcript: '',
              reply: '',
              errorCode:
                typeof value?.['errorCode'] === 'string' ? value['errorCode'] : 'asr-failed',
            };
          transcript = value['text'].trim();
        } else {
          if (typeof body['text'] !== 'string' || [...body['text']].length > 4000)
            return { transcript: '', reply: '', errorCode: 'invalid-input' };
          transcript = body['text'].trim();
        }
        if (!transcript || body['autoSend'] === false)
          return { transcript, reply: '', mode, errorCode: null };
        const answered = await ctx.host.capabilities.invoke(task, 'agent.conversation@1', 'turn', {
          text: transcript,
          mode,
          via: body['kind'] === 'voice' ? 'voice' : 'console',
        });
        if (!answered.ok) return { transcript, reply: '', mode, errorCode: answered.error.code };
        const response = object(answered.value);
        return {
          transcript,
          reply: typeof response?.['text'] === 'string' ? response['text'] : '',
          mode,
          errorCode: response?.['errorCode'] ?? (response ? null : 'internal'),
        };
      },
    });
  },
});
