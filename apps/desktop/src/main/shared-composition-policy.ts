import { DESKTOP_PRESENTATION_KEYS } from '@pet/contracts';
import type { JsonObject } from '@pet/contracts';
import { isDeepStrictEqual } from 'node:util';
export const SHARED_FORBIDDEN_PLUGIN_IDS: ReadonlySet<string> = new Set([
  'pet.agent-cortico',
  'pet.llm-provider',
  'pet.chat',
  'pet.voice-chat',
  'pet.asr-local',
  'pet.asr-cloud',
  'pet.talk-key',
]);
/** Keep archived personality fields unchanged even through generic host/SDK config saves. */
export function presentationOnlyChange(previous: JsonObject, candidate: JsonObject): boolean {
  const allowed = new Set<string>(DESKTOP_PRESENTATION_KEYS);
  for (const key of new Set([...Object.keys(previous), ...Object.keys(candidate)]))
    if (!allowed.has(key) && !isDeepStrictEqual(previous[key], candidate[key])) return false;
  return true;
}
