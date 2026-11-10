import { KernelFault } from '@pet/host-kernel';
import type { VoiceAsrSettings, VoiceCandidate } from '@pet/contracts';

const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const invalidToken = (value: string): boolean =>
  /[\s\\]/.test(value) ||
  [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
const bad = (): never => {
  throw new KernelFault('invalid-input');
};
export function resolveMiMoAsr(modelRef: string): { vendor: string; wireModel: string } {
  if (!modelRef || modelRef.length > 128 || invalidToken(modelRef)) return bad();
  const slash = modelRef.indexOf('/');
  const vendor = modelRef.slice(0, slash),
    wireModel = modelRef.slice(slash + 1);
  if (
    slash <= 0 ||
    vendor.toLowerCase() === 'group' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(vendor) ||
    !/^mimo-[a-z0-9._:-]+$/i.test(wireModel) ||
    !/(?:^|[-_])asr(?:$|[-_.:0-9])/i.test(wireModel) ||
    /voiceclone/i.test(wireModel)
  )
    return bad();
  return { vendor, wireModel };
}
/** The single settings/codec eligibility authority; this does not assert remote model rights. */
export function parseMagpieAsrSettings(value: unknown): VoiceAsrSettings {
  if (
    !object(value) ||
    Object.keys(value).sort().join(',') !== 'authMode,baseUrl,modelRef,protocol' ||
    typeof value['baseUrl'] !== 'string' ||
    !value['baseUrl'] ||
    value['baseUrl'].length > 2048 ||
    invalidToken(value['baseUrl']) ||
    typeof value['modelRef'] !== 'string' ||
    value['protocol'] !== 'mimo-native' ||
    !['local-client-id', 'gateway-key'].includes(String(value['authMode']))
  )
    return bad();
  let url: URL;
  try {
    url = new URL(value['baseUrl']);
  } catch {
    return bad();
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    !(url.protocol === 'https:' || (url.protocol === 'http:' && local)) ||
    (value['authMode'] === 'local-client-id' && !local)
  )
    return bad();
  const baseUrl = url.href.replace(/\/+$/, '');
  if (baseUrl.length > 2048) return bad();
  const modelRef = value['modelRef'];
  if (modelRef) resolveMiMoAsr(modelRef);
  return {
    baseUrl,
    modelRef,
    protocol: 'mimo-native',
    authMode: value['authMode'] as VoiceAsrSettings['authMode'],
  };
}
export type VoiceModelRole = 'asr' | 'tts' | 'chat' | 'other' | 'unknown';
const roles: Readonly<Record<string, VoiceModelRole>> = {
  speech_to_text: 'asr',
  transcription: 'asr',
  asr: 'asr',
  stt: 'asr',
  text_to_speech: 'tts',
  speech: 'tts',
  tts: 'tts',
  embedding: 'other',
  rerank: 'other',
  image: 'other',
  video: 'other',
  decision: 'other',
  chat_completion: 'chat',
  chat_completions: 'chat',
  audio_understanding: 'chat',
  chat: 'chat',
  llm: 'chat',
};
export function classifyVoiceModel(row: Record<string, unknown>): {
  role: VoiceModelRole;
  classification: 'metadata' | 'known-name';
} {
  const explicit: VoiceModelRole[] = [];
  for (const field of ['provider_type', 'serves', 'kind']) {
    const value = row[field];
    for (const role of Array.isArray(value) ? value : [value])
      if (typeof role === 'string') {
        const known = roles[role.toLowerCase()];
        if (known) explicit.push(known);
      }
  }
  if (new Set(explicit).size > 1) return { role: 'unknown', classification: 'metadata' };
  if (explicit[0]) return { role: explicit[0], classification: 'metadata' };
  const name =
    String(row['id'] ?? '')
      .split('/')
      .at(-1)
      ?.toLowerCase() ?? '';
  if (/(?:^|[-_])(?:asr|whisper|transcribe|transcription|sensevoice)(?:$|[-_.:0-9])/.test(name))
    return { role: 'asr', classification: 'known-name' };
  if (/(?:^|[-_])tts(?:$|[-_.:0-9])/.test(name))
    return { role: 'tts', classification: 'known-name' };
  return { role: 'unknown', classification: 'known-name' };
}
export function normalizeAsrCatalog(value: unknown): readonly VoiceCandidate[] {
  if (!object(value) || !Array.isArray(value['data']) || value['data'].length > 512)
    throw new KernelFault('unavailable');
  const candidates: VoiceCandidate[] = [];
  const seen = new Set<string>();
  for (const row of value['data']) {
    if (
      !object(row) ||
      typeof row['id'] !== 'string' ||
      !row['id'] ||
      row['id'].length > 128 ||
      invalidToken(row['id'])
    )
      throw new KernelFault('unavailable');
    const { role, classification } = classifyVoiceModel(row);
    if (role !== 'asr' || seen.has(row['id'])) continue;
    seen.add(row['id']);
    let supported = true;
    try {
      resolveMiMoAsr(row['id']);
    } catch {
      supported = false;
    }
    const label =
      typeof row['display_name'] === 'string'
        ? row['display_name']
        : typeof row['name'] === 'string'
          ? row['name']
          : row['id'];
    candidates.push({
      modelRef: row['id'],
      label: [...label].slice(0, 80).join(''),
      role: 'asr',
      classification,
      protocol: supported ? 'mimo-native' : null,
      selectable: supported,
      reason: supported ? null : 'unsupported-protocol',
    });
  }
  if (candidates.length > 64) throw new KernelFault('quota-exceeded');
  return candidates.sort((a, b) => a.modelRef.localeCompare(b.modelRef));
}
