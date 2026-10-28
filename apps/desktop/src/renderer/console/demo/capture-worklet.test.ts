import { expect, test } from 'vitest';

/**
 * worklet 的输出契约回归：
 * 1. 不足一帧的尾巴必须在结束标记之前交出去，否则最后一个音节静默消失。
 * 2. 出线程的必须是标准 Float32 PCM：重采样/AGC 的轻微 overshoot 饱和到 [-1,1]；
 *    非 finite 是数据损坏，只能发格式标记，不能夹成 ±1、更不能补 0。
 *
 * Node 里没有 AudioWorklet 线程作用域，所以先把 AudioWorkletProcessor 与 registerProcessor
 * 换成夹具，再动态导入被测模块：静态 import 会被提到赋值之前执行，类定义时拿不到基类。
 */
const QUANTUM = 128; // AudioWorklet 的渲染量子
const CHUNK = 1600; // 票据的 chunkSamples

class FakePort {
  onmessage: ((event: MessageEvent) => void) | null = null;
  readonly posted: unknown[] = [];

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  /** 主线程给音频线程发命令。 */
  emit(data: unknown): void {
    this.onmessage?.({ data } as unknown as MessageEvent);
  }
}

interface ProcessorLike {
  readonly port: FakePort;
  process(inputs: Float32Array[][]): boolean;
}

const registered: Array<{ name: string; ctor: new (options?: unknown) => ProcessorLike }> = [];
const workletScope = globalThis as unknown as {
  AudioWorkletProcessor: unknown;
  registerProcessor: (name: string, ctor: new (options?: unknown) => ProcessorLike) => void;
};
workletScope.AudioWorkletProcessor = class {
  readonly port = new FakePort();
};
workletScope.registerProcessor = (name, ctor) => {
  registered.push({ name, ctor });
};

await import('./capture-worklet.js');

/** 起一个 1600 点一帧的处理线程夹具。 */
function startProcessor(): ProcessorLike {
  const entry = registered[0];
  if (entry === undefined) throw new Error('capture-worklet.ts 没有注册处理线程');
  expect(entry.name).toBe('pet-pcm-frame');
  return new entry.ctor({ processorOptions: { chunkSamples: CHUNK } });
}

/** 每个量子的数值都不同且都在 [-1,1] 内：限幅必须是恒等变换，顺序与数值逐点可比。 */
function quantum(seed: number, length = QUANTUM): Float32Array<ArrayBuffer> {
  const values: number[] = [];
  for (let index = 0; index < length; index += 1) values.push((((index + seed) % 9) - 4) / 5);
  return new Float32Array(values);
}

function float32Frames(posted: unknown[]): Float32Array[] {
  return posted.filter((item): item is Float32Array => item instanceof Float32Array);
}

test('尾巴在结束标记之前交出：1664 点一个都不丢', () => {
  const processor = startProcessor();
  // 13 × 128 = 1664 点：只够一个整帧 1600 点，剩下 64 点只能靠 finish 的尾巴交出来。
  for (let seed = 0; seed < 13; seed += 1) processor.process([[quantum(seed)]]);
  processor.port.emit('finish');

  const tail = 13 * QUANTUM - CHUNK;
  const frames = float32Frames(processor.port.posted);
  expect(frames.map((frame) => frame.length)).toEqual([CHUNK, tail]);
  expect(processor.port.posted).toEqual([
    expect.any(Float32Array),
    expect.any(Float32Array),
    'end',
  ]);
  expect(frames.reduce((count, frame) => count + frame.length, 0)).toBe(13 * QUANTUM);

  // 尾巴就是第 13 个量子被整帧切走之后剩下的那段，数值与顺序都不能变。
  const last = Array.from(quantum(12));
  expect(Array.from(frames[1] ?? [])).toEqual(last.slice(QUANTUM - tail));
});

test('刚好攒满一帧时不发空尾巴：0 长度帧会被宿主拒收', () => {
  const processor = startProcessor();
  processor.process([[quantum(0, CHUNK)]]);
  processor.port.emit('finish');

  expect(float32Frames(processor.port.posted).map((frame) => frame.length)).toEqual([CHUNK]);
  expect(processor.port.posted).toEqual([expect.any(Float32Array), 'end']);
});

test('finish 之后的量子不再出帧，结束标记只有一条', () => {
  const processor = startProcessor();
  processor.process([[quantum(0)]]);
  processor.port.emit('finish');
  processor.process([[quantum(1)]]);
  processor.port.emit('finish');

  expect(float32Frames(processor.port.posted).map((frame) => frame.length)).toEqual([QUANTUM]);
  expect(processor.port.posted.filter((item) => item === 'end')).toHaveLength(1);
});

test('真实重采样 overshoot 饱和成标准 PCM：±1.0000293 出 ±1，范围内样本逐点不动', () => {
  const processor = startProcessor();
  // 宿主实测：min=-0.999101996421814、max=1.0000293254852295（ready 后约 0.855 秒，第 8~9 帧）。
  const source = new Float32Array([
    -0.999101996421814, 1.0000293254852295, -1.0000293254852295, 0.5, -0.25, 0,
  ]);
  processor.process([[source]]);
  processor.port.emit('finish');

  const frames = float32Frames(processor.port.posted);
  expect(frames).toHaveLength(1);
  const frame = frames[0] ?? new Float32Array();
  expect(frame.length).toBe(source.length);
  expect(frame[1]).toBe(1);
  expect(frame[2]).toBe(-1);
  expect(frame[0]).toBe(source[0]); // 范围内：只有 Float32 表示，没有任何加工
  expect(Array.from(frame.subarray(3))).toEqual([0.5, -0.25, 0]);
  expect(processor.port.posted).toEqual([expect.any(Float32Array), 'end']); // 没有误报格式
});

test('NaN 不猜 0：坏数据不入流，只发一条格式标记', () => {
  const processor = startProcessor();
  processor.process([[quantum(0, 8)]]); // 先攒 8 个好点
  processor.process([[new Float32Array([0.5, Number.NaN, -0.5])]]);

  expect(float32Frames(processor.port.posted)).toHaveLength(0); // 半个坏帧也没冒出去
  expect(processor.port.posted).toEqual(['format']);

  processor.process([[quantum(1, 8)]]); // 坏掉之后再来的一律不入流
  processor.port.emit('finish'); // 这一次已经作废，不该再补结束标记
  expect(processor.port.posted).toEqual(['format']);
});

test('Infinity 不夹成 ±1：同样只发格式标记', () => {
  const processor = startProcessor();
  const broken = new Float32Array([0.25, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]);
  processor.process([[broken]]);

  expect(float32Frames(processor.port.posted)).toHaveLength(0);
  expect(processor.port.posted).toEqual(['format']);
});
