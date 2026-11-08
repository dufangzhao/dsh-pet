import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { MAGPIE_CONNECTION } from '@pet/companion-runtime';
import type { CompanionModelView, Result } from '@pet/contracts';
import { createCompanionService, type CompanionService } from './service.js';

async function stop(child: ChildProcess, exited: Promise<void>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}

async function removeFixture(directory: string): Promise<void> {
  const target = await realpath(directory);
  if (
    path.dirname(target) !== (await realpath(tmpdir())) ||
    !path.basename(target).startsWith('companion-startup-log-')
  )
    throw new Error('unexpected cleanup target');
  await rm(target, { recursive: true });
}

it.each([false, true])(
  'logs persisted model mode without an environment override; state disabled=%s remains manageable',
  async (stateDisabled) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'companion-startup-log-'));
    const token = `startup-fixture-${crypto.randomUUID()}`;
    let requests = 0;
    const gateway = createServer((_request, response) => {
      requests++;
      response.writeHead(500);
      response.end('Startup logging must not request inference.');
    });
    let initial: CompanionService | undefined;
    let child: ChildProcess | undefined;
    let exited: Promise<void> = Promise.resolve();
    try {
      await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', resolve));
      const address = gateway.address();
      if (!address || typeof address === 'string') throw new Error('missing fixture port');
      initial = await createCompanionService({ dataDirectory: directory, token, port: 0 });
      const view = await initial.models.view();
      const connector = view.connectors.find((entry) => entry.id === MAGPIE_CONNECTION);
      if (!connector) throw new Error('missing connector');
      const saved = await initial.models.save({
        commandId: crypto.randomUUID(),
        expectedProfileRevision: view.profileRevision,
        connectorId: MAGPIE_CONNECTION,
        expectedConfigRevision: connector.configRevision,
        mode: 'model',
        config: {
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          model: 'provider/startup-fixture',
          authMode: 'local-client-id',
        },
      });
      expect(saved.view.enabled).toBe(true);
      if (stateDisabled)
        await initial.runtime.setPlugin('pet.state-sqlite', false, crypto.randomUUID());
      await initial.close();
      initial = undefined;
      const env = Object.fromEntries(
        Object.entries(process.env).filter(([name]) => !name.startsWith('COMPANION_')),
      );
      Object.assign(env, {
        COMPANION_DATA_DIR: directory,
        COMPANION_TOKEN: token,
        COMPANION_HOST: '127.0.0.1',
        COMPANION_PORT: '0',
      });
      expect(env['COMPANION_MODE']).toBeUndefined();
      child = spawn(
        process.execPath,
        ['--import', 'tsx', fileURLToPath(new URL('./main.ts', import.meta.url))],
        {
          cwd: fileURLToPath(new URL('../../../', import.meta.url)),
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      const running = child;
      exited = new Promise<void>((resolve) => running.once('exit', () => resolve()));
      let stdout = '';
      let stderr = '';
      const ready = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('CLI did not publish startup state')),
          10000,
        );
        const fail = (error: Error): void => {
          clearTimeout(timer);
          reject(error);
        };
        running.once('error', fail);
        running.once('exit', () =>
          fail(new Error(`CLI exited before readiness: ${stderr.slice(0, 1000)}`)),
        );
        running.stderr?.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        running.stdout?.on('data', (chunk: Buffer) => {
          stdout += chunk.toString();
          const url = /Companion text service: (http:\/\/\S+)/.exec(stdout)?.[1];
          if (url && stdout.includes('Mode: ')) {
            clearTimeout(timer);
            resolve(url);
          }
        });
      });
      const url = await ready;
      expect(stdout).toContain(
        `Mode: model; model connection: applied; model foreground: ${stateDisabled ? 'disabled' : 'enabled'}`,
      );
      expect(stdout).not.toContain('offline script');
      expect(stdout).not.toContain('no model call');
      const response = await fetch(`${url}/api/model`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      });
      expect(response.status).toBe(200);
      const result = (await response.json()) as Result<CompanionModelView>;
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.code);
      expect(result.value.desired.mode).toBe('model');
      expect(result.value.applied).not.toBeNull();
      expect(result.value.enabled).toBe(!stateDisabled);
      expect(requests).toBe(0);
      await stop(running, exited);
      expect(running.exitCode).toBe(0);
    } finally {
      await initial?.close();
      if (child) await stop(child, exited);
      gateway.closeAllConnections();
      if (gateway.listening)
        await new Promise<void>((resolve, reject) =>
          gateway.close((error) => (error ? reject(error) : resolve())),
        );
      await removeFixture(directory);
    }
  },
  20000,
);
