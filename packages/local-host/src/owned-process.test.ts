import { expect, it, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, lstat, readFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import type { LocalHostProcessIdentity } from '@pet/contracts';
import { openPrivateDirectory } from './rendezvous.js';
import {
  captureCurrentOwnedProcess,
  ownedProcessIdentity,
  verifyOriginalProcessGone,
  verifyCurrentOwnedProcess,
  ownedProcessDeathFact,
  linuxProcessStartIdentity,
} from './owned-process.js';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function profile() {
  const root = await mkdtemp(path.join(tmpdir(), 'owned-process-')),
    original = await lstat(root),
    absolute = await realpath(root);
  cleanup.push(async () => {
    const current = await lstat(absolute);
    expect(await realpath(absolute)).toBe(absolute);
    expect(current.dev).toBe(original.dev);
    expect(current.ino).toBe(original.ino);
    expect(current.uid).toBe(original.uid);
    expect(path.dirname(absolute)).toBe(await realpath(tmpdir()));
    await rm(absolute, { recursive: true });
  });
  return openPrivateDirectory(absolute);
}
it('parses kernel start identity after a comm containing spaces and parentheses', () => {
  const fields = ['S', ...Array.from({ length: 18 }, () => '0'), '123456', '0'];
  expect(linuxProcessStartIdentity(`123 (a tricky ) process) ${fields.join(' ')}`, 123)).toBe(
    '123456',
  );
  expect(() => linuxProcessStartIdentity(`124 (other) ${fields.join(' ')}`, 123)).toThrow();
});
it.skipIf(process.platform !== 'linux')(
  'captures only the current actual process and refuses forged proof objects or namespace/profile mismatches',
  async () => {
    const directory = await profile(),
      capture = await captureCurrentOwnedProcess(directory),
      identity = ownedProcessIdentity(capture);
    await expect(verifyCurrentOwnedProcess(capture, directory)).resolves.toBeUndefined();
    expect(identity.pid).toBe(process.pid);
    expect(identity.osKind).toBe('linux');
    expect(identity.osBootIdentity).toMatch(/^[a-f0-9-]+@\d+:\d+$/);
    expect(await verifyOriginalProcessGone(identity, directory)).toEqual({
      status: 'unavailable',
      reason: 'live',
    });
    expect(
      await verifyOriginalProcessGone(
        { ...identity, osBootIdentity: identity.osBootIdentity + '0' },
        directory,
      ),
    ).toEqual({ status: 'unavailable', reason: 'identity-mismatch' });
    expect(await verifyOriginalProcessGone(identity, await profile())).toEqual({
      status: 'unavailable',
      reason: 'identity-mismatch',
    });
    expect(await verifyOriginalProcessGone(null, directory)).toEqual({
      status: 'unavailable',
      reason: 'unverifiable',
    });
    expect(() => ownedProcessIdentity({ kind: 'owned-process-provenance' })).toThrow();
    expect(() => ownedProcessDeathFact({ status: 'gone' })).toThrow();
  },
);
it.skipIf(process.platform !== 'linux')(
  'uses a real child PID/start token and proves death only after the captured child exits',
  async () => {
    const directory = await profile();
    const module = pathToFileURL(path.resolve('src/owned-process.ts')).href,
      rendezvous = pathToFileURL(path.resolve('src/rendezvous.ts')).href;
    const code = `import {captureCurrentOwnedProcess,ownedProcessIdentity} from ${JSON.stringify(module)};import {openPrivateDirectory} from ${JSON.stringify(rendezvous)};const p=await openPrivateDirectory(process.argv[1]);console.log(JSON.stringify(ownedProcessIdentity(await captureCurrentOwnedProcess(p))));process.stdin.resume();await new Promise(r=>process.stdin.once('end',r));`;
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', code, directory.path],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const exited = once(child, 'exit');
    cleanup.push(async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.stdin.end();
        await exited;
      }
    });
    const identity = await new Promise<LocalHostProcessIdentity>((resolve, reject) => {
      let text = '';
      child.stdout.on('data', (bytes) => {
        text += bytes;
        if (text.includes('\n')) {
          try {
            resolve(JSON.parse(text.split('\n')[0] ?? '') as LocalHostProcessIdentity);
          } catch (error) {
            reject(error);
          }
        }
      });
      child.once('error', reject);
      child.stderr.on('data', (bytes) => reject(new Error(bytes.toString())));
    });
    expect(identity.pid).toBe(child.pid);
    expect(identity.processCreationIdentity).toBe(
      linuxProcessStartIdentity(await readFile(`/proc/${identity.pid}/stat`, 'utf8'), identity.pid),
    );
    expect(await verifyOriginalProcessGone(identity, directory)).toEqual({
      status: 'unavailable',
      reason: 'live',
    });
    child.stdin.end();
    expect((await exited)[0]).toBe(0);
    const proof = await verifyOriginalProcessGone(identity, directory);
    if (proof.status !== 'gone') throw new Error('Actual exited child not proven');
    expect(ownedProcessDeathFact(proof)).toEqual({ identity, reason: 'not-found' });
  },
);
it('ships read-only Windows handle/creation/boot checks, not process termination or wall-clock inference', async () => {
  const script = await readFile(new URL('./owned-process.ps1', import.meta.url), 'utf8');
  expect(script).toContain("[ValidateSet('Capture','Inspect')]");
  expect(script).toContain('NtQuerySystemInformation(90');
  expect(script).toContain('GetProcessTimes');
  expect(script).toContain('WaitForSingleObject(handle, 0)');
  expect(script).toContain('OpenProcess(0x00101000');
  expect(script).not.toMatch(/TerminateProcess|Stop-Process|DateTime|Get-Date/);
});
