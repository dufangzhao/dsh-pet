import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = dirname(fileURLToPath(import.meta.url));
const VALIDATION_DIR = 'validation';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

const FORBIDDEN = [
  /from 'node:/,
  /from "node:/,
  /from 'electron'/,
  /from 'ajv'/,
  /from 'ajv\//,
  /from 'semver'/,
  /require\(/,
];

describe('root entry is browser safe', () => {
  const files = walk(SRC);
  const rootFiles = files.filter(
    (file) => !relative(SRC, file).replaceAll('\\', '/').startsWith(`${VALIDATION_DIR}/`),
  );

  it('finds the root modules', () => {
    expect(rootFiles.length).toBeGreaterThan(10);
  });

  it.each(rootFiles.map((file) => [relative(SRC, file).replaceAll('\\', '/'), file] as const))(
    '%s imports no Node, Electron, Ajv or semver module',
    (_label, file) => {
      const text = readFileSync(file, 'utf8');
      for (const pattern of FORBIDDEN) {
        expect(pattern.test(text), `${file} matched ${pattern}`).toBe(false);
      }
    },
  );

  it('keeps every validator import inside the validation subpath', () => {
    const validationFiles = files.filter((file) =>
      relative(SRC, file).replaceAll('\\', '/').startsWith(`${VALIDATION_DIR}/`),
    );
    expect(validationFiles.length).toBeGreaterThan(0);
    expect(validationFiles.some((file) => readFileSync(file, 'utf8').includes("from 'ajv"))).toBe(
      true,
    );
  });

  it('exports the validation subpath from package.json', () => {
    const pkg = JSON.parse(readFileSync(join(SRC, '..', 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>;
    };
    expect(Object.keys(pkg.exports).sort()).toEqual(['.', './validation']);
  });
});

describe('root entry performs no work at import time', () => {
  it('exposes data and functions but never a compiled validator', async () => {
    const root = await import('./index.js');
    const names = Object.keys(root);
    expect(names.length).toBeGreaterThan(50);
    expect(names).toContain('PLUGIN_MANIFEST_SCHEMA');
    expect(names).toContain('CONTROL_MESSAGE_SCHEMA');
    expect(names).toContain('STREAM_HEADER_SCHEMA');
    expect(names).toContain('MVP_CAPABILITIES');
    expect(names).toContain('ERROR_MESSAGES');
    expect(names).toContain('PET_IPC');
    expect(names).not.toContain('validateManifest');
    expect(names).not.toContain('checkCompatibility');
  });

  it('keeps the frozen M0 bridge exports intact', async () => {
    const root = await import('./index.js');
    expect(root.PET_STATES).toEqual(['idle', 'listening', 'thinking', 'replying', 'error']);
    expect(root.isPetState('idle')).toBe(true);
    expect(root.isPetState('recording')).toBe(false);
  });

  it('freezes the exported error copy table', async () => {
    const root = await import('./index.js');
    expect(Object.isFrozen(root.ERROR_MESSAGES)).toBe(true);
  });
});
