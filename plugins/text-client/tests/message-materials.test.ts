/**
 * 消息材料的界面回归（静态渲染）。
 *
 * 守的是「会把说明当正文」这一类：
 * - text-document 只显示说明，正文要显式点「查看全文」才读。
 * - 超限的文档不提供「查看全文」，直接说下载。
 * - 附件与文本文档不重复展示同一个材料。
 * - 没有材料时整块不渲染。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { MessageMaterials } from '../src/client/message-materials.tsx';

const ref = (over = {}) => ({
  id: 'mat-1',
  kind: 'text',
  name: '会议记录.txt',
  mediaType: 'text/plain',
  sizeBytes: 1024,
  sha256: 'a'.repeat(64),
  durationMs: null,
  audience: { kind: 'owner-private' },
  originInputIds: [],
  ...over,
});

const message = (over = {}) => ({
  id: 'm1',
  role: 'assistant',
  text: '完整正文见附件。',
  createdAt: 1_700_000_000_000,
  inputId: null,
  taskId: null,
  ...over,
});

const actions = (over = {}) => ({
  connectionId: 'conn-1',
  readText: async () => ({ ok: true, value: '真正的完整正文' }),
  readBlob: async () => ({ ok: true, value: { blob: new Blob([]), filename: null } }),
  ...over,
});

const render = (msg, act) =>
  renderToStaticMarkup(h(MessageMaterials, { message: msg, actions: act }));

test('inline-text 不渲染材料区', () => {
  const markup = render(message({ content: { kind: 'inline-text' } }), actions());
  assert.equal(markup, '');
});

test('text-document 只显示说明与两个动作，不把说明当正文', () => {
  const markup = render(
    message({ content: { kind: 'text-document', material: ref() } }),
    actions(),
  );
  assert.match(markup, /查看全文/);
  assert.match(markup, /下载/);
  assert.match(markup, /会议记录\.txt/);
  // 正文还没有被读出来：不能预先渲染成正文。
  assert.doesNotMatch(markup, /真正的完整正文/);
});

test('超过全文上限时不提供查看全文，只说下载', () => {
  const markup = render(
    message({ content: { kind: 'text-document', material: ref({ sizeBytes: 128 * 1024 }) } }),
    actions(),
  );
  assert.match(markup, /超过/);
  assert.doesNotMatch(markup, /查看全文/);
  assert.match(markup, /下载/);
});

test('语音材料说明浏览器不能播放，只给下载', () => {
  const markup = render(
    message({ materials: [ref({ id: 'v1', kind: 'voice', name: '录音.silk' })] }),
    actions(),
  );
  assert.match(markup, /SILK/);
  assert.match(markup, /不能直接播放/);
  assert.doesNotMatch(markup, /查看全文/);
});

test('附件与文本文档不重复展示同一个材料', () => {
  const document = ref();
  const markup = render(
    message({
      content: { kind: 'text-document', material: document },
      materials: [document, ref({ id: 'img-1', kind: 'image', name: '截图.png' })],
    }),
    actions(),
  );
  assert.equal(markup.match(/会议记录\.txt/g)?.length, 1);
  assert.match(markup, /截图\.png/);
});

test('没有材料时整块不渲染', () => {
  assert.equal(render(message(), actions()), '');
});
