import type { QQIoOutcome, QQMediaRead, QQMediaSource } from '@pet/companion-runtime';
import type { KernelError } from '@pet/contracts';
import type { OfficialHttpResponse } from './ports.js';
import type { OfficialHttpReceipt } from './wire.js';
import type {
  OfficialMediaHashes,
  OfficialMediaMetadata,
  OfficialMediaRoute,
  OfficialPreparedUpload,
} from './media-wire.js';

export type OfficialPrepareOutcome =
  | { readonly kind: 'prepared'; readonly plan: OfficialPreparedUpload }
  | Extract<OfficialHttpReceipt, { kind: 'rejected' | 'unknown' }>;

export interface OfficialMediaIo {
  /** Host streams private bytes as file_data; never routes the body through canonical control JSON. */
  inline(
    metadata: OfficialMediaMetadata & { readonly srv_send_msg: false },
    body: AsyncIterable<Uint8Array>,
    signal: AbortSignal,
  ): Promise<QQIoOutcome<OfficialHttpResponse>>;
  /** Host registers the actual provider presigned URLs by this route/upload_id/index. */
  prepare(
    metadata: OfficialMediaMetadata,
    hashes: OfficialMediaHashes,
    signal: AbortSignal,
  ): Promise<QQIoOutcome<OfficialPrepareOutcome>>;
  /** Host-only grant from a captured official attachment; HTTPS/provider-domain policy, no QQ auth. */
  readAttachment(
    input: OfficialMediaRoute & { readonly url: string; readonly maximumBytes: number },
    signal: AbortSignal,
    check: () => Promise<void>,
  ): Promise<QQMediaRead>;
  /** Resolves only a registered prepare URL; there is deliberately no arbitrary URL parameter. */
  putPart(
    input: OfficialMediaRoute & {
      readonly upload_id: string;
      readonly part_index: number;
      readonly byteLength: number;
    },
    body: AsyncIterable<Uint8Array>,
    signal: AbortSignal,
  ): Promise<QQIoOutcome<OfficialHttpResponse>>;
  finishPart(
    input: OfficialMediaRoute & {
      readonly upload_id: string;
      readonly part_index: number;
      readonly block_size: string;
      readonly md5: string;
    },
    signal: AbortSignal,
  ): Promise<QQIoOutcome<OfficialHttpResponse>>;
  commit(
    input: OfficialMediaMetadata & { readonly upload_id: string; readonly srv_send_msg: false },
    signal: AbortSignal,
  ): Promise<QQIoOutcome<OfficialHttpResponse>>;
}
export interface OfficialMediaInput extends OfficialMediaRoute {
  readonly fileType: 1 | 3 | 4;
  readonly source: QQMediaSource;
}
export interface OfficialAttachmentInput extends OfficialMediaRoute {
  readonly url: string;
  readonly name: string;
  readonly maximumBytes: number;
  readonly expectedSizeBytes: number | null;
  readonly expectedSha256: string | null;
}
export interface OfficialDownloadedMedia {
  readonly connectionId: string;
  readonly name: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}
export type OfficialMediaOperationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: KernelError; readonly cleanup?: 'settled' | 'failed' };

export interface OfficialMediaResult {
  readonly connectionId: string;
  /** Physical reader join, independent of a completed provider receipt or logical cancellation. */
  readonly cleanup: 'settled' | 'failed';
  readonly stage: 'hash' | 'inline' | 'prepare' | 'part' | 'finish' | 'commit';
  readonly completedParts: number;
  /** Bytes positively acknowledged by the provider, not merely read from the source. */
  readonly confirmedBytes: number;
  readonly receipt: OfficialHttpReceipt;
  readonly error: KernelError | null;
}
