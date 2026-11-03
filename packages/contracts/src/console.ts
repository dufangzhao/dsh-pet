import type { Result, KernelError } from './errors.js';
import type { HostStatus } from './host-status.js';
import type { OwnerRef } from './ids.js';
import type { PluginLifecycleState } from './lifecycle.js';
import type { PermissionDeclaration } from './permission.js';
import type { ContributionKind } from './contribution.js';
import type { ConfigInspection, ConfigSave } from './config.js';
import type { JsonObject } from './json.js';
import type {
  ConsoleApprovalDecision,
  ConsoleAuditPage,
  ConsolePresetRequest,
  ConsoleSecurityChange,
  ConsoleSecuritySnapshot,
  ConsoleTrustRequest,
  ConsoleBuiltinRestoreRequest,
} from './security.js';

export type ConsolePluginAction = 'enable' | 'disable' | 'uninstall';
export interface ConsolePluginRequest {
  readonly owner: OwnerRef;
  readonly action: ConsolePluginAction;
}
export interface ConsolePluginChange {
  readonly snapshot: ConsoleSnapshot;
  /** A valid request can fail after changing lifecycle state; always apply its snapshot. */
  readonly operationError: KernelError | null;
}
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
  navigate: 'console:v1:navigate',
  stopAll: 'console:v1:stop-all',
  inspectConfig: 'console:v1:inspect-config',
  saveConfig: 'console:v1:save-config',
  pluginAction: 'console:v1:plugin-action',
  security: 'console:v1:security',
  trust: 'console:v1:trust',
  preset: 'console:v1:preset',
  approval: 'console:v1:approval',
  audit: 'console:v1:audit',
  securityChanged: 'console:v1:security-changed',
  restoreBuiltin: 'console:v1:restore-builtin',
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
  runPluginAction(request: ConsolePluginRequest): Promise<Result<ConsolePluginChange>>;
  getSecurity(): Promise<Result<ConsoleSecuritySnapshot>>;
  setTrust(request: ConsoleTrustRequest): Promise<Result<ConsoleSecurityChange>>;
  setPermissionPreset(request: ConsolePresetRequest): Promise<Result<ConsoleSecurityChange>>;
  answerApproval(request: ConsoleApprovalDecision): Promise<Result<ConsoleSecurityChange>>;
  getAudit(request: { offset: number; limit: number }): Promise<Result<ConsoleAuditPage>>;
  onSecurityChanged(listener: () => void): () => void;
  restoreBuiltin(request: ConsoleBuiltinRestoreRequest): Promise<Result<ConsoleSecurityChange>>;
}
export type SettingsDestination =
  'start' | 'persona' | 'appearance' | 'conversation' | 'voice' | 'plugins' | 'about';
export interface SettingsOpenRequest {
  readonly view: SettingsDestination;
}
export interface SettingsLauncher {
  open(request?: SettingsOpenRequest): Promise<Result<null>>;
  onNavigate(listener: (request: SettingsOpenRequest) => void): () => void;
}
export function isSettingsOpenRequest(value: unknown): value is SettingsOpenRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    Object.keys(row).join(',') === 'view' &&
    ['start', 'persona', 'appearance', 'conversation', 'voice', 'plugins', 'about'].includes(
      row['view'] as string,
    )
  );
}
