// Gemini requires this marker for tool calls imported from another provider.
const GEMINI_IMPORTED_CALL_SIGNATURE = 'skip_thought_signature_validator';
const textOf = (content) =>
  typeof content === 'string'
    ? content
    : (content ?? [])
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('');
function nativeParts(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return (content ?? []).flatMap((part) => {
    if (part.type === 'text') return [{ type: 'text', text: part.text }];
    if (part.type === 'image_url') {
      const match = /^data:([^;]+);base64,(.+)$/.exec(part.image_url.url);
      if (!match) throw new Error('Native image must be inline data');
      return [{ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } }];
    }
    throw new Error('Unsupported native content');
  });
}
export function anthropicBody(model, messages, tools, maxTokens = 1024, reasoningEffort) {
  const system = messages
    .filter((m) => m.role === 'system' || m.role === 'developer')
    .map((m) => textOf(m.content))
    .join('\n');
  const rows = [];
  for (const message of messages) {
    if (message.role === 'system' || message.role === 'developer') continue;
    const role = message.role === 'assistant' ? 'assistant' : 'user';
    const content =
      message.role === 'tool'
        ? [
            {
              type: 'tool_result',
              tool_use_id: message.tool_call_id,
              content: textOf(message.content),
            },
          ]
        : nativeParts(message.parts ?? message.content);
    for (const call of message.tool_calls ?? [])
      content.push({
        type: 'tool_use',
        id: call.id,
        name: call.function.name,
        input: JSON.parse(call.function.arguments),
      });
    if (!content.length) continue;
    const previous = rows.at(-1);
    if (previous?.role === role) previous.content.push(...content);
    else rows.push({ role, content });
  }
  return {
    model,
    max_tokens: maxTokens,
    ...(reasoningEffort
      ? { thinking: { type: 'adaptive' }, output_config: { effort: reasoningEffort } }
      : {}),
    ...(system ? { system } : {}),
    messages: rows,
    ...(tools?.length
      ? {
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters,
          })),
        }
      : {}),
  };
}
export function anthropicChatResponse(raw) {
  const input =
    (raw.usage?.input_tokens ?? 0) +
    (raw.usage?.cache_read_input_tokens ?? 0) +
    (raw.usage?.cache_creation_input_tokens ?? 0);
  const calls = (raw.content ?? [])
    .filter((p) => p.type === 'tool_use')
    .map((p) => ({
      id: p.id,
      type: 'function',
      function: { name: p.name, arguments: JSON.stringify(p.input) },
    }));
  const text = (raw.content ?? [])
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('');
  return {
    id: raw.id,
    model: raw.model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: text || null,
          ...(calls.length ? { tool_calls: calls } : {}),
        },
        finish_reason:
          raw.stop_reason === 'tool_use'
            ? 'tool_calls'
            : raw.stop_reason === 'max_tokens'
              ? 'length'
              : 'stop',
      },
    ],
    ...(raw.usage
      ? {
          usage: {
            prompt_tokens: input,
            completion_tokens: raw.usage?.output_tokens ?? 0,
            total_tokens: input + (raw.usage?.output_tokens ?? 0),
            prompt_tokens_details: { cached_tokens: raw.usage?.cache_read_input_tokens ?? 0 },
          },
        }
      : {}),
  };
}
export function geminiBody(
  messages,
  tools,
  maxTokens = 1024,
  signatures = new Map(),
  reasoningEffort,
) {
  const system = messages
    .filter((m) => m.role === 'system' || m.role === 'developer')
    .map((m) => textOf(m.content))
    .join('\n');
  const names = new Map();
  for (const m of messages)
    for (const call of m.tool_calls ?? []) names.set(call.id, call.function.name);
  const contents = [];
  for (const message of messages) {
    if (message.role === 'system' || message.role === 'developer') continue;
    const role = message.role === 'assistant' ? 'model' : 'user';
    const parts = [];
    if (message.role === 'tool') {
      const name = names.get(message.tool_call_id);
      if (!name) throw new Error('Missing function call identity');
      const text = textOf(message.content);
      let response;
      try {
        response = JSON.parse(text);
      } catch {
        response = { result: text };
      }
      parts.push({
        functionResponse: {
          name,
          response:
            typeof response === 'object' && response !== null ? response : { result: response },
        },
      });
    } else
      for (const part of nativeParts(message.content)) {
        if (part.type === 'text') parts.push({ text: part.text });
        else
          parts.push({ inlineData: { mimeType: part.source.media_type, data: part.source.data } });
      }
    for (const [index, call] of (message.tool_calls ?? []).entries())
      parts.push({
        functionCall: { name: call.function.name, args: JSON.parse(call.function.arguments) },
        ...(index === 0
          ? { thoughtSignature: signatures.get(call.id) ?? GEMINI_IMPORTED_CALL_SIGNATURE }
          : {}),
      });
    if (!parts.length) continue;
    const previous = contents.at(-1);
    if (previous?.role === role) previous.parts.push(...parts);
    else contents.push({ role, parts });
  }
  return {
    contents,
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    generationConfig: {
      maxOutputTokens: maxTokens,
      ...(reasoningEffort
        ? { thinkingConfig: { thinkingLevel: reasoningEffort.toUpperCase() } }
        : {}),
    },
    ...(tools?.length
      ? {
          tools: [
            {
              functionDeclarations: tools.map((t) => ({
                name: t.name,
                description: t.description,
                parameters: t.parameters,
              })),
            },
          ],
        }
      : {}),
  };
}
export function geminiChatResponse(raw, model) {
  const candidate = raw.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const calls = parts
    .filter((p) => p.functionCall)
    .map((p) => ({
      id: 'gemini-' + crypto.randomUUID(),
      type: 'function',
      function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args ?? {}) },
    }));
  return {
    id: raw.responseId ?? 'gemini-' + crypto.randomUUID(),
    model: raw.modelVersion ?? model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          reasoning_content: parts
            .filter((part) => part.thought && typeof part.text === 'string')
            .map((part) => part.text)
            .join(''),
          content:
            parts
              .filter((p) => p.text && !p.thought)
              .map((p) => p.text)
              .join('') || null,
          ...(calls.length ? { tool_calls: calls } : {}),
        },
        finish_reason: calls.length
          ? 'tool_calls'
          : candidate?.finishReason === 'MAX_TOKENS'
            ? 'length'
            : 'stop',
      },
    ],
    ...(raw.usageMetadata
      ? {
          usage: {
            prompt_tokens: raw.usageMetadata?.promptTokenCount ?? 0,
            completion_tokens:
              (raw.usageMetadata?.candidatesTokenCount ?? 0) +
              (raw.usageMetadata?.thoughtsTokenCount ?? 0),
            total_tokens: raw.usageMetadata?.totalTokenCount ?? 0,
            prompt_tokens_details: {
              cached_tokens: raw.usageMetadata?.cachedContentTokenCount ?? 0,
            },
            completion_tokens_details: {
              reasoning_tokens: raw.usageMetadata?.thoughtsTokenCount ?? 0,
            },
          },
        }
      : {}),
  };
}
export function planBody(source) {
  const allowed = new Set([
    'model',
    'input',
    'instructions',
    'tools',
    'tool_choice',
    'parallel_tool_calls',
    'reasoning',
    'include',
    'prompt_cache_key',
  ]);
  const body = Object.fromEntries(Object.entries(source).filter(([key]) => allowed.has(key)));
  body.stream = true;
  body.store = false;
  const grouped = (body.tools ?? []).filter(
    (tool) => tool.type === 'function' || tool.type === 'custom',
  );
  if (grouped.length) {
    const names = new Set(grouped.map((tool) => tool.name));
    body.tools = [
      ...(body.tools ?? []).filter((tool) => !grouped.includes(tool)),
      {
        type: 'namespace',
        name: 'app',
        description: 'Application functions',
        tools: grouped.map((tool) =>
          tool.type === 'function' && tool.strict === undefined ? { ...tool, strict: false } : tool,
        ),
      },
    ];
    body.input = (body.input ?? []).map((item) =>
      (item.type === 'function_call' || item.type === 'custom_tool_call') && names.has(item.name)
        ? { ...item, namespace: 'app' }
        : item,
    );
  }
  return body;
}
export function planAssembly(inner) {
  const items = new Map(),
    announced = new Set();
  return {
    feed(event, emit) {
      if (event?.type === 'response.metadata') return;
      if (event?.type === 'response.output_item.added' && Number.isInteger(event.output_index))
        announced.add(event.output_index);
      if (event?.type === 'response.output_item.done' && Number.isInteger(event.output_index))
        items.set(event.output_index, event.item);
      if (
        ['response.completed', 'response.incomplete', 'response.failed'].includes(event?.type) &&
        Array.isArray(event.response?.output) &&
        !event.response.output.length &&
        announced.size
      ) {
        const prior = event.type === 'response.failed' ? inner.snapshot()?.output : [];
        const output = Array.from(
          { length: announced.size },
          (_, index) => items.get(index) ?? (announced.has(index) ? prior?.[index] : undefined),
        );
        if (output.every((item) => item !== undefined))
          event = { ...event, response: { ...event.response, output } };
      }
      inner.feed(event, emit);
    },
    finish: (emit) => inner.finish(emit),
    snapshot: () => inner.snapshot(),
    meters: () => inner.meters(),
    serviceTier: () => inner.serviceTier(),
  };
}
