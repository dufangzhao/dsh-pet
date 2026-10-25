/**
 * Plugin lifecycle vocabulary.
 *
 * Activation is transactional: registrations are staged and published only on
 * success, and rolled back in reverse order on failure. Deactivation stops new
 * tasks first and hides contributions; a cleanup that cannot finish in time is
 * reported as `pending_restart` rather than as a completed uninstall.
 */

import type { KernelError } from './errors.js';
import type { OwnerRef } from './ids.js';

export const PLUGIN_LIFECYCLE_STATES = [
  'rejected',
  'disabled',
  'activating',
  'active',
  'unready',
  'failed',
  'deactivating',
  'pending_restart',
] as const;

export type PluginLifecycleState = (typeof PLUGIN_LIFECYCLE_STATES)[number];

export interface PluginStatusSnapshot {
  owner: OwnerRef;
  state: PluginLifecycleState;
  reason?: KernelError;
}

/**
 * Fixed lifecycle policy table. Keeping it as data (instead of scattered
 * conditionals) is what makes "hidden but still registered" bugs visible.
 */
export interface LifecycleStatePolicy {
  /** Contributions are visible to the user. */
  showsContributions: boolean;
  /** The plugin may accept a new task. */
  acceptsTasks: boolean;
  /** The state is transient and expected to settle without user action. */
  transient: boolean;
}

export const LIFECYCLE_STATE_POLICY: Readonly<Record<PluginLifecycleState, LifecycleStatePolicy>> =
  {
    rejected: { showsContributions: false, acceptsTasks: false, transient: false },
    disabled: { showsContributions: false, acceptsTasks: false, transient: false },
    activating: { showsContributions: false, acceptsTasks: false, transient: true },
    active: { showsContributions: true, acceptsTasks: true, transient: false },
    unready: { showsContributions: true, acceptsTasks: false, transient: false },
    failed: { showsContributions: true, acceptsTasks: false, transient: false },
    deactivating: { showsContributions: false, acceptsTasks: false, transient: true },
    pending_restart: { showsContributions: false, acceptsTasks: false, transient: false },
  };

export function isPluginLifecycleState(value: unknown): value is PluginLifecycleState {
  return (
    typeof value === 'string' && (PLUGIN_LIFECYCLE_STATES as readonly string[]).includes(value)
  );
}

export function acceptsTasksIn(state: PluginLifecycleState): boolean {
  return LIFECYCLE_STATE_POLICY[state].acceptsTasks;
}

export function showsContributionsIn(state: PluginLifecycleState): boolean {
  return LIFECYCLE_STATE_POLICY[state].showsContributions;
}
