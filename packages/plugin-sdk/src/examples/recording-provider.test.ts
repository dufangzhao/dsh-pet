import { expect, it, vi } from 'vitest';
import { validateManifest } from '@pet/contracts/validation';
import { makeError } from '@pet/contracts';
import type { JsonValue } from '@pet/contracts';
import type { PluginContext, PluginTask } from '../index.js';
import { createPluginHostServices } from '../host.js';
import { createRecordingExample, recordingManifest } from './recording-provider.js';
it('validates the public-only example manifest under the frozen contract', () => {
  expect(validateManifest(recordingManifest).ok).toBe(true);
  expect(Object.keys(recordingManifest.entries)).toEqual(['runtime']);
});
it('registers and cleans the public example without receiving kernel objects', async () => {
  const scope = new AbortController(),
    owner = { pluginId: recordingManifest.id, instanceId: 'default', generation: 1 };
  let methods!: Readonly<
    Record<string, (task: PluginTask, input: JsonValue) => Promise<JsonValue>>
  >;
  let dispose!: () => void | Promise<void>;
  const host = createPluginHostServices(
    { owner, signal: scope.signal },
    {
      getConfig: async () => ({ ok: false, error: makeError('not-ready') }),
      invoke: async () => ({ ok: false, error: makeError('permission-denied') }),
      openInput: async () => ({ ok: false, error: makeError('not-ready') }),
      openOutput: async () => ({ ok: false, error: makeError('not-ready') }),
    },
  );
  const example = createRecordingExample();
  const context: PluginContext = {
    owner,
    signal: scope.signal,
    config: {},
    host,
    provide: (id, value) => {
      expect(id).toBe('main');
      methods = value;
    },
    contribute: vi.fn(),
    effect: (factory) => {
      dispose = factory();
    },
  };
  await example.definition.activate(context);
  expect(example.observation.calls).toBe(0);
  expect(Object.keys(host).sort()).toEqual(['capabilities', 'config', 'media', 'version']);
  const input = { sample: 'public' };
  expect(await methods['echo']!({ taskId: 'task', signal: scope.signal }, input)).toEqual(input);
  expect(input).toEqual({ sample: 'public' });
  expect(example.observation.calls).toBe(1);
  scope.abort();
  await expect(methods['echo']!({ taskId: 'task', signal: scope.signal }, null)).rejects.toThrow(
    'cancelled',
  );
  await dispose();
  expect(example.observation.disposed).toBe(1);
});
