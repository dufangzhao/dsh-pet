import {
  companionAudienceKey,
  isCompanionConversationAudience,
  isCompanionRecordId,
} from '@pet/contracts';
import type {
  CompanionAudience,
  CompanionConversationAudience,
  CompanionInputOrigin,
  CompanionTaskOrigin,
  CompanionCleanup,
} from '@pet/contracts';
import type { StateReadScope } from './types.js';
import { StateFailure } from './failure.js';

export const OWNER_AUDIENCE: CompanionConversationAudience = { kind: 'owner-private' };
export const OWNER_SCOPE: StateReadScope = {
  kind: 'conversation',
  audience: OWNER_AUDIENCE,
  principalId: 'owner',
};
export const OWNER_AUDIENCE_KEY = companionAudienceKey(OWNER_AUDIENCE);
export const PUBLIC_AUDIENCE_KEY = companionAudienceKey({ kind: 'public' });

export function isStateReadScope(value: unknown): value is StateReadScope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (v['kind'] === 'management') return Object.keys(v).length === 1;
  if (
    v['kind'] !== 'conversation' ||
    Object.keys(v).length !== 3 ||
    !isCompanionConversationAudience(v['audience']) ||
    !(v['principalId'] === null || isCompanionRecordId(v['principalId']))
  )
    return false;
  return v['audience'].kind === 'owner-private'
    ? v['principalId'] === 'owner'
    : v['audience'].kind === 'person-private'
      ? v['principalId'] === v['audience'].principalId
      : true;
}

export function assertVisible(
  audience: CompanionAudience,
  scope: StateReadScope = OWNER_SCOPE,
  principalId?: string | null,
): void {
  if (scope.kind === 'management') return;
  if (
    (audience.kind !== 'public' &&
      companionAudienceKey(audience) !== companionAudienceKey(scope.audience)) ||
    (principalId !== undefined && (principalId === null || principalId !== scope.principalId))
  )
    throw new StateFailure('permission-denied');
}

/** Closed SQL fragments; all external values remain bound parameters. */
export function scopeWhere(
  scope: StateReadScope | undefined,
  kind: 'messages' | 'tasks' | 'facts' | 'events' | 'other',
): { sql: string; params: (string | null)[] } {
  const selected = scope ?? OWNER_SCOPE;
  if (selected.kind === 'management') return { sql: '1', params: [] };
  const audience = companionAudienceKey(selected.audience);
  if (kind === 'facts')
    return { sql: 'audience_key IN (?,?)', params: [audience, PUBLIC_AUDIENCE_KEY] };
  if (kind === 'tasks')
    return { sql: 'audience_key=? AND principal_id=?', params: [audience, selected.principalId] };
  if (kind === 'events')
    return {
      sql: "audience_key IN (?,?) AND (json_extract(body,'$.kind')!='task' OR principal_id=?)",
      params: [audience, PUBLIC_AUDIENCE_KEY, selected.principalId],
    };
  return { sql: 'audience_key=?', params: [audience] };
}

export function ownerOrigin(inputId: string): CompanionInputOrigin {
  return {
    kind: 'owner',
    inputId,
    principalId: 'owner',
    audience: OWNER_AUDIENCE,
    route: { kind: 'owner-private' },
    policyRevision: null,
  };
}
export function legacyOrigin(): CompanionInputOrigin {
  return {
    kind: 'legacy-unknown',
    inputId: null,
    principalId: 'owner',
    audience: OWNER_AUDIENCE,
    route: { kind: 'owner-private' },
    policyRevision: null,
  };
}
export function ownerTaskOrigin(): CompanionTaskOrigin {
  return {
    inputId: null,
    principalId: 'owner',
    audience: OWNER_AUDIENCE,
    route: { kind: 'owner-private' },
    origins: [],
    materialIds: [],
  };
}
export function legacyTaskOrigin(): CompanionTaskOrigin {
  return {
    inputId: null,
    principalId: 'owner',
    audience: OWNER_AUDIENCE,
    route: { kind: 'owner-private' },
    origins: [legacyOrigin()],
    materialIds: [],
  };
}
export function assertCleanup(previous: CompanionCleanup, next: CompanionCleanup): void {
  if (previous !== 'pending' && previous !== next && next !== 'settled')
    throw new StateFailure('conflict');
  if (previous === 'settled' && next !== 'settled') throw new StateFailure('conflict');
}
