import type { ResponseClient } from '@pet/harness-cortico';
export function createNativeProvider(baseUrl: string, apiKey: string): ResponseClient;
export function isNativeProtocolError(error: unknown): boolean;
