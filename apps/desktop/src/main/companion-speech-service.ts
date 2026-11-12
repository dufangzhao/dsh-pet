import type {
  CompanionEvent,
  DesktopCompanionTarget,
  KernelError,
  Result,
  SpeechAudioHeader,
  SpeechBegin,
  SpeechCatalog,
  SpeechProviderCommand,
  SpeechRemoteBinding,
  SpeechSegmentKey,
  SpeechSegmentReceipt,
  SpeechUtteranceKey,
  SpeechUtteranceReceipt,
  SpeechUtteranceStatus,
  SpeechView,
} from '@pet/contracts';

export interface SpeechBaseline {
  readonly connectionId: string;
  readonly clientId: string;
  readonly agentId: string;
  readonly serviceEpoch: string;
  readonly cursor: number;
}
export type SpeechConnectionEvent =
  | { readonly kind: 'live'; readonly connectionId: string }
  | { readonly kind: 'refresh'; readonly connectionId: string }
  | { readonly kind: 'invalid'; readonly connectionId: string }
  | { readonly kind: 'fence'; readonly connectionId: string; readonly error: KernelError }
  | { readonly kind: 'event'; readonly baseline: SpeechBaseline; readonly event: CompanionEvent };
export type SpeechAudioConsumption = (
  header: SpeechAudioHeader,
  pcm: AsyncIterable<Uint8Array>,
  signal: AbortSignal,
) => Promise<void>;
/** Entire PCM callback stays inside the captured connection's credential borrow. */
export interface CompanionSpeechSession {
  readonly connectionId: string;
  readonly clientId: string;
  readonly agentId: string;
  readonly serviceEpoch: string;
  readonly signal: AbortSignal;
  isCurrent(): Promise<boolean>;
  baseline(signal?: AbortSignal): Promise<Result<SpeechBaseline>>;
  readSpeech(signal?: AbortSignal): Promise<Result<SpeechView>>;
  saveProvider(command: SpeechProviderCommand): Promise<Result<SpeechView>>;
  catalog(input: SpeechRemoteBinding): Promise<Result<SpeechCatalog>>;
  begin(input: SpeechBegin, signal: AbortSignal): Promise<Result<SpeechUtteranceReceipt>>;
  reserve(input: SpeechSegmentKey, signal: AbortSignal): Promise<Result<SpeechSegmentReceipt>>;
  consumeAudio(
    input: SpeechSegmentKey,
    binding: SpeechRemoteBinding,
    signal: AbortSignal,
    consume: SpeechAudioConsumption,
  ): Promise<Result<null>>;
  status(input: SpeechUtteranceKey, signal?: AbortSignal): Promise<Result<SpeechUtteranceStatus>>;
  cancel(input: SpeechUtteranceKey): Promise<Result<SpeechUtteranceStatus>>;
}
export interface CompanionSpeechService {
  getState(): Promise<Result<{ readonly connectionId: string | null; readonly phase: string }>>;
  speechSession(target: DesktopCompanionTarget): CompanionSpeechSession;
  onSpeechEvent(listener: (event: SpeechConnectionEvent) => void): () => void;
  onSpeechRetiring(listener: (connectionId: string) => Promise<void>): () => void;
}
