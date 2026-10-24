/** M0 gesture experiment: first down starts immediately; release selects hold vs latch. */
export type TalkKeyIntent = 'start' | 'finish' | 'cancel';
export class TalkKeyGesture {
  private phase: 'idle' | 'pressed' | 'continuous' | 'draining' = 'idle';
  private down = false;
  private pressedAt = 0;
  private lastAt = -Infinity;
  constructor(readonly holdThresholdMs = 250) {
    if (!Number.isFinite(holdThresholdMs) || holdThresholdMs <= 0)
      throw new Error('Invalid threshold');
  }
  get state() {
    return this.phase;
  }
  private acceptTime(at: number) {
    if (!Number.isFinite(at) || at < this.lastAt) throw new Error('Non-monotonic key timestamp');
    this.lastAt = at;
  }
  key(type: 'down' | 'up', at: number): TalkKeyIntent[] {
    if (type !== 'down' && type !== 'up') throw new Error('Invalid key event');
    this.acceptTime(at);
    if (type === 'down') {
      if (this.down) return [];
      this.down = true;
      if (this.phase === 'continuous') {
        this.phase = 'draining';
        return ['finish'];
      }
      if (this.phase === 'idle') {
        this.phase = 'pressed';
        this.pressedAt = at;
        return ['start'];
      }
      return [];
    }
    if (!this.down) return [];
    this.down = false;
    if (this.phase === 'pressed') {
      if (at - this.pressedAt >= this.holdThresholdMs) {
        this.phase = 'idle';
        return ['finish'];
      }
      this.phase = 'continuous';
    } else if (this.phase === 'draining') this.phase = 'idle';
    return [];
  }
  cancel(at: number): TalkKeyIntent[] {
    this.acceptTime(at);
    const active = this.phase === 'pressed' || this.phase === 'continuous';
    this.phase = this.down ? 'draining' : 'idle';
    return active ? ['cancel'] : [];
  }
}

/** Synthetic pulse replay on observed polling times, NOT a physical key detection rate. */
export function replayPulses(ticks: readonly number[], durationMs: number) {
  if (
    ticks.length < 2 ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0 ||
    ticks.some((value, i) => !Number.isFinite(value) || (i > 0 && value < (ticks[i - 1] ?? 0)))
  ) {
    throw new Error('Invalid polling trace');
  }
  const last = ticks[ticks.length - 1] ?? 0;
  let trials = 0;
  let detected = 0;
  for (let start = 100; start < last - durationMs - 100; start += 1) {
    trials += 1;
    if (ticks.some((tick) => tick >= start && tick < start + durationMs)) detected += 1;
  }
  return { durationMs, trials, detected, missed: trials - detected };
}
