import { MODEL_REASONING_EFFORTS } from '@pet/contracts';
import {
  anthropicBody,
  anthropicChatResponse,
  geminiBody,
  geminiChatResponse,
  planBody,
  planAssembly,
} from './native-protocols.mjs';
let Client;
let ResponsesClient;
let PlanClient;
let NativeClient;
const quiet = Object.freeze({
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  emit() {},
  child() {
    return quiet;
  },
});
export async function respondCompatible(
  secret,
  model,
  request,
  signal,
  endpoint = { id: 'deepseek', baseUrl: 'https://api.deepseek.com', protocol: 'chat' },
  diagnostic = false,
  origins = [],
) {
  signal.throwIfAborted();
  const effort = endpoint.reasoningEffort;
  if (
    !['chat', 'responses', 'anthropic', 'gemini', 'browser'].includes(endpoint.protocol) ||
    (effort !== undefined && !MODEL_REASONING_EFFORTS.includes(effort))
  )
    throw Object.assign(new Error('Unsupported reasoning setting'), { code: 'invalid-input' });
  const explicitEffort = effort !== undefined && effort !== 'default' ? effort : undefined;
  if (explicitEffort)
    request = { ...request, reasoning: { ...request.reasoning, effort: explicitEffort } };
  if (!Client) {
    process.env.TSX_DISABLE_CACHE = '1';
    const { register } = await import('tsx/esm/api');
    register();
    const { OpenAIHttpClient } = await import('cortico/providers/transport/chat.ts');
    ResponsesClient = (await import('cortico/providers/openai-responses-compat/native.ts'))
      .ResponsesProvider;
    PlanClient = class extends ResponsesClient {
      buildResponseBody(request, options) {
        return planBody(super.buildResponseBody(request, options));
      }
      responseAssembly() {
        return planAssembly(super.responseAssembly());
      }
    };
    NativeClient = class extends OpenAIHttpClient {
      constructor(key, model, endpoint, maxTokens) {
        super(endpoint.baseUrl, quiet);
        this.key = key;
        this.model = model;
        this.endpoint = endpoint;
        this.maxTokens = maxTokens;
        this.chatPath =
          endpoint.protocol === 'anthropic'
            ? '/v1/messages'
            : '/models/' + encodeURIComponent(model) + ':generateContent';
      }
      headers() {
        return this.endpoint.protocol === 'anthropic'
          ? { 'x-api-key': this.key, 'anthropic-version': '2023-06-01' }
          : { 'x-goog-api-key': this.key };
      }
      buildResponseBody(request, options) {
        this.signatures = new Map();
        let pending;
        for (const entry of options.context ?? []) {
          const item = entry.item;
          if (item.type === 'reasoning')
            pending =
              entry.context?.origin?.compatibilityDomain === options.origin?.compatibilityDomain
                ? item.encrypted_content
                : undefined;
          else if (item.type === 'function_call') {
            if (pending) this.signatures.set(item.call_id, pending);
            pending = undefined;
          } else if (item.type === 'function_call_output' || item.role === 'user')
            pending = undefined;
        }
        return super.buildResponseBody(request, options);
      }
      buildBody(spec, messages, tools) {
        return this.endpoint.protocol === 'anthropic'
          ? anthropicBody(this.model, messages, tools, this.maxTokens, spec.reasoningEffort)
          : geminiBody(messages, tools, this.maxTokens, this.signatures, spec.reasoningEffort);
      }
      parseResponse(raw, request) {
        const parsed = super.parseResponse(
          this.endpoint.protocol === 'anthropic'
            ? anthropicChatResponse(raw)
            : geminiChatResponse(raw, this.model),
          request,
        );
        if (this.endpoint.protocol === 'gemini') {
          const parts = raw.candidates?.[0]?.content?.parts ?? [];
          const signature =
            parts.find((part) => part.functionCall && typeof part.thoughtSignature === 'string')
              ?.thoughtSignature ??
            parts.filter((part) => typeof part.thoughtSignature === 'string').at(-1)
              ?.thoughtSignature;
          if (signature) {
            let reasoning = parsed.response.output.find((item) => item.type === 'reasoning');
            if (!reasoning) {
              reasoning = { type: 'reasoning', id: 'rs_' + crypto.randomUUID(), summary: [] };
              parsed.response.output.unshift(reasoning);
            }
            reasoning.encrypted_content = signature;
          }
        }
        return parsed;
      }
      async judgeStreamFailure() {
        return { retry: false };
      }
    };
    Client = class extends OpenAIHttpClient {
      constructor(key, selected, baseUrl) {
        super(baseUrl, quiet);
        this.key = key;
        this.selected = selected;
      }
      headers() {
        return { authorization: 'Bearer ' + this.key };
      }
      buildBody(spec, messages, tools) {
        return {
          model: this.selected,
          messages,
          max_tokens: spec.maxTokens ?? 8192,
          ...(spec.reasoningEffort ? { reasoning_effort: spec.reasoningEffort } : {}),
          ...(tools?.length
            ? {
                tools: tools.map((t) => ({
                  type: 'function',
                  function: { name: t.name, description: t.description, parameters: t.parameters },
                })),
              }
            : {}),
        };
      }
      async judgeStreamFailure() {
        return { retry: false };
      }
    };
  }
  const client =
    endpoint.protocol === 'browser'
      ? new PlanClient({
          baseUrl: endpoint.baseUrl,
          apiKey: secret,
          log: quiet,
          reasoningReplay: 'encrypted',
          sendSyntheticReasoning: false,
        })
      : ['anthropic', 'gemini'].includes(endpoint.protocol)
        ? new NativeClient(secret, model, endpoint, diagnostic ? 256 : 8192)
        : endpoint.protocol === 'responses'
          ? new ResponsesClient({
              baseUrl: endpoint.baseUrl,
              apiKey: secret,
              log: quiet,
              reasoningReplay: 'plaintext',
            })
          : new Client(secret, model, endpoint.baseUrl);
  const result = await client.respond(
    { ...request, model },
    {
      signal,
      ...(['gemini', 'browser'].includes(endpoint.protocol) &&
      Array.isArray(origins) &&
      Array.isArray(request.input)
        ? {
            context: request.input.map((item) => ({
              version: 2,
              item,
              context: {
                ...(origins.find((value) => value.id === item.id)?.origin
                  ? { origin: origins.find((value) => value.id === item.id).origin }
                  : {}),
              },
            })),
          }
        : {}),
      ...(endpoint.protocol === 'browser' ? { onEvent: () => {} } : {}),
      diagnostic,
      role: diagnostic ? 'probe' : 'reply',
      nativeSpec: {
        model,
        thinking: true,
        maxTokens: diagnostic ? 256 : 8192,
        ...(explicitEffort ? { reasoningEffort: explicitEffort } : {}),
      },
      origin: {
        instance: endpoint.id,
        module: 'pet.llm-provider',
        model,
        compatibilityDomain: endpoint.protocol + ':' + endpoint.id + ':' + endpoint.baseUrl,
      },
    },
  );
  return JSON.parse(JSON.stringify(result));
}

/** One bounded generation through the same adapter used by normal replies. */
export async function testModelConnection(endpoint, model, secret, signal, reasoningEffort) {
  const started = performance.now();
  try {
    signal.throwIfAborted();
    if (
      typeof model !== 'string' ||
      !model.trim() ||
      model.length > 128 ||
      [...model].some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    )
      return { ok: false, elapsedMs: null, reason: 'invalid-input' };
    const generation = await respondCompatible(
      secret,
      model,
      {
        model,
        input: [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Reply with OK.' }],
          },
        ],
        max_output_tokens: 256,
      },
      signal,
      { ...endpoint, reasoningEffort: reasoningEffort ?? endpoint.reasoningEffort },
      true,
    );
    signal.throwIfAborted();
    const response = generation?.response;
    const ok =
      response?.status === 'completed' &&
      Array.isArray(response.output) &&
      response.output.length > 0;
    return {
      ok,
      elapsedMs: Math.round(performance.now() - started),
      model,
      ...(!ok ? { reason: '模型没有完成连接测试' } : {}),
    };
  } catch (error) {
    const reason = signal.aborted
      ? signal.reason?.name === 'TimeoutError'
        ? 'timeout'
        : 'cancelled'
      : error?.code === 'invalid-input'
        ? 'invalid-input'
        : error?.status === 401 || error?.status === 403
          ? 'auth-failed'
          : error?.status === 429
            ? 'rate-limited'
            : error?.status === 408 || error?.status === 504 || error?.name === 'TimeoutError'
              ? 'timeout'
              : 'network';
    return { ok: false, elapsedMs: Math.round(performance.now() - started), reason };
  }
}
