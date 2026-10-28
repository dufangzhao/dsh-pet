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
  banner: {
    js: "import { createRequire as __petCreateRequire } from 'node:module'; const require = __petCreateRequire(import.meta.url);",
  },
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
await bundle({
  entryPoints: [path.join(root, 'src/runtime/worker.ts')],
  outfile: path.join(root, 'dist/runtime/worker.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  sourcemap: true,
});
const workspace = path.resolve(root, '../..');
for (const plugin of ['asr-local', 'chat', 'voice-chat', 'llm-provider', 'avatar-default']) {
  await bundle({
    entryPoints: [path.join(workspace, 'plugins', plugin, 'src/index.ts')],
    outfile: path.join(workspace, 'plugins', plugin, 'dist/index.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    external: ['sherpa-onnx-node'],
  });
}
await bundle({
  entryPoints: [path.join(workspace, 'plugins/asr-local/src/asr-worker.cjs')],
  outfile: path.join(workspace, 'plugins/asr-local/dist/asr-worker.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  external: ['sherpa-onnx-node'],
});
for (const renderer of ['pet', 'console']) {
  await buildRenderer({
    configFile: false,
    root: path.join(root, `src/renderer/${renderer}`),
    base: './',
    plugins: renderer === 'pet' ? [tailwindcss()] : [],
    build: { outDir: path.join(root, `dist/renderer/${renderer}`), emptyOutDir: true },
  });
}
