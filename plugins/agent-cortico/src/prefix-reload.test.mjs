import { expect, it, vi } from 'vitest';
import { APPLICATION_DEFAULTS } from '@pet/contracts';
const control = vi.hoisted(() => ({ fail: false, calls: 0 }));
vi.mock('tsx/esm/api', () => ({ register: () => () => {} }));
vi.mock('cortico/core/config.ts', () => ({ CORE_DEFAULTS: {} }));
vi.mock('cortico/core/core.ts', () => ({
  Core: class {
    constructor(_loaded, deps) {
      this.bus = { isPaused: () => false, setPaused: () => {} };
      this.persona = deps.persona;
      this.world = deps.worlds[0];
      this.store = { latestCursor: () => 0, range: () => [] };
      this.loop = {
        reloadSystemPrefix: async () => {
          control.calls++;
          await this.persona.systemSegments();
          if (control.fail) throw new Error('Fixture session rename failed');
        },
      };
    }
    async start() {
      await this.persona.systemSegments();
      await this.world.start({});
    }
    async stop() {
      return [];
    }
  },
}));
import { activateAgent } from './agent.mjs';
it('keeps saved and acknowledged revisions distinct on a failed reload and retries the same revision', async () => {
  let profile = { revision: 1, data: { ...APPLICATION_DEFAULTS } };
  let methods;
  let stop;
  await activateAgent({
    dataDirectory: 'fixture-data',
    effect: (create) => {
      stop = create();
    },
    provide: (_id, implementation) => {
      methods = implementation;
    },
    host: { capabilities: { invoke: async () => ({ ok: true, value: profile }) } },
  });
  const task = { taskId: 'fixture-task', signal: new AbortController().signal };
  expect((await methods.reload(task, null)).revision).toBe(1);
  profile = {
    revision: 2,
    data: { ...APPLICATION_DEFAULTS, personaPrompt: 'Updated entire prompt' },
  };
  control.fail = true;
  const failed = await methods.reload(task, null);
  expect(failed.promptState).toBe('error');
  expect(failed.revision).toBe(1);
  expect(failed.segments.some((s) => s.text === 'Updated entire prompt')).toBe(false);
  expect(
    (await methods.turn(task, { text: 'Must not use an unacknowledged prefix', mode: 'demo' }))
      .errorCode,
  ).toBe('unavailable');
  control.fail = false;
  const applied = await methods.reload(task, null);
  expect(applied.promptState).toBe('applied');
  expect(applied.revision).toBe(2);
  expect(applied.segments.some((s) => s.text === 'Updated entire prompt')).toBe(true);
  expect(control.calls).toBe(4);
  await stop();
});
