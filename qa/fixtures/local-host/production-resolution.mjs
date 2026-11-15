import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { realpathSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [application, reportFile] = process.argv.slice(2);
assert.ok(application && reportFile && process.argv.length === 4);
const root = realpathSync(application);
const local = createRequire(path.join(root, 'package.json'));
const files = new Set();
registerHooks({
  resolve(specifier, context, next) {
    const result = next(specifier, context);
    if (result.url.startsWith('file:')) {
      const file = realpathSync(fileURLToPath(result.url));
      const relative = path.relative(root, file);
      assert.ok(relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), `Production module escaped package: ${file}`);
      files.add(file);
    }
    return result;
  },
});
process.env.TSX_DISABLE_CACHE = '1';
const { register } = await import(pathToFileURL(local.resolve('tsx/esm/api')).href);
register({ tsconfig: false });
const kernel = await import(pathToFileURL(local.resolve('@pet/host-kernel')).href);
const sdk = await import(pathToFileURL(local.resolve('@pet/plugin-sdk')).href);
const contracts = await import(pathToFileURL(local.resolve('@pet/contracts')).href);
const host = await import(pathToFileURL(local.resolve('@pet/local-host')).href);
assert.equal(typeof host.createLocalPluginKernel, 'function');
const runtime = await import(pathToFileURL(local.resolve('@pet/companion-runtime/plugin-host')).href);
const sources = [];
for (const name of ['@pet/qq-official', '@pet/qq-onebot', '@pet/local-agent-link']) {
  const entry = realpathSync(local.resolve(name));
  const source = createRequire(entry);
  assert.equal((await import(pathToFileURL(source.resolve('@pet/host-kernel')).href)).KernelFault, kernel.KernelFault);
  assert.equal((await import(pathToFileURL(source.resolve('@pet/plugin-sdk')).href)).definePlugin, sdk.definePlugin);
  assert.equal((await import(pathToFileURL(source.resolve('@pet/contracts')).href)).companionAudienceKey, contracts.companionAudienceKey);
  const directory = realpathSync(path.resolve(path.dirname(entry), '..'));
  sources.push({ name, entry, directory, digest: runtime.packageFingerprint(directory) });
}
for (const script of ['windows-private-directory.ps1', 'owned-process.ps1'])
  assert.ok(existsSync(path.join(path.dirname(local.resolve('@pet/local-host')), script)));
writeFileSync(reportFile, JSON.stringify({ runtime: { platform: process.platform, arch: process.arch, electron: process.versions.electron, node: process.versions.node, modulesABI: process.versions.modules }, singleton: true, sources, files: [...files].sort() }, null, 2) + '\n');
console.log(JSON.stringify({ singleton: true, files: files.size, sources }));
