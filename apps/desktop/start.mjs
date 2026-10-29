import electron from 'electron';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const env = {};
for (const key of [
  'SystemRoot',
  'WINDIR',
  'TEMP',
  'TMP',
  'PATH',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'HOMEDRIVE',
  'HOMEPATH',
]) {
  if (process.env[key]) env[key] = process.env[key];
}
const child = spawn(
  electron,
  [fileURLToPath(new URL('.', import.meta.url)), ...process.argv.slice(2)],
  {
    env,
    stdio: 'inherit',
  },
);
child.once('error', () => {
  console.error('Could not start desktop prototype');
  process.exitCode = 1;
});
child.once('exit', (code) => {
  process.exitCode = code ?? 1;
});
process.once('SIGINT', () => child.kill());
process.once('SIGTERM', () => child.kill());
