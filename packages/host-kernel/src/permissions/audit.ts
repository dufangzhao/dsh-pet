import type { AuditEntry } from '@pet/contracts';
import { freezeJson } from '../runtime/identity.js';
export type { AuditEntry, AuditEvent, AuditSource } from '@pet/contracts';
/** Metadata only. No file IO and no payload/result fields by design. */
export class PermissionAudit {
  readonly #entries: AuditEntry[] = [];
  #total = 0;
  #dropped = 0;
  constructor(private readonly limit = 1024) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000)
      throw new Error('Invalid audit limit');
  }
  append(entry: AuditEntry): void {
    this.#entries.push(freezeJson(structuredClone(entry)));
    this.#total++;
    while (this.#entries.length > this.limit) {
      this.#entries.shift();
      this.#dropped++;
    }
  }
  snapshot(
    offset = 0,
    limit = 50,
  ): { entries: readonly AuditEntry[]; total: number; dropped: number } {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new Error('Invalid audit page');
    return {
      entries: this.#entries.slice(offset, offset + limit),
      total: this.#total,
      dropped: this.#dropped,
    };
  }
}
