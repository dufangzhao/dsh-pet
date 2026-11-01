import type { DemoRecordingAction } from '@pet/contracts';
/** One fixed gesture: down toggles immediately; a held release finishes. */
export class TalkKeyGesture {
  #downAt: number | null = null;
  event(kind: 'down' | 'up', at: number): DemoRecordingAction | null {
    if (kind === 'down') {
      if (this.#downAt !== null) return null;
      this.#downAt = at;
      return 'toggle';
    }
    if (this.#downAt === null) return null;
    const held = at - this.#downAt;
    this.#downAt = null;
    return held >= 250 ? 'finish' : null;
  }
  reset(): void {
    this.#downAt = null;
  }
}
