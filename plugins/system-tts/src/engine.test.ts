import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { SPEECH_OUTPUT_MAX_BYTES } from '@pet/contracts';
const spawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn }));
import { SystemSpeechEngine } from './engine.js';
const platform = Object.getOwnPropertyDescriptor(process, 'platform');
const request = {
  utteranceId: 'reply-1',
  text: '你好。$(Get-Process); "quoted" text',
  language: 'zh-CN',
  voice: null,
  rate: 0,
};
function child() {
  const value = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => {
      queueMicrotask(() => value.emit('close', null));
      return true;
    }),
  });
  spawn.mockReturnValueOnce(value as unknown as ChildProcessWithoutNullStreams);
  return value;
}
beforeEach(() => {
  spawn.mockReset();
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
});
afterEach(() => {
  if (platform) Object.defineProperty(process, 'platform', platform);
});
describe('Windows speech worker boundary', () => {
  it('sends user text only as typed stdin to the fixed declared helper without a shell', async () => {
    const worker = child(),
      engine = new SystemSpeechEngine();
    const input: Buffer[] = [];
    worker.stdin.on('data', (bytes: Buffer) => input.push(bytes));
    const done = engine.synthesize(request, new AbortController().signal);
    const [executable, args, options] = spawn.mock.calls[0] ?? [];
    expect(executable).toMatch(/WindowsPowerShell.*powershell.exe$/);
    expect(args).toContain('-File');
    expect(args.at(-1)).toMatch(/system-speech.ps1$/);
    expect(args.join(' ')).not.toContain(request.text);
    expect(options.shell).toBe(false);
    expect(JSON.parse(Buffer.concat(input).toString('utf8'))).toEqual({
      text: request.text,
      language: request.language,
      voice: null,
      rate: 0,
    });
    worker.stdout.write(Buffer.from([0, 0, 100, 0]));
    worker.emit('close', 0);
    expect(await done).toEqual({ ok: true, pcm: new Uint8Array([0, 0, 100, 0]) });
    engine.close();
  });
  it('kills excess output and does not return truncated audio as success', async () => {
    const worker = child(),
      engine = new SystemSpeechEngine();
    const done = engine.synthesize(request, new AbortController().signal);
    worker.stdout.write(Buffer.alloc(SPEECH_OUTPUT_MAX_BYTES + 1));
    expect(await done).toEqual({ ok: false, errorCode: 'quota-exceeded', reason: 'audio-budget' });
    expect(worker.kill).toHaveBeenCalledOnce();
    engine.close();
  });
  it('cancels the helper and rejects late audio on task cancellation', async () => {
    const worker = child(),
      engine = new SystemSpeechEngine(),
      abort = new AbortController();
    const done = engine.synthesize(request, abort.signal);
    worker.stdout.write(Buffer.from([1, 0]));
    abort.abort();
    expect(await done).toEqual({ ok: false, errorCode: 'cancelled' });
    expect(worker.kill).toHaveBeenCalledOnce();
    engine.close();
  });
  it('reports unavailable requested voices and unsupported platforms honestly', async () => {
    const worker = child(),
      engine = new SystemSpeechEngine();
    const done = engine.synthesize(
      { ...request, voice: 'Missing voice' },
      new AbortController().signal,
    );
    worker.emit('close', 20);
    expect(await done).toEqual({
      ok: false,
      errorCode: 'unavailable',
      reason: 'voice-unavailable',
    });
    engine.close();
    spawn.mockClear();
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const unsupported = new SystemSpeechEngine();
    expect(await unsupported.synthesize(request, new AbortController().signal)).toEqual({
      ok: false,
      errorCode: 'unavailable',
      reason: 'unsupported-platform',
    });
    expect(spawn).not.toHaveBeenCalled();
    unsupported.close();
  });
});
