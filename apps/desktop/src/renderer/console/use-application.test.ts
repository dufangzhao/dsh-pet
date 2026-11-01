import { afterEach, expect, it, vi } from 'vitest';
import {
  APPLICATION_DEFAULTS,
  makeError,
  type ApplicationBridge,
  type ApplicationPreferences,
  type ApplicationSnapshot,
  type Result,
} from '@pet/contracts';
const harness = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as {
    value: unknown;
    deps: readonly unknown[] | undefined;
    cleanup: (() => void) | undefined;
  }[],
  effects: [] as (() => void)[],
}));
vi.mock('react', () => {
  const slot = () => {
    const index = harness.cursor++;
    let entry = harness.slots[index];
    if (!entry) {
      entry = { value: undefined, deps: undefined, cleanup: undefined };
      harness.slots[index] = entry;
    }
    return entry;
  };
  const same = (a: readonly unknown[] | undefined, b: readonly unknown[]) =>
    a !== undefined &&
    a.length === b.length &&
    a.every((value, index) => Object.is(value, b[index]));
  return {
    useState: <T>(initial: T | (() => T)) => {
      const entry = slot();
      if (entry.value === undefined)
        entry.value = typeof initial === 'function' ? (initial as () => T)() : initial;
      return [
        entry.value as T,
        (update: T | ((previous: T) => T)) => {
          entry.value =
            typeof update === 'function'
              ? (update as (previous: T) => T)(entry.value as T)
              : update;
        },
      ];
    },
    useRef: <T>(initial: T) => {
      const entry = slot();
      if (entry.value === undefined) entry.value = { current: initial };
      return entry.value as { current: T };
    },
    useCallback: <T>(callback: T, deps: readonly unknown[]) => {
      const entry = slot();
      if (!same(entry.deps, deps)) {
        entry.value = callback;
        entry.deps = deps;
      }
      return entry.value as T;
    },
    useEffect: (effect: () => (() => void) | void, deps: readonly unknown[]) => {
      const entry = slot();
      if (!same(entry.deps, deps)) {
        entry.deps = deps;
        harness.effects.push(() => {
          entry.cleanup?.();
          entry.cleanup = effect() || undefined;
        });
      }
    },
  };
});
import { useApplication, type ApplicationState } from './use-application.js';
function render(): ApplicationState {
  harness.cursor = 0;
  const state = useApplication();
  for (const effect of harness.effects.splice(0)) effect();
  return state;
}
async function settle(): Promise<ApplicationState> {
  await Promise.resolve();
  await Promise.resolve();
  return render();
}
afterEach(() => {
  for (const slot of harness.slots) slot.cleanup?.();
  harness.slots.length = 0;
  harness.effects.length = 0;
  harness.cursor = 0;
  vi.unstubAllGlobals();
});
function snapshot(
  revision: number,
  data: ApplicationPreferences = { ...APPLICATION_DEFAULTS },
): ApplicationSnapshot {
  return {
    version: 1,
    profile: {
      owner: { pluginId: 'pet.profile', instanceId: 'default', generation: 1 },
      revision,
      data,
    },
    pages: [],
    history: [],
    cursor: 0,
    prompt: { state: 'applied', appliedRevision: revision, segments: [] },
    dialog: null,
    agent: { owner: null, state: 'ready', label: 'fixture' },
    error: null,
  };
}
async function mount(): Promise<{
  state: ApplicationState;
  saveProfile: ReturnType<typeof vi.fn>;
  publish: (revision: number, patch?: Partial<ApplicationPreferences>) => void;
}> {
  let remote = snapshot(1),
    changed = () => {};
  const saveProfile = vi.fn(
    async (
      request: Parameters<ApplicationBridge['saveProfile']>[0],
    ): Promise<Result<ApplicationSnapshot>> => {
      if (request.expectedRevision !== remote.profile?.revision)
        return { ok: false, error: makeError('conflict', false) };
      remote = snapshot(
        request.expectedRevision + 1,
        Object.assign({}, APPLICATION_DEFAULTS, request.data),
      );
      return { ok: true, value: structuredClone(remote) };
    },
  );
  const api = {
    getSnapshot: async () => ({ ok: true, value: structuredClone(remote) }),
    onChanged: (callback: () => void) => {
      changed = callback;
      return () => {
        changed = () => {};
      };
    },
    saveProfile,
  } as unknown as ApplicationBridge;
  vi.stubGlobal('window', { petApplication: api });
  render();
  return {
    state: await settle(),
    saveProfile,
    publish: (revision, patch = {}) => {
      remote = snapshot(
        revision,
        Object.assign({}, remote.profile?.data ?? APPLICATION_DEFAULTS, patch),
      );
      changed();
    },
  };
}
it('keeps revision1 for a name draft after background revision2 and retains the rejected draft', async () => {
  const app = await mount();
  app.state.edit('petName', 'draft from revision1');
  render();
  app.publish(2, { petName: 'newer saved name' });
  let state = await settle();
  const result = await state.save({ petName: state.values?.petName ?? '' });
  state = render();
  expect(app.saveProfile).toHaveBeenLastCalledWith(
    expect.objectContaining({
      expectedRevision: 1,
      data: expect.objectContaining({ petName: 'draft from revision1' }),
    }),
  );
  expect(result.ok).toBe(false);
  expect(state.conflict).toBe(true);
  expect(state.values?.petName).toBe('draft from revision1');
  expect(state.edited.has('petName')).toBe(true);
});
it('explicit reload clears the draft baseline and immediate changes use the current revision', async () => {
  const app = await mount();
  app.state.edit('personaPrompt', 'old prompt draft');
  render();
  app.publish(2, { personaPrompt: 'new saved prompt' });
  let state = await settle();
  state.refresh();
  state = await settle();
  expect(state.edited.size).toBe(0);
  expect(state.values?.personaPrompt).toBe('new saved prompt');
  expect((await state.save({ visible: false })).ok).toBe(true);
  expect(app.saveProfile).toHaveBeenLastCalledWith(
    expect.objectContaining({ expectedRevision: 2 }),
  );
});
it('a successful full draft save clears its baseline before later immediate changes', async () => {
  const app = await mount();
  app.state.edit('petName', 'saved name');
  let state = render();
  expect((await state.save({ petName: 'saved name' })).ok).toBe(true);
  state = render();
  expect(state.edited.size).toBe(0);
  app.publish(3, { userName: 'new remote user' });
  state = await settle();
  expect((await state.save({ alwaysOnTop: false })).ok).toBe(true);
  expect(app.saveProfile).toHaveBeenLastCalledWith(
    expect.objectContaining({
      expectedRevision: 3,
      data: expect.objectContaining({ userName: 'new remote user' }),
    }),
  );
});
it('remaining draft fields keep the acknowledged revision after a partial save', async () => {
  const app = await mount();
  app.state.edit('petName', 'new name');
  app.state.edit('personaPrompt', 'remaining prompt');
  let state = render();
  expect((await state.save({ petName: 'new name' })).ok).toBe(true);
  state = render();
  expect(state.edited.has('personaPrompt')).toBe(true);
  app.publish(3, { personaPrompt: 'remote prompt' });
  state = await settle();
  expect((await state.save({ personaPrompt: 'remaining prompt' })).ok).toBe(false);
  expect(app.saveProfile).toHaveBeenLastCalledWith(
    expect.objectContaining({ expectedRevision: 2 }),
  );
  expect(render().values?.personaPrompt).toBe('remaining prompt');
});
