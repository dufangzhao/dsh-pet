import type {
  CompanionAgentView,
  CompanionInputOrigin,
  CompanionMaterialSelection,
  CompanionMaterialRef,
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
  /** Default 2; at most the canonical context hard limit (4). */
  readonly maxContexts?: number;
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

export interface HarnessReplyAttachment {
  readonly kind: 'material' | 'artifact';
  readonly id: string;
}

export interface HarnessOutput {
  readonly id: string;
  /** Complete formal text. The host owns bounded inline/text-document publication. */
  readonly text: string;
  readonly inputIds: readonly string[];
  readonly taskId?: string;
  readonly attachments?: readonly HarnessReplyAttachment[];
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

/** Already resolved/authorized native parts; the Harness never downloads a caller URL. */
export interface HarnessResolvedImage {
  readonly type: 'input_image';
  readonly image_url: string;
  readonly detail?: 'auto' | 'low' | 'high';
}
export interface HarnessInputTerminal {
  readonly inputId: string;
  readonly contextId: string;
  readonly status: 'completed' | 'failed' | 'cancelled';
  readonly cleanup: 'settled' | 'failed';
  readonly error: KernelError | null;
}

/** Host-private worker input references; binary bytes never enter the public task command. */
export type HarnessWorkRequest = Omit<CompanionTaskCommand, 'commandId'> & {
  readonly materials?: readonly CompanionMaterialSelection[];
};

/** Every callback captures one live host grant; public origin metadata is never that grant. */
export interface CorticoHarnessInputPorts {
  context(): Promise<HarnessProductContext>;
  projectionApplied(value: { profileRevision: number | null; memoryRevision: number }): void;
  projectionFailed(value: { memoryRevision: number; error: KernelError }): void;
  finishInputs(inputIds: readonly string[]): void;
  publish(output: HarnessOutput): Promise<void>;
  startWork(request: HarnessWorkRequest, origin: HarnessOrigin): Promise<CompanionCommandReceipt>;
  stopWork(id: string, origin: HarnessOrigin): Promise<CompanionCommandReceipt>;
  rememberFact(
    key: string,
    value: string,
    origin: HarnessOrigin,
  ): Promise<CompanionMemoryMutationResult>;
}
export interface HarnessInputBinding {
  readonly origin: CompanionInputOrigin;
  /** Controls discoverable tools only; the host still checks every actual operation. */
  readonly role: 'owner' | 'admin' | 'member' | 'reply-only';
  readonly signal: AbortSignal;
  readonly ports: CorticoHarnessInputPorts;
  /** Exact current-input data, separate from the bounded historical context and from authority. */
  readonly currentMaterials: readonly CompanionMaterialRef[];
  readonly currentNotes?: readonly { readonly id: string; readonly text: string }[];
  readonly resolvedInput?: readonly HarnessResolvedImage[];
  /** Called once outside Core hooks after retirement; failed cleanup does not release its slot. */
  terminal(value: HarnessInputTerminal): Promise<void>;
}
export interface CorticoHarnessPorts extends CorticoHarnessInputPorts {
  /** Cancellation only for an already registered live input; does not claim an active slot. */
  queueSignal(inputId: string): AbortSignal;
  /** Unbound bookkeeping, including source close; bound contexts use binding.terminal instead. */
  inputRejected(inputId: string, contextId: string, error: KernelError): Promise<void>;
  /** Called only when a real context slot is available; there is no owner fallback. */
  bindInput(input: HarnessInput, contextId: string): Promise<HarnessInputBinding>;
  /** The initial owner-only bootstrap was physically retired; withdraw its applied claim. */
  bootstrapRetired(): void;
  status(status: CompanionAgentView['status'], error?: KernelError): void;
}

export interface CorticoHarness {
  /** Enqueues within the canonical ready limit; completion is reported through the private ports. */
  accept(input: HarnessInput): Promise<void>;
  /** Fences and retires current input contexts, then installs a fresh owner-only bootstrap. */
  stopForeground(): Promise<void>;
  close(): Promise<void>;
}

export function createCorticoHarness(
  options: CorticoHarnessOptions,
  ports: CorticoHarnessPorts,
): Promise<CorticoHarness>;
