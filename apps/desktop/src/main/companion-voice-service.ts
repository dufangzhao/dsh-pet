import type {
  DesktopCompanionTarget,
  Result,
  VoiceView,
  VoiceSettingsCommand,
  VoiceProviderCommand,
  VoiceCatalog,
  VoiceTicket,
  VoiceCaptureResult,
  VoiceResultKey,
  VoiceBeginSelection,
} from '@pet/contracts';

/** Main-only fixed operations. Neither a transport nor a credential crosses this port. */
export interface CompanionVoiceSession {
  readonly connectionId: string;
  readonly clientId: string;
  readonly agentId: string;
  readonly signal: AbortSignal;
  isCurrent(): Promise<boolean>;
  readVoice(signal?: AbortSignal): Promise<Result<VoiceView>>;
  saveSettings(command: VoiceSettingsCommand): Promise<Result<VoiceView>>;
  saveProvider(command: VoiceProviderCommand): Promise<Result<VoiceView>>;
  catalog(target: { providerRef: string; bindingId: string }): Promise<Result<VoiceCatalog>>;
  begin(selection: VoiceBeginSelection, signal: AbortSignal): Promise<Result<VoiceTicket>>;
  upload(
    ticket: VoiceTicket,
    samples: number,
    pcm: Uint8Array,
    signal: AbortSignal,
  ): Promise<Result<VoiceCaptureResult>>;
  result(key: VoiceResultKey, signal?: AbortSignal): Promise<Result<VoiceCaptureResult>>;
  cancel(ticket: VoiceTicket): Promise<Result<VoiceCaptureResult>>;
}
export interface CompanionVoiceService {
  voiceSession(target: DesktopCompanionTarget): CompanionVoiceSession;
  onVoiceRetiring(listener: (connectionId: string) => Promise<void>): () => void;
}
