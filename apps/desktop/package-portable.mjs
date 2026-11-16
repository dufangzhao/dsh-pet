import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cloneWorkspace,
  sourceFiles,
  sourceModulesState,
} from '../../qa/fixtures/local-host/package-layout.mjs';

const repository = fileURLToPath(new URL('../..', import.meta.url));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hashFile = async (name) => sha(await readFile(name));
const within = (root, name) => {
  const relative = path.relative(root, name);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
};
async function run(command, args, cwd, env) {
  // Windows cannot spawn a pnpm.cmd shim without a shell. Use the caller's
  // pnpm CLI entry directly so paths and arguments retain their exact values.
  if (process.platform === 'win32' && command === 'pnpm') {
    const entry = process.env.npm_execpath;
    assert.ok(
      entry && path.isAbsolute(entry) && /^pnpm\.c?js$/.test(path.basename(entry)),
      'On Windows, run from a pnpm script or set npm_execpath to the pnpm.cjs entry',
    );
    command = process.execPath;
    args = [entry, ...args];
  }
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (bytes) => {
      output = (output + bytes).slice(-20000);
    });
  const [code] = await once(child, 'exit');
  assert.equal(code, 0, `${command} ${args.join(' ')} failed:\n${output}`);
  return { code, output };
}
function environment() {
  const result = {};
  for (const key of [
    'SystemRoot',
    'WINDIR',
    'TEMP',
    'TMP',
    'TMPDIR',
    'PATH',
    'HOME',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'LANG',
    'TZ',
  ])
    if (process.env[key] !== undefined) result[key] = process.env[key];
  return result;
}
export async function validateRuntime(directory, target) {
  const version = (await readFile(path.join(directory, 'version'), 'utf8')).trim();
  assert.equal(version, '45.0.0', 'The preview uses the locked Electron 45 runtime');
  const executable = path.join(directory, target === 'win32-x64' ? 'electron.exe' : 'electron');
  const bytes = await readFile(executable);
  if (target === 'win32-x64') {
    assert.equal(
      bytes.subarray(0, 2).toString(),
      'MZ',
      'Windows runtime must be a real PE executable',
    );
    const header = bytes.readUInt32LE(0x3c);
    assert.equal(bytes.subarray(header, header + 4).toString(), 'PE\0\0');
    assert.equal(bytes.readUInt16LE(header + 4), 0x8664, 'Windows runtime must target AMD64');
  } else {
    assert.equal(bytes.subarray(0, 4).toString('hex'), '7f454c46');
    assert.equal(bytes.readUInt16LE(18), 62);
  }
  return { version, executable: path.basename(executable), sha256: sha(bytes) };
}
async function copyProductionModules(production, built, destination, targetPlatform) {
  const workspaces = new Map();
  for (const parent of ['apps', 'packages', 'plugins']) {
    for (const entry of await readdir(path.join(production, parent), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const relative = path.join(parent, entry.name);
      try {
        const manifest = JSON.parse(
          await readFile(path.join(production, relative, 'package.json'), 'utf8'),
        );
        workspaces.set(manifest.name, { relative, manifest });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
  const workspaceRoots = new Set(
    [...workspaces.values()].map(({ relative }) => path.join(production, relative)),
  );
  const omittedPrebuilds = [];
  const copy = async (source, target) => {
    await mkdir(target, { recursive: true });
    for (const entry of await readdir(source, { withFileTypes: true })) {
      if (['.pnpm', '.modules.yaml', '.pnpm-workspace-state-v1.json', '.bin'].includes(entry.name))
        continue;
      const file = path.join(source, entry.name),
        output = path.join(target, entry.name);
      if (
        path.basename(source) === 'prebuilds' &&
        /^(?:android|darwin|ios|linux|win32)-/.test(entry.name) &&
        entry.name !== targetPlatform
      ) {
        omittedPrebuilds.push(path.relative(production, file));
        continue;
      }
      if (entry.isSymbolicLink()) {
        const actual = await realpath(file);
        // Workspace modules all resolve to one canonical physical directory below.
        if (workspaceRoots.has(actual)) continue;
        assert.ok(within(production, actual));
        assert.ok(
          (await lstat(actual)).isFile(),
          `Unexpected directory link in hoisted install: ${file}`,
        );
        await cp(actual, output);
      } else if (entry.isDirectory()) await copy(file, output);
      else if (entry.isFile()) await cp(file, output);
    }
  };
  await copy(path.join(production, 'node_modules'), destination);
  const required = new Set();
  const include = (name) => {
    if (required.has(name)) return;
    const value = workspaces.get(name);
    if (!value) return;
    required.add(name);
    for (const dependency of Object.keys({
      ...value.manifest.dependencies,
      ...value.manifest.optionalDependencies,
    }))
      include(dependency);
  };
  include('@pet/desktop');
  required.delete('@pet/desktop');
  for (const name of required) {
    const { relative } = workspaces.get(name);
    const target = path.join(destination, name);
    await cp(path.join(built, relative), target, {
      recursive: true,
      filter: (file) => !file.split(path.sep).includes('node_modules'),
    });
    const nested = path.join(production, relative, 'node_modules');
    try {
      await copy(nested, path.join(target, 'node_modules'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return { packages: [...required].sort(), omittedPrebuilds: omittedPrebuilds.sort() };
}
async function checkLockedDependencies(modules, workspace, lock) {
  const workspaceVersions = new Set();
  for (const parent of ['apps', 'packages', 'plugins']) {
    for (const entry of await readdir(path.join(workspace, parent), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        const manifest = JSON.parse(
          await readFile(path.join(workspace, parent, entry.name, 'package.json'), 'utf8'),
        );
        workspaceVersions.add(`${manifest.name}@${manifest.version}`);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
  const installed = [];
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const folder = path.join(directory, entry.name);
      if (entry.name.startsWith('@')) {
        await visit(folder);
        continue;
      }
      const manifest = JSON.parse(await readFile(path.join(folder, 'package.json'), 'utf8'));
      const id = `${manifest.name}@${manifest.version}`;
      const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      assert.ok(
        workspaceVersions.has(id) ||
          new RegExp(`^  ['"]?${escaped}(?:\\([^\\n]*\\))?['"]?:\\s*$`, 'm').test(lock),
        `Deployed dependency is absent from source lock: ${id}`,
      );
      installed.push(id);
      try {
        await visit(path.join(folder, 'node_modules'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  };
  await visit(modules);
  return [...new Set(installed)].sort();
}
async function checkLayout(directory, target) {
  const files = [];
  const walk = async (folder) => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const name = path.join(folder, entry.name);
      assert.ok(!entry.isSymbolicLink(), `Portable output contains a nonportable symlink: ${name}`);
      if (entry.isDirectory()) await walk(name);
      else if (entry.isFile()) {
        const relative = path.relative(directory, name).split(path.sep).join('/');
        assert.ok(
          !/(^|\/)(?:\.env[^/]*|\.npmrc|userdata|management|\.git)(\/|$)/.test(relative),
          `Private state in package: ${relative}`,
        );
        const bytes = await readFile(name);
        if (target === 'win32-x64') {
          assert.notEqual(
            bytes.subarray(0, 4).toString('hex'),
            '7f454c46',
            `Linux ELF in Windows package: ${relative}`,
          );
          assert.ok(
            !/\.(?:so(?:\.[0-9.]+)?|dylib)$/.test(name),
            `Foreign native library: ${relative}`,
          );
          if (/\.(?:exe|dll|node|bare)$/.test(name)) {
            assert.equal(bytes.subarray(0, 2).toString(), 'MZ', `Non-Windows binary: ${relative}`);
            const header = bytes.readUInt32LE(0x3c);
            assert.equal(bytes.readUInt16LE(header + 4), 0x8664, `Non-x64 binary: ${relative}`);
          }
        }
        files.push({ path: relative, sha256: sha(bytes) });
      }
    }
  };
  await walk(directory);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export async function packagePortable({
  output,
  runtimeDirectory,
  target,
  version,
  linuxLibraries,
  provisionCache,
}) {
  assert.ok(['win32-x64', 'linux-x64'].includes(target));
  assert.ok(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version), 'Use an explicit preview version');
  assert.ok(path.isAbsolute(output) && path.isAbsolute(runtimeDirectory));
  assert.equal(await realpath(runtimeDirectory), runtimeDirectory);
  await assert.rejects(lstat(output), { code: 'ENOENT' });
  const runtime = await validateRuntime(runtimeDirectory, target);
  const names = [];
  for (const name of await sourceFiles(repository)) {
    try {
      await lstat(path.join(repository, name));
      names.push(name);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const sourceBefore = await sourceModulesState(repository, names);
  const report = {
    version,
    target,
    runtime,
    status: 'assembling',
    steps: [],
    sourceModulesBefore: sha(JSON.stringify(sourceBefore)),
  };
  const temporary = await mkdtemp(path.join(tmpdir(), 'pet-portable-build-'));
  const owner = await lstat(temporary);
  const workspace = path.join(temporary, 'workspace');
  const env = environment();
  let sourceCopy;
  try {
    report.copiedFiles = await cloneWorkspace(repository, workspace, names);
    const copiedNames = (await sourceFiles(repository)).filter((name) => names.includes(name));
    sourceCopy = [];
    for (const name of copiedNames) {
      const copied = path.join(workspace, name);
      try {
        if ((await lstat(copied)).isFile())
          sourceCopy.push({ path: name, sha256: await hashFile(copied) });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    for (const file of sourceCopy)
      assert.equal(
        await hashFile(path.join(repository, file.path)),
        file.sha256,
        `Source changed during snapshot: ${file.path}`,
      );
    report.sourceContent = sha(JSON.stringify(sourceCopy));
    console.log(
      JSON.stringify({
        stage: 'snapshot-complete',
        copiedFiles: sourceCopy.length,
        sourceContent: report.sourceContent,
      }),
    );
    const architecture = [
      `--os=${[...new Set([process.platform, target.split('-')[0]])].join(',')}`,
      '--cpu=x64',
    ];
    if (provisionCache !== undefined) {
      assert.equal(provisionCache, 'true');
      report.steps.push(
        await run(
          'pnpm',
          ['install', '--frozen-lockfile', '--ignore-scripts', '--prod=false', ...architecture],
          workspace,
          env,
        ),
      );
    }
    report.steps.push(
      await run(
        'pnpm',
        [
          'install',
          '--offline',
          '--frozen-lockfile',
          '--ignore-scripts',
          '--prod=false',
          ...architecture,
        ],
        workspace,
        env,
      ),
    );
    report.steps.push(await run('pnpm', ['--filter', '@pet/desktop', 'build'], workspace, env));
    await mkdir(path.dirname(output), { recursive: true });
    await cp(runtimeDirectory, output, { recursive: true, errorOnExist: true, force: false });
    // Electron treats its stock executable name as a development application.
    const executable = target === 'win32-x64' ? 'Pet.exe' : 'pet-desktop';
    await rename(path.join(output, runtime.executable), path.join(output, executable));
    if (target === 'win32-x64')
      await rename(path.join(output, 'electron_wer.dll'), path.join(output, 'Pet_wer.dll'));
    report.runtime = { ...runtime, executable };
    if (linuxLibraries) {
      assert.equal(target, 'linux-x64');
      const libraries = linuxLibraries.split(',');
      assert.ok(libraries.length >= 1 && libraries.length <= 2);
      for (const [index, directory] of libraries.entries()) {
        assert.ok(path.isAbsolute(directory));
        assert.equal(await realpath(directory), directory);
        await cp(directory, path.join(output, index === 0 ? 'lib' : 'lib/browser'), {
          recursive: true,
          dereference: true,
        });
      }
      const linked = await run('/usr/bin/ldd', [path.join(output, executable)], output, {
        ...env,
        LD_LIBRARY_PATH: [path.join(output, 'lib'), path.join(output, 'lib/browser')].join(
          path.delimiter,
        ),
      });
      assert.ok(!linked.output.includes('not found'), linked.output);
      report.runtimeDependencies = linked;
    }
    const app = path.join(output, 'resources/app');
    // Legacy deploy re-resolves transitive ranges despite --frozen-lockfile. Install
    // the original lock directly in a second fresh workspace for the actual target.
    const production = path.join(temporary, 'production');
    await cloneWorkspace(workspace, production, names);
    const settingsFile = path.join(production, 'pnpm-workspace.yaml');
    const settings = await readFile(settingsFile, 'utf8');
    assert.ok(!/^nodeLinker:/m.test(settings));
    await writeFile(settingsFile, settings + '\nnodeLinker: hoisted\n');
    const install = [
      'install',
      '--prod=true',
      '--frozen-lockfile',
      '--ignore-scripts',
      `--os=${target.split('-')[0]}`,
      '--cpu=x64',
    ];
    if (provisionCache) report.steps.push(await run('pnpm', install, production, env));
    report.steps.push(
      await run('pnpm', [...install, '--offline', '--frozen-store'], production, env),
    );
    const copiedModules = await copyProductionModules(
      production,
      workspace,
      path.join(app, 'node_modules'),
      target,
    );
    report.workspacePackages = copiedModules.packages;
    report.omittedPrebuilds = copiedModules.omittedPrebuilds;
    report.dependencies = await checkLockedDependencies(
      path.join(app, 'node_modules'),
      workspace,
      await readFile(path.join(workspace, 'pnpm-lock.yaml'), 'utf8'),
    );
    await cp(path.join(workspace, 'apps/desktop/dist'), path.join(app, 'dist'), {
      recursive: true,
    });
    const manifest = JSON.parse(
      await readFile(path.join(workspace, 'apps/desktop/package.json'), 'utf8'),
    );
    await writeFile(
      path.join(app, 'package.json'),
      JSON.stringify({ ...manifest, version }, null, 2) + '\n',
    );
    const roleManifest = path.join(app, 'dist/local-host-app/package.json');
    const role = JSON.parse(await readFile(roleManifest, 'utf8'));
    await writeFile(roleManifest, JSON.stringify({ ...role, version }, null, 2) + '\n');
    for (const entry of await readdir(path.join(workspace, 'plugins'), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const source = path.join(workspace, 'plugins', entry.name);
      try {
        await lstat(path.join(source, 'plugin.json'));
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      await cp(source, path.join(output, 'resources/plugins', entry.name), {
        recursive: true,
        filter: (name) => !name.split(path.sep).includes('node_modules'),
      });
    }
    const resolve = createRequire(path.join(app, 'package.json'));
    for (const specifier of [
      '@pet/local-host',
      '@pet/contracts',
      '@pet/host-kernel',
      'tsx/esm/api',
    ])
      assert.ok(
        within(output, await realpath(resolve.resolve(specifier))),
        `Dependency escaped output: ${specifier}`,
      );
    for (const script of ['windows-private-directory.ps1', 'owned-process.ps1'])
      assert.equal(
        await hashFile(path.join(path.dirname(resolve.resolve('@pet/local-host')), script)),
        await hashFile(path.join(app, 'dist/main', script)),
      );
    if (target === 'win32-x64')
      await writeFile(
        path.join(output, 'Start Pet.cmd'),
        '@echo off\r\nset ELECTRON_RUN_AS_NODE=\r\nset NODE_OPTIONS=\r\nstart "" "%~dp0Pet.exe"\r\n',
      );
    else {
      const runtimePath =
        'pet_runtime=${0%/*}\nexport LD_LIBRARY_PATH="$pet_runtime/lib:$pet_runtime/lib/browser"\n';
      await writeFile(
        path.join(output, 'start-pet.sh'),
        `#!/bin/sh\nunset ELECTRON_RUN_AS_NODE NODE_OPTIONS\n${runtimePath}exec "$pet_runtime/pet-desktop" "$@"\n`,
        { mode: 0o755 },
      );
      await writeFile(
        path.join(output, 'pet-worker'),
        `#!/bin/sh\n${runtimePath}exec "$pet_runtime/pet-desktop" "$@"\n`,
        { mode: 0o755 },
      );
    }
    await writeFile(
      path.join(output, 'README.txt'),
      `Pet local QQ preview ${version} (${target})\n\nStart the application with ${target === 'win32-x64' ? 'Start Pet.cmd' : './start-pet.sh'}.\nConnect the desktop to your existing server Agent, start the local host, review each source and its permissions, configure local QQ settings/keys, then explicitly link and enable the Agent connection.\nQQofficial and OneBot remain disabled until you enable them. SnowLuma is installed and operated separately.\nGUI exit leaves the independent host running. Reopen to attach; use Stop local host to join local native cleanup, including while the server is offline.\nHost restart requires temporary keys again. Server models, State, memory, codec and cloud work remain server-side.\nWindows-device, real-account and paid-model joint trial is pending; Linux native checks do not prove Windows ACL/device execution.\n`,
    );
    report.files = await checkLayout(output, target);
    report.status = 'portable-candidate-assembled';
    return report;
  } finally {
    const after = await sourceModulesState(repository, names);
    assert.deepEqual(
      after,
      sourceBefore,
      'Live source modules or lock metadata changed during packaging',
    );
    report.sourceModulesAfter = sha(JSON.stringify(after));
    const current = await lstat(temporary);
    assert.equal(await realpath(temporary), temporary);
    assert.equal(current.dev, owner.dev);
    assert.equal(current.ino, owner.ino);
    assert.equal(current.uid, owner.uid);
    assert.ok(temporary.startsWith(path.join(tmpdir(), 'pet-portable-build-')));
    await rm(temporary, { recursive: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = Object.fromEntries(
    process.argv.slice(2).map((argument) => {
      const match =
        /^--(output|runtimeDirectory|target|version|linuxLibraries|provisionCache)=(.+)$/.exec(
          argument,
        );
      assert.ok(
        match,
        'Use --output=ABS --runtimeDirectory=ABS --target=win32-x64 --version=X.Y.Z-preview.N',
      );
      return [match[1], match[2]];
    }),
  );
  try {
    const report = await packagePortable(options);
    await writeFile(
      path.join(options.output, 'package-report.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
    console.log(
      JSON.stringify({
        status: report.status,
        output: options.output,
        version: report.version,
        target: report.target,
        files: report.files.length,
        sourceModulesBefore: report.sourceModulesBefore,
        sourceModulesAfter: report.sourceModulesAfter,
      }),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Portable assembly failed');
    process.exitCode = 1;
  }
}
