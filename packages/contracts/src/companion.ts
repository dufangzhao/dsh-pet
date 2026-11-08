/** Versioned, browser-safe text-service contract. Execution Sessions stay internal. */
import type { KernelError } from './errors.js';
import type { CompanionModelView } from './companion-model.js';
import type { JsonObject } from './json.js';

export const COMPANION_PROTOCOL_VERSION = 1 as const;
export const COMPANION_MAX_TEXT = 8_000;
export const COMPANION_MAX_CODE = 16_000;
export const COMPANION_EVENT_PAGE_SIZE = 200;

export type CompanionTaskStatus =
  | 'accepted'
  | 'running'
  | 'cancel-requested'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'interrupted'
  | 'unknown';

export interface CompanionArtifact {
  readonly id: string;
  readonly taskId: string;
  readonly name: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
}

export interface CompanionTask {
  readonly id: string;
  readonly executionId: string;
  readonly title: string;
  readonly status: CompanionTaskStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly logsTruncated: boolean;
  readonly artifacts: readonly CompanionArtifact[];
  readonly error: KernelError | null;
}

export interface CompanionMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant' | 'notice';
  readonly text: string;
  readonly createdAt: number;
  readonly inputId: string | null;
  readonly taskId: string | null;
}

export interface CompanionFact {
  readonly key: string;
  readonly value: string;
  readonly revision: number;
  readonly updatedAt: number;
}

export interface CompanionAgentView {
  readonly id: string;
  readonly name: string;
  readonly profileRevision: number;
  readonly harness: string;
  readonly mode: 'scripted' | 'model';
  readonly status: 'ready' | 'busy' | 'unavailable';
  readonly error: KernelError | null;
}

export interface CompanionPluginView {
  readonly id: string;
  readonly name: string;
  readonly state: string;
  readonly desiredActive: boolean;
  readonly protected: boolean;
}

export interface CompanionSnapshot {
  readonly protocolVersion: typeof COMPANION_PROTOCOL_VERSION;
  readonly epoch: string;
  readonly cursor: number;
  readonly now: number;
  readonly agent: CompanionAgentView;
  readonly messages: readonly CompanionMessage[];
  readonly tasks: readonly CompanionTask[];
  readonly facts: readonly CompanionFact[];
  readonly plugins: readonly CompanionPluginView[];
  /** Absent only for a service predating explicit model connection management. */
  readonly model?: CompanionModelView;
  readonly projection?: {
    readonly hasMoreMessages: boolean;
    readonly hasMoreTasks: boolean;
    readonly taskDetailsTruncated: boolean;
  };
}

/** Durable notifications; clients can refetch the bounded snapshot after a batch. */
export interface CompanionEvent {
  readonly id: string;
  readonly epoch: string;
  readonly sequence: number;
  readonly time: number;
  readonly kind: 'message' | 'task' | 'fact' | 'profile' | 'runtime';
  readonly data: JsonObject;
}

export interface CompanionEventPage {
  readonly epoch: string;
  readonly cursor: number;
  readonly events: readonly CompanionEvent[];
  readonly hasMore: boolean;
}

export interface CompanionCommandReceipt {
  readonly commandId: string;
  readonly status: 'accepted' | 'duplicate';
  readonly messageId: string | null;
  readonly taskId: string | null;
}

export interface CompanionMessageCommand {
  readonly commandId: string;
  readonly text: string;
}

export interface CompanionTaskCommand {
  readonly commandId: string;
  readonly title: string;
  readonly code: string;
  readonly files?: readonly { readonly path: string; readonly content: string }[];
  readonly outputs?: readonly { readonly path: string; readonly mediaType?: string }[];
  readonly timeoutMs?: number;
}

export interface CompanionStopCommand {
  readonly commandId: string;
}

export interface CompanionFactCommand {
  readonly commandId: string;
  readonly key: string;
  readonly value: string;
}

export interface CompanionPluginCommand {
  readonly commandId: string;
  readonly enabled: boolean;
}

export interface CompanionHarnessCommand {
  readonly commandId: string;
  readonly harness: string;
}
