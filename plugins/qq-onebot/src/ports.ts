import type { KernelError, QQOneBotSettings } from '@pet/contracts';
import type { PluginContext } from '@pet/plugin-sdk';
import type { QQIoOutcome } from '@pet/companion-runtime';
import type { OneBotQqDriver } from './driver.js';
import type { SnowMediaIo } from './media-types.js';
export type {
  SnowMediaIo,
  SnowMediaExchange,
  SnowMediaUploadInput,
  SnowMediaDownloadInput,
  SnowMediaOutcome,
  SnowStagedMedia,
  SnowDownloadedMedia,
} from './media-types.js';
export type { SnowMediaRequest } from './media-wire.js';
import type { OneBotActionFrame, OneBotFrame, OneBotResponse } from './wire.js';

/** Host verifies Bearer, expected account and reverse Universal role before exposing this peer. */
export interface OneBotPeer extends SnowMediaIo {
  /** Unique for this physical connection; account identity alone is not a connection epoch. */
  readonly id: string;
  /** Aborts synchronously on physical close/retirement, before outstanding writes settle. */
  readonly signal: AbortSignal;
  readonly selfId: string;
  /** One consumer of metadata/control frames. Binary stream operations are not assembled here. */
  readonly frames: AsyncIterable<string>;
  readonly settled: Promise<void>;
  /** Settles only after the actual transport write has settled; never replays frames. */
  send(frame: OneBotActionFrame, signal: AbortSignal): Promise<QQIoOutcome<null>>;
  /** Idempotent, unblocks frames; rejects if actual close is unconfirmed. */
  close(): Promise<void>;
}
export interface OneBotIo {
  /** Waits for an already authenticated incoming Universal peer; never dials a QQ client. */
  nextPeer(signal: AbortSignal): Promise<OneBotPeer>;
  /** Stops the owned listener, pending accepts and peers and awaits physical settlement. */
  close(): Promise<void>;
}
export interface OneBotDriverStatus {
  readonly phase: 'idle' | 'waiting' | 'ready' | 'offline' | 'retiring' | 'stopped' | 'failed';
  readonly connectionId: string | null;
  readonly error: KernelError | null;
}
export interface OneBotDriverObserver {
  onStatus(status: OneBotDriverStatus): void;
  onEvent(
    event: Exclude<OneBotFrame, OneBotResponse>,
    connectionId: string,
    signal: AbortSignal,
  ): Promise<void>;
}
export interface OneBotQqPorts {
  /** Constructs a closed-purpose binding only; activation must not listen or borrow credentials. */
  authorizedOneBot(settings: QQOneBotSettings): OneBotIo;
  readonly observer: OneBotDriverObserver;
  bind(driver: OneBotQqDriver): () => Promise<void>;
}
export type OneBotQqPortsFor = (context: PluginContext) => OneBotQqPorts;
