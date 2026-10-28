import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { FileConfigStore, type StoredConfig } from '@pet/host-kernel';
import type { DemoMessage, JsonValue } from '@pet/contracts';
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
export class DemoHistory {
  #tail: Promise<void> = Promise.resolve();
  private constructor(
    private readonly store: FileConfigStore,
    private record: StoredConfig,
  ) {}
  static async create(directory: string): Promise<DemoHistory> {
    const root = path.join(directory, 'history');
    await mkdir(root, { recursive: true });
    const store = new FileConfigStore(root);
    let record = await store.read(identity);
    if (!record) {
      record = { format: 1, ...identity, schemaVersion: 1, revision: 1, data: { messages: [] } };
      if (!(await store.compareAndSet(identity, null, record)))
        throw new Error('History unavailable');
    }
    const messages = record.data['messages'];
    if (
      record.schemaVersion !== 1 ||
      !Array.isArray(messages) ||
      messages.length > 20 ||
      !messages.every(valid)
    )
      throw new Error('History unavailable');
    return new DemoHistory(store, record);
  }
  get messages(): readonly DemoMessage[] {
    return this.record.data['messages'] as unknown as readonly DemoMessage[];
  }
  replace(input: readonly DemoMessage[], signal?: AbortSignal): Promise<void> {
    const messages = input.map((message) => ({ ...message })).slice(-20);
    while (Buffer.byteLength(JSON.stringify({ messages }), 'utf8') > 32768) messages.shift();
    const work = this.#tail.then(async () => {
      if (signal?.aborted) throw new Error('History cancelled');
      const record: StoredConfig = {
        ...this.record,
        revision: this.record.revision + 1,
        data: { messages: messages as unknown as JsonValue },
      };
      if (!(await this.store.compareAndSet(identity, this.record.revision, record)))
        throw new Error('History unavailable');
      this.record = record;
    });
    this.#tail = work.then(
      () => {},
      () => {},
    );
    return work;
  }
}
