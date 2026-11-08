import type {
  CompanionArtifact,
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
  rememberFact: CompanionFactCommand & { readonly expectedRevision?: number };
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
  rememberFact: { readonly receipt: CompanionCommandReceipt; readonly fact: CompanionFact };
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
  'rememberFact',
  'getTask',
  'getTaskByExecution',
  'getArtifact',
  'recover',
  'recordCommand',
  'getCommand',
] as const satisfies readonly (keyof StateMethodInputs)[];

/** Reserve headroom for both the capability payload Result and its transport Result. */
export const STATE_MAX_RESULT_BYTES = 60 * 1024;
export const STATE_MAX_FACT_BYTES = 8 * 1024;
export const STATE_MAX_FACTS = 32;
export const STATE_MAX_ARTIFACTS = 16;
export const STATE_LOG_BYTES = 12 * 1024;
