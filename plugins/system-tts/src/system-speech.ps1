$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
$synthesizer = $null
$stream = $null
$exitCode = 21
try {
  $raw = [Console]::In.ReadToEnd()
  if ($raw.Length -gt 32768) { exit 23 }
  $request = ConvertFrom-Json -InputObject $raw
  $keys = @($request.PSObject.Properties.Name | Sort-Object)
  if (($keys -join ',') -ne 'language,rate,text,voice') { exit 23 }
  if ($request.text -isnot [string] -or $request.text.Length -lt 1 -or $request.text.Length -gt 8000) { exit 23 }
  if ($request.language -isnot [string] -or $request.language -notmatch '^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8}){0,3}$') { exit 23 }
  if ($request.rate -isnot [int] -or $request.rate -lt -10 -or $request.rate -gt 10) { exit 23 }
  if ($null -ne $request.voice -and ($request.voice -isnot [string] -or $request.voice.Length -lt 1 -or $request.voice.Length -gt 256)) { exit 23 }
  Add-Type -AssemblyName System.Speech
  $synthesizer = [System.Speech.Synthesis.SpeechSynthesizer]::new()
  if ($null -ne $request.voice) {
    $matched = @($synthesizer.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Name -ceq $request.voice })
    if ($matched.Count -ne 1) { $exitCode = 20; throw 'voice-unavailable' }
    $synthesizer.SelectVoice($request.voice)
  }
  $synthesizer.Rate = $request.rate
  $synthesizer.Volume = 100
  $stream = [IO.MemoryStream]::new()
  $format = [System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(24000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  $synthesizer.SetOutputToAudioStream($stream, $format)
  # Speak consumes plain text. User input is never a script, expression, or SSML.
  $synthesizer.Speak($request.text)
  $synthesizer.SetOutputToNull()
  if ($stream.Length -lt 2 -or $stream.Length -gt 2097152) { $exitCode = 22; throw 'audio-budget' }
  $stdout = [Console]::OpenStandardOutput()
  $stream.Position = 0
  $stream.CopyTo($stdout)
  $stdout.Flush()
  $exitCode = 0
} catch {
  # Only the fixed process exit code crosses this boundary; never echo text/errors.
} finally {
  if ($null -ne $synthesizer) { $synthesizer.Dispose() }
  if ($null -ne $stream) { $stream.Dispose() }
}
exit $exitCode
