import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url));
await build({
  absWorkingDir: root,
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node26',
  packages: 'external',
});
await build({
  absWorkingDir: root,
  entryPoints: ['src/browser.ts'],
  outfile: 'dist/browser.js',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  external: ['@pet/contracts'],
});
// A missing real worklet is a build failure, never an emitted placeholder.
await build({
  absWorkingDir: root,
  entryPoints: ['src/capture-worklet.ts'],
  outfile: 'dist/voice-capture-worklet.js',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
});
