import type {
  CompanionCleanup,
  CompanionMaterialRef,
  KernelError,
  LocalHostSourceBinding,
  LocalHostProcessIdentity,
  LocalHostTaskReference,
  QQAccountRef,
  QQDeliveryAttempt,
  QQDeliveryPart,
  QQDeliveryView,
  QQRemoteReceipt,
} from '@pet/contracts';
import type { TaskMediaReference } from '@pet/host-kernel';
import type { OwnedProcessDeathReason } from './owned-process.js';

export interface QQDeliveryProgress {
  readonly dispatched: boolean;
  readonly receipt: QQRemoteReceipt | null;
  readonly correlationId?: string | null;
}
export interface QQDeliveryOutcome extends QQDeliveryProgress {
  readonly outcome: Exclude<QQDeliveryAttempt['outcome'], 'pending'>;
  /** Physical native/key settlement, independent of platform acceptance. */
  readonly cleanup: CompanionCleanup;
  readonly error: KernelError | null;
  /** Host-private native upload object or a remote opaque continuation; never persisted as intent. */
  readonly uploaded?: unknown;
}
export interface QQDeliveryRequest {
  check(): Promise<void>;
  readonly expectedConnectionId: string;
  readonly attemptId: string;
  readonly operation: QQDeliveryAttempt['operation'];
  readonly delivery: QQDeliveryView;
  readonly part: QQDeliveryPart;
  readonly material?: CompanionMaterialRef;
  readonly bytes?: AsyncIterable<Uint8Array>;
  readonly uploaded?: unknown;
  /** Frozen private execution identity. Absence retains the service-local contract. */
  readonly executionBinding?: LocalHostSourceBinding;
}
export interface QQDeliveryTransport {
  execute(
    request: QQDeliveryRequest,
    signal: AbortSignal,
    progress: (value: QQDeliveryProgress) => Promise<void>,
  ): Promise<QQDeliveryOutcome>;
}
export interface QQDeliverySource {
  readonly account: QQAccountRef;
  readonly connectionId: string;
  readonly signal: AbortSignal;
  readonly transport: QQDeliveryTransport;
  check(): Promise<void>;
}

/** Closed execution metadata, not a grant. Both ends bind it to actual owned tasks. */
export interface QQExecutionRequest {
  readonly binding: LocalHostSourceBinding;
  readonly delivery: QQDeliveryView;
  readonly partId: string;
  readonly attemptId: string;
  readonly operation: QQDeliveryAttempt['operation'];
  readonly stream?: TaskMediaReference;
  readonly continuation?: string;
}
export interface QQExecutionIdentity {
  readonly binding: LocalHostSourceBinding;
  readonly task: LocalHostTaskReference;
  readonly deliveryId: string;
  readonly partId: string;
  readonly attemptId: string;
  readonly contentHash: string;
  readonly operation: QQDeliveryAttempt['operation'];
}
export interface QQExecutionFact extends QQExecutionIdentity {
  readonly outcome: Omit<QQDeliveryOutcome, 'uploaded'>;
}
export interface QQExecutionResult {
  readonly fact: QQExecutionFact;
  readonly continuation?: string;
}
export type QQExecutionInspection =
  | { readonly phase: 'pending'; readonly identity: QQExecutionIdentity }
  | { readonly phase: 'settled'; readonly fact: QQExecutionFact };

/** Closed cleanup inquiry; it contains no content, native command, permit or mutable receipt. */
export interface QQExecutionRecoveryRequest {
  readonly original: QQExecutionIdentity;
  readonly processIdentity: LocalHostProcessIdentity;
  readonly challenge: string;
}
export interface QQExecutionRecoveryResult extends QQExecutionRecoveryRequest {
  readonly reason: OwnedProcessDeathReason;
}
