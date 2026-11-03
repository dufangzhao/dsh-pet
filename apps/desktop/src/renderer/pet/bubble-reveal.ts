const graphemes = new Intl.Segmenter('zh', { granularity: 'grapheme' });

/** A presentation clock for text already received from the host. */
export class BubbleTextReveal {
  private shown: string;
  private units: string[] = [];
  private count = 0;
  private speed = 100;
  private nextAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly apply: (text: string) => void,
    initial = '',
  ) {
    this.shown = initial;
  }

  update(text: string, animate: boolean, speed: number, active = true): void {
    this.stop();
    if (!active) return;
    if (!animate) {
      this.shown = text;
      this.nextAt = 0;
      this.apply(text);
      return;
    }
    if (!text.startsWith(this.shown)) {
      this.shown = '';
      this.nextAt = 0;
    }
    this.speed = speed;
    this.units = Array.from(graphemes.segment(text), (unit) => unit.segment);
    this.count = Array.from(graphemes.segment(this.shown)).length;
    this.apply(this.shown);
    // Appended chunks keep the existing deadline, including a punctuation pause.
    if (this.count < this.units.length)
      this.timer = setTimeout(this.step, Math.max(0, this.nextAt - performance.now()));
  }

  stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private readonly step = (): void => {
    this.timer = null;
    const unit = this.units[this.count];
    if (unit === undefined) return;
    this.count += 1;
    this.shown += unit;
    this.apply(this.shown);
    const stepMs = /[。！？.!?…]/u.test(unit) ? 320 : /[，、；：,;:]/u.test(unit) ? 180 : 50;
    const delay = stepMs * (100 / this.speed);
    this.nextAt = performance.now() + delay;
    if (this.count < this.units.length) this.timer = setTimeout(this.step, delay);
  };
}
