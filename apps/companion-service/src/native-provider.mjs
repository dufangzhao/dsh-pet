import { ResponsesProvider } from 'cortico/providers/openai-responses-compat/native.ts';

/** Keep upstream .ts implementation outside this workspace's strict type compilation. */
export function createNativeProvider(baseUrl, apiKey) {
  return new ResponsesProvider({
    baseUrl,
    apiKey,
    reasoningReplay: 'plaintext',
    sendSyntheticReasoning: false,
  });
}
