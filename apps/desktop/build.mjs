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
await fs.copyFile(
  path.join(workspace, 'plugins/system-tts/src/system-speech.ps1'),
  path.join(workspace, 'plugins/system-tts/dist/system-speech.ps1'),
);
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
  outfile: path.join(root, 'dist/main/desktop.mjs'),
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
// A packaged Electron executable boots resources/app even when passed a role directory.
// Dispatch only the fixed native role; no module path is accepted from caller input.
await fs.writeFile(
  path.join(root, 'dist/main/index.mjs'),
  "if (process.argv.some((value) => value.startsWith('--local-host-profile='))) {\n  await import('../local-host-app/main.mjs');\n} else {\n  await import('./desktop.mjs');\n}\n",
);
// Main's bundled native rendezvous helper resolves this fixed sibling from import.meta.url.
for (const script of ['windows-private-directory.ps1', 'owned-process.ps1'])
  await fs.copyFile(
    path.join(workspace, 'packages/local-host/src', script),
    path.join(root, 'dist/main', script),
  );
// Only Desktop role code is bundled here. Reviewed factories, SDK and kernel retain
// their installed physical package roots and one module identity under the TS loader.
const localHostApp = path.join(root, 'dist/local-host-app');
await bundle({
  entryPoints: [path.join(root, 'src/main/local-host-entry.ts')],
  outfile: path.join(localHostApp, 'role.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  packages: 'external',
  plugins: [
    {
      name: 'external-local-host-package',
      setup(build) {
        build.onResolve({ filter: /packages\/local-host\/src\/.*\.js$/ }, () => ({
          path: '@pet/local-host',
          external: true,
        }));
      },
    },
  ],
  sourcemap: true,
});
const desktopPackage = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
await fs.writeFile(
  path.join(localHostApp, 'package.json'),
  JSON.stringify({
    name: 'pet-local-plugin-host',
    version: desktopPackage.version,
    type: 'module',
    main: 'main.mjs',
  }),
);
await fs.writeFile(
  path.join(localHostApp, 'main.mjs'),
  "import { register } from 'tsx/esm/api';\nprocess.env.TSX_DISABLE_CACHE = '1';\nregister({ tsconfig: false });\nawait import('./role.mjs');\n",
);
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
