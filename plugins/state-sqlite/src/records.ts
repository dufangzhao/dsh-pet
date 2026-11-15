import { createHash } from 'node:crypto';
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import type {
  CompanionAudience,
  CompanionCommandReceipt,
  CompanionEvent,
  CompanionMessage,
  JsonValue,
} from '@pet/contracts';
import type { AppendMessageInput } from './types.js';
import { canonical } from './validation.js';
import { StateFailure } from './failure.js';

export interface RecordWriter {
  readonly db: DatabaseSync;
  event(
    kind: CompanionEvent['kind'],
    data: CompanionEvent['data'],
    time?: number,
    audience?: CompanionAudience,
    principalId?: string | null,
  ): void;
  appendMessage(input: AppendMessageInput): CompanionMessage;
  command(id: string, digest: string): CompanionCommandReceipt | null;
  saveCommand(digest: string, receipt: CompanionCommandReceipt): void;
}
export function decode<T>(row: Record<string, SQLOutputValue> | undefined): T {
  if (!row || typeof row['body'] !== 'string') throw new StateFailure('unavailable');
  return JSON.parse(row['body']) as T;
}
export function scalar(row: Record<string, SQLOutputValue> | undefined, key: string): number {
  const value = row?.[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new StateFailure('internal');
  return value;
}
export function fingerprint(value: unknown): string {
  return createHash('sha256')
    .update(canonical(value as JsonValue))
    .digest('hex');
}
export function receipt(
  commandId: string,
  messageId: string | null,
  taskId: string | null,
): CompanionCommandReceipt {
  return { commandId, status: 'accepted', messageId, taskId };
}
