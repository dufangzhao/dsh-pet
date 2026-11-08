/** Browser-safe desktop projections. Service state and local presentation have distinct owners. */
import type { ApplicationPreferences } from './application.js';
import type {
  CompanionSnapshot,
  CompanionMessageCommand,
  CompanionCommandReceipt,
  CompanionStopCommand,
  CompanionTask,
} from './companion.js';
import type {
  CompanionModelSaveCommand,
  CompanionModelTestCommand,
  CompanionModelView,
} from './companion-model.js';
import type { CompanionProfileView } from './companion-profile.js';
import type { KernelError, Result } from './errors.js';

export const DESKTOP_COMPANION_PLUGIN_ID = 'pet.companion-client';
export const DESKTOP_COMPANION_MAX_STATE_BYTES = 80 * 1024;
export const DESKTOP_COMPANION_MAX_PENDING = 16;
export interface DesktopCompanionPending {
  readonly commandId: string;
  readonly kind: 'message' | 'stop';
  readonly taskId: string | null;
  readonly status: 'sending' | 'uncertain' | 'accepted';
}
export interface DesktopCompanionState {
  readonly version: 1;
  readonly revision: number;
  readonly source: 'ready' | 'disabled' | 'unavailable';
  readonly baseUrl: string;
  readonly configRevision: number;
  readonly connectionId: string | null;
  readonly phase: 'idle' | 'connecting' | 'live' | 'offline' | 'retiring';
  readonly confirmedAt: number | null;
  readonly snapshot: CompanionSnapshot | null;
  readonly pending: readonly DesktopCompanionPending[];
  readonly error: KernelError | null;
}
export interface DesktopCompanionTarget {
  readonly connectionId: string;
}
export interface DesktopArtifactSave {
  readonly status: 'saved' | 'cancelled';
  readonly name: string;
  readonly sizeBytes: number;
}
export interface DesktopCompanionBridge {
  readonly version: 1;
  getState(): Promise<Result<DesktopCompanionState>>;
  onChanged(listener: () => void): () => void;
  connect(input: {
    readonly expectedRevision: number;
    readonly baseUrl: string;
    readonly token: string;
  }): Promise<Result<DesktopCompanionState>>;
  reconnect(input: DesktopCompanionTarget): Promise<Result<DesktopCompanionState>>;
  disconnect(input: DesktopCompanionTarget): Promise<Result<DesktopCompanionState>>;
  refresh(input: DesktopCompanionTarget): Promise<Result<DesktopCompanionState>>;
  sendMessage(
    input: DesktopCompanionTarget & CompanionMessageCommand,
  ): Promise<Result<CompanionCommandReceipt>>;
  stopTask(
    input: DesktopCompanionTarget & CompanionStopCommand & { readonly taskId: string },
  ): Promise<Result<CompanionCommandReceipt>>;
  stopForeground(input: DesktopCompanionTarget): Promise<Result<null>>;
  readProfile(input: DesktopCompanionTarget): Promise<Result<CompanionProfileView>>;
  readTask(
    input: DesktopCompanionTarget & { readonly taskId: string },
  ): Promise<Result<CompanionTask>>;
  saveArtifact(
    input: DesktopCompanionTarget & { readonly artifactId: string },
  ): Promise<Result<DesktopArtifactSave>>;
  saveModel(
    input: DesktopCompanionTarget & { readonly command: CompanionModelSaveCommand },
  ): Promise<Result<CompanionModelView>>;
  testModel(
    input: DesktopCompanionTarget & { readonly command: CompanionModelTestCommand },
  ): Promise<Result<CompanionModelView>>;
}
export const DESKTOP_COMPANION_IPC = {
  getState: 'companion:desktop:v1:getState',
  changed: 'companion:desktop:v1:changed',
  connect: 'companion:desktop:v1:connect',
  reconnect: 'companion:desktop:v1:reconnect',
  disconnect: 'companion:desktop:v1:disconnect',
  refresh: 'companion:desktop:v1:refresh',
  sendMessage: 'companion:desktop:v1:sendMessage',
  stopTask: 'companion:desktop:v1:stopTask',
  stopForeground: 'companion:desktop:v1:stopForeground',
  readProfile: 'companion:desktop:v1:readProfile',
  readTask: 'companion:desktop:v1:readTask',
  saveArtifact: 'companion:desktop:v1:saveArtifact',
  saveModel: 'companion:desktop:v1:saveModel',
  testModel: 'companion:desktop:v1:testModel',
} as const;
export const DESKTOP_PRESENTATION_KEYS = [
  'figure',
  'palette',
  'size',
  'visible',
  'alwaysOnTop',
  'draggable',
  'reducedMotion',
  'bubbleFontSize',
  'bubbleSpeed',
  'glow',
  'hover',
  'doubleClickTyping',
  'statusBubble',
  'saidBubble',
  'hideInFullscreen',
  'rememberPosition',
  'lockFps',
  'frameRate',
  'soundEnabled',
  'soundMove',
  'soundTouch',
  'soundFace',
  'soundSnore',
  'soundUi',
  'speechEnabled',
  'speechProvider',
  'speechVoice',
  'speechRate',
  'speechVolume',
] as const;
export type DesktopPresentationKey = (typeof DESKTOP_PRESENTATION_KEYS)[number];
export type DesktopPresentationPreferences = Pick<ApplicationPreferences, DesktopPresentationKey>;
export interface DesktopPresentationSnapshot {
  readonly version: 1;
  readonly revision: number;
  readonly preferences: Readonly<DesktopPresentationPreferences> | null;
  readonly desktop: { readonly available: boolean; readonly shown: boolean };
  readonly error: KernelError | null;
}
export interface DesktopPresentationBridge {
  readonly version: 1;
  getSnapshot(): Promise<Result<DesktopPresentationSnapshot>>;
  onChanged(listener: () => void): () => void;
  save(input: {
    readonly expectedRevision: number;
    readonly patch: Partial<DesktopPresentationPreferences>;
  }): Promise<Result<DesktopPresentationSnapshot>>;
}
export const DESKTOP_PRESENTATION_IPC = {
  snapshot: 'companion:presentation:v1:snapshot',
  save: 'companion:presentation:v1:save',
  changed: 'companion:presentation:v1:changed',
} as const;
