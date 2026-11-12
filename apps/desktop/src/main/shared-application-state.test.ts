import { expect, it } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileConfigStore } from '@pet/host-kernel';
import { SPEECH_FEATURE_PLUGIN_ID } from '@pet/contracts';
import { SharedApplicationState } from './shared-application-state.js';
it('only adopted target intents change disabled markers; explicit disable/enable survives restart', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'shared-ledger-test-'));
  if (path.dirname(root) !== tmpdir() || !path.basename(root).startsWith('shared-ledger-test-'))
    throw new Error('Unexpected temp directory');
  try {
    await mkdir(path.join(root, 'host-settings'));
    let ledger = await SharedApplicationState.create(root);
    await ledger.record('pet.explicitly-disabled', false);
    await ledger.record('pet.other-action', true);
    ledger = await SharedApplicationState.create(root);
    expect(ledger.disabled('pet.explicitly-disabled')).toBe(true);
    expect(ledger.disabled('pet.skipped-unsupported')).toBe(false);
    expect(ledger.disabled('pet.other-action')).toBe(false);
    await ledger.record('pet.explicitly-disabled', true);
    ledger = await SharedApplicationState.create(root);
    expect(ledger.disabled('pet.explicitly-disabled')).toBe(false);
    const record = await new FileConfigStore(path.join(root, 'host-settings')).read({
      pluginId: 'host.application-state',
      instanceId: 'default',
    });
    expect(record?.data).toEqual({
      guideStep: 'welcome',
      completed: false,
      deferred: false,
      disabled: [],
    });
  } finally {
    await rm(root, { recursive: true });
  }
});

async function withLedger(
  run: (root: string, store: FileConfigStore) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'shared-ledger-test-'));
  if (
    path.resolve(root) !== root ||
    path.dirname(root) !== path.resolve(tmpdir()) ||
    !path.basename(root).startsWith('shared-ledger-test-')
  )
    throw new Error('Unexpected temp directory');
  try {
    await mkdir(path.join(root, 'host-settings'));
    await run(root, new FileConfigStore(path.join(root, 'host-settings')));
  } finally {
    await rm(root, { recursive: true });
  }
}
const applicationIdentity = { pluginId: 'host.application-state', instanceId: 'default' };

it('new optional speech stays off on old ledgers until explicit enable, then persists independently', async () => {
  await withLedger(async (root, store) => {
    const legacy = {
      guideStep: 'done',
      completed: true,
      deferred: true,
      disabled: ['pet.other'],
      preserved: { speechEnabled: true },
    };
    expect(
      await store.compareAndSet(applicationIdentity, null, {
        format: 1,
        ...applicationIdentity,
        schemaVersion: 1,
        revision: 1,
        data: legacy,
      }),
    ).toBe(true);
    let ledger = await SharedApplicationState.create(root);
    expect(ledger.disabled(SPEECH_FEATURE_PLUGIN_ID)).toBe(true);
    expect(ledger.disabled('pet.other')).toBe(true);
    await ledger.record('pet.unrelated', true);
    expect((await store.read(applicationIdentity))?.data['optionalEnabled']).toBeUndefined();
    await ledger.record(SPEECH_FEATURE_PLUGIN_ID, true);
    ledger = await SharedApplicationState.create(root);
    expect(ledger.disabled(SPEECH_FEATURE_PLUGIN_ID)).toBe(false);
    expect(ledger.disabled('pet.other')).toBe(true);
    const record = await store.read(applicationIdentity);
    expect(record?.data).toEqual({ ...legacy, optionalEnabled: [SPEECH_FEATURE_PLUGIN_ID] });
    await ledger.record(SPEECH_FEATURE_PLUGIN_ID, false);
    ledger = await SharedApplicationState.create(root);
    expect(ledger.disabled(SPEECH_FEATURE_PLUGIN_ID)).toBe(true);
    expect((await store.read(applicationIdentity))?.data['preserved']).toEqual(legacy.preserved);
  });
});

it('failed opt-in CAS does not mark automatic speech as adopted', async () => {
  await withLedger(async (root, store) => {
    const ledger = await SharedApplicationState.create(root);
    const current = await store.read(applicationIdentity);
    if (!current) throw new Error('Missing ledger');
    expect(
      await store.compareAndSet(applicationIdentity, current.revision, {
        ...current,
        revision: current.revision + 1,
        data: { ...current.data, deferred: true },
      }),
    ).toBe(true);
    await expect(ledger.record(SPEECH_FEATURE_PLUGIN_ID, true)).rejects.toMatchObject({
      error: { code: 'conflict' },
    });
    expect(ledger.disabled(SPEECH_FEATURE_PLUGIN_ID)).toBe(true);
    expect((await SharedApplicationState.create(root)).disabled(SPEECH_FEATURE_PLUGIN_ID)).toBe(
      true,
    );
  });
});

it('unknown optional-source intent is rejected rather than silently enabling arbitrary sources', async () => {
  await withLedger(async (root, store) => {
    expect(
      await store.compareAndSet(applicationIdentity, null, {
        format: 1,
        ...applicationIdentity,
        schemaVersion: 1,
        revision: 1,
        data: { disabled: [], optionalEnabled: ['pet.not-an-optional-role'] },
      }),
    ).toBe(true);
    await expect(SharedApplicationState.create(root)).rejects.toMatchObject({
      error: { code: 'not-ready' },
    });
    expect((await store.read(applicationIdentity))?.revision).toBe(1);
  });
});
