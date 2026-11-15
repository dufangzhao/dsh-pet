import { isDeepStrictEqual } from 'node:util';
import {
  companionAudienceKey,
  sameQQAccount,
  isCompanionRecordId,
  type CompanionInputAdmission,
  type QQExternalActor,
} from '@pet/contracts';
import { KernelFault } from '@pet/host-kernel';
import type { RuntimeInputAccess, RuntimeInputGrant } from '@pet/companion-runtime';
import type { StateObservation } from '@pet/state-sqlite';

/** Original server-issued candidate; public proactive origin contains no actor or role grant. */
export interface QQProactiveMediaAuthority {
  readonly grant: RuntimeInputGrant;
  readonly actor: QQExternalActor;
  readonly observation: StateObservation;
}

/** Restrict existing authority, without minting a RuntimeInputGrant or borrowing a local signal. */
export async function qqMediaAccess(
  input: CompanionInputAdmission,
  access: RuntimeInputAccess,
  candidate?: QQProactiveMediaAuthority,
  mapped?: { readonly actor: QQExternalActor; readonly observationId: string },
): Promise<RuntimeInputAccess> {
  const origin = input.origin;
  if (
    access.scope.kind !== 'conversation' ||
    companionAudienceKey(access.scope.audience) !== companionAudienceKey(origin.audience) ||
    access.scope.principalId !== origin.principalId
  )
    throw new KernelFault('permission-denied');
  let candidateCheck: (() => void | Promise<void>) | undefined;
  let candidateSignal: AbortSignal | undefined;
  if (origin.kind === 'qq') {
    if (candidate || (mapped && !isDeepStrictEqual(origin.actor, mapped.actor)))
      throw new KernelFault('permission-denied');
  } else if (origin.kind === 'qq-proactive') {
    if (
      !candidate ||
      candidate.grant.role !== 'reply-only' ||
      typeof candidate.grant.check !== 'function' ||
      !(candidate.grant.signal instanceof AbortSignal) ||
      !isDeepStrictEqual(candidate.grant.origin, origin) ||
      candidate.actor.scene !== 'group' ||
      origin.audience.kind !== 'qq-group' ||
      !sameQQAccount(candidate.actor.account, origin.account) ||
      candidate.actor.groupId !== origin.audience.groupId ||
      !isCompanionRecordId(candidate.observation.id) ||
      companionAudienceKey(candidate.observation.audience) !==
        companionAudienceKey(origin.audience) ||
      (mapped &&
        (!isDeepStrictEqual(candidate.actor, mapped.actor) ||
          candidate.observation.id !== mapped.observationId))
    )
      throw new KernelFault('permission-denied');
    candidateCheck = candidate.grant.check.bind(candidate.grant);
    candidateSignal = candidate.grant.signal;
  } else throw new KernelFault('permission-denied');
  const check = access.check.bind(access);
  const signal = candidateSignal
    ? AbortSignal.any([access.signal, candidateSignal])
    : access.signal;
  const captured: RuntimeInputAccess = {
    scope: structuredClone(access.scope),
    signal,
    check: async () => {
      signal.throwIfAborted();
      await check();
      await candidateCheck?.();
      signal.throwIfAborted();
    },
  };
  await captured.check();
  return captured;
}
