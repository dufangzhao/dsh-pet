import type { CaptureErrorReason } from './demo.js';

/** Neutral capture limits shared by browser, desktop and ASR adapters. */
export const VOICE_SAMPLE_RATE = 16000;
export const VOICE_MAX_SECONDS = 20;
export const VOICE_CHUNK_SAMPLES = 1600;
export const VOICE_MAX_SAMPLES = VOICE_SAMPLE_RATE * VOICE_MAX_SECONDS;
export const VOICE_MAX_PCM_BYTES = VOICE_MAX_SAMPLES * 4;
export interface AudioCaptureFormat {
  readonly encoding: 'f32le';
  readonly sampleRate: 16000;
  readonly channels: 1;
}
export interface AudioCaptureTicket extends AudioCaptureFormat {
  readonly chunkSamples: 1600;
  readonly maxSamples: number;
  readonly microphoneId?: string;
}
/** Sampling callbacks carry no service identity. The owner numbers acknowledged frames. */
export interface AudioCaptureEvents {
  ready(sampleRate: number): Promise<void>;
  push(samples: Float32Array): Promise<void>;
  failed(reason: CaptureErrorReason): void;
  limitReached(): void;
  level?(rms: number): void;
  readonly signal?: AbortSignal;
}
export interface AudioCaptureOperation {
  finish(): Promise<AudioCaptureSummary>;
  cancel(): Promise<void>;
  readonly released: Promise<void>;
}
export interface AudioCaptureOptions {
  readonly workletUrl: string;
}
export interface AudioCaptureSummary {
  readonly frames: number;
  readonly samples: number;
}
