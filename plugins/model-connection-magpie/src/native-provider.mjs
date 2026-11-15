import { ResponsesProvider } from 'cortico/providers/openai-responses-compat/native.ts';
import { STREAM_EVENT_TYPES } from 'cortico/protocol/open-responses/generated.ts';

// Observed Magpie sidebands, not text/tool/lifecycle events. Future standard definitions win.
const metadataTypes = new Set([
  'codex.rate_limits',
  'codex.response.metadata',
  'response.metadata',
]);
export const MAGPIE_EVENT_CODE_UNITS_FLOOR = 64 * 1024;

export class MagpieResponsesProvider extends ResponsesProvider {
  constructor(baseUrl, apiKey) {
    super({ baseUrl, apiKey, reasoningReplay: 'plaintext', sendSyntheticReasoning: false });
    // These native limits count JS string.length (UTF-16 code units), not UTF-8 bytes.
    this.eventCodeUnitsFloor = MAGPIE_EVENT_CODE_UNITS_FLOOR;
  }

  responseAssembly() {
    const native = super.responseAssembly();
    return {
      feed(payload, emit) {
        if (
          payload &&
          typeof payload === 'object' &&
          metadataTypes.has(payload.type) &&
          !STREAM_EVENT_TYPES.has(payload.type)
        )
          return;
        native.feed(payload, emit);
      },
      finish: () => native.finish(),
      snapshot: () => native.snapshot(),
      meters: () => native.meters(),
      serviceTier: () => native.serviceTier(),
    };
  }
}

/** The host invokes this inside the existing connector-owned credential lease. */
export function createMagpieNativeProvider(baseUrl, apiKey) {
  return new MagpieResponsesProvider(baseUrl, apiKey);
}
