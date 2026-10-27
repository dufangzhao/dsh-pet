import type { Result, KernelError } from './errors.js';
import type { HostStatus } from './host-status.js';
import type { OwnerRef } from './ids.js';
import type { PluginLifecycleState } from './lifecycle.js';
import type { PermissionDeclaration } from './permission.js';
import type { ContributionKind } from './contribution.js';
import type { ConfigInspection, ConfigSave } from './config.js';
import type { JsonObject } from './json.js';

export interface ConsoleConfigSaveRequest {
  readonly owner: OwnerRef;
  /** Zero creates the first record; positive revisions compare an existing record. */
  readonly expectedRevision: number;
  readonly data: JsonObject;
}
export interface ConsoleContribution {
  readonly owner: OwnerRef;
  readonly id: string;
  readonly kind: ContributionKind;
  readonly title: string;
}
export const CONSOLE_IPC = {
  snapshot: 'console:v1:snapshot',
  open: 'console:v1:open',
  stopAll: 'console:v1:stop-all',
  inspectConfig: 'console:v1:inspect-config',
  saveConfig: 'console:v1:save-config',
} as const;
export interface ConsolePlugin {
  readonly owner: OwnerRef;
  readonly name: string;
  readonly version: string;
  readonly state: PluginLifecycleState;
  readonly origin: 'builtin' | 'user';
  readonly protected: boolean;
  readonly permissions: readonly PermissionDeclaration[];
  readonly reason?: KernelError;
}
export interface ConsoleSnapshot {
  readonly version: 1;
  readonly host: HostStatus;
  readonly plugins: readonly ConsolePlugin[];
  readonly contributions: readonly ConsoleContribution[];
  readonly app: {
    readonly name: string;
    readonly version: string;
    readonly electron: string;
    readonly node: string;
    readonly platform: string;
  };
}
export interface ConsoleBridge {
  readonly version: 1;
  getSnapshot(): Promise<Result<ConsoleSnapshot>>;
  stopAll(): Promise<Result<HostStatus>>;
  inspectConfig(owner: OwnerRef): Promise<Result<ConfigInspection>>;
  saveConfig(request: ConsoleConfigSaveRequest): Promise<Result<ConfigSave>>;
}
export interface SettingsLauncher {
  open(): Promise<Result<null>>;
}
