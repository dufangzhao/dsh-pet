// Isolated package boundary: install the fence before any package or TS loader is imported.
import { registerHooks, createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const layout = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const inside = (name) => {
  const rel = path.relative(layout, name);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
};
const files = new Set();
registerHooks({
  resolve(specifier, context, next) {
    const result = next(specifier, context);
    if (result.url.startsWith('file:')) {
      const resolved = realpathSync(fileURLToPath(result.url));
      if (!inside(resolved))
        throw new Error('Package proof resolved JS outside its isolated layout');
      files.add(resolved);
    }
    return result;
  },
});
const local = createRequire(path.join(layout, 'packages/local-host/package.json'));
const runtime = createRequire(local.resolve('@pet/companion-runtime/plugin-host'));
const harness = createRequire(runtime.resolve('@pet/harness-cortico'));
const { register } = await import(pathToFileURL(harness.resolve('tsx/esm/api')).href);
register();
const contracts = await import(pathToFileURL(local.resolve('@pet/contracts')).href);
const kernelModule = await import(pathToFileURL(local.resolve('@pet/host-kernel')).href);
const sdk = await import(pathToFileURL(local.resolve('@pet/plugin-sdk')).href);
const { packageFingerprint } = await import(
  pathToFileURL(local.resolve('@pet/companion-runtime/plugin-host')).href
);
const sources = [];
for (const specifier of ['@pet/qq-official', '@pet/qq-onebot']) {
  const entry = local.resolve(specifier),
    from = createRequire(entry);
  const siblingKernel = await import(pathToFileURL(from.resolve('@pet/host-kernel')).href);
  const siblingSdk = await import(pathToFileURL(from.resolve('@pet/plugin-sdk')).href);
  const siblingContracts = await import(pathToFileURL(from.resolve('@pet/contracts')).href);
  if (
    kernelModule.KernelFault !== siblingKernel.KernelFault ||
    sdk.definePlugin !== siblingSdk.definePlugin ||
    contracts.companionAudienceKey !== siblingContracts.companionAudienceKey
  )
    throw new Error('Duplicate SDK/kernel/contracts module instances');
  const root = realpathSync(path.resolve(path.dirname(entry), '..'));
  sources.push({
    specifier,
    entry: realpathSync(entry),
    root,
    reviewedDigest: packageFingerprint(root),
  });
}
const report = {
  layout,
  process: {
    electron: process.versions.electron,
    node: process.versions.node,
    modulesABI: process.versions.modules,
    napi: process.versions.napi,
    platform: process.platform,
    arch: process.arch,
  },
  sources,
  singleton: true,
};
writeFileSync(path.join(layout, 'resolution.json'), JSON.stringify(report, null, 2));
process.on('exit', () =>
  writeFileSync(
    path.join(layout, 'resolution-files.json'),
    JSON.stringify([...files].sort(), null, 2),
  ),
);
await import(new URL('../qa/fixtures/local-host/host.mjs', import.meta.url).href);
