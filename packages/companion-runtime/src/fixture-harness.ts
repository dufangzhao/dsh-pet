import { createHash, randomUUID } from 'node:crypto';
import { definePlugin, type PluginDefinition, type PluginTask } from '@pet/plugin-sdk';
import {
  COMPANION_INPUT_CONTEXT_MAX,
  COMPANION_MAX_TEXT,
  isCompanionRecordId,
  makeError,
  type JsonValue,
  type KernelError,
  type PluginManifest,
} from '@pet/contracts';
import { KernelFault } from '@pet/host-kernel';
import type {
  CorticoHarnessPorts,
  HarnessInput,
  HarnessInputBinding,
  HarnessProductContext,
} from '@pet/harness-cortico';
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

function parseInput(value: JsonValue): HarnessInput {
  const body = object(value);
  if (
    !body ||
    !isCompanionRecordId(body['id']) ||
    typeof body['text'] !== 'string' ||
    !body['text'].trim() ||
    body['text'].length > COMPANION_MAX_TEXT ||
    !['user', 'work-result'].includes(String(body['kind'])) ||
    Object.keys(body).some((key) => !['id', 'text', 'kind', 'taskId'].includes(key)) ||
    (body['kind'] === 'work-result'
      ? !isCompanionRecordId(body['taskId'])
      : body['taskId'] !== undefined)
  )
    throw new KernelFault('invalid-input');
  return {
    id: body['id'],
    text: body['text'],
    kind: body['kind'] as HarnessInput['kind'],
    ...(typeof body['taskId'] === 'string' ? { taskId: body['taskId'] } : {}),
  };
}
function failure(error: unknown): KernelError {
  return error instanceof KernelFault ? error.error : makeError('unavailable');
}

/** Different execution semantics, with the same admitted-input authority and terminal bookkeeping. */
export function createFixturePlugin(ports: CorticoHarnessPorts): PluginDefinition {
  return definePlugin({
    async activate(ctx) {
      let closed = false;
      let controller = new AbortController();
      let bootstrap: HarnessProductContext | null = await ports.context();
      ports.projectionApplied({ profileRevision: null, memoryRevision: bootstrap.memoryRevision });
      const pending = new Set<Promise<void>>();
      const state = (): 'ready' | 'busy' | 'unavailable' =>
        closed ? 'unavailable' : pending.size ? 'busy' : 'ready';
      const retireBootstrap = (): void => {
        if (!bootstrap) return;
        bootstrap = null;
        ports.bootstrapRetired();
      };
      ctx.effect(() => async () => {
        closed = true;
        controller.abort();
        const settled = await Promise.allSettled([...pending]);
        retireBootstrap();
        if (settled.some((result) => result.status === 'rejected'))
          throw new KernelFault('unavailable');
      });
      const run = async (input: HarnessInput, queuedSignal: AbortSignal): Promise<void> => {
        const contextId = `fixture-${randomUUID()}`;
        const signal = AbortSignal.any([queuedSignal, controller.signal]);
        let binding: HarnessInputBinding | undefined;
        let error: KernelError | null = null;
        try {
          signal.throwIfAborted();
          retireBootstrap();
          binding = await ports.bindInput(input, contextId);
          const context = await binding.ports.context();
          signal.throwIfAborted();
          binding.signal.throwIfAborted();
          binding.ports.projectionApplied({
            profileRevision: null,
            memoryRevision: context.memoryRevision,
          });
          const facts = context.facts.map((fact) => `${fact.key}=${fact.value}`).join('；');
          const text = `确定性适配器验证：${input.text}${facts ? `\n已记录：${facts}` : ''}`;
          await binding.ports.publish({
            id: `fixture-${createHash('sha256').update(input.id).digest('hex').slice(0, 32)}`,
            inputIds: [input.id],
            text,
            ...(input.taskId ? { taskId: input.taskId } : {}),
          });
          binding.ports.finishInputs([input.id]);
        } catch (cause) {
          error =
            signal.aborted || binding?.signal.aborted ? makeError('cancelled') : failure(cause);
        }
        if (binding) {
          await binding.terminal({
            inputId: input.id,
            contextId,
            status: error ? (error.code === 'cancelled' ? 'cancelled' : 'failed') : 'completed',
            cleanup: 'settled',
            error,
          });
        } else await ports.inputRejected(input.id, contextId, error ?? makeError('cancelled'));
      };
      ctx.provide('fixture', {
        status: async () => ({ status: state(), mode: 'scripted' }),
        accept: async (task: PluginTask, raw: JsonValue): Promise<JsonValue> => {
          try {
            const input = parseInput(raw);
            if (closed || task.signal.aborted) throw new KernelFault('cancelled');
            if (pending.size >= COMPANION_INPUT_CONTEXT_MAX)
              throw new KernelFault('quota-exceeded');
            const signal = ports.queueSignal(input.id);
            const work = Promise.resolve().then(() => run(input, signal));
            pending.add(work);
            ports.status(state());
            void work.then(
              () => {
                pending.delete(work);
                if (!closed) ports.status(state());
              },
              (error: unknown) => {
                // Failed terminal persistence is not a completed input or a released healthy slot.
                ports.status('unavailable', failure(error));
              },
            );
            return { ok: true, value: null };
          } catch (error) {
            return { ok: false, error: { ...failure(error) } };
          }
        },
        stopForeground: async () => {
          controller.abort();
          const settled = await Promise.allSettled([...pending]);
          if (settled.some((result) => result.status === 'rejected'))
            return { ok: false, error: { ...makeError('unavailable') } };
          controller = new AbortController();
          retireBootstrap();
          bootstrap = await ports.context();
          ports.projectionApplied({
            profileRevision: null,
            memoryRevision: bootstrap.memoryRevision,
          });
          ports.status(state());
          return { ok: true, value: null };
        },
      });
      ports.status('ready');
    },
  });
}
