import { spawn } from 'node:child_process';
import { pcmWave } from '../../asr-cloud/src/transcription.js';
const SETUP =
  "$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new();Add-Type -AssemblyName System.Speech;$voices=[System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers();if($voices.Count -eq 0){exit 3};";
/** Uses a WAV stream, so SAPI never opens a second microphone. */
export async function sapiRecognize(
  samples: Float32Array | null,
  signal: AbortSignal,
): Promise<string> {
  if (process.platform !== 'win32') throw new Error('not-ready');
  if (signal.aborted) throw new Error('cancelled');
  const script =
    SETUP +
    (samples === null
      ? "[Console]::Out.Write('ready')"
      : "$engine=[System.Speech.Recognition.SpeechRecognitionEngine]::new($voices[0]);try{$engine.LoadGrammar([System.Speech.Recognition.DictationGrammar]::new());$bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd());$stream=[IO.MemoryStream]::new($bytes);$engine.SetInputToWaveStream($stream);$result=[Collections.Generic.List[string]]::new();Register-ObjectEvent $engine SpeechRecognized -SourceIdentifier pet-sapi-recognized|Out-Null;Register-ObjectEvent $engine RecognizeCompleted -SourceIdentifier pet-sapi-completed|Out-Null;$engine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple);$done=$false;while(!$done){$event=Wait-Event -Timeout 30;if($null -eq $event){throw 'recognition-timeout'};if($event.SourceIdentifier -eq 'pet-sapi-recognized'){$result.Add($event.SourceEventArgs.Result.Text)}elseif($event.SourceIdentifier -eq 'pet-sapi-completed'){if($event.SourceEventArgs.Error){throw 'recognition-failed'};$done=$true};Remove-Event -EventIdentifier $event.EventIdentifier};[Console]::Out.Write(($result -join ' '))}finally{Unregister-Event -SourceIdentifier pet-sapi-recognized -ErrorAction SilentlyContinue;Unregister-Event -SourceIdentifier pet-sapi-completed -ErrorAction SilentlyContinue;$engine.Dispose();if($stream){$stream.Dispose()}}");
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const child = spawn(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] },
  );
  let text = '';
  return new Promise((resolve, reject) => {
    let settled = false;
    const abort = () => {
      child.kill();
      finish(new Error('cancelled'));
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(text.trim());
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (part: string) => {
      text += part;
      if (text.length > 16384) {
        child.kill();
        finish(new Error('asr-failed'));
      }
    });
    child.once('error', () => finish(new Error('not-ready')));
    child.once('close', (code) =>
      finish(code === 0 ? undefined : new Error(code === 3 ? 'not-ready' : 'asr-failed')),
    );
    child.stdin.on('error', () => {
      child.kill();
      finish(new Error('asr-failed'));
    });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    child.stdin.end(samples === null ? '' : Buffer.from(pcmWave(samples)).toString('base64'));
  });
}
