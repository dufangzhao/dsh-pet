import type { JsonObject, JsonValue } from '@pet/contracts';
export function respondCompatible(
  secret: string,
  model: string,
  request: JsonObject,
  signal: AbortSignal,
): Promise<JsonValue>;
