import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SPEECH_OUTPUT_MAX_BYTES,
  type SpeechOutputRequest,
  type SpeechOutputFailureReason,
} from '@pet/contracts';

export type SystemSpeechResult =
  | { ok: true; pcm: Uint8Array }
  | {
      ok: false;
      errorCode: 'unavailable' | 'cancelled' | 'quota-exceeded' | 'invalid-input';
      reason?: SpeechOutputFailureReason;
    };

/** Fixed declared helper and executable. No request value is a command argument. */
export function systemSpeechLaunch(): { executable: string; args: string[] } {
  return {
    executable: path.win32.join(
      process.env['SystemRoot'] ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    ),
    args: [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      fileURLToPath(new URL('./system-speech.ps1', import.meta.url)),
    ],
  };
}

export class SystemSpeechEngine {
  #child: ChildProcessWithoutNullStreams | undefined;
  #closed = false;
  close(): void {
    this.#closed = true;
    this.#child?.kill();
  }
  synthesize(request: SpeechOutputRequest, signal: AbortSignal): Promise<SystemSpeechResult> {
    if (process.platform !== 'win32')
      return Promise.resolve({
        ok: false,
        errorCode: 'unavailable',
        reason: 'unsupported-platform',
      });
    if (signal.aborted || this.#closed)
      return Promise.resolve({ ok: false, errorCode: 'cancelled' });
    if (this.#child)
      return Promise.resolve({ ok: false, errorCode: 'unavailable', reason: 'synthesis-failed' });
    const launch = systemSpeechLaunch();
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(launch.executable, launch.args, {
        windowsHide: true,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      return Promise.resolve({ ok: false, errorCode: 'unavailable', reason: 'synthesis-failed' });
    }
    this.#child = child;
    return new Promise((resolve) => {
      const chunks: Uint8Array[] = [];
      let count = 0;
      let failed: SystemSpeechResult | undefined;
      const abort = (): void => {
        child.kill();
      };
      signal.addEventListener('abort', abort, { once: true });
      child.stdout.on('data', (chunk: Buffer) => {
        count += chunk.byteLength;
        if (count > SPEECH_OUTPUT_MAX_BYTES) {
          failed = { ok: false, errorCode: 'quota-exceeded', reason: 'audio-budget' };
          child.kill();
        } else chunks.push(Uint8Array.from(chunk));
      });
      // Drain fixed diagnostics without exposing exception text or the utterance.
      child.stderr.resume();
      child.stdin.on('error', () => {
        failed = { ok: false, errorCode: 'unavailable', reason: 'synthesis-failed' };
        child.kill();
      });
      child.once('error', () => {
        failed = { ok: false, errorCode: 'unavailable', reason: 'synthesis-failed' };
      });
      child.once('close', (code) => {
        signal.removeEventListener('abort', abort);
        if (this.#child === child) this.#child = undefined;
        if (signal.aborted || this.#closed) resolve({ ok: false, errorCode: 'cancelled' });
        else if (failed) resolve(failed);
        else if (code === 20)
          resolve({ ok: false, errorCode: 'unavailable', reason: 'voice-unavailable' });
        else if (code === 22)
          resolve({ ok: false, errorCode: 'quota-exceeded', reason: 'audio-budget' });
        else if (code !== 0)
          resolve({ ok: false, errorCode: 'unavailable', reason: 'synthesis-failed' });
        else if (!count || count % 2)
          resolve({ ok: false, errorCode: 'unavailable', reason: 'invalid-audio' });
        else {
          const pcm = new Uint8Array(count);
          let offset = 0;
          for (const chunk of chunks) {
            pcm.set(chunk, offset);
            offset += chunk.byteLength;
          }
          resolve({ ok: true, pcm });
        }
      });
      if (signal.aborted) abort();
      else
        child.stdin.end(
          JSON.stringify({
            text: request.text,
            language: request.language,
            voice: request.voice,
            rate: request.rate,
          }),
          'utf8',
        );
    });
  }
}
