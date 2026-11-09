/**
 * 人格/记忆组件的渲染回归（web 侧）。
 *
 * 静态渲染只能证明「说了什么、有没有那个控件、禁没禁用」；
 * 真实点击、焦点与迟到响应必须由浏览器 DOM 探针验证，这里不冒充。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';

import { PersonaMemory } from '../src/client/persona-memory.tsx';

const noop = () => {};

const profile = (overrides = {}) => ({
  agentId: 'agent-1',
  name: '阿蓝',
  persona: '你是阿蓝。',
  revision: 3,
  management: {
    application: { appliedRevision: 3, error: null },
    launchOverrides: { name: false, persona: false },
  },
  ...overrides,
});

const status = (overrides = {}) => ({
  revision: 7,
  application: { appliedRevision: 7, error: null },
  usage: { count: 2, dataBytes: 120, originBytes: 30 },
  ...overrides,
});

const fact = (overrides = {}) => ({
  key: '常喝的茶',
  value: '乌龙',
  revision: 5,
  updatedAt: 1_700_000_000_000,
  origin: { kind: 'owner-form' },
  ...overrides,
});

const memory = (overrides = {}) => ({
  agentId: 'agent-1',
  facts: [fact()],
  ...status(),
  ...overrides,
});

const transport = {
  readProfile: async () => ({
    ok: false,
    error: { code: 'not-ready', messageKey: 'k', retryable: true },
  }),
  saveProfile: async () => ({
    ok: false,
    error: { code: 'not-ready', messageKey: 'k', retryable: true },
  }),
  readMemory: async () => ({
    ok: false,
    error: { code: 'not-ready', messageKey: 'k', retryable: true },
  }),
  upsertFact: async () => ({
    ok: false,
    error: { code: 'not-ready', messageKey: 'k', retryable: true },
  }),
  forgetFact: async () => ({
    ok: false,
    error: { code: 'not-ready', messageKey: 'k', retryable: true },
  }),
};

const render = (overrides = {}) =>
  renderToStaticMarkup(
    createElement(PersonaMemory, {
      transport,
      live: true,
      agentStatus: 'ready',
      profile: profile(),
      memory: memory(),
      targetKey: 'agent-1',
      onNotice: noop,
      ...overrides,
    }),
  );

const tagOf = (html, testId) => {
  const at = html.indexOf(`data-testid="${testId}"`);
  assert.notEqual(at, -1, `找不到 ${testId}`);
  const start = html.lastIndexOf('<', at);
  const end = html.indexOf('>', at);
  return html.slice(start, end + 1);
};

test('人格区显示名字、正文、保存按钮与生效状态', () => {
  const html = render();
  assert.ok(html.includes('data-testid="profile-name"'));
  assert.ok(html.includes('data-testid="profile-persona"'));
  assert.ok(html.includes('data-testid="profile-save"'));
  assert.ok(html.includes('data-testid="profile-applied"'));
  assert.match(html, /已生效/);
});

test('记忆区列出每一行的键、值与来源，并显示上限计数', () => {
  const html = render();
  assert.ok(html.includes('data-testid="memory-row"'));
  assert.match(html, /常喝的茶/);
  assert.match(html, /乌龙/);
  assert.match(html, /手动设置/);
  assert.match(html, /修订 5/);
  // 只展示 count/32 与 dataBytes/8192，不暴露 originBytes 这个内部预算。
  assert.match(html, /2\/32/);
  assert.match(html, /120\/8192/);
  assert.ok(!html.includes('originBytes'));
});

test('metadata 缺失时只说这一项暂不可编辑，并禁用对应按钮', () => {
  const html = render({ profile: profile({ management: undefined }) });
  assert.ok(html.includes('data-testid="profile-unsupported"'));
  assert.match(html, /服务暂未提供可编辑的人格/);
  assert.match(tagOf(html, 'profile-save'), /disabled/);
  // 记忆那一边不受影响。
  assert.ok(!html.includes('data-testid="memory-unsupported"'));
});

test('记忆 metadata 缺失只禁记忆，人格照旧可保存', () => {
  const html = render({ memory: null });
  assert.ok(html.includes('data-testid="memory-unsupported"'));
  assert.ok(!html.includes('data-testid="profile-unsupported"'));
  assert.ok(!tagOf(html, 'profile-save').includes('disabled'));
});

test('未连接时整块只读，按钮禁用并说明原因', () => {
  const html = render({ live: false });
  assert.match(html, /当前未连接服务/);
  assert.match(tagOf(html, 'profile-save'), /disabled/);
  assert.match(tagOf(html, 'memory-save'), /disabled/);
});

test('agent 正忙是独立的操作条件：metadata 在也不能写', () => {
  const html = render({ agentStatus: 'busy' });
  assert.match(tagOf(html, 'profile-save'), /disabled/);
  assert.match(html, /正在回复/);
});

test('部署参数覆盖时提示下次启动可能被覆盖，不暗改部署', () => {
  const html = render({
    profile: profile({
      management: {
        application: { appliedRevision: 3, error: null },
        launchOverrides: { name: true, persona: false },
      },
    }),
  });
  assert.ok(html.includes('data-testid="launch-overrides"'));
  assert.match(html, /下次启动可能被覆盖/);
  assert.match(html, /启动参数正在覆盖名字/);
});

test('旧数据来源显示为未知，不猜成「你在这里添加」', () => {
  const html = render({
    memory: memory({ facts: [fact({ origin: { kind: 'legacy-unknown' } })] }),
  });
  assert.match(html, /来源未知（旧数据）/);
  assert.ok(!html.includes('你在这里添加'));
});

test('保存成功但未生效时如实说「已保存，尚未生效」', () => {
  const html = render({
    profile: profile({
      management: {
        application: { appliedRevision: null, error: null },
        launchOverrides: { name: false, persona: false },
      },
    }),
  });
  assert.match(html, /已保存，尚未生效/);
  assert.ok(!html.includes('已生效'));
});

test('记忆应用失败单独一行，不谎称已生效', () => {
  const html = render({
    memory: memory({
      application: {
        appliedRevision: null,
        error: { code: 'not-ready', messageKey: 'errors.not-ready', retryable: true },
      },
    }),
  });
  assert.ok(html.includes('data-testid="memory-apply-error"'));
});

test('空记忆时说明还没有记下任何事，不给一个假的行', () => {
  const html = render({ memory: memory({ facts: [] }) });
  assert.match(html, /还没有记下任何事/);
  assert.ok(!html.includes('data-testid="memory-row"'));
});

test('忘记入口按行存在，且不是整块一个总按钮', () => {
  const html = render({
    memory: memory({ facts: [fact(), fact({ key: '常看的书', value: '庄子' })] }),
  });
  assert.ok(html.includes('data-testid="memory-forget-常喝的茶"'));
  assert.ok(html.includes('data-testid="memory-forget-常看的书"'));
});

test('忘记确认是行内一组，不假装是模态对话框', () => {
  // 静态渲染无法打开确认框，这里只守住「没有 aria-modal 的假模态」这条：
  // 组件源码里那一段用 role=group + aria-label，不用 alertdialog/aria-modal。
  const source = readFileSync(new URL('../src/client/persona-memory.tsx', import.meta.url), 'utf8');
  assert.ok(!source.includes('aria-modal'));
  assert.ok(!source.includes('role="alertdialog"'));
  assert.ok(source.includes('role="group"'));
});

test('没有 metadata 时两端都说明各自的事实，不说版本过旧', () => {
  const html = render({ profile: null, memory: null });
  assert.ok(html.includes('data-testid="profile-unsupported"'));
  assert.ok(html.includes('data-testid="memory-unsupported"'));
  assert.ok(!html.includes('版本过旧'));
  assert.ok(!html.includes('旧版本'));
});
