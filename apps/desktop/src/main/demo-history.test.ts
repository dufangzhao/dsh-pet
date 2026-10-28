import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { DemoMessage } from '@pet/contracts';
import { DemoHistory } from './demo-history.js';
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    if (!path.basename(directory).startsWith('pet-history-')) throw new Error('Unsafe cleanup');
    await fs.rm(directory, { recursive: true, force: true });
  }
});
it('retains bounded real messages across restart and serializes explicit clearing', async () => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'pet-history-'));
  directories.push(directory);
  const history = await DemoHistory.create(directory);
  const messages: DemoMessage[] = Array.from({ length: 24 }, (_, index) => ({
    id: 'turn-' + index,
    role: index % 2 ? 'assistant' : 'user',
    text: '消息' + index,
    mode: 'demo',
    at: index,
  }));
  await history.replace(messages);
  expect(history.messages).toHaveLength(20);
  const restarted = await DemoHistory.create(directory);
  expect(restarted.messages[0]?.text).toBe('消息4');
  const saved = history.replace(messages.slice(-2)),
    cleared = history.replace([]);
  await Promise.all([saved, cleared]);
  expect((await DemoHistory.create(directory)).messages).toEqual([]);
});
