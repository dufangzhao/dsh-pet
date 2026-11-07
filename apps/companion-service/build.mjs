import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

for (const name of ['state-sqlite', 'cloud-exec', 'harness-cortico', 'text-client']) {
  execFileSync(process.execPath, ['build.mjs'], {
    cwd: fileURLToPath(new URL(`../../plugins/${name}/`, import.meta.url)),
    stdio: 'inherit',
  });
}
await build({
  entryPoints: [fileURLToPath(new URL('./src/main.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('./dist/main.mjs', import.meta.url)),
  bundle: true,
  platform: 'node',
  target: 'node26',
  format: 'esm',
  sourcemap: true,
  packages: 'external',
});
