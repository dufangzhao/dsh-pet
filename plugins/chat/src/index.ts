import { definePlugin } from '@pet/plugin-sdk';
export default definePlugin({
  activate(ctx) {
    ctx.provide('demo', {
      respond: async (task, input) => {
        if (
          !input ||
          typeof input !== 'object' ||
          Array.isArray(input) ||
          typeof input['text'] !== 'string' ||
          [...input['text']].length > 4000
        )
          return { text: '', mode: 'demo', errorCode: 'invalid-input' };
        const text = input['text'].trim();
        const answer = /几点|时间/.test(text)
          ? '离线演示回复（脚本，不是 AI）：现在是' +
            new Date().toLocaleTimeString('zh-CN', { hour12: false }) +
            '。'
          : '离线演示回复（脚本，不是 AI）：已收到这条消息。你可以继续验证桌宠与本地识别；要获得模型生成的回答，请配置真实服务。';
        const opened = await ctx.host.media.openOutput(task);
        if (!opened.ok) return { text: '', mode: 'demo', errorCode: opened.error.code };
        try {
          const chars = [...answer];
          for (let i = 0; i < chars.length; i += 8) {
            const sent = await opened.value.write(
              new TextEncoder().encode(chars.slice(i, i + 8).join('')),
            );
            if (!sent.ok) return { text: '', mode: 'demo', errorCode: sent.error.code };
          }
          const ended = await opened.value.end();
          return {
            text: ended.ok ? answer : '',
            mode: 'demo',
            errorCode: ended.ok ? null : ended.error.code,
          };
        } finally {
          opened.value.cancel();
        }
      },
    });
  },
});
