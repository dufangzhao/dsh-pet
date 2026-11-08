import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createReadOnlyModelTransport } from '../src/model-ui.ts';
import { parseProfile, getProfile, SseDecoder } from '../src/protocol.ts';

test('shared wire reads are abortable, reject redirects and reject oversized JSON before projection', async () => {
  const original = globalThis.fetch;
  let options;
  const abort = new AbortController();
  try {
    globalThis.fetch = async (_url, init) => {
      options = init;
      return new Response(
        JSON.stringify({ ok: true, value: { agentId: 'a', name: 'n', persona: 'p', revision: 1 } }),
      );
    };
    assert.equal(
      (await getProfile({ baseUrl: 'http://127.0.0.1', token: 'test' }, abort.signal)).ok,
      true,
    );
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    abort.abort();
    assert.equal(options.signal.aborted, true);
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ ok: true, value: 'x'.repeat(65536) }));
    assert.equal((await getProfile({ baseUrl: 'http://127.0.0.1', token: 'test' })).ok, false);
    assert.throws(() => new SseDecoder().push('data: ' + 'x'.repeat(65536)), /budget/);
  } finally {
    globalThis.fetch = original;
  }
});

test('native model credential adapter denies without dispatching any transport operation', async () => {
  let calls = 0;
  const actions = {
    saveModel: async () => {
      calls++;
    },
    testModel: async () => {
      calls++;
    },
  };
  const adapter = createReadOnlyModelTransport(actions);
  const result = await adapter.writeModelCredential({
    apiKey: 'never-send',
    connectorId: 'x',
    expectedConfigRevision: 1,
    expectedCredentialVersion: 'v',
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'permission-denied');
  assert.equal(calls, 0);
});
test('persona bounds count code points, unlike message UTF16 admission', () => {
  const base = { agentId: 'agent-1', name: 'name', persona: '😀'.repeat(16384), revision: 1 };
  assert.ok(parseProfile(base));
  assert.equal(parseProfile({ ...base, persona: base.persona + '😀' }), null);
  assert.equal(parseProfile({ ...base, revision: 0 }), null);
});
test('model stylesheet is scoped and the reusable UI has no page CSS import', async () => {
  const css = await readFile(new URL('../src/client/model.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /(^|\n)\s*(html|body|:root|\*|#root)\s*[{,]/);
  assert.doesNotMatch(css, /(^|\n)\s*\.pk-dialog/);
  assert.match(css, /\.tc-model-dialog \.pk-dialog\[open\]/);
  const entry = await readFile(new URL('../src/model-ui.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(entry, /styles\.css|client\/app|client\/main/);
});
