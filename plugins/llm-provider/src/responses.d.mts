import type { JsonValue } from '@pet/contracts';
export function respondCompatible(
  secret: string,
  model: string,
  request: JsonValue,
  signal: AbortSignal,
  endpoint?: { id: string; baseUrl: string; protocol: string },
  diagnostic?: boolean,
  origins?: JsonValue,
): Promise<JsonValue>;
