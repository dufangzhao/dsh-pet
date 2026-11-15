import type { KernelError, Result } from './errors.js';
import type { QQCredentialCommand, QQSourceSettingsCommand } from './companion-qq.js';
import type { LocalAgentLinkCredentialCommand } from './local-host-qq.js';
import type {
  LocalHostConsoleTarget,
  LocalHostConsoleView,
  LocalHostConsoleMutation,
  LocalHostSourceReview,
  LocalHostSourceTrustCommand,
  LocalHostSourcePresetCommand,
  LocalHostSourceEnabledCommand,
  LocalHostAgentEnabledCommand,
} from './local-host-console.js';

export interface DesktopLocalHostState {
  readonly revision: number;
  readonly phase: 'stopped' | 'starting' | 'running' | 'stopping' | 'failed';
  readonly view: LocalHostConsoleView | null;
  readonly error: KernelError | null;
}
export interface DesktopLocalHostReview extends LocalHostConsoleTarget {
  readonly protocol: LocalHostSourceReview['protocol'];
}
export type DesktopLocalHostSourceSettings = LocalHostConsoleTarget & QQSourceSettingsCommand;
/** Accepted by the fixed trusted Native bridge; the value then uses the sensitive lane. */
export type DesktopLocalHostSourceCredential = LocalHostConsoleTarget & QQCredentialCommand;
export type DesktopLocalHostAgentCredential = LocalHostConsoleTarget &
  LocalAgentLinkCredentialCommand;
export type DesktopLocalHostAgentEnabled = LocalHostAgentEnabledCommand;
export interface DesktopLocalHostAgentHandoff extends LocalHostConsoleTarget {
  readonly connectionId: string;
  readonly expectedRevision: number;
  readonly expectedCredentialVersion: string;
}

export const DESKTOP_LOCAL_HOST_IPC = {
  getState: 'pet:local-host:state',
  start: 'pet:local-host:start',
  stop: 'pet:local-host:stop',
  reviewSource: 'pet:local-host:review-source',
  confirmSourceTrust: 'pet:local-host:trust-source',
  setSourcePreset: 'pet:local-host:preset-source',
  saveSource: 'pet:local-host:save-source',
  setSourceEnabled: 'pet:local-host:enable-source',
  setSourceCredential: 'pet:local-host:source-credential',
  linkCurrentAgent: 'pet:local-host:link-agent',
  setAgentEnabled: 'pet:local-host:enable-agent',
  setAgentCredential: 'pet:local-host:agent-credential',
  changed: 'pet:local-host:changed',
} as const;

/** Console-only fixed facade. No process paths, socket URLs, task owners or secret references. */
export interface DesktopLocalHostBridge {
  readonly version: 1;
  getState(): Promise<Result<DesktopLocalHostState>>;
  start(): Promise<Result<DesktopLocalHostState>>;
  stop(input: LocalHostConsoleTarget): Promise<Result<DesktopLocalHostState>>;
  reviewSource(input: DesktopLocalHostReview): Promise<Result<LocalHostSourceReview>>;
  confirmSourceTrust(input: LocalHostSourceTrustCommand): Promise<Result<LocalHostConsoleMutation>>;
  setSourcePreset(input: LocalHostSourcePresetCommand): Promise<Result<LocalHostConsoleMutation>>;
  saveSource(input: DesktopLocalHostSourceSettings): Promise<Result<LocalHostConsoleMutation>>;
  setSourceEnabled(input: LocalHostSourceEnabledCommand): Promise<Result<LocalHostConsoleMutation>>;
  setSourceCredential(
    input: DesktopLocalHostSourceCredential,
  ): Promise<Result<LocalHostConsoleMutation>>;
  linkCurrentAgent(input: DesktopLocalHostAgentHandoff): Promise<Result<LocalHostConsoleMutation>>;
  setAgentEnabled(input: DesktopLocalHostAgentEnabled): Promise<Result<LocalHostConsoleMutation>>;
  setAgentCredential(
    input: DesktopLocalHostAgentCredential,
  ): Promise<Result<LocalHostConsoleMutation>>;
  onChanged(listener: () => void): () => void;
}
