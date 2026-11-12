/**
 * Pet 的唯一流式播放 owner。
 *
 * 与旧的整段 buffer 播放器不同：PCM 边到边排进有界 node 窗口，24k AudioBuffer 交给
 * WebAudio 转换到实际设备 rate。这里只证明 API 调度事实（ready / started / ended 帧数），
 * 不证明人耳听到。
 *
 * 生命周期约束：
 * - 每个 chunk 末尾不足整块的帧要立刻排成短 node（含 1 frame），不能攥着 consume ACK
 *   去等下一块或 end —— 那会让 Main 读不到 EOF。
 * - 窗口满只能等 node.onended 归还容量；容量等待必须能被 stop 同步解除。
 * - 一个 session 的 setup / chain / inflight 是**真实在途工作**：stop 先同步停止与解除
 *   容量，但必须等它们全部 settle 才 close，再交 released。late 返回不 ready、不 start。
 * - 任何回执失败都 fence，不再排 PCM；真实 cleanup 放在保证执行的位置。
 * - end 只有在 VerifiedTerminal 且所有 node 真的 ended 之后，才 close → released。
 */
import {
  DESKTOP_SPEECH_BLOCK_FRAMES,
  DESKTOP_SPEECH_IPC_MAX_CHUNK_BYTES,
  DESKTOP_SPEECH_MAX_BLOCKS,
  isSpeechFormat,
  type DesktopSpeechAudioEvent,
  type DesktopSpeechBridge,
  type DesktopSpeechPlaybackIdentity,
  type OwnerRef,
  type SpeechFormat,
  type SpeechVerifiedTerminal,
} from '@pet/contracts';

/** 只取这一层真正会调用的四个回执方法，不把整个桥塞进播放器。 */
type PlaybackBridge = Pick<
  DesktopSpeechBridge,
  'playerReady' | 'consume' | 'reportPlayback' | 'reportReleased'
>;

interface Block {
  readonly source: AudioBufferSourceNode;
  readonly frames: number;
  readonly sequence: number;
}

interface Session {
  readonly identity: DesktopSpeechPlaybackIdentity;
  readonly format: SpeechFormat;
  readonly volume: number;
  /** start 事件的 sequence；准备阶段失败也用它交回执。 */
  readonly startSequence: number;
  /** createContext 可能还没发生（等上一次 cleanup），也可能创建失败。 */
  context: AudioContext | undefined;
  gain: GainNode | undefined;
  /** 准备链：createContext → gain → connect → resume → playerReady。 */
  setup: Promise<void>;
  /** 本 playback 的 chunk/end 串行处理。 */
  chain: Promise<void>;
  /** 所有未 settle 的回执；cleanup 要 join 它们。 */
  readonly inflight: Set<Promise<void>>;
  /** 唯一收尾 Promise：避免同一 context 多次 close 或与旧 cleanup 重叠。 */
  cleanup: Promise<boolean> | undefined;
  /** 已分配 context 的唯一 close；fence 后立即开始，不等 setup。 */
  closing: Promise<'settled' | 'failed'> | undefined;
  nextStart: number;
  endedFrames: number;
  started: boolean;
  fenced: boolean;
  terminal: SpeechVerifiedTerminal | null;
  endSequence: number;
  expectedSequence: number;
  readonly blocks: Set<Block>;
  readonly waiters: (() => void)[];
}

const SAMPLE_RATE = 24000;

const sameOwner = (a: OwnerRef, b: OwnerRef): boolean =>
  a.pluginId === b.pluginId && a.instanceId === b.instanceId && a.generation === b.generation;

/**
 * 完整 identity 比较：同一 playbackId 但换了 owner/target/binding/index 的帧一律不接受。
 * 少比一个字段，旧目标的 chunk 就能污染新目标。
 */
export function samePlaybackIdentity(
  a: DesktopSpeechPlaybackIdentity,
  b: DesktopSpeechPlaybackIdentity,
): boolean {
  return (
    a.connectionId === b.connectionId &&
    a.utteranceId === b.utteranceId &&
    a.clientId === b.clientId &&
    a.agentId === b.agentId &&
    a.serviceEpoch === b.serviceEpoch &&
    a.utteranceBindingId === b.utteranceBindingId &&
    a.segmentIndex === b.segmentIndex &&
    a.requestId === b.requestId &&
    a.playbackId === b.playbackId &&
    a.localTaskId === b.localTaskId &&
    a.localStreamId === b.localStreamId &&
    sameOwner(a.localOwner, b.localOwner) &&
    a.remoteBinding.providerRef === b.remoteBinding.providerRef &&
    a.remoteBinding.bindingId === b.remoteBinding.bindingId
  );
}

/** 一段 PCM16LE 的字节数必须是偶数字节，且不超过单个 IPC chunk 上限。 */
function isChunkPayload(value: unknown, byteLength: number): value is Uint8Array {
  return (
    value instanceof Uint8Array &&
    value.byteLength === byteLength &&
    byteLength > 0 &&
    byteLength <= DESKTOP_SPEECH_IPC_MAX_CHUNK_BYTES &&
    byteLength % 2 === 0
  );
}

export class SharedSpeechPlaybackOwner {
  #session: Session | undefined;
  /**
   * 上一次 cleanup 的**实际结果**（context 是否真的关掉）。
   * 只有 true 才允许下一次 prepare 开新 context——"promise 结束"不等于"已释放"。
   */
  #releasing: Promise<boolean> = Promise.resolve(true);
  #closed = false;
  constructor(
    private readonly bridge: PlaybackBridge,
    private readonly createContext: () => AudioContext = () => new AudioContext(),
  ) {}

  receive(event: DesktopSpeechAudioEvent, payload?: Uint8Array): void {
    if (this.#closed) return;
    if (event.kind === 'start') {
      this.#start(event);
      return;
    }
    const session = this.#session;
    // 已 fence 或已换代的会话不再推进；late 帧不能让它复活。
    if (session === undefined || session.fenced) return;
    if (!samePlaybackIdentity(session.identity, event)) return;
    if (event.kind === 'stop') {
      this.#fence(session, event.sequence);
      return;
    }
    if (event.sequence !== session.expectedSequence) {
      this.#fail(session, event.sequence);
      return;
    }
    session.expectedSequence += 1;
    if (event.kind === 'chunk') {
      if (!isChunkPayload(payload, event.byteLength)) {
        this.#fail(session, event.sequence);
        return;
      }
      const bytes = Uint8Array.from(payload);
      this.#enqueue(session, event.sequence, () =>
        this.#scheduleChunk(session, event.sequence, bytes),
      );
      return;
    }
    this.#enqueue(session, event.sequence, async () =>
      this.#finish(session, event.sequence, event.terminal),
    );
  }

  /** 本机主动收尾（禁用插件、关闭窗口、换目标）。stop 事件走 receive。 */
  stop(): void {
    const session = this.#session;
    if (session === undefined) return;
    this.#fence(session, session.endSequence || Math.max(0, session.expectedSequence - 1));
  }

  close(): void {
    this.stop();
    this.#closed = true;
  }

  #start(event: Extract<DesktopSpeechAudioEvent, { kind: 'start' }>): void {
    if (!isSpeechFormat(event.format)) return;
    // 上一代先同步 fence，它的 cleanup 由 #releasing 承接。
    this.stop();
    const prior = this.#releasing;
    const identity: DesktopSpeechPlaybackIdentity = {
      connectionId: event.connectionId,
      utteranceId: event.utteranceId,
      clientId: event.clientId,
      agentId: event.agentId,
      serviceEpoch: event.serviceEpoch,
      utteranceBindingId: event.utteranceBindingId,
      segmentIndex: event.segmentIndex,
      requestId: event.requestId,
      playbackId: event.playbackId,
      localOwner: event.localOwner,
      localTaskId: event.localTaskId,
      localStreamId: event.localStreamId,
      remoteBinding: event.remoteBinding,
    };
    const session: Session = {
      identity,
      format: event.format,
      volume: event.volume,
      startSequence: event.sequence,
      context: undefined,
      gain: undefined,
      setup: Promise.resolve(),
      chain: Promise.resolve(),
      inflight: new Set(),
      cleanup: undefined,
      closing: undefined,
      nextStart: 0,
      endedFrames: 0,
      started: false,
      fenced: false,
      terminal: null,
      endSequence: 0,
      expectedSequence: event.sequence + 1,
      blocks: new Set(),
      waiters: [],
    };
    this.#session = session;
    session.setup = this.#prepare(session, prior);
  }

  /**
   * 准备链。失败（含 createContext/createGain/connect 抛、resume 后非 running、
   * playerReady 被拒）都必须交 failed 回执并真实收尾，不能让 Main 永远等 release。
   */
  async #prepare(session: Session, prior: Promise<boolean>): Promise<void> {
    // 上一次 cleanup 未完成前不开新 context；它若没真正释放，就不能替换。
    const priorReleased = await prior;
    if (session.fenced) return;
    if (!priorReleased) {
      this.#fail(session, session.startSequence);
      return;
    }
    let context: AudioContext;
    try {
      context = this.createContext();
      session.context = context;
      const gain = context.createGain();
      session.gain = gain;
      // 音量由 Main 从本机实际 speechVolume 取，随 start 事件下来；渲染层不自己存一份。
      gain.gain.value = session.volume / 100;
      gain.connect(context.destination);
    } catch {
      this.#fail(session, session.startSequence);
      return;
    }
    try {
      await context.resume();
    } catch {
      this.#fail(session, session.startSequence);
      return;
    }
    // resume 已 resolve 但没到 running：同样是准备失败，不能静默留着资源。
    if (session.fenced) return;
    if (context.state !== 'running') {
      this.#fail(session, session.startSequence);
      return;
    }
    session.nextStart = context.currentTime;
    // playerReady 也可能 reject（RPC 断），同样走准备失败出口，不能让它悬着。
    try {
      const result = await this.bridge.playerReady({
        ...session.identity,
        sequence: session.startSequence,
        format: session.format,
      });
      if (session.fenced) return;
      if (!result.ok) this.#fail(session, session.startSequence);
    } catch {
      if (!session.fenced) this.#fail(session, session.startSequence);
    }
  }

  /**
   * 串行推进；失败必须归到**这一段自己的** sequence。
   *
   * 不能用 `session.expectedSequence`：那是下一个待处理的序号，Main 手上还没有它，
   * 会拒绝这条 failed/released，接着 release 就永远等不到。
   */
  #enqueue(session: Session, sequence: number, work: () => Promise<void>): void {
    session.chain = session.chain.then(work).catch(() => {
      this.#fail(session, sequence);
    });
  }

  /**
   * 把一块 chunk 按整块 + 立刻排出的短尾块写进窗口。
   * 尾块即使只有 1 frame 也要现在排，不能攒到下一块或 end。
   */
  async #scheduleChunk(session: Session, sequence: number, bytes: Uint8Array): Promise<void> {
    await session.setup;
    if (session.fenced) return;
    const frames = bytes.byteLength / 2;
    let offset = 0;
    while (offset < frames) {
      if (session.fenced) return;
      const take = Math.min(DESKTOP_SPEECH_BLOCK_FRAMES, frames - offset);
      await this.#awaitCapacity(session);
      if (session.fenced) return;
      if (!this.#scheduleBlock(session, sequence, bytes, offset, take)) return;
      offset += take;
    }
    if (session.fenced) return;
    // 全部帧已进窗口或已播完，才回消费 ACK；ACK 被拒就 fence，不再继续读。
    const result = await this.bridge.consume({
      ...session.identity,
      sequence,
      byteLength: bytes.byteLength,
    });
    if (session.fenced) return;
    if (!result.ok) this.#fail(session, sequence);
  }

  #awaitCapacity(session: Session): Promise<void> {
    if (session.blocks.size < DESKTOP_SPEECH_MAX_BLOCKS) return Promise.resolve();
    return new Promise<void>((resolve) => session.waiters.push(resolve));
  }

  /** 返回 false 表示这一块没能排上（已 fence / 设备抛错），调用方停止推进。 */
  #scheduleBlock(
    session: Session,
    sequence: number,
    bytes: Uint8Array,
    offset: number,
    frames: number,
  ): boolean {
    const context = session.context;
    const gain = session.gain;
    if (context === undefined || gain === undefined) return false;
    try {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const buffer = context.createBuffer(session.format.channels, frames, SAMPLE_RATE);
      const target = buffer.getChannelData(0);
      for (let index = 0; index < frames; index += 1)
        target[index] = view.getInt16((offset + index) * 2, true) / 32768;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      const block: Block = { source, frames, sequence };
      session.blocks.add(block);
      source.onended = () => this.#ended(session, block);
      // 饥饿时重基到当前时间：不伪造连续播放，也不丢/重复样本。
      const at = Math.max(context.currentTime, session.nextStart);
      session.nextStart = at + frames / SAMPLE_RATE;
      source.start(at);
      if (!session.started) {
        session.started = true;
        this.#track(
          session,
          this.bridge.reportPlayback({
            ...session.identity,
            sequence,
            status: 'started',
            endedFrames: 0,
          }),
          sequence,
        );
      }
      return true;
    } catch {
      this.#fail(session, sequence);
      return false;
    }
  }

  #ended(session: Session, block: Block): void {
    if (!session.blocks.delete(block)) return;
    try {
      block.source.disconnect();
    } catch {
      /* 已经断开的 source 再 disconnect 会抛，忽略。 */
    }
    session.endedFrames += block.frames;
    const waiter = session.waiters.shift();
    waiter?.();
    if (session.fenced) return;
    this.#track(
      session,
      this.bridge.reportPlayback({
        ...session.identity,
        sequence: block.sequence,
        status: 'progress',
        endedFrames: session.endedFrames,
      }),
      block.sequence,
    );
    this.#complete(session);
  }

  #finish(session: Session, sequence: number, terminal: SpeechVerifiedTerminal): void {
    if (session.fenced) return;
    session.terminal = terminal;
    session.endSequence = sequence;
    this.#complete(session);
  }

  /**
   * 只有 verified terminal + 所有 node 真的 ended，才算这一条播完。
   *
   * ended 回执也进 inflight：它失败只 fence，不会让 cleanup 丢掉——
   * cleanup 在保证执行的位置，与回执成败解耦。
   */
  #complete(session: Session): void {
    if (session.fenced || session.terminal === null) return;
    if (session.blocks.size > 0) return;
    if (this.#session !== session) return;
    // 登记 ended 回执；cleanup 会 join inflight，所以 close 一定在它 settle 之后。
    this.#track(
      session,
      this.bridge.reportPlayback({
        ...session.identity,
        sequence: session.endSequence,
        status: 'ended',
        endedFrames: session.endedFrames,
      }),
      session.endSequence,
    );
    this.#fence(session, session.endSequence);
  }

  /**
   * 同步部分：停止排新 PCM、停 node、解除容量等待。
   * 异步 cleanup 单独一个 Promise，必须 join setup/chain/inflight 后才 close。
   */
  #fence(session: Session, sequence: number): void {
    if (session.fenced) return;
    session.fenced = true;
    if (this.#session === session) this.#session = undefined;
    for (const waiter of session.waiters.splice(0)) waiter();
    for (const block of session.blocks) {
      block.source.onended = null;
      try {
        block.source.stop();
      } catch {
        /* 已经结束的 source 再 stop 会抛，忽略。 */
      }
      try {
        block.source.disconnect();
      } catch {
        /* 同上。 */
      }
    }
    session.blocks.clear();
    try {
      session.gain?.disconnect();
    } catch {
      /* 未分配的 gain 没有可断开的连接。 */
    }
    // 已分配的 context 立刻开始唯一 close：resume 可能一直挂到 close 才 settle，
    // 先等 setup 会让 stop 永远走不到 close。
    if (session.context !== undefined) void this.#closeContext(session);
    void this.#cleanup(session, sequence);
  }

  /** 已分配 context 的唯一 close；重复调用返回同一 Promise。 */
  #closeContext(session: Session): Promise<'settled' | 'failed'> {
    if (session.closing !== undefined) return session.closing;
    const context = session.context;
    if (context === undefined) return Promise.resolve('settled');
    session.closing = context.close().then(
      (): 'settled' => 'settled',
      (): 'failed' => 'failed',
    );
    return session.closing;
  }

  /**
   * 唯一收尾：close 已在 fence 时启动；这里 join setup / chain / 全部回执，
   * 再等那次 close 真正完成，最后交 released。
   *
   * 返回 cleanup 是否真的 settled：close 失败时返回 false，
   * 让下一次 prepare 拒绝在未释放的设备上开新 context。
   */
  #cleanup(session: Session, sequence: number): Promise<boolean> {
    if (session.cleanup !== undefined) return session.cleanup;
    const prior = this.#releasing;
    const cleanup = (async (): Promise<boolean> => {
      // setup/chain 在 fenced 后会自行提前返回，所以这两个 await 有界。
      await session.setup.catch(() => undefined);
      await session.chain.catch(() => undefined);
      await Promise.allSettled([...session.inflight]);
      const cleanupState = await this.#closeContext(session);
      // 报告实际清理结果；failed 仍不可复用，通知失败不改写事实或自动重试。
      try {
        await this.bridge.reportReleased({
          ...session.identity,
          sequence,
          cleanup: cleanupState,
        });
      } catch {
        /* 收尾本身已执行；不伪造成功，也不重试。 */
      }
      return cleanupState === 'settled';
    })();
    session.cleanup = cleanup;
    // 没分配资源的新 session 不能抹掉更早未释放的 context。
    this.#releasing = Promise.all([prior, cleanup]).then(
      ([previous, current]) => previous && current,
    );
    return cleanup;
  }

  /** 记录一个回执 Promise；失败即 fence，但不吞掉它、不伪造成功。 */
  #track(session: Session, work: Promise<{ ok: boolean }>, sequence: number): void {
    const tracked: Promise<void> = work.then(
      (result) => {
        if (!result.ok) this.#fail(session, sequence);
      },
      () => {
        this.#fail(session, sequence);
      },
    );
    session.inflight.add(tracked);
    void tracked.then(() => session.inflight.delete(tracked));
  }

  #fail(session: Session, sequence: number): void {
    if (session.fenced) return;
    this.#track(
      session,
      this.bridge.reportPlayback({
        ...session.identity,
        sequence,
        status: 'failed',
        endedFrames: session.endedFrames,
      }),
      sequence,
    );
    this.#fence(session, sequence);
  }
}
