import { deferred, within } from './helpers.mjs';

// These are native Cortico response/attempt shapes, also exercised by companion-cortico-gate.mjs.
const { createResponse } = await import('cortico/protocol/open-responses/index.ts');
const { GenerationError, unknownMeters } = await import('cortico/core/generation.ts');
const origin = {
  instance: 'recovery-http',
  module: 'openai-responses-compat',
  model: 'controlled-offline',
  compatibilityDomain: 'recovery.invalid',
};

export function functionCall(name, callId, args) {
  return {
    type: 'function_call',
    id: `item-${callId}`,
    call_id: callId,
    name,
    arguments: JSON.stringify(args),
    status: 'completed',
  };
}

export function assistantMessage(text) {
  return {
    type: 'message',
    id: 'controlled-answer',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text, annotations: [] }],
  };
}

export function controlledClient(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Reflect.ownKeys(options).some((key) => key !== 'holdResponses'))
    throw new TypeError('Invalid controlled Responses options');
  const holdResponses = options.holdResponses ?? 2;
  if (!Number.isSafeInteger(holdResponses) || holdResponses < 0 || holdResponses > 12)
    throw new TypeError('holdResponses must be an integer between 0 and 12');
  const requests = [];
  const slots = [];
  const client = {
    respond(request, options = {}) {
      const pending = deferred();
      const index = requests.length;
      const id = `controlled-${index + 1}`;
      const attempt = (outcome) => ({
        id: `attempt-${id}`,
        generationId: id,
        ordinal: 1,
        origin,
        startedAt: new Date().toISOString(),
        elapsedMs: 0,
        requestId: null,
        responseId: id,
        outcome,
        status: outcome === 'completed' ? 200 : null,
        serviceTier: null,
        meters: unknownMeters(),
        charges: [],
      });
      const abort = () => flight.fail();
      const flight = {
        request,
        options,
        done: false,
        complete(output = []) {
          if (flight.done) return;
          flight.done = true;
          options.signal?.removeEventListener('abort', abort);
          pending.resolve({
            response: {
              ...createResponse(id, request, 0),
              status: 'completed',
              completed_at: 0,
              output,
            },
            origin,
            attempts: [attempt('completed')],
          });
        },
        fail() {
          if (flight.done) return;
          flight.done = true;
          options.signal?.removeEventListener('abort', abort);
          pending.reject(
            new GenerationError('Controlled request aborted', [attempt('aborted')], null, origin),
          );
        },
      };
      requests.push(flight);
      (slots[index] ??= deferred()).resolve(flight);
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) abort();
      // By default only the first two inferences are held; later results drain normally.
      if (index >= holdResponses) flight.complete();
      return pending.promise;
    },
  };
  return {
    client,
    requests,
    next(index) {
      return within((slots[index - 1] ??= deferred()).promise, `inference ${index}`);
    },
    close() {
      for (const flight of requests) flight.fail();
    },
  };
}
