import {
  MEDIA_MAX_CHUNK_BYTES,
  SPEECH_DECODED_CHUNK_MAX_BYTES,
  SPEECH_FIRST_AUDIO_TIMEOUT_MS,
  SPEECH_PRODUCER_IDLE_TIMEOUT_MS,
  SPEECH_SEGMENT_MAX_BYTES,
  SPEECH_SEGMENT_TIMEOUT_MS,
  SPEECH_SSE_EVENT_MAX_BYTES,
} from '@pet/contracts';
import { KernelFault } from '@pet/host-kernel';
import { SpeechGenerationFault } from '@pet/companion-runtime';
import type {
  AuthorizedMagpieSpeechTransport,
  AuthorizedSpeechStream,
  NativeSpeechInput,
  NativeSpeechResult,
} from '@pet/companion-runtime';

const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const invalid = (): never => {
  throw new KernelFault('audio-format');
};

/** Private native SSE decoder. It retains only the current bounded event. */
export class SpeechSseDecoder {
  private pending = '';
  private data: string[] = [];
  private size = 0;
  *push(text: string, final = false): Generator<string> {
    this.pending += text;
    for (;;) {
      const at = this.pending.search(/[\r\n]/);
      if (at < 0) break;
      if (!final && this.pending[at] === '\r' && at + 1 === this.pending.length) break;
      const line = this.pending.slice(0, at);
      const width = this.pending[at] === '\r' && this.pending[at + 1] === '\n' ? 2 : 1;
      this.pending = this.pending.slice(at + width);
      if (!line) {
        if (this.data.length) yield this.data.join('\n');
        this.data = [];
        this.size = 0;
        continue;
      }
      this.size += Buffer.byteLength(line);
      if (this.size > SPEECH_SSE_EVENT_MAX_BYTES) throw new KernelFault('quota-exceeded');
      if (line.startsWith('data:')) this.data.push(line.slice(5).replace(/^ /, ''));
    }
    if (this.size + Buffer.byteLength(this.pending) > SPEECH_SSE_EVENT_MAX_BYTES)
      throw new KernelFault('quota-exceeded');
    if (final && (this.pending.length || this.data.length)) invalid();
  }
}

function base64(value: unknown): Uint8Array {
  if (typeof value !== 'string') return invalid();
  if (value.length > Math.ceil(SPEECH_DECODED_CHUNK_MAX_BYTES / 3) * 4)
    throw new KernelFault('quota-exceeded');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    return invalid();
  const decoded = Buffer.from(value, 'base64');
  if (decoded.byteLength > SPEECH_DECODED_CHUNK_MAX_BYTES) throw new KernelFault('quota-exceeded');
  if (decoded.toString('base64') !== value) return invalid();
  return decoded;
}

/** One original native attempt. Idle runs only while reading, not while awaiting media credits. */
export async function streamMiMoSpeech(
  transport: AuthorizedMagpieSpeechTransport,
  input: NativeSpeechInput,
  signal: AbortSignal,
): Promise<NativeSpeechResult> {
  const lifetime = new AbortController();
  const absolute = new AbortController();
  const absoluteTimer = setTimeout(() => absolute.abort(), SPEECH_SEGMENT_TIMEOUT_MS);
  absoluteTimer.unref();
  const combined = AbortSignal.any([signal, lifetime.signal, absolute.signal]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let upstream: AuthorizedSpeechStream | undefined;
  let first = true;
  let bytes = 0;
  let carry: number | undefined;
  let stopped = false;
  let done = false;
  let completionId: string | undefined;
  let model: string | undefined;
  let audioId: string | undefined;
  const timedOut = (): void => lifetime.abort(new KernelFault('timeout'));
  const clear = (): void => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  const arm = (ms: number): void => {
    clear();
    timer = setTimeout(timedOut, ms);
    timer.unref();
  };
  const abort = (): void => {
    input.audio.cancel();
    upstream?.cancel();
  };
  combined.addEventListener('abort', abort, { once: true });
  if (combined.aborted) abort();
  const same = (value: unknown, previous: string | undefined): string | undefined => {
    if (value === undefined) return previous;
    if (
      typeof value !== 'string' ||
      !value ||
      value.length > 256 ||
      (previous && previous !== value)
    )
      return invalid();
    return value;
  };
  const consume = async (data: string): Promise<void> => {
    combined.throwIfAborted();
    if (done) return invalid();
    if (data === '[DONE]') {
      if (!stopped) throw new SpeechGenerationFault('missing-stop');
      done = true;
      return;
    }
    let chunk: unknown;
    try {
      chunk = JSON.parse(data) as unknown;
    } catch {
      return invalid();
    }
    if (!object(chunk) || chunk['error'] || !Array.isArray(chunk['choices'])) return invalid();
    completionId = same(chunk['id'], completionId);
    model = same(chunk['model'], model);
    if (!chunk['choices'].length) return;
    if (chunk['choices'].length !== 1) return invalid();
    const choice: unknown = chunk['choices'][0];
    if (!object(choice) || choice['index'] !== 0 || !object(choice['delta'])) return invalid();
    const delta = choice['delta'];
    if (delta['tool_calls'] || delta['function_call'] || delta['final_text_preview'])
      return invalid();
    const audio = delta['audio'];
    if (audio !== undefined && audio !== null) {
      if (!object(audio) || stopped) return invalid();
      audioId = same(audio['id'], audioId);
      if (audio['data'] !== undefined) {
        const raw = base64(audio['data']);
        const block = new Uint8Array(raw.length + Number(carry !== undefined));
        let offset = 0;
        if (carry !== undefined) block[offset++] = carry;
        block.set(raw, offset);
        const length = block.byteLength - (block.byteLength % 2);
        carry = length === block.byteLength ? undefined : block[length];
        if (bytes + length > SPEECH_SEGMENT_MAX_BYTES) throw new KernelFault('quota-exceeded');
        if (length) {
          first = false;
          bytes += length;
          input.onProduced(bytes / 2);
          // A pending write is consumer backpressure, never producer silence.
          clear();
          for (let at = 0; at < length; at += MEDIA_MAX_CHUNK_BYTES) {
            const sent = await input.audio.write(
              block.subarray(at, Math.min(length, at + MEDIA_MAX_CHUNK_BYTES)),
            );
            if (!sent.ok) throw new KernelFault(sent.error.code);
            combined.throwIfAborted();
          }
          arm(SPEECH_PRODUCER_IDLE_TIMEOUT_MS);
        }
      }
    }
    const finish = choice['finish_reason'];
    if (finish !== undefined && finish !== null) {
      if (stopped) return invalid();
      if (finish === 'length' || finish === 'content_filter')
        throw new SpeechGenerationFault(finish);
      if (finish !== 'stop') return invalid();
      if (!bytes || carry !== undefined) throw new SpeechGenerationFault('stop');
      stopped = true;
      // Bound the final usage/[DONE]/EOF wait too.
      arm(SPEECH_PRODUCER_IDLE_TIMEOUT_MS);
    }
  };
  try {
    arm(SPEECH_FIRST_AUDIO_TIMEOUT_MS);
    upstream = await transport.mimoSpeech(
      { modelRef: input.modelRef, text: input.text, voice: input.voice },
      combined,
    );
    if (combined.aborted) {
      upstream.cancel();
      combined.throwIfAborted();
    }
    const text = new TextDecoder('utf-8', { fatal: true });
    const decoder = new SpeechSseDecoder();
    for await (const raw of upstream.body) {
      combined.throwIfAborted();
      if (!(raw instanceof Uint8Array)) return invalid();
      for (const data of decoder.push(text.decode(raw, { stream: true }))) await consume(data);
    }
    for (const data of decoder.push(text.decode(), true)) await consume(data);
    if (!stopped) throw new SpeechGenerationFault('missing-stop');
    if (first || carry !== undefined) return invalid();
    clear();
    await upstream.settled;
    combined.throwIfAborted();
    const ended = await input.audio.end();
    if (!ended.ok) throw new KernelFault(ended.error.code);
    return { finishReason: 'stop', producedBytes: bytes, producedFrames: bytes / 2 };
  } catch (error) {
    if (lifetime.signal.aborted || absolute.signal.aborted) throw new KernelFault('timeout');
    if (signal.aborted) throw new KernelFault('cancelled');
    if (error instanceof KernelFault) throw error;
    throw new KernelFault('audio-format');
  } finally {
    clear();
    clearTimeout(absoluteTimer);
    combined.removeEventListener('abort', abort);
    input.audio.cancel();
    upstream?.cancel();
    if (upstream) await upstream.settled;
  }
}
