import { createHash } from 'node:crypto';
import {
  COMPANION_OWNER_PRINCIPAL_ID,
  companionAudienceKey,
  qqActorKey,
  sameQQAccount,
  type CompanionConversationAudience,
  type QQAccountRef,
  type QQExternalActor,
  type QQGroupSettings,
  type QQPolicySettings,
} from '@pet/contracts';
import { KernelFault } from '@pet/host-kernel';

export interface QQParticipant {
  readonly principalId: string;
  readonly role: 'owner' | 'admin' | 'member';
  readonly audience: CompanionConversationAudience;
}

/** Inputs have already passed the config/native boundary. Names and group rank grant nothing. */
export function resolveQQParticipant(
  policy: QQPolicySettings,
  actor: QQExternalActor,
): QQParticipant | null {
  const actorKey = qqActorKey(actor);
  if (policy.knownMachineActors.some((candidate) => qqActorKey(candidate) === actorKey))
    return null;
  const admitted =
    actor.scene === 'private'
      ? policy.privateAllowlist.some((candidate) => qqActorKey(candidate) === actorKey)
      : policy.groupAllowlist.some(
          (group) => sameQQAccount(group.account, actor.account) && group.groupId === actor.groupId,
        );
  if (!admitted) return null;
  const principalId =
    policy.principalAliases.find((alias) => qqActorKey(alias.actor) === actorKey)?.principalId ??
    `qq-${createHash('sha256').update(actorKey).digest('hex')}`;
  const role =
    principalId === COMPANION_OWNER_PRINCIPAL_ID
      ? 'owner'
      : policy.administratorPrincipalIds.includes(principalId)
        ? 'admin'
        : 'member';
  const audience: CompanionConversationAudience =
    actor.scene === 'group'
      ? { kind: 'qq-group', account: actor.account, groupId: actor.groupId }
      : principalId === COMPANION_OWNER_PRINCIPAL_ID
        ? { kind: 'owner-private' }
        : { kind: 'person-private', principalId };
  return { principalId, role, audience };
}

/** Rechecking may preserve a captured lower grant, but can never promote an old input. */
export function assertQQParticipantCurrent(
  policy: QQPolicySettings,
  actor: QQExternalActor,
  captured: QQParticipant,
): void {
  const current = resolveQQParticipant(policy, actor);
  if (
    !current ||
    current.principalId !== captured.principalId ||
    companionAudienceKey(current.audience) !== companionAudienceKey(captured.audience) ||
    (captured.role === 'owner' && current.role !== 'owner') ||
    (captured.role === 'admin' && current.role === 'member')
  )
    throw new KernelFault('permission-denied');
}

export function qqGroupSettings(
  policy: QQPolicySettings,
  account: QQAccountRef,
  groupId: string,
): QQGroupSettings {
  return (
    policy.groups.find(
      (group) => sameQQAccount(group.account, account) && group.groupId === groupId,
    )?.settings ?? policy.groupDefaults
  );
}

/** Only authored text participates; quoted evidence is intentionally not an argument. */
export function qqWakeTrigger(
  settings: QQGroupSettings,
  authoredText: string,
  mentioned: boolean,
): 'mention' | 'wake-word' | null {
  if (settings.mentionEnabled && mentioned) return 'mention';
  return settings.wakeWords.some((word) => authoredText.includes(word)) ? 'wake-word' : null;
}
