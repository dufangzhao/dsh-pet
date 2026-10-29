import { build as bundle } from 'esbuild';
import { build as buildRenderer } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(root, '../..');
const require = createRequire(import.meta.url);
await import('../../plugins/profile/build.mjs');
await import('../../plugins/llm-provider/build.mjs');
for (const entry of await fs.readdir(path.join(workspace, 'plugins'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const directory = path.join(workspace, 'plugins', entry.name);
  try {
    await fs.access(path.join(directory, 'plugin.json'));
    await fs.access(path.join(directory, 'src/index.ts'));
  } catch (error) {
    if (error.code === 'ENOENT') continue;
    throw error;
  }
  await bundle({
    entryPoints: [path.join(directory, 'src/index.ts')],
    outfile: path.join(directory, 'dist/index.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    external: ['sherpa-onnx-node', 'cortico/*', 'tsx/*'],
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
const admissionEntry = path.join(workspace, '.cache/build-admission/index.cjs');
await bundle({
  entryPoints: [path.join(root, 'scripts/builtin-admission.ts')],
  outfile: admissionEntry,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
});
await require(admissionEntry).generateAdmission(workspace);
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
for (const renderer of ['pet', 'console']) {
  await buildRenderer({
    configFile: false,
    root: path.join(root, 'src/renderer', renderer),
    base: './',
    plugins: renderer === 'pet' ? [tailwindcss()] : [],
    build: { outDir: path.join(root, 'dist/renderer', renderer), emptyOutDir: true },
  });
}
