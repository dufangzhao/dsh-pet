import { afterEach, expect, it, vi } from 'vitest';
import {
  makeError,
  type PetAppearanceRequest,
  type PetPresentationBridge,
  type PetPresentationSnapshot,
  type PetPresentationTheme,
  type Result,
} from '@pet/contracts';
const harness = vi.hoisted(() => ({
  effects: [] as (() => (() => void) | void)[],
  states: [] as unknown[],
}));
vi.mock('react', () => ({
  useState: <T>(value: T) => {
    const index = harness.states.length;
    harness.states.push(value);
    return [
      value,
      (next: T) => {
        harness.states[index] = next;
      },
    ];
  },
  useEffect: (effect: () => (() => void) | void) => {
    harness.effects.push(effect);
  },
}));
import {
  defaultStoredTheme,
  fallbackPalette,
  readThemeState,
  writeThemeState,
  type StoredTheme,
} from './theme.js';
import { usePresentationTheme } from './use-presentation-theme.js';

const cleanups: (() => void)[] = [];
const seed: StoredTheme = {
  ...defaultStoredTheme(),
  mode: 'light',
  selectedId: 'custom-kept',
  custom: [
    {
      id: 'custom-kept',
      name: 'Personal palette',
      note: 'Keep both variants',
      custom: true,
      palettes: {
        light: { ...fallbackPalette('light'), accent: '#214365', 'bubble-bg': '#fefdfc' },
        dark: { ...fallbackPalette('dark'), accent: '#db4321', 'bubble-bg': '#102030' },
      },
    },
  ],
};
function setup(initial = seed) {
  const storage = new Map([['pet.console.theme', JSON.stringify(initial)]]);
  const setItem = vi.fn((key: string, value: string) => {
    storage.set(key, value);
  });
  const events = new Set<() => void>();
  const media = {
    matches: false,
    addEventListener: vi.fn((_name: string, callback: () => void) => {
      events.add(callback);
    }),
    removeEventListener: vi.fn((_name: string, callback: () => void) => {
      events.delete(callback);
    }),
  };
  const attributes = new Map<string, string>();
  const root = {
    setAttribute: (name: string, value: string) => {
      attributes.set(name, value);
    },
    style: { setProperty: vi.fn(), colorScheme: '' },
  };
  let request = (_request: PetAppearanceRequest) => {};
  const offRequest = vi.fn();
  const publishTheme = vi.fn(
    async (theme: PetPresentationTheme): Promise<Result<PetPresentationSnapshot>> => ({
      ok: true,
      value: { version: 1, theme },
    }),
  );
  const completeAppearance = vi.fn(async (): Promise<Result<null>> => ({ ok: true, value: null }));
  const bridge: PetPresentationBridge = {
    version: 1,
    getSnapshot: async () => ({ ok: true, value: { version: 1, theme: null } }),
    publishTheme,
    setAppearance: async () => ({ ok: false, error: makeError('unavailable', false) }),
    onChanged: () => () => {},
    onAppearanceRequested: (listener) => {
      request = listener;
      return offRequest;
    },
    completeAppearance,
  };
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem });
  vi.stubGlobal('document', { documentElement: root });
  vi.stubGlobal('window', { petPresentation: bridge, matchMedia: () => media });
  usePresentationTheme();
  for (const effect of harness.effects.splice(0)) {
    const off = effect();
    if (off) cleanups.push(off);
  }
  return {
    storage,
    setItem,
    media,
    events,
    root,
    attributes,
    publishTheme,
    completeAppearance,
    request: (value: PetAppearanceRequest) => request(value),
    offRequest,
  };
}
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  harness.effects.length = 0;
  harness.states.length = 0;
  vi.unstubAllGlobals();
});
it('changes only the stored mode, preserving custom scheme and both palettes before publishing and acknowledging', async () => {
  const state = setup();
  await flush();
  expect(state.setItem).not.toHaveBeenCalled();
  state.request({ id: 'change-1', appearance: 'dark' });
  await flush();
  expect(readThemeState()).toEqual({ ...seed, mode: 'dark' });
  expect([...state.storage.keys()]).toEqual(['pet.console.theme']);
  expect(state.setItem).toHaveBeenCalledOnce();
  expect(state.attributes.get('data-theme')).toBe('dark');
  expect(state.root.style.colorScheme).toBe('dark');
  expect(state.publishTheme).toHaveBeenCalledTimes(2);
  expect(state.publishTheme.mock.lastCall?.[0]).toMatchObject({
    appearance: 'dark',
    colors: { primary: '#db4321', surface: '#102030' },
  });
  expect(state.completeAppearance).toHaveBeenCalledExactlyOnceWith({
    id: 'change-1',
    applied: true,
  });
  expect(harness.states[0]).toBeNull();
});
it('waits for the actual publish receipt before sending the exact request acknowledgment', async () => {
  const state = setup();
  await flush();
  let finish = (_result: Result<PetPresentationSnapshot>) => {};
  const publishing = new Promise<Result<PetPresentationSnapshot>>((resolve) => {
    finish = resolve;
  });
  state.publishTheme.mockReturnValueOnce(publishing);
  state.request({ id: 'change-2', appearance: 'dark' });
  await flush();
  expect(state.completeAppearance).not.toHaveBeenCalled();
  const candidate = state.publishTheme.mock.lastCall?.[0];
  if (!candidate) throw new Error('Expected published theme');
  finish({ ok: true, value: { version: 1, theme: candidate } });
  await flush();
  expect(state.completeAppearance).toHaveBeenCalledExactlyOnceWith({
    id: 'change-2',
    applied: true,
  });
});
it.each(['throw', 'discard'] as const)(
  'does not claim saved or applied when storage writes %s',
  async (failure) => {
    const state = setup();
    await flush();
    state.setItem.mockImplementation(() => {
      if (failure === 'throw') throw new Error('PRIVATE_STORAGE');
    });
    state.request({ id: 'change-3', appearance: 'dark' });
    await flush();
    expect(readThemeState()).toEqual(seed);
    expect(state.publishTheme).toHaveBeenCalledOnce();
    expect(state.completeAppearance).toHaveBeenCalledExactlyOnceWith({
      id: 'change-3',
      applied: false,
    });
    expect(harness.states[0]).toBe('配色未能保存到本机');
    expect(String(harness.states[0])).not.toContain('PRIVATE_STORAGE');
  },
);
it.each(['failed', 'wrong-snapshot'] as const)(
  'sends a negative receipt for a %s publication',
  async (failure) => {
    const state = setup();
    await flush();
    state.publishTheme.mockImplementationOnce(async (theme) =>
      failure === 'failed'
        ? { ok: false, error: makeError('unavailable', false) }
        : { ok: true, value: { version: 1, theme: { ...theme, appearance: 'light' } } },
    );
    state.request({ id: 'change-4', appearance: 'dark' });
    await flush();
    expect(state.completeAppearance).toHaveBeenCalledExactlyOnceWith({
      id: 'change-4',
      applied: false,
    });
    expect(harness.states[0]).toBe('配色已保存，桌宠同步失败');
  },
);
it('projects ordinary owner edits and system appearance changes without creating another saved record', async () => {
  const state = setup({ ...seed, mode: 'system' });
  await flush();
  state.media.matches = true;
  for (const callback of state.events) callback();
  await flush();
  expect(state.publishTheme.mock.lastCall?.[0].appearance).toBe('dark');
  expect(state.setItem).not.toHaveBeenCalled();
  writeThemeState({ ...seed, mode: 'dark' });
  await flush();
  expect(state.publishTheme.mock.lastCall?.[0].appearance).toBe('dark');
  expect(state.setItem).toHaveBeenCalledOnce();
  expect(state.completeAppearance).not.toHaveBeenCalled();
});
it('disposes request, theme and media subscriptions and drops a late acknowledgment after unmount', async () => {
  const state = setup();
  await flush();
  let finish = (_result: Result<PetPresentationSnapshot>) => {};
  state.publishTheme.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  state.request({ id: 'change-5', appearance: 'dark' });
  const candidate = state.publishTheme.mock.lastCall?.[0];
  if (!candidate) throw new Error('Expected published theme');
  for (const cleanup of cleanups.splice(0)) cleanup();
  expect(state.offRequest).toHaveBeenCalledOnce();
  expect(state.media.removeEventListener).toHaveBeenCalledOnce();
  const calls = state.publishTheme.mock.calls.length;
  writeThemeState({ ...seed, mode: 'light' });
  expect(state.publishTheme).toHaveBeenCalledTimes(calls);
  finish({ ok: true, value: { version: 1, theme: candidate } });
  await flush();
  expect(state.completeAppearance).not.toHaveBeenCalled();
});
