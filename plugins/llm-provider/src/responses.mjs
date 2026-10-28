let Client;
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
export async function respondCompatible(secret, model, request, signal) {
  if (!Client) {
    process.env.TSX_DISABLE_CACHE = '1';
    const { register } = await import('tsx/esm/api');
    register();
    const { OpenAIHttpClient } = await import('cortico/providers/transport/chat.ts');
    Client = class extends OpenAIHttpClient {
      constructor(key, selected) {
        super('https://api.deepseek.com', quiet);
        this.key = key;
        this.selected = selected;
      }
      headers() {
        return { authorization: 'Bearer ' + this.key };
      }
      buildBody(_spec, messages, tools) {
        return {
          model: this.selected,
          messages,
          max_tokens: 1024,
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
  const client = new Client(secret, model);
  const result = await client.respond(
    { ...request, model },
    {
      signal,
      nativeSpec: { model },
      origin: {
        instance: 'deepseek',
        module: 'pet.llm-provider',
        model,
        compatibilityDomain: 'https://api.deepseek.com',
      },
    },
  );
  return JSON.parse(JSON.stringify(result));
}
