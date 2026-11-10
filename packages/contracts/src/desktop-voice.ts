import type { CaptureErrorReason } from './demo.js';
import type { DesktopCompanionTarget } from './desktop-companion.js';
import type { KernelError, Result } from './errors.js';
import type {
  VoiceBeginSelection,
  VoiceCaptureResult,
  VoiceCatalog,
  VoiceProviderCommand,
  VoiceResultKey,
  VoiceSettingsCommand,
  VoiceTicket,
  VoiceView,
} from './companion-voice.js';

export const DESKTOP_VOICE_MAX_STATE_BYTES = 24 * 1024;
export interface DesktopVoiceState {
  readonly version: 1;
  readonly revision: number;
  readonly connectionId: string | null;
  readonly phase:
    'idle' | 'arming' | 'recording' | 'finishing' | 'transcribing' | 'retiring' | 'error';
  readonly captureId: string | null;
  readonly samples: number;
  readonly cleanup: 'settled' | 'pending';
  readonly error: KernelError | null;
}
type Target = DesktopCompanionTarget;
type Capture = Target & { readonly captureId: string };
export interface DesktopVoiceBridge {
  readonly version: 1;
  getState(): Promise<Result<DesktopVoiceState>>;
  onChanged(listener: () => void): () => void;
  readVoice(input: Target): Promise<Result<VoiceView>>;
  saveVoiceSettings(
    input: Target & { readonly command: VoiceSettingsCommand },
  ): Promise<Result<VoiceView>>;
  saveAsrProvider(
    input: Target & { readonly command: VoiceProviderCommand },
  ): Promise<Result<VoiceView>>;
  readAsrCatalog(
    input: Target & { readonly providerRef: string; readonly bindingId: string },
  ): Promise<Result<VoiceCatalog>>;
  begin(input: Target & VoiceBeginSelection): Promise<Result<VoiceTicket>>;
  readCaptureResult(input: Target & VoiceResultKey): Promise<Result<VoiceCaptureResult>>;
  captureReady(input: Capture & { readonly sampleRate: 16000 }): Promise<Result<null>>;
  pushAudio(
    input: Capture & { readonly sequence: number },
    payload: Uint8Array,
  ): Promise<Result<null>>;
  finishCapture(input: Capture & { readonly frames: number }): Promise<Result<VoiceCaptureResult>>;
  cancelCapture(input: Capture): Promise<Result<DesktopVoiceState>>;
  reportCaptureError(
    input: Capture & { readonly reason: CaptureErrorReason },
  ): Promise<Result<DesktopVoiceState>>;
  reportCaptureReleased(input: Capture): Promise<Result<null>>;
}
export const DESKTOP_VOICE_IPC = {
  getState: 'voice:desktop:v1:getState',
  changed: 'voice:desktop:v1:changed',
  readVoice: 'voice:desktop:v1:readVoice',
  saveVoiceSettings: 'voice:desktop:v1:saveVoiceSettings',
  saveAsrProvider: 'voice:desktop:v1:saveAsrProvider',
  readAsrCatalog: 'voice:desktop:v1:readAsrCatalog',
  begin: 'voice:desktop:v1:begin',
  readCaptureResult: 'voice:desktop:v1:readCaptureResult',
  captureReady: 'voice:desktop:v1:captureReady',
  pushAudio: 'voice:desktop:v1:pushAudio',
  finishCapture: 'voice:desktop:v1:finishCapture',
  cancelCapture: 'voice:desktop:v1:cancelCapture',
  reportCaptureError: 'voice:desktop:v1:reportCaptureError',
  reportCaptureReleased: 'voice:desktop:v1:reportCaptureReleased',
} as const;
