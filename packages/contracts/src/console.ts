import type { Result, KernelError } from './errors.js';
import type { HostStatus } from './host-status.js';
import type { OwnerRef } from './ids.js';
import type { PluginLifecycleState } from './lifecycle.js';
import type { PermissionDeclaration } from './permission.js';
import type { ContributionKind } from './contribution.js';
export interface ConsoleContribution {
  readonly owner: OwnerRef;
  readonly id: string;
  readonly kind: ContributionKind;
  readonly title: string;
}
export const CONSOLE_IPC = { snapshot: 'console:v1:snapshot', open: 'console:v1:open' } as const;
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
}
export interface SettingsLauncher {
  open(): Promise<Result<null>>;
}
