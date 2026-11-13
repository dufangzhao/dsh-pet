import type {
  CompanionArtifact,
  CompanionAudience,
  CompanionConversationAudience,
  CompanionCleanup,
  CompanionInputAdmission,
  CompanionInputOrigin,
  CompanionMaterialRef,
  CompanionMaterialSelection,
  CompanionMaterialView,
  CompanionMessageContent,
  CompanionTaskOrigin,
  QQDeliveryView,
  QQDeliveryPage,
  QQDeliveryAttempt,
  QQAccountRef,
  QQReplyRoute,
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

/** A host-authorized selector, never an action grant supplied by a participant. */
export type StateReadScope =
  | {
      readonly kind: 'conversation';
      readonly audience: CompanionConversationAudience;
      readonly principalId: string | null;
    }
  | { readonly kind: 'management' };

export interface StoredMaterial extends CompanionMaterialView {
  readonly inputId: string | null;
  readonly observationId: string | null;
  readonly audience: CompanionConversationAudience;
  /** Private provider-relative storage key. Never expose through public snapshots/events. */
  readonly storageKey: string | null;
}

export interface QQFileEvidence {
  readonly kind: 'qq-file';
  readonly account: QQAccountRef;
  readonly groupId: string;
  readonly fileId: string;
  readonly busId: string | null;
  readonly name: string;
  readonly reportedSize: number | null;
}
export interface StateObservation {
  /** Local context dedup identity, never a native reply/event ID or an input grant. */
  readonly id: string;
  readonly audience: CompanionConversationAudience;
  readonly principalId: string | null;
  readonly observedAt: number;
  readonly text: string;
  readonly quotedText: string | null;
  readonly materialIds: readonly string[];
  readonly fileEvidence: QQFileEvidence | null;
}

export type StateGroupAudience = Extract<
  CompanionConversationAudience,
  { readonly kind: 'qq-group' }
>;
export interface StateJudgmentLimits {
  readonly maxAttemptsPerHour: number;
  readonly perGroupIntervalMs: number;
}
export interface ClaimJudgmentRequest {
  readonly id: string;
  readonly eventKey: string;
  readonly audience: StateGroupAudience;
  readonly providerRef: string;
  readonly policyRevision: number;
  readonly configRevision: number;
  readonly limits?: StateJudgmentLimits;
}
export interface StateJudgmentAttempt extends Omit<ClaimJudgmentRequest, 'limits'> {
  readonly limits: StateJudgmentLimits;
  readonly phase: 'claimed' | 'settled' | 'unknown';
  readonly decision: boolean | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly error: KernelError | null;
  readonly cleanup: CompanionCleanup;
  readonly claimedAt: number;
  readonly settledAt: number | null;
}
export interface StateJudgmentUsage {
  readonly since: number;
  readonly now: number;
  readonly admittedAttempts: number;
  readonly active: number;
  readonly settled: number;
  readonly unknown: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
}
export interface StateProactiveLimits {
  readonly cooldownMs: number;
  readonly maxRepliesPerHour: number;
}

export interface CreateInputRequest {
  readonly proactiveLimits?: StateProactiveLimits;
  readonly id: string;
  readonly commandId: string;
  readonly origin: CompanionInputOrigin;
  readonly evidence: JsonObject;
  readonly materialIds: readonly string[];
}
export interface CommitInputRequest {
  readonly id: string;
  readonly text: string;
  readonly materials?: readonly CompanionMaterialRef[];
  readonly content?: CompanionMessageContent;
}

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
  | (CompanionMemoryUpsertCommand & {
      readonly origin: CompanionFactOrigin;
      readonly audience?: CompanionAudience;
    })
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
  readonly audience?: CompanionConversationAudience;
  readonly origins?: readonly CompanionInputOrigin[];
  readonly materials?: readonly CompanionMaterialRef[];
  readonly content?: CompanionMessageContent;
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
  claimJudgment: ClaimJudgmentRequest;
  finishJudgment: Pick<
    StateJudgmentAttempt,
    'id' | 'decision' | 'inputTokens' | 'outputTokens' | 'error' | 'cleanup'
  >;
  judgmentUsage: { readonly since?: number; readonly audience?: StateGroupAudience };
  proactiveReadiness: {
    readonly audience: StateGroupAudience;
    readonly limits?: StateProactiveLimits;
  };
  inputMessage: { readonly id: string; readonly scope: StateReadScope };
  inputNotices: { readonly id: string; readonly scope: StateReadScope };
  getObservation: { readonly id: string; readonly scope: StateReadScope };
  observe: { readonly observation: StateObservation };
  observations: { readonly scope: StateReadScope; readonly now?: number };
  pruneObservations: { readonly now?: number };
  createInput: CreateInputRequest;
  commitInput: CommitInputRequest;
  claimInput: { readonly id: string };
  getInput: { readonly id: string; readonly scope: StateReadScope };
  findInput: { readonly id: string; readonly scope: StateReadScope };
  updateInput: Pick<CompanionInputAdmission, 'id' | 'phase' | 'cleanup'> & {
    readonly error?: KernelError | null;
  };
  putMaterial: StoredMaterial;
  getMaterial: { readonly id: string; readonly scope: StateReadScope };
  findMaterial: { readonly id: string; readonly scope: StateReadScope };
  createDelivery: { readonly delivery: QQDeliveryView };
  updateDelivery: { readonly delivery: QQDeliveryView };
  /** First official claim freezes the whole eligible plan's msgSeq reservations; always use returned delivery. Unsent reservations are not refunded or reused. */
  claimDeliveryAttempt: {
    readonly id: string;
    readonly partId: string;
    readonly attempt: QQDeliveryAttempt;
  };
  /** Unreserved capacity for a new plan, not a second check on an existing plan's held slots. This read grants/reserves nothing. */
  passiveReplyBudget: { readonly route: QQReplyRoute };
  getDelivery: { readonly id: string; readonly scope: StateReadScope };
  deliveries: { readonly scope: StateReadScope; readonly after?: string; readonly limit?: number };
  snapshot: {
    readonly scope?: StateReadScope;
    readonly messageLimit?: number;
    readonly taskLimit?: number;
    readonly byteBudget?: number;
  };
  events: {
    readonly after: number;
    readonly epoch: string;
    readonly limit?: number;
    readonly scope?: StateReadScope;
  };
  acceptMessage: CompanionMessageCommand;
  createTask: CompanionTaskCommand & {
    readonly executionId?: string;
    readonly origin?: CompanionTaskOrigin;
    /** Nonempty selections are immutable intent; empty/absent retains the legacy fingerprint. */
    readonly materials?: readonly CompanionMaterialSelection[];
  };
  updateTask: UpdateTaskInput;
  appendMessage: AppendMessageInput;
  memorySnapshot: { readonly scope?: StateReadScope };
  rememberFact: StateRememberInput;
  forgetFact: CompanionMemoryForgetCommand & {
    readonly origin: CompanionFactOrigin;
    readonly audience?: CompanionAudience;
  };
  /** Exact canonical event/message pair; speech admission must additionally require assistant. */
  getMessage: {
    readonly id: string;
    readonly eventSequence: number;
    readonly scope?: StateReadScope;
  };
  getTask: { readonly id: string; readonly scope?: StateReadScope };
  getTaskByExecution: { readonly executionId: string; readonly scope?: StateReadScope };
  getArtifact: { readonly id: string; readonly scope?: StateReadScope };
  recover: { readonly limit?: number };
  recordCommand: RecordCommandInput;
  getCommand: CommandLookup;
}

export interface StateMethodOutputs {
  claimJudgment: {
    readonly claimed: boolean;
    readonly attempt: StateJudgmentAttempt | null;
    readonly reason?: 'duplicate' | 'hourly-limit' | 'group-cooldown' | 'busy';
  };
  finishJudgment: StateJudgmentAttempt;
  judgmentUsage: StateJudgmentUsage;
  proactiveReadiness: {
    readonly eligible: boolean;
    readonly reason: 'ready' | 'group-cooldown' | 'hourly-limit';
    readonly nextAt: number | null;
  };
  inputMessage: CompanionMessage;
  inputNotices: readonly { readonly id: string; readonly text: string }[];
  getObservation: StateObservation;
  observe: {
    readonly observation: StateObservation;
    readonly duplicate: boolean;
    readonly retained: boolean;
  };
  observations: { readonly observations: readonly StateObservation[]; readonly hasMore: boolean };
  pruneObservations: { readonly removed: number };
  claimInput: { readonly admission: CompanionInputAdmission; readonly claimed: boolean };
  createInput: {
    readonly receipt: CompanionCommandReceipt;
    readonly admission: CompanionInputAdmission;
  };
  commitInput: { readonly admission: CompanionInputAdmission; readonly message: CompanionMessage };
  getInput: CompanionInputAdmission;
  findInput: CompanionInputAdmission | null;
  updateInput: CompanionInputAdmission;
  putMaterial: StoredMaterial;
  getMaterial: StoredMaterial;
  findMaterial: StoredMaterial | null;
  createDelivery: QQDeliveryView;
  updateDelivery: QQDeliveryView;
  claimDeliveryAttempt: { readonly delivery: QQDeliveryView; readonly claimed: boolean };
  passiveReplyBudget: {
    readonly remainingMessageParts: number;
    readonly nextMsgSeq: number;
    readonly eligible: boolean;
    readonly expiresAt: number | null;
  };
  getDelivery: QQDeliveryView;
  deliveries: QQDeliveryPage;
  snapshot: StateSnapshot;
  events: CompanionEventPage;
  acceptMessage: { readonly receipt: CompanionCommandReceipt; readonly message: CompanionMessage };
  createTask: { readonly receipt: CompanionCommandReceipt; readonly task: CompanionTask };
  updateTask: CompanionTask;
  appendMessage: CompanionMessage;
  memorySnapshot: StateMemoryView;
  rememberFact: StateMemoryMutation;
  forgetFact: StateMemoryMutation;
  getMessage: CompanionMessage;
  getTask: CompanionTask;
  getTaskByExecution: CompanionTask;
  getArtifact: StoredArtifact;
  recover: {
    readonly taskIds: readonly string[];
    readonly inputIds: readonly string[];
    readonly materialIds: readonly string[];
    readonly deliveryIds: readonly string[];
    readonly judgmentIds: readonly string[];
    readonly hasMore: boolean;
  };
  recordCommand: CompanionCommandReceipt;
  getCommand: CompanionCommandReceipt | null;
}

export const STATE_METHODS = [
  'claimJudgment',
  'finishJudgment',
  'judgmentUsage',
  'proactiveReadiness',
  'snapshot',
  'events',
  'acceptMessage',
  'createTask',
  'updateTask',
  'appendMessage',
  'memorySnapshot',
  'rememberFact',
  'forgetFact',
  'getMessage',
  'getTask',
  'getTaskByExecution',
  'getArtifact',
  'recover',
  'recordCommand',
  'getCommand',
  'inputMessage',
  'inputNotices',
  'getObservation',
  'observe',
  'observations',
  'pruneObservations',
  'createInput',
  'commitInput',
  'claimInput',
  'getInput',
  'findInput',
  'updateInput',
  'putMaterial',
  'getMaterial',
  'findMaterial',
  'createDelivery',
  'updateDelivery',
  'claimDeliveryAttempt',
  'passiveReplyBudget',
  'getDelivery',
  'deliveries',
] as const satisfies readonly (keyof StateMethodInputs)[];

/** Encoded JSON bytes for the entire canonical message, including provenance and content metadata. */
export const STATE_MAX_MESSAGE_BYTES = 28 * 1024;
/** Reserve headroom for both the capability payload Result and its transport Result. */
export const STATE_MAX_RESULT_BYTES = 60 * 1024;
export {
  COMPANION_MEMORY_MAX_DATA_BYTES as STATE_MAX_FACT_BYTES,
  COMPANION_MEMORY_MAX_FACTS as STATE_MAX_FACTS,
} from '@pet/contracts';
export const STATE_MAX_ARTIFACTS = 16;
export const STATE_LOG_BYTES = 12 * 1024;
