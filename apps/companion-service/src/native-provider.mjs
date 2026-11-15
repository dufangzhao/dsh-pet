import { ResponsesProvider } from 'cortico/providers/openai-responses-compat/native.ts';
import { GenerationError } from 'cortico/core/generation.ts';
import { ResponseProtocolError } from 'cortico/protocol/open-responses/stream.ts';

/** Keep upstream .ts implementation outside this workspace's strict type compilation. */
export function createNativeProvider(baseUrl, apiKey) {
  return new ResponsesProvider({
    baseUrl,
    apiKey,
    reasoningReplay: 'plaintext',
    sendSyntheticReasoning: false,
  });
}

/** Project only a verified native protocol failure, preserving the original exception internally. */
export function isNativeProtocolError(error) {
  return (
    error instanceof ResponseProtocolError ||
    (error instanceof GenerationError && error.cause instanceof ResponseProtocolError)
  );
}
