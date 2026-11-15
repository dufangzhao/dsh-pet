import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import {
  windowsPrivateCommand,
  windowsPrivateFailure,
  parseWindowsPrivateIdentity,
  verifyWindowsPrivateDirectory,
  verifyWindowsPrivateFile,
  initializeWindowsPrivateDirectory,
} from './windows-private-directory.js';

it('uses only a fixed absolute OS executable and shipped script with separate path arguments', () => {
  const command = windowsPrivateCommand(
    'C:\\Windows',
    'InitializeDirectory',
    'C:\\Users\\fixture\\AppData\\Roaming',
    'pet-local-host',
  );
  expect(command.executable).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  expect(command.args).toContain('-NoProfile');
  expect(command.args).toContain('-NonInteractive');
  expect(command.args).not.toContain('-Command');
  expect(command.args).not.toContain('-EncodedCommand');
  const file = command.args.indexOf('-File');
  expect(command.args[file + 1]).toMatch(/windows-private-directory\.ps1$/);
  expect(command.args.slice(-6)).toEqual([
    '-Operation',
    'InitializeDirectory',
    '-Anchor',
    'C:\\Users\\fixture\\AppData\\Roaming',
    '-Name',
    'pet-local-host',
  ]);
  for (const name of [
    '..',
    '../other',
    'other\\child',
    'CON',
    'nul.txt',
    'trailing.',
    'C:other',
    'x;write-host',
  ])
    expect(() =>
      windowsPrivateCommand('C:\\Windows', 'VerifyFile', 'C:\\Users\\fixture', name),
    ).toThrow();
  expect(() =>
    windowsPrivateCommand('C:\\Windows', 'VerifyFile', '\\\\remote\\share', 'host-id'),
  ).toThrow();
});
it('checks only native identity shape and exact scoped path, never infers ACL proof from a DTO', async () => {
  const value = {
    version: 1,
    kind: 'file',
    path: 'C:\\Users\\fixture\\management\\host-id',
    userSid: 'S-1-5-21-100-200-300-1000',
    volumeId: '1234abcd',
    fileId: '0000000000001234',
    links: 1,
  };
  expect(parseWindowsPrivateIdentity(value, value.path.toLowerCase(), 'file')).toMatchObject({
    fileId: value.fileId,
  });
  for (const changed of [
    { links: 2 },
    { kind: 'directory' },
    { path: 'C:\\other\\host-id' },
    { fileId: 'bad' },
    { userSid: 'owner' },
    { arbitrary: true },
  ])
    expect(() =>
      parseWindowsPrivateIdentity({ ...value, ...changed }, value.path, 'file'),
    ).toThrow();
  await expect(verifyWindowsPrivateDirectory({ path: 'C:\\Users\\fixture' })).rejects.toMatchObject(
    { error: { code: 'permission-denied' } },
  );
});
it('ships real owner/DACL and handle checks while existing directories are verified without ACL repair', async () => {
  const source = await readFile(
    new URL('./windows-private-directory.ps1', import.meta.url),
    'utf8',
  );
  expect(source).toContain("[ValidateSet('InitializeDirectory','VerifyDirectory','VerifyFile')]");
  expect(source).toContain('[Security.Principal.WindowsIdentity]::GetCurrent().User');
  expect(source).toContain("SecurityIdentifier]::new('S-1-5-18')");
  expect(source).toContain('$security.SetAccessRuleProtection($true, $false)');
  expect(source).toContain('[IO.Directory]::CreateDirectory($target, $security)');
  expect(source).toContain(
    "$Operation -eq 'InitializeDirectory' -and -not [IO.Directory]::Exists($target)",
  );
  expect(source).not.toMatch(/Set-Acl|SetAccessControl\(/);
  expect(source).toContain('GetFileInformationByHandle');
  expect(source).toContain('GetFileType(handle) != 1');
  expect(source).toContain('0x02200000');
  expect(source).toContain('ReparsePoint');
  expect(source).toContain('$info.Links -ne 1');
  expect(source).toContain("$drive.DriveFormat -ne 'NTFS'");
});
it('does not misreport a Windows script failure as missing authorization or echo stderr', () => {
  const denied = windowsPrivateFailure(
    'local-host-private-profile-unavailable:foreign-access\r\n',
    1,
  );
  expect(denied.error.code).toBe('permission-denied');
  for (const stderr of [
    'local-host-private-profile-unavailable:script-error',
    "The term '//' is not recognized at C:\\Users\\private\\profile",
    'local-host-private-profile-unavailable:unknown-reason',
  ]) {
    const failure = windowsPrivateFailure(stderr, 1);
    expect(failure.error.code).toBe('internal');
    expect(failure.message).toBe('errors.internal');
    expect(Object.keys(failure.error).sort()).toEqual(['code', 'messageKey', 'retryable']);
  }
  expect(windowsPrivateFailure('', 2).error.code).toBe('not-ready');
  expect(windowsPrivateFailure('', 'ENOENT').error.code).toBe('not-ready');
  expect(windowsPrivateFailure('', 1, true).error.code).toBe('not-ready');
});
it.skipIf(process.platform !== 'win32')(
  'executes Windows initialization and verifies directory/file identities under a normal user anchor',
  async () => {
    const anchor = await mkdtemp(path.join(tmpdir(), 'pet-private-regression-'));
    try {
      const directory = await initializeWindowsPrivateDirectory(anchor, 'qq-connection');
      const identity = await verifyWindowsPrivateDirectory(directory);
      expect(identity.kind).toBe('directory');
      expect(identity.path).toBe(directory.path);
      expect(await verifyWindowsPrivateFile(directory, 'missing')).toBeNull();
      await writeFile(path.join(directory.path, 'fixture'), 'controlled fixture');
      expect(await verifyWindowsPrivateFile(directory, 'fixture')).toMatchObject({
        kind: 'file',
        userSid: identity.userSid,
        volumeId: identity.volumeId,
        links: 1,
      });
    } finally {
      await rm(anchor, { recursive: true, force: true });
    }
  },
  60000,
);
it("uses PowerShell comments outside the native helpers' embedded C#", async () => {
  for (const name of ['windows-private-directory.ps1', 'owned-process.ps1']) {
    const source = await readFile(new URL(`./${name}`, import.meta.url), 'utf8');
    let csharp = false;
    for (const [index, line] of source.split(/\r?\n/).entries()) {
      if (csharp) {
        if (line.trim() === "'@") csharp = false;
      } else if (line.trimEnd().endsWith("@'")) {
        csharp = true;
      } else {
        expect(line, `${name}:${index + 1}`).not.toMatch(/^\s*\/\//);
      }
    }
    expect(csharp, `${name}: unterminated C# here-string`).toBe(false);
  }
});
it.skipIf(process.platform === 'win32')(
  'does not pretend Linux exercised Windows OS ACLs',
  async () => {
    await expect(
      initializeWindowsPrivateDirectory('C:\\Users\\fixture', 'local-host'),
    ).rejects.toMatchObject({ error: { code: 'not-ready' } });
  },
);
