/**
 * 音频线程：把 AudioWorklet 的渲染量子攒成固定长度的单声道帧，再交给主线程上行。
 *
 * 一帧最多 1600 个采样点（16kHz 下 100ms），攒满就把缓冲区转移给主线程：主线程因此每
 * 100ms 被打扰一次，而不是每 8ms 一个量子。声道在这里合成单声道；采样率由 AudioContext
 * 定死，这里不做任何换算。
 *
 * 出这条线程的必须是标准 Float32 PCM。浏览器重采样与 AGC 会让合成结果轻微超出 [-1,1]
 * （宿主实测 max=1.0000293），所以合成之后先验有限性、再饱和到 [-1,1]。非 finite 是数据损坏：
 * 夹成 ±1 或补 0 都是掩盖，只发一条格式标记，由采集器关硬件报 failed('format')。
 * 结束时先交出不足一帧的尾巴，再给结束标记：最后一个音节就藏在这条尾巴里。
 */

/** 一帧的硬上限，与宿主票据的 chunkSamples 一致。 */
const MAX_CHUNK_SAMPLES = 1600;

interface FrameOptions {
  readonly processorOptions?: { readonly chunkSamples?: number };
}

class PcmFrameProcessor extends AudioWorkletProcessor {
  private readonly chunkSamples: number;
  private frame: Float32Array<ArrayBuffer>;
  private used = 0;
  private stopped = false; // 尾巴已交或格式已坏：不再攒帧，也不会再有第二条消息

  constructor(options?: FrameOptions) {
    super();
    const requested = options?.processorOptions?.chunkSamples ?? MAX_CHUNK_SAMPLES;
    this.chunkSamples = Math.min(Math.max(1, Math.floor(requested)), MAX_CHUNK_SAMPLES);
    this.frame = new Float32Array(this.chunkSamples);
    // 主线程只有「结束」这一条命令，不必分辨载荷。
    this.port.onmessage = () => this.flush();
  }

  process(inputs: Float32Array[][]): boolean {
    if (this.stopped) return true; // 等主线程拆端口：不攒帧、不重复发消息
    const channels = inputs[0];
    if (channels === undefined || channels.length === 0) return true;
    const quantum = channels[0]?.length ?? 0;
    for (let index = 0; index < quantum; index += 1) {
      let sum = 0;
      for (const channel of channels) sum += channel[index] ?? 0;
      const mixed = sum / channels.length;
      if (!Number.isFinite(mixed)) {
        this.reportFormat();
        return true;
      }
      this.write(Math.max(-1, Math.min(1, mixed)));
    }
    return true;
  }

  /** 剩下的采样点先交出去，然后才是结束标记；同一端口，主线程按顺序收到。 */
  private flush(): void {
    if (this.stopped) return;
    this.stopped = true;
    const tail = this.frame.subarray(0, this.used);
    this.used = 0;
    if (tail.length > 0) this.port.postMessage(tail, [tail.buffer]);
    this.port.postMessage('end'); // 与 microphone.ts 的 END_MARKER 对应
  }

  /** 采样点不是数：不猜 0、不夹成 ±1，只交一条格式标记（与 FORMAT_MARKER 对应）然后停手。 */
  private reportFormat(): void {
    this.stopped = true;
    this.used = 0;
    this.port.postMessage('format');
  }

  private write(sample: number): void {
    const frame = this.frame;
    frame[this.used] = sample;
    this.used += 1;
    if (this.used < this.chunkSamples) return;
    this.frame = new Float32Array(this.chunkSamples);
    this.used = 0;
    this.port.postMessage(frame, [frame.buffer]);
  }
}

registerProcessor('pet-pcm-frame', PcmFrameProcessor);
