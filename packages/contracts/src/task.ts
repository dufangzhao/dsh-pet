/**
 * Task vocabulary. A task is one user intent with an identity, a state, a
 * cancellation signal and an optional deadline on the *current* monotonic clock
 * domain — a deadline must never be compared across processes.
 */

import type { KernelError } from './errors.js';
import type { LocalId, OwnerRef } from './ids.js';

export const TASK_STATES = [
  'pending',
  'running',
  'cancelling',
  'completed',
  'failed',
  'cancelled',
  'timed-out',
] as const;

export type TaskState = (typeof TASK_STATES)[number];

/** Terminal states never leave; a terminal task emits no further business data. */
export const TASK_TERMINAL_STATES = ['completed', 'failed', 'cancelled', 'timed-out'] as const;

export type TaskTerminalState = (typeof TASK_TERMINAL_STATES)[number];

export function isTaskState(value: unknown): value is TaskState {
  return typeof value === 'string' && (TASK_STATES as readonly string[]).includes(value);
}

export function isTerminalTaskState(state: TaskState): state is TaskTerminalState {
  return (TASK_TERMINAL_STATES as readonly string[]).includes(state);
}

/** In-process only. Never serialize a TaskContext across a process boundary. */
export interface TaskContext {
  taskId: LocalId;
  owner: OwnerRef;
  signal: AbortSignal;
  /** Monotonic milliseconds in the current clock domain. */
  deadline?: number;
}

export const TASK_EVENT_KINDS = [
  'started',
  'progress',
  'data',
  'completed',
  'failed',
  'cancelled',
] as const;

export type TaskEventKind = (typeof TASK_EVENT_KINDS)[number];

/** Kinds that end a task; at most one may be delivered per task. */
export const TASK_TERMINAL_EVENT_KINDS = ['completed', 'failed', 'cancelled'] as const;

export type TaskTerminalEventKind = (typeof TASK_TERMINAL_EVENT_KINDS)[number];

export function isTerminalTaskEventKind(kind: TaskEventKind): kind is TaskTerminalEventKind {
  return (TASK_TERMINAL_EVENT_KINDS as readonly string[]).includes(kind);
}

/** Business data is only legal before the terminal event. */
export function allowsTaskData(kind: TaskEventKind): boolean {
  return kind === 'progress' || kind === 'data';
}

export interface TaskEvent<T = unknown> {
  taskId: LocalId;
  owner: OwnerRef;
  sequence: number;
  kind: TaskEventKind;
  data?: T;
  error?: KernelError;
}

export const CANCEL_REASONS = [
  'user',
  'owner-disabled',
  'deadline',
  'permission-revoked',
  'shutdown',
] as const;

export type CancelReason = (typeof CANCEL_REASONS)[number];
