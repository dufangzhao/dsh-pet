/**
 * Capability naming, the M1 capability set, and task-time binding.
 *
 * A binding is frozen when a task starts: changing a setting never migrates an
 * in-flight task and never silently swaps the provider or destination.
 */

import type { CapabilityId, LocalId, OwnerRef } from './ids.js';
import { CAPABILITY_ID_PATTERN } from './patterns.js';

/** Capability identifiers implemented in the M1 milestone. */
export const MVP_CAPABILITIES = [
  'input.talkKey@1',
  'audio.capture@1',
  'speech.asr@1',
  'llm.chat@1',
  'chat.session@1',
  'avatar.render@1',
] as const;

export type MvpCapability = (typeof MVP_CAPABILITIES)[number];

export interface CapabilityBinding {
  capability: CapabilityId;
  consumer: OwnerRef;
  provider: OwnerRef;
  providerId: LocalId;
}

/** Split `domain.name@major`; returns `null` when the identifier is malformed. */
export function parseCapabilityId(
  value: string,
): { domain: string; name: string; major: number } | null {
  if (typeof value !== 'string' || !new RegExp(CAPABILITY_ID_PATTERN).test(value)) return null;
  const at = value.lastIndexOf('@');
  const head = value.slice(0, at);
  const major = Number(value.slice(at + 1));
  if (!Number.isSafeInteger(major) || major < 1) return null;
  const dot = head.indexOf('.');
  if (dot < 1 || dot === head.length - 1) return null;
  return { domain: head.slice(0, dot), name: head.slice(dot + 1), major };
}

/** Major version of a capability identifier, or `null` when malformed. */
export function capabilityMajor(value: string): number | null {
  return parseCapabilityId(value)?.major ?? null;
}

/** Whether two identifiers name the same capability *contract* (same major). */
export function isSameCapability(a: string, b: string): boolean {
  const left = parseCapabilityId(a);
  const right = parseCapabilityId(b);
  if (left === null || right === null) return false;
  return left.domain === right.domain && left.name === right.name && left.major === right.major;
}
