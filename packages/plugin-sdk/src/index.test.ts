import { describe, expect, it, vi } from 'vitest';
import type { JsonObject } from '@pet/contracts';
import {
  definePlugin,
  type PluginContext,
  type PluginDefinition,
  type PluginTask,
} from './index.js';

function task(overrides: Partial<PluginTask> = {}): PluginTask {
  return { taskId: 'task-1', signal: new AbortController().signal, ...overrides };
}

describe('definePlugin only inspects shape', () => {
  it('returns a frozen own copy and does not execute activate', () => {
    const activate = vi.fn();
    const definition = definePlugin({ activate });
    expect(activate).not.toHaveBeenCalled();
    expect(Object.isFrozen(definition)).toBe(true);
    expect(Object.keys(definition)).toEqual(['activate']);
    expect(definition.activate).toBe(activate);
  });

  it('copies the top level so later mutation of the source is invisible', () => {
    const activate = vi.fn();
    const source: PluginDefinition = { activate };
    const definition = definePlugin(source);
    (source as { activate: () => void }).activate = vi.fn();
    expect(definition.activate).toBe(activate);
    expect(() => {
      (definition as { activate: () => void }).activate = vi.fn();
    }).toThrow();
  });

  it('keeps migrateConfig but never calls it', () => {
    const migrateConfig = vi.fn(async () => ({}) as JsonObject);
    const definition = definePlugin({ activate: vi.fn(), migrateConfig });
    expect(definition.migrateConfig).toBe(migrateConfig);
    expect(migrateConfig).not.toHaveBeenCalled();
    expect(Object.isFrozen(definition)).toBe(true);
  });

  it('accepts a definition without migrateConfig', () => {
    expect(() => definePlugin({ activate() {} })).not.toThrow();
    expect('migrateConfig' in definePlugin({ activate() {} })).toBe(false);
  });

  it.each([
    ['unknown field', () => ({ activate() {}, extra: 1 })],
    ['missing activate', () => ({})],
    ['non-function activate', () => ({ activate: 1 })],
    ['non-function migrateConfig', () => ({ activate() {}, migrateConfig: 1 })],
    ['array', () => []],
    ['null', () => null],
    [
      'getter activate',
      () => ({
        get activate() {
          return () => {};
        },
      }),
    ],
  ])('rejects %s', (_label, make) => {
    expect(() => definePlugin(make() as unknown as PluginDefinition)).toThrow(TypeError);
  });

  it('rejects a definition carrying a class instance', () => {
    class Hosted {
      activate(): void {}
    }
    expect(() => definePlugin(new Hosted())).toThrow(TypeError);
  });

  it('rejects symbol keys', () => {
    const definition = { activate() {} } as Record<string | symbol, unknown>;
    definition[Symbol('x')] = 1;
    expect(() => definePlugin(definition as unknown as PluginDefinition)).toThrow(TypeError);
  });

  it('reports a fixed message that never echoes the input', () => {
    try {
      definePlugin({ activate: 'secret-value' } as unknown as PluginDefinition);
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toBe('invalid plugin definition');
      expect((error as Error).message).not.toContain('secret-value');
    }
  });
});

describe('the root entry stays browser safe', () => {
  it('exports only definePlugin at runtime', async () => {
    const module = await import('./index.js');
    expect(Object.keys(module)).toEqual(['definePlugin']);
  });

  it('imports nothing at runtime, so no Node/Electron/host-kernel enters a bundle', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(new URL('./index.ts', import.meta.url), 'utf8');
    const imports = source.match(/^import\s[\s\S]*?from\s+'[^']+';$/gm) ?? [];
    expect(imports.length).toBeGreaterThan(0);
    for (const statement of imports) {
      expect(statement.startsWith('import type ')).toBe(true);
      expect(statement).not.toContain('node:');
      expect(statement).not.toContain('electron');
      expect(statement).not.toContain('host-kernel');
      expect(statement).not.toContain('@pet/contracts/validation');
    }
  });
});

describe('definePlugin creates no permissions and no side effects', () => {
  it('leaves the definition usable as a plain object', () => {
    const seen: string[] = [];
    const definition = definePlugin({
      activate(context: PluginContext) {
        seen.push(context.owner.pluginId);
        context.provide('main', { run: async () => null });
      },
    });
    expect(seen).toEqual([]);
    expect(definition.activate).toBeTypeOf('function');
  });

  it('does not need a task to be defined', () => {
    expect(task().taskId).toBe('task-1');
  });
});
