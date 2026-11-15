import { isDeepStrictEqual } from 'node:util';
import {
  isCompanionInputOrigin,
  type CompanionInputAdmission,
  type CompanionInputOrigin,
  type CompanionMaterialRef,
  type CompanionMaterialSelection,
  type CompanionMessage,
  type CompanionTaskOrigin,
  type Result,
} from '@pet/contracts';
import type {
  HarnessResolvedImage,
  HarnessWorkRequest,
  HarnessReplyAttachment,
} from '@pet/harness-cortico';
import type { CloudMaterialSource } from '@pet/cloud-exec';
import type { StateReadScope } from '@pet/state-sqlite';
import { KernelFault } from '@pet/host-kernel';

/** Host-private policy lease. Its signal outlives a QQ socket and any one foreground context. */
export interface RuntimeInputGrant {
  readonly origin: CompanionInputOrigin;
  readonly role: 'owner' | 'admin' | 'member' | 'reply-only';
  readonly signal: AbortSignal;
  /** Recheck captured participant/alias/policy authority without promoting this captured role. */
  check(): void | Promise<void>;
}

export interface RuntimeInputAccess {
  readonly signal: AbortSignal;
  readonly scope: StateReadScope;
  check(): Promise<void>;
}

export interface RuntimeInputTerminal {
  /** Native-only captured participant policy lease; never serialize it or substitute context.signal. */
  readonly grant: RuntimeInputGrant;
  readonly admission: CompanionInputAdmission;
  readonly contextId: string | null;
  /** Exact committed records, in formal publication order; full text may be a material reference. */
  readonly outputs: readonly CompanionMessage[];
}

export interface RuntimeWorkMaterialReadRequest {
  readonly executionId: string;
  readonly selection: CompanionMaterialSelection;
  readonly material: CompanionMaterialRef;
  readonly origin: CompanionTaskOrigin;
}

type ConversationWindow = { readonly maxMessages: number; readonly maxAgeMs: number };

/** Fixed host media operations; no generic filesystem, remote URL, or model credential access. */
export interface RuntimeInputPorts {
  /** Current effective QQ group policy; never a replacement for the input's audience/grant. */
  conversationWindow?(
    origin: CompanionInputOrigin,
  ): ConversationWindow | Promise<ConversationWindow>;
  resolveInput?(
    input: CompanionInputAdmission,
    access: RuntimeInputAccess,
  ): Promise<readonly HarnessResolvedImage[]>;
  prepareWork?(
    input: CompanionInputAdmission,
    request: HarnessWorkRequest,
    access: RuntimeInputAccess,
  ): Promise<HarnessWorkRequest>;
  /** The access signal/check belong to accepted work, never its retired foreground input. */
  readWorkMaterial?(
    request: RuntimeWorkMaterialReadRequest,
    access: RuntimeInputAccess,
    consume: (source: CloudMaterialSource) => Promise<void>,
  ): Promise<Result<null>>;
  resolveReplyAttachment?(
    selection: HarnessReplyAttachment,
    origin: CompanionInputOrigin,
    access: RuntimeInputAccess,
  ): Promise<CompanionMaterialRef>;
  storeFullText?(
    output: { readonly id: string; readonly text: string; readonly origin: CompanionInputOrigin },
    access: RuntimeInputAccess,
  ): Promise<CompanionMaterialRef>;
  grantForWorkResult?(origin: CompanionInputOrigin): Promise<RuntimeInputGrant>;
}

export const OWNER_INPUT_SCOPE: StateReadScope = {
  kind: 'conversation',
  audience: { kind: 'owner-private' },
  principalId: 'owner',
};
export function inputScope(origin: CompanionInputOrigin): StateReadScope {
  return { kind: 'conversation', audience: origin.audience, principalId: origin.principalId };
}

export function captureInputGrant(
  grant: RuntimeInputGrant,
  origin: CompanionInputOrigin,
): RuntimeInputGrant {
  if (
    !isCompanionInputOrigin(origin) ||
    origin.kind === 'legacy-unknown' ||
    !isDeepStrictEqual(grant.origin, origin) ||
    !['owner', 'admin', 'member', 'reply-only'].includes(grant.role) ||
    (grant.role === 'owner' && origin.principalId !== 'owner') ||
    (origin.kind === 'owner' && grant.role !== 'owner') ||
    (['qq-proactive', 'work-result'].includes(origin.kind) && grant.role !== 'reply-only') ||
    !(grant.signal instanceof AbortSignal) ||
    typeof grant.check !== 'function'
  ) {
    throw new KernelFault('permission-denied');
  }
  const check = grant.check.bind(grant);
  return { origin: structuredClone(origin), role: grant.role, signal: grant.signal, check };
}

export async function checkInputGrant(grant: RuntimeInputGrant): Promise<void> {
  if (grant.signal.aborted) throw new KernelFault('permission-denied');
  await grant.check();
  if (grant.signal.aborted) throw new KernelFault('permission-denied');
}
