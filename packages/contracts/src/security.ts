import type { ConsolePlugin, ConsoleSnapshot } from './console.js';
import type { KernelError, KernelErrorCode } from './errors.js';
import type { OwnerRef } from './ids.js';
import type { PermissionDeclaration, PermissionKind } from './permission.js';
export const PERMISSION_PRESETS = ['allow', 'ask', 'deny', 'local'] as const;
export type PermissionPreset = (typeof PERMISSION_PRESETS)[number];
export const PERMISSION_PRESET_DESCRIPTIONS: Readonly<Record<PermissionPreset, string>> = {
  allow: '自动允许插件已声明的操作，不再逐次询问。',
  ask: '每次敏感操作询问，只同意当前请求。',
  deny: '拒绝所有敏感操作。',
  local:
    '允许本地麦克风、插件进程、能力调用、插件数据访问和只读插件资源；拒绝网络，其他操作仍询问。',
};
export interface ConsoleSecurityPlugin extends ConsolePlugin {
  readonly digest: string | null;
  readonly trusted: boolean;
  readonly preset: PermissionPreset;
  readonly blocked: boolean;
}
export interface ConsoleApprovalPrompt {
  readonly requestId: string;
  readonly owner: OwnerRef;
  readonly taskId: string;
  readonly permission: PermissionDeclaration;
  readonly permissionDigest: string;
  readonly deadlineAt: number;
}
export interface ConsoleApprovalDecision {
  readonly requestId: string;
  readonly owner: OwnerRef;
  readonly taskId: string;
  readonly permissionDigest: string;
  readonly approved: boolean;
}
export interface ConsoleBuiltinPackage {
  readonly pluginId: string;
  readonly name: string;
  readonly version: string;
  readonly digest: string;
  readonly permissions: readonly PermissionDeclaration[];
}
export interface ConsoleBuiltinRestoreRequest {
  readonly pluginId: string;
  readonly expectedDigest: string;
}
export interface ConsoleSecuritySnapshot {
  readonly sessionOnly: true;
  readonly availableBuiltins: readonly ConsoleBuiltinPackage[];
  readonly plugins: readonly ConsoleSecurityPlugin[];
  readonly pending: readonly ConsoleApprovalPrompt[];
}
export interface ConsoleTrustRequest {
  readonly owner: OwnerRef;
  /** Comparison token from the displayed host descriptor, never an authority supplied by UI. */
  readonly expectedDigest: string;
  readonly approved: boolean;
}
export interface ConsolePresetRequest {
  readonly owner: OwnerRef;
  readonly preset: PermissionPreset;
}
export interface ConsoleSecurityChange {
  readonly snapshot: ConsoleSnapshot;
  readonly security: ConsoleSecuritySnapshot;
  readonly operationError: KernelError | null;
}
export type AuditEvent =
  | 'requested'
  | 'approved'
  | 'denied'
  | 'cancelled'
  | 'started'
  | 'completed'
  | 'failed'
  | 'closed'
  | 'revoked';
export type AuditSource =
  'preset' | 'approval' | 'undeclared' | 'invalid' | 'stale' | 'unavailable' | 'control';
export interface AuditEntry {
  readonly id: string;
  readonly at: number;
  readonly owner: OwnerRef;
  readonly taskId: string;
  readonly kind: PermissionKind;
  readonly targetHash: string;
  readonly event: AuditEvent;
  readonly source: AuditSource;
  readonly errorCode?: KernelErrorCode;
}
export interface ConsoleAuditPage {
  readonly entries: readonly AuditEntry[];
  readonly total: number;
  readonly dropped: number;
}
