import { createHash } from 'node:crypto';
import { definePlugin, type PluginDefinition, type PluginTask } from '@pet/plugin-sdk';
import { COMPANION_MAX_TEXT, makeError, type JsonValue, type PluginManifest } from '@pet/contracts';
import type { CorticoHarnessPorts } from '@pet/harness-cortico';
import { object } from './json.js';

export const fixtureManifest: PluginManifest = {
  schemaVersion: 1,
  id: 'pet.harness-fixture',
  version: '0.1.0',
  displayName: { 'zh-CN': '确定性验证适配器', en: 'Deterministic test harness' },
  description: {
    'zh-CN': '明确标注的独立契约验证，不调用模型',
    en: 'Labeled deterministic contract adapter; no model calls',
  },
  license: 'MIT',
  host: '^1.0.0',
  platforms: ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64'],
  entries: { runtime: 'src/fixture-harness.ts' },
  provides: [
    {
      id: 'fixture',
      capability: 'companion.harness@1',
      features: {
        text: true,
        tools: false,
        methodPermissions: {
          status: [{ kind: 'capability-use', capability: 'companion.state@1' }],
          accept: [{ kind: 'capability-use', capability: 'companion.state@1' }],
          stopForeground: [{ kind: 'capability-use', capability: 'companion.state@1' }],
        },
      },
    },
  ],
  consumes: [{ capability: 'companion.state@1', optional: true }],
  permissions: [{ kind: 'capability-use', capability: 'companion.state@1' }],
};

/** A second execution semantics, not a second pretend production model. */
export function createFixturePlugin(ports: CorticoHarnessPorts): PluginDefinition {
  return definePlugin({
    activate(ctx) {
      let closed = false;
      let generation = 0;
      const pending = new Set<Promise<JsonValue>>();
      const state = () =>
        closed ? ('unavailable' as const) : pending.size ? ('busy' as const) : ('ready' as const);
      ctx.effect(() => async () => {
        closed = true;
        generation++;
        await Promise.allSettled([...pending]);
      });
      const accept = async (task: PluginTask, input: JsonValue): Promise<JsonValue> => {
        const body = object(input);
        if (
          !body ||
          typeof body['id'] !== 'string' ||
          typeof body['text'] !== 'string' ||
          !['user', 'work-result'].includes(String(body['kind']))
        )
          return { ok: false, error: { ...makeError('invalid-input') } };
        if (closed || task.signal.aborted)
          return { ok: false, error: { ...makeError('cancelled') } };
        const current = generation;
        const context = await ports.context();
        ports.projectionApplied({ profileRevision: null, memoryRevision: context.memoryRevision });
        if (closed || generation !== current || task.signal.aborted)
          return { ok: false, error: { ...makeError('cancelled') } };
        if (body['kind'] === 'user') {
          const facts = context.facts.map((fact) => `${fact.key}=${fact.value}`).join('；');
          const digest = createHash('sha256').update(body['id']).digest('hex').slice(0, 32);
          const text = `确定性适配器验证：${body['text']}${facts ? `\n已记录：${facts}` : ''}`;
          await ports.publish({
            id: `fixture-${digest}`,
            inputIds: [body['id']],
            text:
              text.length <= COMPANION_MAX_TEXT
                ? text
                : `${text.slice(0, COMPANION_MAX_TEXT - 40)}\n[验证适配器已省略超长内容]`,
          });
        }
        ports.finishInputs([String(body['id'])]);
        return { ok: true, value: null };
      };
      ctx.provide('fixture', {
        status: async () => ({ status: state(), mode: 'scripted' }),
        accept: (task, input) => {
          const work = accept(task, input);
          pending.add(work);
          ports.status(state());
          const settled = (): void => {
            pending.delete(work);
            if (!closed) ports.status(state());
          };
          void work.then(settled, settled);
          return work;
        },
        stopForeground: async () => {
          generation++;
          await Promise.allSettled([...pending]);
          ports.status(state());
          return { ok: true, value: null };
        },
      });
      ports.status('ready');
    },
  });
}
