import { describe, expect, it } from 'vitest';
import { validateManifest } from './validate.js';
import { LOCAL_ID_PATTERN, PLUGIN_ID_PATTERN } from '../patterns.js';

const base = () => ({
  schemaVersion: 1,
  id: 'com.example.plugin',
  version: '1.0.0',
  displayName: { en: 'Plugin' },
  description: { en: 'Description' },
  license: 'MIT',
  host: '^1.0.0',
  platforms: ['win32-x64'],
  entries: { runtime: 'dist/runtime.js' },
});

describe('manifest: length and shape budgets', () => {
  it('accepts a 128 character plugin id and rejects 129', () => {
    expect(validateManifest({ ...base(), id: 'a'.repeat(128) }).ok).toBe(true);
    expect(validateManifest({ ...base(), id: 'a'.repeat(129) }).ok).toBe(false);
  });

  it('accepts a 128 character local id and rejects 129', () => {
    const manifest = (id: string) => ({
      ...base(),
      entries: { runtime: 'a.js', workers: { [id]: 'w.js' } },
    });
    expect(validateManifest(manifest('a'.repeat(128))).ok).toBe(true);
    expect(validateManifest(manifest('a'.repeat(129))).ok).toBe(false);
  });

  it('rejects a dangerous prototype key used as a local id', () => {
    for (const key of ['__proto__', 'prototype', 'constructor']) {
      expect(new RegExp(LOCAL_ID_PATTERN).test(key)).toBe(false);
    }
  });

  it('rejects a plugin id with a newline anywhere', () => {
    expect(new RegExp(PLUGIN_ID_PATTERN).test('a.b\nc')).toBe(false);
    expect(validateManifest({ ...base(), id: 'a.b\n' }).ok).toBe(false);
  });

  it('caps localized dictionaries at eight entries', () => {
    const displayName = Object.fromEntries(
      ['en', 'fr', 'de', 'es', 'it', 'pt', 'ja', 'ko'].map((tag) => [tag, tag.toUpperCase()]),
    );
    expect(validateManifest({ ...base(), displayName }).ok).toBe(true);
    expect(validateManifest({ ...base(), displayName: { ...displayName, nl: 'NL' } }).ok).toBe(
      false,
    );
  });

  it('rejects a hotkey default longer than 64 characters', () => {
    const manifest = {
      ...base(),
      contributes: [
        { id: 'cmd', kind: 'command', title: { en: 'Run' }, handler: 'run' },
        {
          id: 'hk',
          kind: 'hotkey',
          title: { en: 'Hold' },
          command: 'cmd',
          defaultKey: 'K'.repeat(65),
        },
      ],
    };
    expect(validateManifest(manifest).ok).toBe(false);
  });

  it('rejects the draft object-shaped contributes document', () => {
    const manifest = {
      ...base(),
      contributes: { commands: [{ id: 'dictation.toggle', title: { en: 'Toggle' } }] },
    };
    expect(validateManifest(manifest).ok).toBe(false);
  });
});

describe('manifest: resource URLs', () => {
  const withResource = (url: string) => ({
    ...base(),
    resources: [{ id: 'm', url, bytes: 1, sha256: 'c'.repeat(64), license: 'MIT', shared: false }],
  });

  it('accepts a plain HTTPS resource URL', () => {
    expect(validateManifest(withResource('https://models.example.com/a/b.onnx')).ok).toBe(true);
  });

  it.each([
    ['fragment', 'https://models.example.com/a.onnx#sha'],
    ['userinfo', 'https://user:pw@models.example.com/a.onnx'],
    ['plain http', 'http://models.example.com/a.onnx'],
    ['uppercase sha256', 'https://models.example.com/a.onnx'],
  ])('rejects a resource URL with %s', (_label, url) => {
    const manifest = withResource(url);
    if (_label === 'uppercase sha256') {
      (manifest.resources[0] as { sha256: string }).sha256 = 'C'.repeat(64);
    }
    expect(validateManifest(manifest).ok).toBe(false);
  });
});
