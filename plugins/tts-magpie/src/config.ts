import {
  isSpeechTtsSettings,
  SPEECH_GATEWAY_CATALOG_MAX_ROWS,
  SPEECH_CATALOG_MAX_CANDIDATES,
  type SpeechCandidate,
  type SpeechTtsSettings,
} from '@pet/contracts';
import { KernelFault } from '@pet/host-kernel';
import { classifyVoiceModel } from '@pet/asr-magpie';

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const invalidToken = (value: string): boolean =>
  /[\s\\]/u.test(value) ||
  [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);

/** This codec supports the documented ordinary MiMo model, not design/clone or groups. */
export function resolveMiMoSpeech(modelRef: string): { vendor: string; wireModel: string } {
  const slash = modelRef.indexOf('/');
  const vendor = modelRef.slice(0, slash);
  const wireModel = modelRef.slice(slash + 1);
  if (
    modelRef.length > 128 ||
    invalidToken(modelRef) ||
    slash <= 0 ||
    vendor.toLowerCase() === 'group' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(vendor) ||
    wireModel !== 'mimo-v2.5-tts'
  )
    throw new KernelFault('invalid-input');
  return { vendor, wireModel };
}

/** Pure settings authority. Saving never fetches a catalog or proves inference rights. */
export function parseMagpieSpeechSettings(value: unknown): SpeechTtsSettings {
  if (!isSpeechTtsSettings(value) || invalidToken(value.baseUrl))
    throw new KernelFault('invalid-input');
  let url: URL;
  try {
    url = new URL(value.baseUrl);
  } catch {
    throw new KernelFault('invalid-input');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    !(url.protocol === 'https:' || (url.protocol === 'http:' && local)) ||
    (value.authMode === 'local-client-id' && !local)
  )
    throw new KernelFault('invalid-input');
  if (value.modelRef) resolveMiMoSpeech(value.modelRef);
  return { ...value, baseUrl: url.href.replace(/\/+$/, '') };
}

export function normalizeSpeechCatalog(value: unknown): readonly SpeechCandidate[] {
  if (
    !object(value) ||
    !Array.isArray(value['data']) ||
    value['data'].length > SPEECH_GATEWAY_CATALOG_MAX_ROWS
  )
    throw new KernelFault('unavailable');
  const candidates: SpeechCandidate[] = [];
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
    if (role !== 'tts' || seen.has(row['id'])) continue;
    seen.add(row['id']);
    let selectable = true;
    try {
      resolveMiMoSpeech(row['id']);
    } catch {
      selectable = false;
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
      role: 'tts',
      classification,
      protocol: selectable ? 'mimo-native-pcm16-sse' : null,
      selectable,
      reason: selectable ? null : 'unsupported-protocol',
    });
  }
  if (candidates.length > SPEECH_CATALOG_MAX_CANDIDATES) throw new KernelFault('quota-exceeded');
  return candidates.sort((a, b) => a.modelRef.localeCompare(b.modelRef));
}
