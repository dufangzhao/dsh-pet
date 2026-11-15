import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DesktopCompanionState,
  DesktopSpeechBridge,
  DesktopSpeechState,
  Result,
  SpeechCatalog,
  SpeechTtsSettings,
  SpeechView,
} from '@pet/contracts';
import { SPEECH_PROTOCOL, SPEECH_TTS_PROVIDER, makeError } from '@pet/contracts';
import type { CompanionView } from '../../shared/use-companion.js';

// Drive the real hook with committed renders, dependency-aware effects and their own cleanup.
// This substitutes hook scheduling only; it is not DOM or native evidence.
const harness = vi.hoisted(() => ({
  slots: [] as {
    state?: unknown;
    ref?: { current: unknown };
    deps?: readonly unknown[];
    fn?: unknown;
    cleanup?: () => void;
  }[],
  cursor: 0,
  pending: [] as { slot: number; effect: () => (() => void) | void }[],
  mounted: false,
  dirty: false,
  view: null as unknown,
  sameDeps: (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined): boolean =>
    a !== undefined &&
    b !== undefined &&
    a.length === b.length &&
    a.every((item, index) => Object.is(item, b[index])),
}));

vi.mock('react', () => ({
  useState: <T>(initial: T) => {
    const slot = harness.cursor++;
    const entry = (harness.slots[slot] ??= {});
    if (!('state' in entry)) entry.state = initial;
    return [
      entry.state as T,
      (next: T | ((previous: T) => T)) => {
        if (!harness.mounted) return;
        const value =
          typeof next === 'function' ? (next as (previous: T) => T)(entry.state as T) : next;
        if (!Object.is(value, entry.state)) {
          entry.state = value;
          harness.dirty = true;
        }
      },
    ] as const;
  },
  useRef: <T>(initial: T) => {
    const entry = (harness.slots[harness.cursor++] ??= {});
    entry.ref ??= { current: initial };
    return entry.ref as { current: T };
  },
  useCallback: <T>(fn: T, deps: readonly unknown[]) => {
    const entry = (harness.slots[harness.cursor++] ??= {});
    if (!harness.sameDeps(entry.deps, deps)) {
      entry.deps = [...deps];
      entry.fn = fn;
    }
    return entry.fn as T;
  },
  useEffect: (effect: () => (() => void) | void, deps?: readonly unknown[]) => {
    const slot = harness.cursor++;
    const entry = (harness.slots[slot] ??= {});
    if (harness.sameDeps(entry.deps, deps)) return;
    if (deps === undefined) delete entry.deps;
    else entry.deps = [...deps];
    harness.pending.push({ slot, effect });
  },
}));

import { useSharedSpeech } from './use-shared-speech.js';

type Form = ReturnType<typeof useSharedSpeech>;
let companion: Pick<CompanionView, 'state'> = { state: null };
const releases: (() => void)[] = [];
const operations: Promise<unknown>[] = [];

function unmount(): void {
  harness.mounted = false;
  for (const entry of harness.slots) {
    entry.cleanup?.();
    delete entry.cleanup;
  }
  harness.pending.length = 0;
}

function commit(): Form {
  for (let pass = 0; pass < 25; pass++) {
    harness.cursor = 0;
    harness.dirty = false;
    harness.view = useSharedSpeech(companion as CompanionView);
    for (const { slot, effect } of harness.pending.splice(0)) {
      const entry = harness.slots[slot];
      if (!entry) throw new Error('Missing effect slot');
      entry.cleanup?.();
      const cleanup = effect();
      if (cleanup) entry.cleanup = cleanup;
      else delete entry.cleanup;
    }
    if (!harness.dirty) return harness.view as Form;
  }
  throw new Error('Hook did not settle its synchronous renders');
}

function render(connectionId: string | null): Form {
  companion = { state: companionState(connectionId) };
  harness.mounted = true;
  return commit();
}

function form(): Form {
  return harness.dirty ? commit() : (harness.view as Form);
}

async function flush(): Promise<void> {
  // Async bridge completions may set state and then start another await after a commit.
  for (let pass = 0; pass < 3; pass++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (harness.mounted && harness.dirty) commit();
  }
}

function gate<T>(fallback: T): { promise: Promise<T>; resolve(value: T): void } {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  releases.push(() => resolve(fallback));
  return { promise, resolve };
}

function track(work: Promise<void>): Promise<void> {
  operations.push(work);
  return work;
}

beforeEach(() => {
  harness.slots.length = 0;
  harness.cursor = 0;
  harness.pending.length = 0;
  harness.view = null;
  harness.mounted = false;
  harness.dirty = false;
  companion = { state: null };
});

afterEach(async () => {
  unmount();
  for (const release of releases.splice(0)) release();
  await Promise.allSettled(operations.splice(0));
  await flush();
  vi.unstubAllGlobals();
});

const companionState = (connectionId: string | null): DesktopCompanionState => ({
  version: 1,
  revision: 1,
  source: 'ready',
  baseUrl: 'https://synthetic-service.invalid',
  configRevision: 1,
  connectionId,
  phase: connectionId === null ? 'idle' : 'live',
  confirmedAt: null,
  snapshot: null,
  pending: [],
  error: null,
});

const settings = (baseUrl: string): SpeechTtsSettings => ({
  baseUrl,
  modelRef: 'xiaomi/mimo-v2.5-tts',
  authMode: 'gateway-key',
  protocol: SPEECH_PROTOCOL,
  voice: 'Mia',
});

const speechView = (baseUrl: string, revision = 1): SpeechView => ({
  version: 1,
  feature: {
    providerRef: SPEECH_TTS_PROVIDER,
    sourcePluginId: 'pet.shared-speech',
    instanceId: 'default',
    source: 'ready',
    configRevision: revision,
  },
  providers: [
    {
      providerRef: SPEECH_TTS_PROVIDER,
      sourcePluginId: 'pet.tts-magpie',
      instanceId: 'default',
      providerId: 'magpie',
      label: 'Synthetic Magpie TTS',
      synthetic: true,
      source: 'ready',
      configRevision: revision,
      settings: settings(baseUrl),
      bindingId: 'binding',
      credential: { available: true, writable: false, version: 'v1', source: 'memory' },
      readiness: 'configured',
      reason: null,
    },
  ],
});

const localState = (connectionId: string | null): DesktopSpeechState => ({
  version: 1,
  revision: 1,
  connectionId,
  appliedBinding: null,
  source: connectionId === null ? 'disabled' : 'ready',
  phase: 'idle',
  generating: false,
  playing: false,
  queued: 0,
  current: null,
  messageId: null,
  segmentCount: 0,
  completedSegments: 0,
  receivedFrames: 0,
  endedFrames: 0,
  outcome: 'pending',
  localCleanup: 'settled',
  remoteCleanup: 'settled',
  error: null,
  reason: null,
});

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const A = speechView('https://a.synthetic.invalid/v1');
const B = speechView('https://b.synthetic.invalid/v1');
const catalog: SpeechCatalog = {
  providerRef: SPEECH_TTS_PROVIDER,
  bindingId: 'binding',
  candidates: [],
};

function install(
  script: Partial<
    Pick<
      DesktopSpeechBridge,
      'getState' | 'readSpeech' | 'saveTtsProvider' | 'readTtsCatalog' | 'stop'
    >
  > = {},
) {
  const listeners = new Set<() => void>();
  const getState = vi.fn(script.getState ?? (async () => ok(localState('A'))));
  const readSpeech = vi.fn(
    script.readSpeech ?? (async ({ connectionId }) => ok(connectionId === 'A' ? A : B)),
  );
  const saveTtsProvider = vi.fn(
    script.saveTtsProvider ?? (async () => ok(speechView('https://saved.synthetic.invalid/v1', 2))),
  );
  const readTtsCatalog = vi.fn(script.readTtsCatalog ?? (async () => ok(catalog)));
  const stop = vi.fn(script.stop ?? (async ({ connectionId }) => ok(localState(connectionId))));
  const onChanged = vi.fn((listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  });
  const bridge: DesktopSpeechBridge = {
    version: 1,
    getState,
    readSpeech,
    saveTtsProvider,
    readTtsCatalog,
    stop,
    onChanged,
    playerReady: async () => ok(null),
    consume: async () => ok(null),
    reportPlayback: async () => ok(null),
    reportReleased: async () => ok(null),
    onAudio: () => () => {},
  };
  vi.stubGlobal('window', { petSharedSpeech: bridge });
  return {
    getState,
    readSpeech,
    saveTtsProvider,
    readTtsCatalog,
    stop,
    onChanged,
    listeners,
    changed: () => {
      for (const listener of listeners) listener();
    },
  };
}

describe('shared speech settings ownership', () => {
  it('configures the companion target while local speech remains default off', async () => {
    const bridge = install({ getState: async () => ok(localState(null)) });
    render('A');
    await flush();
    expect(bridge.readSpeech).toHaveBeenCalledExactlyOnceWith({ connectionId: 'A' });
    expect(form().draft?.baseUrl).toBe(A.providers[0]?.settings.baseUrl);
    form().edit({ modelRef: 'edited-model' });
    await track(form().save());
    expect(bridge.saveTtsProvider).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'A' }),
    );
  });

  it('preserves dirty CAS input across local progress without rerunning stable effects', async () => {
    const bridge = install();
    render('A');
    await flush();
    form().edit({ modelRef: 'dirty-model' });
    render('A');
    for (let count = 0; count < 3; count++) {
      bridge.changed();
      await flush();
    }
    expect(bridge.onChanged).toHaveBeenCalledTimes(1);
    expect(bridge.readSpeech).toHaveBeenCalledTimes(1);
    expect(form().draft?.modelRef).toBe('dirty-model');
    await track(form().save());
    expect(bridge.saveTtsProvider).toHaveBeenCalledWith({
      connectionId: 'A',
      command: expect.objectContaining({
        expectedRevision: 1,
        settings: expect.objectContaining({ modelRef: 'dirty-model' }),
      }),
    });
    unmount();
    expect(bridge.listeners.size).toBe(0);
  });

  it('does not transfer a dirty draft between targets with equal revisions', async () => {
    const bridge = install();
    render('A');
    await flush();
    form().edit({ modelRef: 'dirty-on-A' });
    render('B');
    await flush();
    expect(form().draft?.baseUrl).toBe(B.providers[0]?.settings.baseUrl);
    expect(form().dirty).toBe(false);
    await track(form().save());
    expect(bridge.saveTtsProvider).not.toHaveBeenCalled();
  });

  it.each(['save', 'readCatalog', 'reload'] as const)(
    'an obsolete render cannot dispatch %s for A after B commits',
    async (action) => {
      const bridge = install();
      render('A');
      await flush();
      form().edit({ modelRef: 'dirty-A' });
      const stale = form();
      render('B');
      await flush();
      const reads = bridge.readSpeech.mock.calls.length;
      await stale[action]();
      await flush();
      expect(bridge.saveTtsProvider).not.toHaveBeenCalled();
      expect(bridge.readTtsCatalog).not.toHaveBeenCalled();
      expect(bridge.readSpeech).toHaveBeenCalledTimes(reads);
      expect(form().draft?.baseUrl).toBe(B.providers[0]?.settings.baseUrl);
    },
  );

  it.each(['save-first', 'catalog-first'] as const)(
    '%s leaves both controls usable after admitted work settles',
    async (order) => {
      const saved = gate(ok(A));
      const listed = gate(ok(catalog));
      const bridge = install({
        saveTtsProvider: () => saved.promise,
        readTtsCatalog: () => listed.promise,
      });
      render('A');
      await flush();
      form().edit({ modelRef: 'dirty-model' });
      const first = track(order === 'save-first' ? form().save() : form().readCatalog());
      expect(
        order === 'save-first' ? bridge.saveTtsProvider : bridge.readTtsCatalog,
      ).toHaveBeenCalledTimes(1);
      const second = track(order === 'save-first' ? form().readCatalog() : form().save());
      // Either explicit config-operation exclusion or safe overlap is valid.
      saved.resolve(ok(A));
      listed.resolve(ok(catalog));
      await Promise.all([first, second]);
      await flush();
      expect(form().saving).toBe(false);
      expect(form().readingCatalog).toBe(false);
    },
  );

  it('keeps stop independent of a held save and closes each busy state separately', async () => {
    const saved = gate(ok(A));
    const stopped = gate(ok(localState('A')));
    const bridge = install({ saveTtsProvider: () => saved.promise, stop: () => stopped.promise });
    render('A');
    await flush();
    form().edit({ modelRef: 'dirty-model' });
    const saving = track(form().save());
    const stopping = track(form().stop());
    expect(bridge.stop).toHaveBeenCalledExactlyOnceWith({ connectionId: 'A' });
    expect(form().stopping).toBe(true);
    saved.resolve(ok(A));
    await saving;
    await flush();
    expect(form().saving).toBe(false);
    expect(form().stopping).toBe(true);
    stopped.resolve(ok(localState('A')));
    await stopping;
    await flush();
    expect(form().stopping).toBe(false);
  });

  it('does not resurrect A when its held remote read completes after disconnect', async () => {
    const remote = gate<Result<SpeechView>>(ok(A));
    const bridge = install({ readSpeech: () => remote.promise });
    render('A');
    expect(bridge.readSpeech).toHaveBeenCalledExactlyOnceWith({ connectionId: 'A' });
    render(null);
    remote.resolve(ok(A));
    await flush();
    expect(form().speech).toBeNull();
    expect(form().draft).toBeNull();
    expect(form().readError).not.toBeNull();
  });

  it('does not launch an A config read after reload waits on local state and target becomes B', async () => {
    const local = gate<Result<DesktopSpeechState>>(ok(localState('A')));
    let held = false;
    const bridge = install({
      getState: () => (held ? local.promise : Promise.resolve(ok(localState('A')))),
    });
    render('A');
    await flush();
    held = true;
    const reads = bridge.getState.mock.calls.length;
    form().reload();
    expect(bridge.getState).toHaveBeenCalledTimes(reads + 1);
    render('B');
    await flush();
    expect(form().draft?.baseUrl).toBe(B.providers[0]?.settings.baseUrl);
    local.resolve(ok(localState('A')));
    await flush();
    expect(bridge.readSpeech.mock.calls.map(([input]) => input.connectionId)).toEqual(['A', 'B']);
    expect(form().draft?.baseUrl).toBe(B.providers[0]?.settings.baseUrl);
  });

  it('a real pending B save survives completion of the previous A save', async () => {
    const savedA = gate(ok(speechView('https://saved-a.synthetic.invalid/v1', 2)));
    const savedB = gate(ok(speechView('https://saved-b.synthetic.invalid/v1', 2)));
    const bridge = install({
      saveTtsProvider: ({ connectionId }) =>
        connectionId === 'A' ? savedA.promise : savedB.promise,
    });
    render('A');
    await flush();
    form().edit({ modelRef: 'dirty-A' });
    const savingA = track(form().save());
    expect(bridge.saveTtsProvider).toHaveBeenCalledTimes(1);
    render('B');
    await flush();
    // The real component disables B's fields while saving/readingCatalog is true.
    // Calling the hook action directly must not conceal an unreachable B form.
    expect(form().saving).toBe(false);
    expect(form().readingCatalog).toBe(false);
    form().edit({ modelRef: 'dirty-B' });
    const savingB = track(form().save());
    expect(bridge.saveTtsProvider.mock.calls.map(([input]) => input.connectionId)).toEqual([
      'A',
      'B',
    ]);
    expect(form().saving).toBe(true);
    savedA.resolve(ok(speechView('https://saved-a.synthetic.invalid/v1', 2)));
    await savingA;
    await flush();
    expect(form().saving).toBe(true);
    expect(form().draft?.modelRef).toBe('dirty-B');
    expect(form().notice).toBeNull();
    savedB.resolve(ok(speechView('https://saved-b.synthetic.invalid/v1', 2)));
    await savingB;
    await flush();
    expect(form().saving).toBe(false);
    expect(form().draft?.baseUrl).toBe('https://saved-b.synthetic.invalid/v1');
  });

  it.each(['save', 'readCatalog'] as const)(
    'a new B render cannot dispatch %s using A while the B config read is held',
    async (action) => {
      const remoteB = gate<Result<SpeechView>>(ok(B));
      const bridge = install({
        readSpeech: async ({ connectionId }) => (connectionId === 'B' ? remoteB.promise : ok(A)),
      });
      render('A');
      await flush();
      form().edit({ modelRef: 'dirty-A' });
      render('B');
      expect(bridge.readSpeech.mock.calls.map(([input]) => input.connectionId)).toEqual(['A', 'B']);
      await track(form()[action]());
      expect(bridge.saveTtsProvider).not.toHaveBeenCalled();
      expect(bridge.readTtsCatalog).not.toHaveBeenCalled();
      remoteB.resolve(ok(B));
      await flush();
      expect(form().draft?.baseUrl).toBe(B.providers[0]?.settings.baseUrl);
    },
  );

  it('a pending A stop neither blocks B stop nor replaces B playback facts when it finishes', async () => {
    const stoppedA = gate<Result<DesktopSpeechState>>(ok(localState('A')));
    const stoppedB = gate<Result<DesktopSpeechState>>(ok(localState('B')));
    let local: DesktopSpeechState = { ...localState('A'), phase: 'streaming', playing: true };
    const bridge = install({
      getState: async () => ok(local),
      stop: ({ connectionId }) => (connectionId === 'A' ? stoppedA.promise : stoppedB.promise),
    });
    render('A');
    await flush();
    const stoppingA = track(form().stop());
    expect(bridge.stop).toHaveBeenCalledExactlyOnceWith({ connectionId: 'A' });
    render('B');
    local = { ...localState('B'), phase: 'streaming', playing: true };
    bridge.changed();
    await flush();
    expect(form().state?.connectionId).toBe('B');
    // Button busy disables the real stop control; A must not leave B's control busy.
    expect(form().stopping).toBe(false);
    const stoppingB = track(form().stop());
    expect(bridge.stop.mock.calls.map(([input]) => input.connectionId)).toEqual(['A', 'B']);
    stoppedA.resolve(ok(localState('A')));
    await stoppingA;
    await flush();
    expect(form().state?.connectionId).toBe('B');
    expect(form().stopping).toBe(true);
    stoppedB.resolve(ok(localState('B')));
    await stoppingB;
    await flush();
    expect(form().stopping).toBe(false);
  });

  it('stops the actual local speech owner rather than the configuration target', async () => {
    const bridge = install();
    render('B');
    await flush();
    await track(form().stop());
    expect(bridge.stop).toHaveBeenCalledExactlyOnceWith({ connectionId: 'A' });
  });

  it('reports no connection without making remote requests', async () => {
    const bridge = install({
      getState: async () => ok(localState(null)),
      readSpeech: async () => ({ ok: false, error: makeError('unavailable', false) }),
    });
    render(null);
    await flush();
    expect(bridge.readSpeech).not.toHaveBeenCalled();
    expect(form().draft).toBeNull();
    expect(form().readError).not.toBeNull();
  });
});
