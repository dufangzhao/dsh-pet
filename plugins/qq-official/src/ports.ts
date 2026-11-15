import type { KernelError, QQOfficialSettings } from '@pet/contracts';
import type { PluginContext } from '@pet/plugin-sdk';
import type { QQIoOutcome } from '@pet/companion-runtime';
import type { OfficialQqDriver } from './driver.js';
import type { OfficialMediaIo } from './media-types.js';
export type {
  OfficialMediaIo,
  OfficialMediaInput,
  OfficialMediaResult,
  OfficialMediaOperationResult,
  OfficialPrepareOutcome,
  OfficialAttachmentInput,
  OfficialDownloadedMedia,
} from './media-types.js';
import type { OfficialMessageEvent, OfficialMessageRequest } from './wire.js';

/** One captured, host-authenticated production gateway. There is one frame consumer. */
export interface OfficialGateway {
  /** Unique for this physical connection, never reused as an account/binding identifier. */
  readonly id: string;
  /** Aborts synchronously when this physical connection retires; independent of settlement. */
  readonly signal: AbortSignal;
  readonly frames: AsyncIterable<string>;
  /** Physical transport settlement, including outstanding reader/writer work. */
  readonly settled: Promise<void>;
  /** Host owns the QQ access token and constructs the native Identify/Resume payload. */
  identify(signal: AbortSignal): Promise<void>;
  resume(
    input: { readonly sessionId: string; readonly sequence: number },
    signal: AbortSignal,
  ): Promise<void>;
  heartbeat(sequence: number | null, signal: AbortSignal): Promise<void>;
  /** Idempotent; unblocks frames. Rejects when actual closure cannot be confirmed. */
  close(): Promise<void>;
}
export interface OfficialHttpResponse {
  readonly status: number;
  readonly body: string;
}
/** All methods recheck the captured source/credential/target authority in the host. */
export interface OfficialIo {
  readonly media: OfficialMediaIo;
  openGateway(signal: AbortSignal): Promise<OfficialGateway>;
  /** These promises include response-body consumption and actual native settlement. No retries. */
  send(
    request: OfficialMessageRequest,
    signal: AbortSignal,
  ): Promise<QQIoOutcome<OfficialHttpResponse>>;
  upload(
    request: OfficialMessageRequest,
    signal: AbortSignal,
  ): Promise<QQIoOutcome<OfficialHttpResponse>>;
  /** Closes owned gateway/HTTP work, not another source's transport. */
  close(): Promise<void>;
}
export interface OfficialDriverStatus {
  readonly phase:
    | 'idle'
    | 'connecting'
    | 'authenticating'
    | 'ready'
    | 'offline'
    | 'retiring'
    | 'stopped'
    | 'failed';
  readonly connectionId: string | null;
  readonly selfId: string | null;
  readonly error: KernelError | null;
}
export interface OfficialDriverObserver {
  /** Synchronous bounded state observation; never an inference callback. */
  onStatus(status: OfficialDriverStatus): void;
  /** Bounded native-event admission only. Accepted Core work has a separate lifetime. */
  onEvent(event: OfficialMessageEvent, connectionId: string, signal: AbortSignal): Promise<void>;
}
export interface OfficialQqPorts {
  /** Constructs a closed-purpose binding only; no credential borrow or network during activation. */
  authorizedOfficial(settings: QQOfficialSettings): OfficialIo;
  readonly observer: OfficialDriverObserver;
  /** Registers synchronously. The controller calls driver.start only once its source is active. */
  bind(driver: OfficialQqDriver): () => Promise<void>;
}
export type OfficialQqPortsFor = (context: PluginContext) => OfficialQqPorts;
