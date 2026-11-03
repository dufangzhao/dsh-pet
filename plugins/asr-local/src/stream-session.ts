import { LOCAL_ASR_MAX_SECONDS, LOCAL_ASR_SAMPLE_RATE } from '@pet/contracts';
export interface AsrStream {
  acceptWaveform(input: { sampleRate: number; samples: Float32Array }): void;
  inputFinished?(): void;
}
export interface AsrRecognizer {
  createStream(): AsrStream;
  decode(stream: AsrStream): void;
  getResult(stream: AsrStream): { text: unknown };
  isReady?(stream: AsrStream): boolean;
}
/** One loaded recognizer and one bounded utterance. Offline prefixes are real, revisable results. */
export class StreamingAsrSession {
  readonly #samples: Float32Array | null;
  readonly #online: AsrStream | null;
  #written = 0;
  #decoded = 0;
  #lastResult = '';
  #lastPartial = '';
  #steps = 0;
  #ended = false;
  constructor(
    private readonly modelId: string,
    private readonly recognizer: AsrRecognizer | null,
    private readonly partial: (text: string) => Promise<void>,
    private readonly sapi: (samples: Float32Array) => Promise<string>,
  ) {
    if (modelId === 'streaming-paraformer-zh-en-int8') {
      if (!recognizer?.isReady) throw new Error('not-ready');
      this.#online = recognizer.createStream();
      if (!this.#online.inputFinished) throw new Error('not-ready');
      this.#samples = null;
    } else {
      this.#online = null;
      this.#samples = new Float32Array(LOCAL_ASR_SAMPLE_RATE * LOCAL_ASR_MAX_SECONDS);
    }
  }
  get sampleCount(): number {
    return this.#written;
  }
  private text(stream: AsrStream): string {
    const text = this.recognizer?.getResult(stream).text;
    if (typeof text !== 'string' || [...text].length > 4000) throw new Error('asr-failed');
    return text.trim();
  }
  private drain(stream: AsrStream): void {
    const recognizer = this.recognizer;
    if (!recognizer?.isReady) throw new Error('not-ready');
    while (recognizer.isReady(stream)) {
      if (++this.#steps > 10000) throw new Error('asr-failed');
      recognizer.decode(stream);
    }
  }
  private decodePrefix(): string {
    const recognizer = this.recognizer,
      samples = this.#samples;
    if (!recognizer || !samples) throw new Error('not-ready');
    const stream = recognizer.createStream();
    stream.acceptWaveform({
      sampleRate: LOCAL_ASR_SAMPLE_RATE,
      samples: samples.subarray(0, this.#written),
    });
    recognizer.decode(stream);
    this.#decoded = this.#written;
    this.#lastResult = this.text(stream);
    return this.#lastResult;
  }
  private async publish(text: string): Promise<void> {
    if (text === this.#lastPartial) return;
    this.#lastPartial = text;
    await this.partial(text);
  }
  async push(samples: Float32Array): Promise<void> {
    if (
      this.#ended ||
      samples.length > 1600 ||
      this.#written + samples.length > LOCAL_ASR_SAMPLE_RATE * LOCAL_ASR_MAX_SECONDS
    )
      throw new Error('audio-format');
    for (const sample of samples)
      if (!Number.isFinite(sample) || Math.abs(sample) > 1) throw new Error('audio-format');
    if (this.#online) {
      this.#online.acceptWaveform({ sampleRate: LOCAL_ASR_SAMPLE_RATE, samples });
      this.#written += samples.length;
      this.drain(this.#online);
      await this.publish(this.text(this.#online));
    } else {
      this.#samples?.set(samples, this.#written);
      this.#written += samples.length;
      if (
        this.modelId === 'sensevoice-small-int8' &&
        this.#written - this.#decoded >= LOCAL_ASR_SAMPLE_RATE
      )
        await this.publish(this.decodePrefix());
    }
  }
  async finish(): Promise<string> {
    if (this.#ended) throw new Error('asr-failed');
    this.#ended = true;
    if (this.#written === 0) return '';
    if (this.#online) {
      this.#online.acceptWaveform({
        sampleRate: LOCAL_ASR_SAMPLE_RATE,
        samples: new Float32Array(8000),
      });
      this.#online.inputFinished?.();
      this.drain(this.#online);
      return this.text(this.#online);
    }
    if (this.modelId === 'windows-sapi') {
      if (!this.#samples) throw new Error('not-ready');
      const text = await this.sapi(this.#samples.subarray(0, this.#written));
      if ([...text].length > 4000) throw new Error('asr-failed');
      return text.trim();
    }
    return this.#decoded === this.#written ? this.#lastResult : this.decodePrefix();
  }
}
