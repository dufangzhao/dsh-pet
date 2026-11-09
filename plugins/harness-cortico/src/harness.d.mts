import type {
  CompanionAgentView,
  CompanionMemoryMutationResult,
  CompanionCommandReceipt,
  CompanionSnapshot,
  CompanionTaskCommand,
  KernelError,
} from '@pet/contracts';
import type { Request, Response, StreamEvent } from 'cortico/protocol/open-responses/index.ts';

/** Native wire types are reused; provider attempt/context metadata stays opaque at this facade. */
export interface ResponseClient {
  respond(
    request: Request,
    options?: {
      signal?: AbortSignal;
      onEvent?: (event: StreamEvent) => void;
      role?: string;
      sessionId?: string;
      diagnostic?: boolean;
      [key: string]: unknown;
    },
  ): Promise<{
    response: Response;
    origin: { instance: string; module: string; model: string; compatibilityDomain: string };
    /** Pass the complete native ProviderAttempt array through, without flattening it. */
    attempts: readonly unknown[];
  }>;
}

export interface CorticoHarnessOptions {
  readonly dataDirectory: string;
  readonly name: string;
  readonly persona: string;
  readonly profileRevision?: number;
  readonly mode: 'scripted' | 'model';
  readonly model?: string;
  readonly baseUrl?: string;
  /** Host-authorized transport; must propagate signals and native GenerationError partials. */
  readonly client?: ResponseClient;
}

export interface HarnessInput {
  readonly id: string;
  readonly text: string;
  readonly kind: 'user' | 'work-result';
  readonly taskId?: string;
}

export interface HarnessOrigin {
  /** Stable effect id derived from the product input and normalized tool arguments. */
  readonly id: string;
  readonly inputIds: readonly string[];
  /** Projection-local call identity for diagnostics, never a logical task identity. */
  readonly callId: string;
}

export interface HarnessOutput {
  readonly id: string;
  readonly text: string;
  readonly inputIds: readonly string[];
  readonly taskId?: string;
}

export interface HarnessProductContext extends Pick<
  CompanionSnapshot,
  'messages' | 'facts' | 'tasks'
> {
  readonly memoryRevision: number;
}
export interface HarnessProfileBinding {
  readonly name: string;
  readonly persona: string;
  readonly revision: number;
}
export interface CorticoHarnessPorts {
  context(): Promise<HarnessProductContext>;
  projectionApplied(value: { profileRevision: number | null; memoryRevision: number }): void;
  projectionFailed(value: { memoryRevision: number; error: KernelError }): void;
  finishInputs(inputIds: readonly string[]): void;
  publish(output: HarnessOutput): Promise<void>;
  startWork(
    request: Omit<CompanionTaskCommand, 'commandId'>,
    origin: HarnessOrigin,
  ): Promise<CompanionCommandReceipt>;
  stopWork(id: string): Promise<CompanionCommandReceipt>;
  rememberFact(
    key: string,
    value: string,
    origin: HarnessOrigin,
  ): Promise<CompanionMemoryMutationResult>;
  status(status: CompanionAgentView['status'], error?: KernelError): void;
}

export interface CorticoHarness {
  accept(input: HarnessInput): Promise<void>;
  /** Fences old effects, drains the Core, then reconstructs from canonical context. */
  stopForeground(): Promise<void>;
  close(): Promise<void>;
}

export function createCorticoHarness(
  options: CorticoHarnessOptions,
  ports: CorticoHarnessPorts,
): Promise<CorticoHarness>;
