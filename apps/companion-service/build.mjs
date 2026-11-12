import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

for (const name of [
  'state-sqlite',
  'cloud-exec',
  'harness-cortico',
  'model-connection-magpie',
  'asr-magpie',
  'shared-voice',
  'tts-magpie',
  'shared-speech',
  'text-client',
]) {
  execFileSync(process.execPath, ['build.mjs'], {
    cwd: fileURLToPath(new URL(`../../plugins/${name}/`, import.meta.url)),
    stdio: 'inherit',
  });
}
await build({
  entryPoints: ['main', 'migrate'].map((name) =>
    fileURLToPath(new URL(`./src/${name}.ts`, import.meta.url)),
  ),
  outdir: fileURLToPath(new URL('./dist/', import.meta.url)),
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node26',
  format: 'esm',
  sourcemap: true,
  packages: 'external',
});
