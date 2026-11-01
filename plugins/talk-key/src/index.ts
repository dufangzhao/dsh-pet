import { definePlugin } from '@pet/plugin-sdk';
import { TALK_KEYS } from '@pet/contracts';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export default definePlugin({
  activate(ctx) {
    ctx.provide('keyboard', {
      listen: async (task, input) => {
        if (process.platform !== 'win32') return { errorCode: 'not-ready' };
        if (
          !input ||
          typeof input !== 'object' ||
          Array.isArray(input) ||
          typeof input['code'] !== 'string'
        )
          return { errorCode: 'invalid-input' };
        const key = Object.hasOwn(TALK_KEYS, input['code']) ? TALK_KEYS[input['code']] : undefined;
        if (!key) return { errorCode: 'invalid-input' };
        const output = await ctx.host.media.openOutput(task);
        if (!output.ok) return { errorCode: output.error.code };
        let library: { unload(): void } | undefined;
        try {
          const koffi = require('koffi') as {
            load(name: string): {
              func(declaration: string): (key: number) => number;
              unload(): void;
            };
          };
          const native = koffi.load('user32.dll');
          library = native;
          const state = native.func('short __stdcall GetAsyncKeyState(int vKey)');
          let down = (state(key.virtualKey) & 0x8000) !== 0;
          // A key already held on activation is ignored until released.
          let armed = !down;
          await new Promise<void>((resolve, reject) => {
            let writing = Promise.resolve();
            const finish = () => {
              clearInterval(timer);
              task.signal.removeEventListener('abort', finish);
              void writing.then(resolve, reject);
            };
            const timer = setInterval(() => {
              const next = (state(key.virtualKey) & 0x8000) !== 0;
              if (next === down) return;
              down = next;
              if (!armed) {
                if (!next) armed = true;
                return;
              }
              const payload = new TextEncoder().encode(
                JSON.stringify({ kind: next ? 'down' : 'up', at: performance.now() }),
              );
              writing = writing.then(async () => {
                const result = await output.value.write(payload);
                if (!result.ok) throw new Error('key-output-ended');
              });
              void writing.catch(() => {
                clearInterval(timer);
                task.signal.removeEventListener('abort', finish);
                reject(new Error('key-output-ended'));
              });
            }, 10);
            task.signal.addEventListener('abort', finish, { once: true });
            if (task.signal.aborted) finish();
          });
          return { errorCode: null };
        } catch {
          return { errorCode: task.signal.aborted ? 'cancelled' : 'unavailable' };
        } finally {
          output.value.cancel();
          library?.unload();
        }
      },
    });
  },
});
