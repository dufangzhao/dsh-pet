import type { QQIoOutcome, QQMediaSource } from '@pet/companion-runtime';
import type { KernelError } from '@pet/contracts';
import type { SnowMediaRequest } from './media-wire.js';
import type { OneBotResponse } from './wire.js';

export type SnowMediaLookup = (
  action: 'get_group_file_url' | 'get_private_file_url',
  params: unknown,
  signal: AbortSignal,
) => Promise<QQIoOutcome<OneBotResponse>>;

export interface SnowMediaExchange {
  /** Native action-write settlement, not the remote transfer result. */
  readonly sent: Promise<QQIoOutcome<null>>;
  /** Only this registered echo's frames. Never forwarded into ordinary message admission. */
  readonly frames: AsyncIterable<string>;
  readonly settled: Promise<void>;
  /** Stops/drains this owned route, and awaits actual local reader/write settlement. */
  close(): Promise<void>;
}
export interface SnowMediaIo {
  /** Synchronously registers a finite action/echo before writing to this authenticated peer. */
  openMedia(request: SnowMediaRequest, signal: AbortSignal): SnowMediaExchange;
}
export interface SnowMediaRoute {
  readonly scene: 'private' | 'group';
  readonly targetId: string;
}
export interface SnowMediaUploadInput extends SnowMediaRoute {
  readonly kind: 'image' | 'voice' | 'file' | 'text';
  readonly source: QQMediaSource;
}
export interface SnowStagedMedia extends SnowMediaRoute {
  readonly connectionId: string;
  readonly kind: SnowMediaUploadInput['kind'];
  readonly name: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  /** Set only from a verified file_complete response's stream_id, never from a request alone. */
  readonly transferId: string;
  /** Private gateway path; never opened on this host and never included in a public receipt. */
  readonly remotePath: string;
}
export type SnowMediaDownloadSource =
  | { readonly kind: 'image' | 'voice'; readonly fileId: string }
  | (SnowMediaRoute & {
      readonly kind: 'file';
      readonly fileId: string;
      readonly fileHash: string | null;
      readonly busid: number | null;
    });
export interface SnowMediaDownloadInput {
  readonly source: SnowMediaDownloadSource;
  readonly expectedSizeBytes: number | null;
  readonly expectedSha256: string | null;
}
export interface SnowDownloadedMedia {
  readonly connectionId: string;
  readonly name: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly chunks: number;
}
export type SnowMediaOutcome<T> =
  | { readonly kind: 'complete'; readonly value: T }
  | {
      readonly kind: 'unknown' | 'rejected';
      readonly connectionId: string;
      readonly confirmedBytes: number;
      readonly confirmedChunks: number;
      readonly error: KernelError;
      readonly retcode: number | null;
    };
