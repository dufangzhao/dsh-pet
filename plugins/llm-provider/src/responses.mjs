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
      buildBody(_spec, messages, tools) {
        return this.endpoint.protocol === 'anthropic'
          ? anthropicBody(this.model, messages, tools, this.maxTokens)
          : geminiBody(messages, tools, this.maxTokens, this.signatures);
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
      nativeSpec: { model, thinking: true, maxTokens: 8192 },
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
