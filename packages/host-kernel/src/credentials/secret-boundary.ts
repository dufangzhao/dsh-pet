import type { JsonValue, MediaFrame } from '@pet/contracts';
import { jsonPreflight, validateMediaFrame } from '@pet/contracts/validation';
import { SecretRedactor } from './redactor.js';
/** Bounded known-value defence, not arbitrary encoding reconstruction or an OS sandbox. */
export class KnownSecretBoundary {
  #blockedJson = 0;
  #blockedMedia = 0;
  readonly #tails = new Map<string, Uint8Array>();
  constructor(readonly redactor: SecretRedactor = new SecretRedactor()) {}
  observe(secret: string): boolean {
    try {
      this.redactor.add(secret);
      return true;
    } catch {
      return false;
    }
  }
  allowJson(input: JsonValue): boolean {
    const safe = jsonPreflight(input);
    if (!safe.ok) return false;
    const visit = (value: JsonValue): boolean => {
      if (typeof value === 'string') return !this.redactor.contains(value);
      if (Array.isArray(value)) return value.every(visit);
      if (value && typeof value === 'object')
        return Object.entries(value).every(
          ([key, child]) => !this.redactor.contains(key) && visit(child),
        );
      return true;
    };
    const allowed = visit(safe.value);
    if (!allowed) this.#blockedJson++;
    return allowed;
  }
  allowFrame(input: MediaFrame): boolean {
    const parsed = validateMediaFrame(input);
    if (!parsed.ok) return false;
    const frame = parsed.value,
      id = frame.header.streamId;
    if (!this.#tails.has(id) && this.#tails.size >= 64) return false;
    const joined = Buffer.concat([this.#tails.get(id) ?? new Uint8Array(0), frame.payload]);
    if (this.redactor.containsBytes(joined)) {
      joined.fill(0);
      this.#blockedMedia++;
      return false;
    }
    const size = Math.min(joined.length, Math.max(0, this.redactor.maxPatternBytes - 1));
    this.#tails.set(id, Uint8Array.from(joined.subarray(joined.length - size)));
    joined.fill(0);
    return true;
  }
  diagnostics() {
    return { blockedJson: this.#blockedJson, blockedMedia: this.#blockedMedia };
  }
  forget(streamId: string): void {
    this.#tails.get(streamId)?.fill(0);
    this.#tails.delete(streamId);
  }
  clear(): void {
    for (const bytes of this.#tails.values()) bytes.fill(0);
    this.#tails.clear();
    this.redactor.clear();
  }
}
