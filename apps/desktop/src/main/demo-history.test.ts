import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { FileConfigStore } from '@pet/host-kernel';
import { readLegacyDemoHistory } from './demo-history.js';
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    if (!path.basename(directory).startsWith('pet-history-')) throw new Error('Unsafe cleanup');
    await fs.rm(directory, { recursive: true, force: true });
  }
});
it('does not create a second history store for a fresh application', async () => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'pet-history-'));
  directories.push(directory);
  expect(await readLegacyDemoHistory(directory)).toEqual([]);
  expect(await fs.readdir(directory)).toEqual([]);
});
it('reads old data for recoverable migration without replacing it', async () => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'pet-history-'));
  directories.push(directory);
  const root = path.join(directory, 'history');
  await fs.mkdir(root);
  const store = new FileConfigStore(root);
  const identity = { pluginId: 'pet.voice-chat', instanceId: 'default' };
  const messages = [{ id: 'old-1', role: 'user', text: '旧消息', mode: 'demo', at: 1 }];
  await store.compareAndSet(identity, null, {
    format: 1,
    ...identity,
    schemaVersion: 1,
    revision: 1,
    data: { messages },
  });
  expect(await readLegacyDemoHistory(directory)).toEqual(messages);
  expect((await store.read(identity))?.revision).toBe(1);
});
