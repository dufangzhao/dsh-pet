import type { JsonValue, ModelReasoningEffort, ModelServiceEndpoint } from '@pet/contracts';

export type { ModelReasoningEffort } from '@pet/contracts';
export type ModelProtocolEndpoint = Pick<ModelServiceEndpoint, 'id' | 'baseUrl' | 'protocol'> & {
  readonly reasoningEffort?: ModelReasoningEffort;
};
export type ModelConnectionTest = {
  readonly ok: boolean;
  readonly elapsedMs: number | null;
  readonly model?: string;
  readonly reason?: string;
};
export function respondCompatible(
  secret: string,
  model: string,
  request: JsonValue,
  signal: AbortSignal,
  endpoint?: ModelProtocolEndpoint,
  diagnostic?: boolean,
  origins?: JsonValue,
): Promise<JsonValue>;
export function testModelConnection(
  endpoint: ModelProtocolEndpoint,
  model: string,
  secret: string,
  signal: AbortSignal,
  reasoningEffort?: ModelReasoningEffort,
): Promise<ModelConnectionTest>;
