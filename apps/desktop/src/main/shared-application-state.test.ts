import { expect, it } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileConfigStore } from '@pet/host-kernel';
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
