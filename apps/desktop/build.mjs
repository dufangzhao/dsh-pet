import { build as bundle } from 'esbuild';
import { build as buildRenderer } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.dirname(fileURLToPath(import.meta.url));
await bundle({
  entryPoints: [path.join(root, 'src/main/index.ts')],
  outfile: path.join(root, 'dist/main/index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external: ['electron'],
  sourcemap: true,
});
await bundle({
  entryPoints: [path.join(root, 'src/preload/index.ts')],
  outfile: path.join(root, 'dist/preload/index.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  external: ['electron'],
  sourcemap: true,
});
await buildRenderer({
  configFile: false,
  root: path.join(root, 'src/renderer/pet'),
  base: './',
  plugins: [tailwindcss()],
  build: { outDir: path.join(root, 'dist/renderer/pet'), emptyOutDir: true },
});
