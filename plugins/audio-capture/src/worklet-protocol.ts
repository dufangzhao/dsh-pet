/**
 * 主线程与音频线程之间的字面协议。
 *
 * 单独一个模块是因为 worklet 源码本身要在音频线程里执行 `registerProcessor`；
 * 主线程（以及单元测试）只需要这几个常量，不该因此把 worklet 一起加载进来。
 */

/** 主线程唯一的命令：交出不足一帧的尾巴。 */
export const FINISH_COMMAND = 'finish';

/** 尾巴交完之后紧跟的结束标记；收到它主线程才知道数据到头。 */
export const END_MARKER = 'end';

/** 采样点不是数时的格式标记：数据已损坏，不能夹成 ±1 或补 0。 */
export const FORMAT_MARKER = 'format';

/** 音频线程注册的处理线程名；主线程按这个名字建节点。 */
export const VOICE_PROCESSOR_NAME = 'pet-pcm-frame';

/** 一帧的硬上限，与票据的 chunkSamples 一致。 */
export const MAX_CHUNK_SAMPLES = 1600;
