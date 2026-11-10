import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { copyFile } from 'node:fs/promises';

const root = fileURLToPath(new URL('.', import.meta.url));

// runtime：普通插件入口，注册 panel 贡献。
await build({
  absWorkingDir: root,
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
});

// Reusable entries keep the host's React instance and existing kit dependency.
await build({
  absWorkingDir: root,
  entryPoints: [
    'src/protocol.ts',
    'src/model-ui.ts',
    'src/persona-memory-ui.ts',
    'src/voice-input-ui.ts',
  ],
  outdir: 'dist',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  jsx: 'automatic',
  external: ['react', 'react/*', 'react-dom', 'react-dom/*', '@pet/contracts', '@pet/ui-kit'],
});
await copyFile(
  new URL('src/client/model.css', import.meta.url),
  new URL('dist/model.css', import.meta.url),
);

await copyFile(
  new URL('src/client/persona-memory.css', import.meta.url),
  new URL('dist/persona-memory.css', import.meta.url),
);

await copyFile(
  new URL('src/client/voice-input.css', import.meta.url),
  new URL('dist/voice-input.css', import.meta.url),
);

// Worklet stays a fixed same-origin asset under the existing CSP.
await build({
  absWorkingDir: root,
  entryPoints: ['../audio-capture/src/capture-worklet.ts'],
  outfile: 'dist/voice-capture-worklet.js',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
});

// 浏览器端：client.js 自带 React，页面只引这一个脚本和一份 CSS。
await build({
  absWorkingDir: root,
  entryPoints: ['src/client/main.tsx'],
  outfile: 'dist/client.js',
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  jsx: 'automatic',
  minify: true,
  loader: { '.css': 'css' },
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'none',
});

// ui-kit 的样式由 client.js 里的 import 一并产出为 client.css。
await copyFile('src/client/index.html', 'dist/index.html');
