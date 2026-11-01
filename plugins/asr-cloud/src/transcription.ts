import { VOICE_INPUT_CLOUD_ORIGINS, type JsonValue } from '@pet/contracts';
export function pcmWave(samples: Float32Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(44 + samples.length * 2),
    view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const value = samples[i];
    if (value === undefined || !Number.isFinite(value) || Math.abs(value) > 1)
      throw new Error('audio-format');
    view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}
export async function transcribeOpenAI(
  samples: Float32Array,
  model: string,
  key: string,
  signal: AbortSignal,
  request: typeof fetch = fetch,
  baseUrl = 'https://api.openai.com/v1',
): Promise<JsonValue> {
  if (!/^[a-zA-Z0-9._:/-]{1,128}$/.test(model)) return { errorCode: 'invalid-input', text: '' };
  let endpoint: URL;
  try {
    const base = new URL(baseUrl);
    if (
      base.protocol !== 'https:' ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      !VOICE_INPUT_CLOUD_ORIGINS.some((origin) => base.origin === origin)
    )
      return { text: '', errorCode: 'permission-denied' };
    endpoint = new URL(base.href.replace(/\/$/, '') + '/audio/transcriptions');
  } catch {
    return { text: '', errorCode: 'invalid-input' };
  }
  if (!samples.length) return { modelId: 'openai', text: '', errorCode: null };
  const form = new FormData();
  form.set('model', model);
  form.set('file', new Blob([pcmWave(samples)], { type: 'audio/wav' }), 'recording.wav');
  try {
    const response = await request(endpoint.href, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + key },
      body: form,
      signal,
      redirect: 'error',
    });
    if (!response.ok)
      return {
        text: '',
        errorCode:
          response.status === 401 || response.status === 403
            ? 'auth-failed'
            : response.status === 429
              ? 'rate-limited'
              : 'network',
      };
    if (!response.body) return { text: '', errorCode: 'network' };
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > 65536) return { text: '', errorCode: 'asr-failed' };
        chunks.push(next.value);
      }
    } finally {
      await reader.cancel();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as {
      text?: unknown;
    };
    if (typeof body.text !== 'string' || [...body.text].length > 4000)
      return { text: '', errorCode: 'asr-failed' };
    return { modelId: 'openai', text: body.text.trim(), errorCode: null };
  } catch {
    return { text: '', errorCode: signal.aborted ? 'cancelled' : 'network' };
  }
}
