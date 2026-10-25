import { describe, expect, it } from 'vitest';
import { checkCompatibility, validateManifest } from '../validation/validate.js';
import { ERROR_MESSAGES, makeError } from '../errors.js';

const base = () => ({
  schemaVersion: 1,
  id: 'official.dictation',
  version: '0.1.0',
  displayName: { 'zh-CN': '语音听写', en: 'Dictation' },
  description: { en: 'Speech dictation plugin' },
  license: 'MIT',
  host: '^1.0.0',
  platforms: ['win32-x64'],
  entries: { runtime: 'dist/runtime.js', ui: 'dist/ui/index.html' },
});

const withEntries = (patch: Record<string, unknown>) => ({ ...base(), ...patch });

describe('manifest: accepts the documented shapes', () => {
  it('accepts a minimal manifest', () => {
    expect(validateManifest(base())).toEqual({ ok: true, value: base() });
  });

  it('accepts an official-style manifest with providers, consumers and contributions', () => {
    const manifest = withEntries({
      provides: [
        {
          id: 'asr',
          capability: 'speech.asr@1',
          features: { streaming: 'segmented', offline: true },
        },
      ],
      consumes: [{ capability: 'audio.capture@1', optional: false }],
      contributes: [
        {
          id: 'dictation.toggle',
          kind: 'command',
          title: { en: 'Toggle dictation' },
          handler: 'toggle',
        },
        {
          id: 'dictation.button',
          kind: 'shortcut-button',
          title: { en: 'Mic' },
          command: 'dictation.toggle',
        },
        {
          id: 'dictation.hotkey',
          kind: 'hotkey',
          title: { en: 'Hold to talk' },
          command: 'dictation.toggle',
          defaultKey: 'F8',
        },
        {
          id: 'dictation.settings',
          kind: 'settings',
          title: { en: 'Dictation' },
          section: 'general',
        },
        { id: 'dictation.panel', kind: 'panel', title: { en: 'Panel' }, entry: 'dist/panel.html' },
      ],
      permissions: [
        { kind: 'capability-use', capability: 'audio.capture@1' },
        { kind: 'microphone' },
        { kind: 'network', origins: ['https://api.example.com', 'https://asr.example.com:8443'] },
        { kind: 'credentials', keys: ['asr-cloud'] },
        { kind: 'files', scope: 'plugin-data', access: 'read-write' },
        { kind: 'process', workers: ['asr'] },
        { kind: 'clipboard', access: 'write' },
      ],
      entries: { runtime: 'dist/runtime.js', workers: { asr: 'dist/workers/asr.js' } },
      resources: [
        {
          id: 'model-small',
          url: 'https://models.example.com/sensevoice.onnx',
          bytes: 1024,
          sha256: 'a'.repeat(64),
          license: 'Apache-2.0',
          shared: true,
        },
      ],
      config: {
        version: 1,
        schema: { type: 'object', properties: {} },
        apply: { theme: 'immediate' },
      },
    });
    const result = validateManifest(manifest);
    expect(result.ok).toBe(true);
  });

  it('accepts an external plugin with the same Schema as an official one', () => {
    const external = withEntries({ id: 'com.example.my-asr' });
    expect(validateManifest(external).ok).toBe(true);
  });
});

describe('manifest: rejects invalid documents', () => {
  it.each([
    ['missing required field', (m: Record<string, unknown>) => delete m['license']],
    ['unknown top-level field', (m: Record<string, unknown>) => (m['trusted'] = true)],
    ['declared source', (m: Record<string, unknown>) => (m['source'] = 'official')],
    ['declared protected flag', (m: Record<string, unknown>) => (m['protected'] = true)],
    [
      'unknown entries field',
      (m: Record<string, unknown>) =>
        ((m['entries'] as Record<string, unknown>)['main'] = 'dist/main.js'),
    ],
    ['wrong schemaVersion', (m: Record<string, unknown>) => (m['schemaVersion'] = 2)],
    ['v-prefixed version', (m: Record<string, unknown>) => (m['version'] = 'v0.1.0')],
    ['version with whitespace', (m: Record<string, unknown>) => (m['version'] = ' 0.1.0')],
    ['version with newline', (m: Record<string, unknown>) => (m['version'] = '0.1.0\n')],
    ['leading zero version', (m: Record<string, unknown>) => (m['version'] = '01.0.0')],
    ['invalid host range', (m: Record<string, unknown>) => (m['host'] = 'not a range!')],
    ['empty displayName', (m: Record<string, unknown>) => (m['displayName'] = {})],
    [
      'non-BCP47 locale',
      (m: Record<string, unknown>) => (m['displayName'] = { zh: 'x', 'not a tag!': 'y' }),
    ],
    ['empty localized value', (m: Record<string, unknown>) => (m['displayName'] = { en: '' })],
    [
      'unknown platform',
      (m: Record<string, unknown>) => (m['platforms'] = ['win32-x64', 'win32-ia32']),
    ],
    ['empty platforms', (m: Record<string, unknown>) => (m['platforms'] = [])],
    [
      'duplicate platforms',
      (m: Record<string, unknown>) => (m['platforms'] = ['win32-x64', 'win32-x64']),
    ],
    ['uppercase plugin id', (m: Record<string, unknown>) => (m['id'] = 'Official.Dictation')],
    ['plugin id with colon', (m: Record<string, unknown>) => (m['id'] = 'official:dictation')],
    ['plugin id leading dot', (m: Record<string, unknown>) => (m['id'] = '.official')],
    ['plugin id trailing dot', (m: Record<string, unknown>) => (m['id'] = 'official.')],
    [
      'plugin id consecutive dots',
      (m: Record<string, unknown>) => (m['id'] = 'official..dictation'),
    ],
    ['plugin id trailing hyphen', (m: Record<string, unknown>) => (m['id'] = 'official-')],
  ])('rejects %s', (_label, mutate) => {
    const manifest = base() as Record<string, unknown>;
    mutate(manifest);
    expect(validateManifest(manifest).ok).toBe(false);
  });

  it.each([
    ['absolute path', '/etc/passwd'],
    ['drive letter', 'C:/app.js'],
    ['backslash', 'dist\\runtime.js'],
    ['empty segment', 'dist//runtime.js'],
    ['dot segment', './dist/runtime.js'],
    ['parent segment', 'dist/../runtime.js'],
    ['trailing dot', 'dist/runtime.'],
    ['trailing space', 'dist/runtime '],
    ['ADS', 'dist/runtime.js:stream'],
    ['reserved device name', 'CON.js'],
    ['trailing slash directory', 'dist/'],
    ['empty path', ''],
  ])('rejects %s as a relative path', (_label, path) => {
    expect(validateManifest(withEntries({ entries: { runtime: path } })).ok).toBe(false);
  });

  it('accepts a nested relative path', () => {
    expect(
      validateManifest(withEntries({ entries: { runtime: 'dist/nested/runtime.js' } })).ok,
    ).toBe(true);
  });
});

describe('manifest: cross references and uniqueness', () => {
  it('rejects duplicate provider ids', () => {
    const manifest = withEntries({
      provides: [
        { id: 'asr', capability: 'speech.asr@1' },
        { id: 'asr', capability: 'audio.capture@1' },
      ],
    });
    expect(validateManifest(manifest).ok).toBe(false);
  });

  it('rejects duplicate consumed capabilities', () => {
    const manifest = withEntries({
      consumes: [
        { capability: 'audio.capture@1', optional: false },
        { capability: 'audio.capture@1', optional: true },
      ],
    });
    expect(validateManifest(manifest).ok).toBe(false);
  });

  it('rejects duplicate contribution ids', () => {
    const manifest = withEntries({
      contributes: [
        { id: 'x', kind: 'command', title: { en: 'a' }, handler: 'a' },
        { id: 'x', kind: 'settings', title: { en: 'b' }, section: 'b' },
      ],
    });
    expect(validateManifest(manifest).ok).toBe(false);
  });

  it('rejects duplicate resource ids', () => {
    const resource = {
      id: 'm',
      url: 'https://example.com/m.onnx',
      bytes: 1,
      sha256: 'b'.repeat(64),
      license: 'MIT',
      shared: false,
    };
    expect(validateManifest(withEntries({ resources: [resource, { ...resource }] })).ok).toBe(
      false,
    );
  });

  it('rejects a shortcut button that references an undeclared command', () => {
    const manifest = withEntries({
      contributes: [
        { id: 'button', kind: 'shortcut-button', title: { en: 'Mic' }, command: 'missing' },
      ],
    });
    expect(validateManifest(manifest).ok).toBe(false);
  });

  it('accepts a hotkey without a default key', () => {
    const manifest = withEntries({
      contributes: [
        { id: 'cmd', kind: 'command', title: { en: 'Run' }, handler: 'run' },
        { id: 'hk', kind: 'hotkey', title: { en: 'Hold' }, command: 'cmd' },
      ],
    });
    expect(validateManifest(manifest).ok).toBe(true);
  });

  it('rejects a hotkey that references an undeclared command', () => {
    const manifest = withEntries({
      contributes: [{ id: 'hk', kind: 'hotkey', title: { en: 'Hold' }, command: 'missing' }],
    });
    expect(validateManifest(manifest).ok).toBe(false);
  });

  it('treats a command handler as a plugin-local name, not a command reference', () => {
    const manifest = withEntries({
      contributes: [{ id: 'cmd', kind: 'command', title: { en: 'Run' }, handler: 'handler' }],
    });
    expect(validateManifest(manifest).ok).toBe(true);
  });

  it('rejects a process permission for an undeclared worker', () => {
    const manifest = withEntries({
      permissions: [{ kind: 'process', workers: ['missing'] }],
    });
    expect(validateManifest(manifest).ok).toBe(false);
  });

  it('accepts a process permission for a declared worker', () => {
    const manifest = withEntries({
      entries: { runtime: 'dist/runtime.js', workers: { asr: 'dist/asr.js' } },
      permissions: [{ kind: 'process', workers: ['asr'] }],
    });
    expect(validateManifest(manifest).ok).toBe(true);
  });
});

describe('manifest: permission references', () => {
  it.each([
    ['wildcard origin', [{ kind: 'network', origins: ['https://*.example.com'] }]],
    ['plain http origin', [{ kind: 'network', origins: ['http://example.com'] }]],
    ['origin with path', [{ kind: 'network', origins: ['https://example.com/api'] }]],
    ['origin with query', [{ kind: 'network', origins: ['https://example.com?a=1'] }]],
    ['origin with fragment', [{ kind: 'network', origins: ['https://example.com#f'] }]],
    ['origin with userinfo', [{ kind: 'network', origins: ['https://user:pw@example.com'] }]],
    ['origin with default port', [{ kind: 'network', origins: ['https://example.com:443'] }]],
    ['uppercase origin', [{ kind: 'network', origins: ['https://EXAMPLE.com'] }]],
    ['empty origins', [{ kind: 'network', origins: [] }]],
    ['capability-use without capability', [{ kind: 'capability-use' }]],
    ['unknown permission kind', [{ kind: 'usb' }]],
    ['unknown field in permission', [{ kind: 'microphone', extra: true }]],
    ['files without scope', [{ kind: 'files', access: 'read' }]],
    ['invalid access mode', [{ kind: 'clipboard', access: 'append' }]],
    ['credentials with namespace', [{ kind: 'credentials', keys: ['a'], namespace: 'other' }]],
    ['process without workers', [{ kind: 'process', workers: [] }]],
  ])('rejects %s', (_label, permissions) => {
    expect(validateManifest(withEntries({ permissions })).ok).toBe(false);
  });
});

describe('manifest: config schema restrictions', () => {
  it('rejects a remote $ref', () => {
    const manifest = withEntries({
      config: { version: 1, schema: { $ref: 'https://evil.example.com/schema.json' } },
    });
    expect(validateManifest(manifest).ok).toBe(false);
  });

  it('accepts a local $ref', () => {
    const manifest = withEntries({
      config: {
        version: 1,
        schema: { $defs: { t: { type: 'string' } }, properties: { a: { $ref: '#/$defs/t' } } },
      },
    });
    expect(validateManifest(manifest).ok).toBe(true);
  });

  it('rejects a dynamic ref keyword', () => {
    const manifest = withEntries({
      config: { version: 1, schema: { $dynamicRef: '#meta' } },
    });
    expect(validateManifest(manifest).ok).toBe(false);
  });
});

describe('manifest: errors never echo the input', () => {
  it('returns a fixed code with no input text', () => {
    const secret = 'sk-live-DO-NOT-ECHO';
    const manifest = withEntries({ id: secret });
    const result = validateManifest(manifest);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.error)).not.toContain(secret);
    expect(Object.keys(result.error).sort()).toEqual(['code', 'messageKey', 'retryable']);
    expect(result.error.messageKey).toBe('errors.invalid-input');
  });

  it('maps dangerous JSON to invalid-input without a value echo', () => {
    const payload = JSON.parse('{"id": {"__proto__": {"x": 1}}}') as unknown;
    const result = validateManifest(payload);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual(makeError('invalid-input'));
    expect(ERROR_MESSAGES[result.error.code]).toBeTypeOf('string');
  });
});

describe('checkCompatibility', () => {
  it('accepts a compatible host and platform', () => {
    expect(
      checkCompatibility(base() as never, { hostApiVersion: '1.2.3', platform: 'win32-x64' }),
    ).toEqual({ ok: true, value: null });
  });

  it('rejects an incompatible host range as not-ready', () => {
    const result = checkCompatibility(base() as never, {
      hostApiVersion: '2.0.0',
      platform: 'win32-x64',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not-ready');
  });

  it('does not treat a pre-release host as stable-compatible by default', () => {
    const result = checkCompatibility(base() as never, {
      hostApiVersion: '1.2.3-beta.1',
      platform: 'win32-x64',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a platform the manifest does not list', () => {
    const result = checkCompatibility(base() as never, {
      hostApiVersion: '1.2.3',
      platform: 'linux-x64',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not-ready');
  });

  it('rejects a malformed host api version', () => {
    const result = checkCompatibility(base() as never, {
      hostApiVersion: 'v1.2.3',
      platform: 'win32-x64',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invalid-input');
  });
});
