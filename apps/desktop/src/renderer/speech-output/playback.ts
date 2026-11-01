import {
  MEDIA_MAX_CHUNK_BYTES,
  SPEECH_OUTPUT_MAX_BYTES,
  isSpeechOutputAudioDescriptor,
  type SpeechOutputAudioEvent,
  type SpeechOutputAudioDescriptor,
  type SpeechOutputBridge,
  type OwnerRef,
} from '@pet/contracts';

const sameOwner = (a: OwnerRef, b: OwnerRef): boolean =>
  a.pluginId === b.pluginId && a.instanceId === b.instanceId && a.generation === b.generation;
interface Session {
  identity: SpeechOutputAudioEvent;
  descriptor: SpeechOutputAudioDescriptor;
  sequence: number;
  chunks: Uint8Array[];
  bytes: number;
  volume: number;
  ended: boolean;
  context?: AudioContext;
  source?: AudioBufferSourceNode;
  gain?: GainNode;
}

/** The sole audio consumer. Construct only in the Pet window, above its transient bubbles. */
export class SpeechPlaybackOwner {
  #session: Session | undefined;
  #closed = false;
  constructor(
    private readonly bridge: Pick<SpeechOutputBridge, 'reportPlayback'>,
    private readonly createContext: () => AudioContext = () => new AudioContext(),
  ) {}
  receive(event: SpeechOutputAudioEvent, payload?: Uint8Array): void {
    if (this.#closed) return;
    if (event.kind === 'start') {
      this.stop();
      if (
        event.sequence !== 0 ||
        payload !== undefined ||
        !isSpeechOutputAudioDescriptor(event.descriptor) ||
        event.descriptor.utteranceId !== event.utteranceId ||
        !sameOwner(event.descriptor.media.owner, event.provider) ||
        !Number.isInteger(event.volume) ||
        event.volume < 0 ||
        event.volume > 100
      ) {
        void this.bridge.reportPlayback({ playbackId: event.playbackId, status: 'failed' });
        return;
      }
      this.#session = {
        identity: event,
        descriptor: event.descriptor,
        sequence: 1,
        chunks: [],
        bytes: 0,
        volume: event.volume,
        ended: false,
      };
      return;
    }
    const session = this.#session;
    if (
      !session ||
      event.playbackId !== session.identity.playbackId ||
      event.taskId !== session.identity.taskId ||
      event.utteranceId !== session.identity.utteranceId ||
      !sameOwner(event.owner, session.identity.owner) ||
      !sameOwner(event.provider, session.identity.provider)
    )
      return;
    if (event.kind === 'stop') {
      this.stop();
      return;
    }
    if (event.sequence !== session.sequence++ || session.ended) {
      this.fail(session);
      return;
    }
    if (event.kind === 'chunk') {
      if (
        !(payload instanceof Uint8Array) ||
        !payload.byteLength ||
        payload.byteLength !== event.byteLength ||
        payload.byteLength > MEDIA_MAX_CHUNK_BYTES ||
        session.bytes + payload.byteLength > SPEECH_OUTPUT_MAX_BYTES
      ) {
        this.fail(session);
        return;
      }
      session.chunks.push(Uint8Array.from(payload));
      session.bytes += payload.byteLength;
    } else {
      session.ended = true;
      if (
        payload !== undefined ||
        session.bytes !== session.descriptor.frames * session.descriptor.channels * 2
      ) {
        this.fail(session);
        return;
      }
      void this.play(session);
    }
  }
  private current(session: Session): boolean {
    return !this.#closed && this.#session === session;
  }
  private async play(session: Session): Promise<void> {
    try {
      const context = this.createContext();
      session.context = context;
      await context.resume();
      if (!this.current(session)) return;
      const bytes = new Uint8Array(session.bytes);
      let offset = 0;
      for (const chunk of session.chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      session.chunks = [];
      const { channels, frames, sampleRate } = session.descriptor;
      const buffer = context.createBuffer(channels, frames, sampleRate);
      const view = new DataView(bytes.buffer);
      for (let channel = 0; channel < channels; channel++) {
        const target = buffer.getChannelData(channel);
        for (let frame = 0; frame < frames; frame++)
          target[frame] = view.getInt16((frame * channels + channel) * 2, true) / 32768;
      }
      const source = context.createBufferSource(),
        gain = context.createGain();
      session.source = source;
      session.gain = gain;
      source.buffer = buffer;
      gain.gain.value = session.volume / 100;
      source.connect(gain);
      gain.connect(context.destination);
      source.onended = () => {
        if (!this.current(session)) return;
        void this.bridge.reportPlayback({
          playbackId: session.identity.playbackId,
          status: 'ended',
        });
        this.stop();
      };
      source.start();
      const receipt = await this.bridge.reportPlayback({
        playbackId: session.identity.playbackId,
        status: 'started',
      });
      if (!receipt.ok && this.current(session)) this.stop();
    } catch {
      if (this.current(session)) this.fail(session);
    }
  }
  private fail(session: Session): void {
    if (!this.current(session)) return;
    void this.bridge.reportPlayback({ playbackId: session.identity.playbackId, status: 'failed' });
    this.stop();
  }
  stop(): void {
    const session = this.#session;
    this.#session = undefined;
    if (!session) return;
    session.chunks = [];
    if (session.source) {
      session.source.onended = null;
      try {
        session.source.stop();
      } catch {
        /* A source can already be ended. */
      }
      session.source.disconnect();
    }
    session.gain?.disconnect();
    if (session.context) void session.context.close().catch(() => {});
  }
  close(): void {
    this.stop();
    this.#closed = true;
  }
}
