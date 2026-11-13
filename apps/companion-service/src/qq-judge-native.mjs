import { randomUUID } from 'node:crypto';
import { JSON_MAX_BYTES } from '@pet/contracts';
import { ResponsesProvider } from 'cortico/providers/openai-responses-compat/native.ts';
import { GenerationError, unknownMeters } from 'cortico/core/generation.ts';
import { ResponseProtocolError } from 'cortico/protocol/open-responses/stream.ts';

async function jsonBody(response) {
  if (!response.body) throw new ResponseProtocolError('Missing judgment response body');
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > JSON_MAX_BYTES)
        throw new ResponseProtocolError('Judgment response exceeds byte budget');
      chunks.push(next.value);
    }
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    } catch {
      throw new ResponseProtocolError('Invalid judgment JSON body');
    }
  } finally {
    try {
      await reader.cancel();
    } finally {
      reader.releaseLock();
    }
  }
}

/** Unary participation only: one real fetch, with native Responses serialization and parsing. */
class QQJudgeResponsesProvider extends ResponsesProvider {
  async respond(request, options = {}) {
    if (options.diagnostic || options.onEvent || request.tools?.length)
      throw new TypeError(
        'Participation judgment requires one non-diagnostic tool-free unary call',
      );
    const origin = options.origin ?? {
      instance: 'qq-participation',
      module: 'openai-responses-compat',
      model: request.model ?? '',
      compatibilityDomain: this.baseUrl,
    };
    const generationId = randomUUID();
    const started = Date.now();
    const attempt = {
      id: randomUUID(),
      generationId,
      ordinal: 0,
      origin: structuredClone(origin),
      startedAt: new Date(started).toISOString(),
      elapsedMs: 0,
      requestId: null,
      responseId: null,
      outcome: 'failed',
      status: null,
      serviceTier: null,
      requestedServiceTier: request.service_tier ?? null,
      purpose: 'generation',
      meters: unknownMeters(),
      charges: [],
    };
    let sent = false;
    let partial = null;
    let failure;
    try {
      options.signal?.throwIfAborted();
      const body = this.buildResponseBody(request, options);
      const serialized = JSON.stringify(body);
      if (Buffer.byteLength(serialized) > JSON_MAX_BYTES)
        throw new ResponseProtocolError('Judgment request exceeds byte budget');
      const headers = await this.headers();
      options.signal?.throwIfAborted();
      sent = true;
      const response = await fetch(`${this.baseUrl}${this.chatPath}`, {
        method: 'POST',
        headers,
        body: serialized,
        signal: options.signal,
        redirect: 'error',
      });
      attempt.status = response.status;
      attempt.requestId = response.headers.get('x-request-id');
      if (!response.ok) {
        await response.body?.cancel();
        // Status is evidence; an arbitrary provider error body is not part of this tiny decision API.
        throw new Error('Judgment provider rejected the request');
      }
      const parsed = this.parseResponse(await jsonBody(response), request);
      partial = parsed.response;
      attempt.meters = parsed.meters;
      attempt.serviceTier = parsed.serviceTier;
      attempt.responseId = partial.id;
      if (!['completed', 'incomplete'].includes(partial.status))
        throw new ResponseProtocolError('Judgment response has no successful terminal state');
      options.signal?.throwIfAborted();
      attempt.outcome = partial.status;
    } catch (error) {
      failure = error;
      if (options.signal?.aborted) attempt.outcome = 'aborted';
    } finally {
      attempt.elapsedMs = Date.now() - started;
    }
    const attempts = sent ? [attempt] : [];
    if (failure)
      throw new GenerationError(
        'QQ participation request failed',
        attempts,
        partial,
        origin,
        attempt.status ?? 0,
        '',
        { cause: failure },
      );
    return { response: partial, origin, attempts };
  }
}

export function createQQJudgeNativeProvider(baseUrl, apiKey) {
  return new QQJudgeResponsesProvider({
    baseUrl,
    apiKey,
    reasoningReplay: 'plaintext',
    sendSyntheticReasoning: false,
  });
}
