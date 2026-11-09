import type {
  CompanionArtifact,
  CompanionFactOrigin,
  CompanionMemoryUpsertCommand,
  CompanionMemoryForgetCommand,
  CompanionCommandReceipt,
  CompanionEventPage,
  CompanionFact,
  CompanionFactCommand,
  CompanionMessage,
  CompanionMessageCommand,
  CompanionTask,
  CompanionTaskCommand,
  CompanionTaskStatus,
  JsonObject,
  KernelError,
} from '@pet/contracts';

export interface StateSnapshot {
  readonly memoryRevision: number;
  readonly assistantId: string;
  readonly epoch: string;
  readonly cursor: number;
  readonly hasMoreMessages: boolean;
  readonly hasMoreTasks: boolean;
  readonly taskDetailsTruncated: boolean;
  readonly messages: readonly CompanionMessage[];
  readonly tasks: readonly CompanionTask[];
  readonly facts: readonly CompanionFact[];
}

export interface StateMemoryView {
  readonly assistantId: string;
  readonly memoryRevision: number;
  readonly facts: readonly CompanionFact[];
  readonly usage: {
    readonly count: number;
    readonly dataBytes: number;
    readonly originBytes: number;
  };
}
export interface StateMemoryMutation {
  readonly receipt: CompanionCommandReceipt;
  readonly committedRevision: number | null;
  readonly memory: StateMemoryView;
  readonly fact: CompanionFact | null;
}
export type StateRememberInput =
  | (CompanionMemoryUpsertCommand & { readonly origin: CompanionFactOrigin })
  | (CompanionFactCommand & { readonly expectedRevision?: number });

/** Location is relative to this provider's artifact root, never the state directory. */
export interface StoredArtifact extends CompanionArtifact {
  readonly provider: string;
  readonly relativePath: string;
}

export interface UpdateTaskInput {
  readonly taskId: string;
  readonly status: CompanionTaskStatus;
  readonly exitCode?: number | null;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly logsTruncated?: boolean;
  readonly error?: KernelError | null;
  readonly artifacts?: readonly StoredArtifact[];
}

export interface AppendMessageInput {
  readonly id: string;
  readonly role: CompanionMessage['role'];
  readonly text: string;
  readonly inputId?: string | null;
  readonly taskId?: string | null;
}

export interface CommandLookup {
  readonly commandId: string;
  readonly kind: string;
  readonly payload: JsonObject;
}

export interface RecordCommandInput extends CommandLookup {
  readonly taskId?: string | null;
  readonly messageId?: string | null;
}

export interface StateMethodInputs {
  snapshot: {
    readonly messageLimit?: number;
    readonly taskLimit?: number;
    readonly byteBudget?: number;
  };
  events: { readonly after: number; readonly epoch: string; readonly limit?: number };
  acceptMessage: CompanionMessageCommand;
  createTask: CompanionTaskCommand & { readonly executionId?: string };
  updateTask: UpdateTaskInput;
  appendMessage: AppendMessageInput;
  memorySnapshot: Record<string, never>;
  rememberFact: StateRememberInput;
  forgetFact: CompanionMemoryForgetCommand & { readonly origin: CompanionFactOrigin };
  getTask: { readonly id: string };
  getTaskByExecution: { readonly executionId: string };
  getArtifact: { readonly id: string };
  recover: { readonly limit?: number };
  recordCommand: RecordCommandInput;
  getCommand: CommandLookup;
}

export interface StateMethodOutputs {
  snapshot: StateSnapshot;
  events: CompanionEventPage;
  acceptMessage: { readonly receipt: CompanionCommandReceipt; readonly message: CompanionMessage };
  createTask: { readonly receipt: CompanionCommandReceipt; readonly task: CompanionTask };
  updateTask: CompanionTask;
  appendMessage: CompanionMessage;
  memorySnapshot: StateMemoryView;
  rememberFact: StateMemoryMutation;
  forgetFact: StateMemoryMutation;
  getTask: CompanionTask;
  getTaskByExecution: CompanionTask;
  getArtifact: StoredArtifact;
  recover: { readonly taskIds: readonly string[]; readonly hasMore: boolean };
  recordCommand: CompanionCommandReceipt;
  getCommand: CompanionCommandReceipt | null;
}

export const STATE_METHODS = [
  'snapshot',
  'events',
  'acceptMessage',
  'createTask',
  'updateTask',
  'appendMessage',
  'memorySnapshot',
  'rememberFact',
  'forgetFact',
  'getTask',
  'getTaskByExecution',
  'getArtifact',
  'recover',
  'recordCommand',
  'getCommand',
] as const satisfies readonly (keyof StateMethodInputs)[];

/** Reserve headroom for both the capability payload Result and its transport Result. */
export const STATE_MAX_RESULT_BYTES = 60 * 1024;
export {
  COMPANION_MEMORY_MAX_DATA_BYTES as STATE_MAX_FACT_BYTES,
  COMPANION_MEMORY_MAX_FACTS as STATE_MAX_FACTS,
} from '@pet/contracts';
export const STATE_MAX_ARTIFACTS = 16;
export const STATE_LOG_BYTES = 12 * 1024;
