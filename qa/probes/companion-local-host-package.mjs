// G0 package feasibility, offline owned layout only. No Windows or final distributable claim.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  mkdtemp,
  mkdir,
  cp,
  readFile,
  writeFile,
  realpath,
  lstat,
  readdir,
  symlink,
  unlink,
  rm,
} from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { register } from 'tsx/esm/api';
import { expect } from '@playwright/test';
import { startDisplay } from '../fixtures/companion-desktop/display.mjs';
import {
  sourceFiles,
  cloneWorkspace,
  sourceModulesState,
} from '../fixtures/local-host/package-layout.mjs';
register();
const { openPrivateDirectory, readRendezvous } =
  await import('../../packages/local-host/src/rendezvous.ts');
const { attachLocalManagement } = await import('../../packages/local-host/src/management.ts');
const { localHostEnvironment } = await import('../../apps/desktop/src/local-host/client.ts');
const packageEnvironment = localHostEnvironment();
const WebSocket = createRequire(new URL('../../packages/local-host/package.json', import.meta.url))(
  'ws',
);
assert.deepEqual(process.argv.slice(2), ['--run-g0']);
const repository = fileURLToPath(new URL('../..', import.meta.url)),
  id = randomUUID();
const evidence = path.join(repository, 'qa/fixtures/local-host/evidence', `package-${id}`);
const report = {
  id,
  scope: 'G0-offline-external-layout-runtime-factory-identity-singletons',
  status: 'running',
  stages: [],
  cleanup: {},
  limits: [
    'Linux-amd64 actual package mechanism only; Windows candidate ABI/ACL and final GUI distribution remain separate.',
    'No real QQ/model/Agent; existing cached runtime/dependencies only, scripts disabled, no public release.',
  ],
};
let owned,
  display,
  child,
  childExit,
  client,
  peer,
  sourceNames,
  moduleStateBefore,
  failed = false,
  stopped = false,
  stage = 'preflight';
const sha = async (name) =>
  createHash('sha256')
    .update(await readFile(name))
    .digest('hex');
async function run(command, args, cwd, env) {
  const process = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let text = '';
  for (const stream of [process.stdout, process.stderr])
    stream.on('data', (bytes) => {
      text = (text + bytes).slice(-12000);
    });
  const [code] = await once(process, 'exit');
  return { code, output: text };
}
async function insideTree(folder, layout) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const item = path.join(folder, entry.name);
    if (entry.isSymbolicLink()) {
      const actual = await realpath(item);
      const rel = path.relative(layout, actual);
      assert.ok(
        rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel),
        `External package symlink: ${item} -> ${actual}`,
      );
    } else if (entry.isDirectory()) await insideTree(item, layout);
  }
}
try {
  assert.equal(process.platform, 'linux');
  assert.equal(process.arch, 'x64');
  const originalLock = await sha(path.join(repository, 'pnpm-lock.yaml'));
  report.rootLockBefore = originalLock;
  sourceNames = await sourceFiles(repository);
  moduleStateBefore = await sourceModulesState(repository, sourceNames);
  report.sourceModulesBeforeHash = createHash('sha256')
    .update(JSON.stringify(moduleStateBefore))
    .digest('hex');
  const temporary = await mkdtemp(path.join(tmpdir(), 'local-host-package-'));
  const info = await lstat(temporary);
  owned = { path: await realpath(temporary), dev: info.dev, ino: info.ino, uid: info.uid };
  report.ownedRoot = owned;
  const layout = path.join(owned.path, 'layout'),
    local = path.join(layout, 'packages/local-host'),
    workspace = path.join(owned.path, 'workspace');
  await mkdir(path.dirname(local), { recursive: true });
  stage = 'clone-complete-workspace';
  report.copiedSourceFiles = await cloneWorkspace(repository, workspace, sourceNames);
  stage = 'temporary-offline-install';
  const install = await run(
    'pnpm',
    ['install', '--offline', '--frozen-lockfile', '--ignore-scripts', '--prod=false'],
    workspace,
    packageEnvironment,
  );
  report.temporaryInstall = install;
  assert.equal(install.code, 0, 'Temporary complete workspace install must actually succeed');
  stage = 'offline-deploy';
  const deploy = await run(
    'pnpm',
    [
      '--filter',
      '@pet/local-host',
      'deploy',
      '--prod',
      '--offline',
      '--frozen-lockfile',
      '--ignore-scripts',
      '--frozen-store',
      '--legacy',
      local,
    ],
    workspace,
    packageEnvironment,
  );
  report.deploy = deploy;
  assert.equal(deploy.code, 0, 'Offline deploy must actually succeed');
  assert.equal(
    await sha(path.join(repository, 'pnpm-lock.yaml')),
    originalLock,
    'Root lock modified',
  );
  report.stages.push('actual-pnpm-offline-frozen-prod-deploy');
  // Legacy deploy leaves its own workspace self-alias outside the deploy root. Bind that one alias to the copied package.
  const selfAlias = path.join(local, 'node_modules/.pnpm/node_modules/@pet/local-host');
  const aliasInfo = await lstat(selfAlias);
  assert.ok(aliasInfo.isSymbolicLink());
  assert.equal(
    await realpath(selfAlias),
    await realpath(path.join(workspace, 'packages/local-host')),
  );
  assert.ok(selfAlias.startsWith(local + path.sep));
  await unlink(selfAlias);
  await symlink(path.relative(path.dirname(selfAlias), local), selfAlias, 'dir');
  report.legacySelfAlias = 'rebound-to-deployed-package-only';
  stage = 'layout-assembly';
  const app = path.join(layout, 'application'),
    desktop = path.join(layout, 'apps/desktop/src/local-host');
  await mkdir(app, { recursive: true });
  await mkdir(path.dirname(desktop), { recursive: true });
  await cp(path.join(workspace, 'apps/desktop/src/local-host'), desktop, { recursive: true });
  await cp(
    path.join(workspace, 'apps/desktop/package.json'),
    path.join(layout, 'apps/desktop/package.json'),
  );
  await mkdir(path.join(layout, 'apps/companion-service'), { recursive: true });
  await cp(
    path.join(workspace, 'apps/companion-service/src'),
    path.join(layout, 'apps/companion-service/src'),
    { recursive: true },
  );
  await cp(
    path.join(workspace, 'apps/companion-service/package.json'),
    path.join(layout, 'apps/companion-service/package.json'),
  );
  const fixture = path.join(layout, 'qa/fixtures/local-host');
  await mkdir(fixture, { recursive: true });
  await cp(path.join(workspace, 'qa/fixtures/local-host/host.mjs'), path.join(fixture, 'host.mjs'));
  await cp(
    path.join(workspace, 'qa/fixtures/local-host/package-entry.mjs'),
    path.join(app, 'main.mjs'),
  );
  await writeFile(
    path.join(app, 'package.json'),
    JSON.stringify({ name: 'g0-packaged-local-host', version: '0.1.0', main: 'main.mjs' }),
  );
  await symlink(
    path.relative(layout, path.join(local, 'node_modules')),
    path.join(layout, 'node_modules'),
    'dir',
  );
  // The entry's source loader is a declared production dependency of the existing Harness package.
  const resolve = createRequire(path.join(local, 'package.json'));
  const runtime = createRequire(resolve.resolve('@pet/companion-runtime/plugin-host'));
  const harness = createRequire(runtime.resolve('@pet/harness-cortico'));
  const tsxRoot = path.dirname(harness.resolve('tsx/package.json'));
  await symlink(
    path.relative(path.join(local, 'node_modules'), tsxRoot),
    path.join(local, 'node_modules/tsx'),
    'dir',
  );
  // Existing service-native relative imports must name these same deployed package roots, not duplicate source copies.
  await mkdir(path.join(layout, 'plugins'), { recursive: true });
  for (const name of ['qq-official', 'qq-onebot']) {
    const installed = await realpath(
      path.resolve(path.dirname(resolve.resolve(`@pet/${name}`)), '..'),
    );
    assert.ok(installed.startsWith(layout + path.sep));
    await symlink(
      path.relative(path.join(layout, 'plugins'), installed),
      path.join(layout, 'plugins', name),
      'dir',
    );
  }
  for (const name of ['contracts', 'host-kernel', 'plugin-sdk', 'companion-runtime']) {
    const installed = await realpath(
      path.resolve(path.dirname(resolve.resolve(`@pet/${name}`)), '..'),
    );
    assert.ok(installed.startsWith(layout + path.sep));
    await symlink(
      path.relative(path.join(layout, 'packages'), installed),
      path.join(layout, 'packages', name),
      'dir',
    );
  }
  const runtimeDirectory = path.join(layout, 'runtime');
  await cp(path.join(repository, '.companion-data/tooling/desktop/electron-45'), runtimeDirectory, {
    recursive: true,
    dereference: true,
  });
  const libraries = path.join(layout, 'native-libraries');
  await cp(
    path.join(repository, '.companion-data/tooling/desktop/libraries/usr/lib/x86_64-linux-gnu'),
    libraries,
    { recursive: true, dereference: true },
  );
  const browserLibraries = path.join(layout, 'native-browser-libraries');
  await cp(
    path.join(repository, '.companion-data/tooling/browser/libraries/usr/lib/x86_64-linux-gnu'),
    browserLibraries,
    { recursive: true, dereference: true },
  );
  const libraryPath = [libraries, browserLibraries].join(':');
  const elf = await readFile(path.join(runtimeDirectory, 'electron'));
  assert.equal(elf.subarray(0, 4).toString('hex'), '7f454c46');
  assert.equal(elf[4], 2);
  assert.equal(elf.readUInt16LE(18), 62);
  const dependencies = await run(
    '/usr/bin/ldd',
    [path.join(runtimeDirectory, 'electron')],
    layout,
    { PATH: '/usr/bin:/bin', LD_LIBRARY_PATH: libraryPath },
  );
  report.runtimeDependencies = dependencies;
  assert.equal(dependencies.code, 0);
  assert.ok(
    !dependencies.output.includes('not found'),
    'Unresolved actual native runtime dependency',
  );
  report.runtimeArchitecture = {
    format: 'ELF64',
    machine: 'x86-64',
    target: 'linux-x64',
    windowsArtifact: false,
  };
  await insideTree(layout, layout);
  report.stages.push('independent-runtime-app-package-tree-with-only-internal-symlinks');
  stage = 'isolated-native-host';
  display = await startDisplay(repository);
  const environment = {
    PATH: '/usr/bin:/bin',
    HOME: path.join(owned.path, 'home'),
    DISPLAY: display.env.DISPLAY,
    LANG: 'C.UTF-8',
    LD_LIBRARY_PATH: libraryPath,
  };
  await mkdir(environment.HOME, { mode: 0o700 });
  const profile = path.join(owned.path, 'profile');
  await mkdir(profile, { mode: 0o700 });
  child = spawn(
    path.join(runtimeDirectory, 'electron'),
    ['--no-sandbox', app, `--local-host-profile=${profile}`],
    { cwd: layout, env: environment, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let log = '';
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (bytes) => {
      log = (log + bytes).slice(-8000);
    });
  childExit = once(child, 'exit');
  const directory = await openPrivateDirectory(path.join(profile, 'management'));
  let captured;
  await expect
    .poll(
      async () => {
        captured = await readRendezvous(directory);
        return !!captured;
      },
      { timeout: 45000 },
    )
    .toBe(true)
    .catch((error) => {
      report.nativeLog = log;
      throw error;
    });
  client = await attachLocalManagement(captured);
  const status = await client.status();
  assert.equal(status.ok, true);
  assert.equal(status.value.kernel.localCore, false);
  assert.equal(status.value.kernel.localState, false);
  assert.deepEqual(status.value.kernel.plugins.map((p) => p.id).sort(), [
    'pet.qq-official',
    'pet.qq-onebot',
  ]);
  assert.ok(status.value.kernel.plugins.every((p) => p.state === 'active'));
  const resolution = JSON.parse(await readFile(path.join(layout, 'resolution.json'), 'utf8'));
  assert.equal(resolution.singleton, true);
  assert.equal(resolution.process.electron.split('.')[0], '45');
  for (const source of resolution.sources)
    assert.ok(!source.root.startsWith(repository) && source.root.startsWith(layout));
  const native = JSON.parse(await readFile(path.join(profile, 'g0-native.json'), 'utf8'));
  peer = new WebSocket(`ws://127.0.0.1:${native.port}/g0`, {
    headers: {
      Authorization: 'Bearer g0-controlled-local-onebot-key',
      'X-Self-ID': '12345',
      'X-Client-Role': 'Universal',
    },
  });
  peer.on('error', () => {});
  await once(peer, 'open');
  peer.send(
    JSON.stringify({
      post_type: 'message',
      time: 1,
      self_id: 12345,
      user_id: 67890,
      message_type: 'private',
      sub_type: 'friend',
      message_id: 1,
      sender: { user_id: 67890 },
      message: [{ type: 'text', data: { text: 'isolated package event' } }],
    }),
  );
  await expect
    .poll(async () => {
      try {
        return (await readFile(path.join(profile, 'g0-observed.ndjson'), 'utf8')).trim().split('\n')
          .length;
      } catch (error) {
        if (error.code === 'ENOENT') return 0;
        throw error;
      }
    })
    .toBe(1);
  const peerClosed = once(peer, 'close');
  const stop = await client.stop();
  assert.equal(stop.ok, true);
  assert.equal(stop.value.kernel.tasks.pendingWork, 0);
  await peerClosed;
  const [code] = await childExit;
  assert.equal(code, 0);
  stopped = true;
  const files = JSON.parse(await readFile(path.join(layout, 'resolution-files.json'), 'utf8'));
  assert.ok(files.length > 10);
  await mkdir(evidence, { recursive: true });
  await writeFile(
    path.join(evidence, 'resolved-files.json'),
    JSON.stringify(files, null, 2) + '\n',
    { mode: 0o600 },
  );
  report.nativeProcess = { pid: child.pid, port: native.port, exitCode: code };
  for (const file of files)
    assert.ok(file.startsWith(layout + path.sep), 'Repository/outside JS resolution');
  report.resolution = {
    ...resolution,
    loadedFiles: files.length,
    allLoadedFilesInsideLayout: true,
  };
  report.runtimeHashes = { electron: await sha(path.join(runtimeDirectory, 'electron')) };
  report.stages.push(
    'actual-external-Electron-real-reviewed-factory-native-socket-and-authenticated-stop',
  );
  assert.equal(await sha(path.join(repository, 'pnpm-lock.yaml')), originalLock);
  report.rootLockAfter = originalLock;
  report.status = 'G0-linux-package-feasibility-passed';
} catch (error) {
  failed = true;
  report.status = 'failed';
  report.failure = `${stage}: ${error instanceof Error ? error.message.slice(0, 1400) : 'unknown'}`;
} finally {
  if (moduleStateBefore && sourceNames) {
    try {
      const after = await sourceModulesState(repository, sourceNames);
      report.sourceModulesAfterHash = createHash('sha256')
        .update(JSON.stringify(after))
        .digest('hex');
      assert.deepEqual(after, moduleStateBefore, 'Source workspace modules metadata/links changed');
      report.sourceModulesUnchanged = true;
    } catch (error) {
      failed = true;
      report.sourceModulesUnchanged = false;
      report.sourceFenceFailure = error.message;
    }
  }
  if (client) {
    if (!stopped) {
      try {
        await client.stop();
        if (childExit) await childExit;
        stopped = true;
      } catch {
        failed = true;
      }
    }
    await client.close();
  }
  if (peer && peer.readyState !== WebSocket.CLOSED) {
    const closed = once(peer, 'close');
    peer.terminate();
    await closed;
  }
  if (child && !stopped) {
    if (child.exitCode !== null || child.signalCode !== null) stopped = true;
    else if (!client) {
      child.kill('SIGTERM');
      let timer;
      try {
        const exited = await Promise.race([
          childExit.then(() => true),
          new Promise((resolve) => {
            timer = setTimeout(() => resolve(false), 3000);
          }),
        ]);
        if (!exited) {
          child.kill('SIGKILL');
          await childExit;
        }
        stopped = true;
        report.cleanup.runtime = 'owned-failed-bootstrap-process-joined';
      } finally {
        clearTimeout(timer);
      }
    } else report.cleanup.runtime = 'unconfirmed';
  }
  if (display) {
    try {
      await display.stop();
      report.cleanup.display = 'joined';
    } catch {
      failed = true;
    }
  }
  if (owned && (!child || stopped)) {
    const info = await lstat(owned.path);
    assert.equal(await realpath(owned.path), owned.path);
    assert.equal(info.dev, owned.dev);
    assert.equal(info.ino, owned.ino);
    assert.equal(info.uid, owned.uid);
    assert.equal(path.dirname(owned.path), await realpath(tmpdir()));
    assert.ok(path.basename(owned.path).startsWith('local-host-package-'));
    await rm(owned.path, { recursive: true });
    report.cleanup.ownedRoot = 'verified-removed';
  } else if (owned) {
    failed = true;
    report.cleanup.ownedRoot = 'retained';
  }
  if (failed && report.status === 'G0-linux-package-feasibility-passed')
    report.status = 'cleanup-or-source-fence-failed';
  await mkdir(evidence, { recursive: true });
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n', {
    mode: 0o600,
  });
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = failed ? 1 : 0;
}
