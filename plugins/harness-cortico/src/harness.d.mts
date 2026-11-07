import type {
  CompanionAgentView,
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

export interface CorticoHarnessPorts {
  context(): Promise<Pick<CompanionSnapshot, 'messages' | 'facts' | 'tasks'>>;
  publish(output: HarnessOutput): Promise<void>;
  startWork(
    request: Omit<CompanionTaskCommand, 'commandId'>,
    origin: HarnessOrigin,
  ): Promise<CompanionCommandReceipt>;
  stopWork(id: string): Promise<CompanionCommandReceipt>;
  rememberFact(key: string, value: string, origin: HarnessOrigin): Promise<CompanionCommandReceipt>;
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
