import path from 'node:path';
import { stat } from 'node:fs/promises';
import { FileConfigStore } from '@pet/host-kernel';
import type { DemoMessage } from '@pet/contracts';
const identity = { pluginId: 'pet.voice-chat', instanceId: 'default' };
const valid = (value: unknown): value is DemoMessage => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    Object.keys(row).sort().join(',') === 'at,id,mode,role,text' &&
    typeof row['id'] === 'string' &&
    row['id'].length <= 128 &&
    ['user', 'assistant'].includes(String(row['role'])) &&
    typeof row['text'] === 'string' &&
    [...row['text']].length <= 4000 &&
    ['demo', 'deepseek'].includes(String(row['mode'])) &&
    Number.isSafeInteger(row['at']) &&
    (row['at'] as number) >= 0
  );
};
/** Migration input only. The Core event/session stores are the sole ongoing conversation writers. */
export async function readLegacyDemoHistory(directory: string): Promise<readonly DemoMessage[]> {
  const root = path.join(directory, 'history');
  try {
    const entry = await stat(root);
    if (!entry.isDirectory()) throw new Error('History unavailable');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const record = await new FileConfigStore(root).read(identity);
  if (!record) return [];
  const messages = record.data['messages'];
  if (record.schemaVersion !== 1 || !Array.isArray(messages) || messages.length > 20)
    throw new Error('History unavailable');
  return messages.map((m: unknown) => {
    if (!valid(m)) throw new Error('History unavailable');
    return { ...m };
  });
}
