import { VOICE_INPUT_CLOUD_ORIGINS, type JsonValue } from '@pet/contracts';
import { pcmWave } from '@pet/audio-capture/wave';
export { pcmWave } from '@pet/audio-capture/wave';
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
