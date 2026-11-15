/**
 * 共享源码信任卡的渲染回归。
 *
 * 这里守两件事：
 * - 界面只提供真实可用的显式动作（读取 / 信任 / 撤销 / 允许 / 禁止），
 *   不出现「本次同意」这种后台进程根本没有的交互；
 * - 没读到 review 时不能凭空显示 digest 或动作，读到之后显示完整摘要。
 *
 * 点击顺序、迟到回应与 epoch 刷新属于真实 DOM 流程，由
 * `apps/desktop/tests/browser/local-host.browser.mjs` 证明，这里不冒充。
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup as html } from 'react-dom/server';

import type { LocalHostSourceReview } from '@pet/contracts';

import { SourceTrustControls } from './local-source-trust.js';

const noop = (): void => undefined;

const review = (over: Partial<LocalHostSourceReview> = {}): LocalHostSourceReview => ({
  protocol: 'official',
  digest: 'a'.repeat(64),
  trusted: false,
  preset: 'deny',
  blocked: false,
  permissionEpoch: 0,
  cleanup: 'settled',
  ...over,
});

const render = (props: Partial<Parameters<typeof SourceTrustControls>[0]> = {}): string =>
  html(
    <SourceTrustControls
      selector="official"
      label="官方 QQ 机器人"
      review={null}
      error={null}
      busy={false}
      onReview={noop}
      onTrust={noop}
      onPreset={noop}
      {...props}
    />,
  );

const has = (out: string, testid: string): boolean => out.includes(`data-testid="${testid}"`);

describe('没读过就什么都不承诺', () => {
  it('只有读取按钮，没有信任或预设动作', () => {
    const out = render();
    expect(has(out, 'local-source-review')).toBe(true);
    expect(has(out, 'local-source-review-empty')).toBe(true);
    expect(has(out, 'local-source-confirm-trust')).toBe(false);
    expect(has(out, 'local-source-revoke-trust')).toBe(false);
    expect(has(out, 'local-source-allow-permissions')).toBe(false);
    expect(has(out, 'local-source-deny-permissions')).toBe(false);
    expect(has(out, 'local-source-digest')).toBe(false);
  });

  it('卡按 selector 作用域命名，三个源互不混淆', () => {
    expect(render()).toContain('data-testid="local-trust-official"');
    expect(render({ selector: 'agent-link', label: 'Agent 连接' })).toContain(
      'data-testid="local-trust-agent-link"',
    );
  });
});

describe('读到 review 后显示可决策的事实', () => {
  it('显示完整 digest、未信任与 deny，并提供信任与允许', () => {
    const out = render({ review: review() });
    expect(out).toContain('a'.repeat(64));
    expect(out).toContain('未信任');
    expect(out).toContain('拒绝');
    expect(out).toContain('已收尾');
    expect(has(out, 'local-source-confirm-trust')).toBe(true);
    expect(has(out, 'local-source-allow-permissions')).toBe(true);
    // 已经是 deny，就不再提供「禁止」。
    expect(has(out, 'local-source-deny-permissions')).toBe(false);
    // 未信任时明说放开预设也不会运行，不制造假的放行。
    expect(has(out, 'local-source-preset-locked')).toBe(true);
  });

  it('已信任 + allow 时给的是撤销与禁止', () => {
    const out = render({ review: review({ trusted: true, preset: 'allow', permissionEpoch: 2 }) });
    expect(out).toContain('已信任');
    expect(has(out, 'local-source-revoke-trust')).toBe(true);
    expect(has(out, 'local-source-deny-permissions')).toBe(true);
    expect(has(out, 'local-source-confirm-trust')).toBe(false);
    expect(has(out, 'local-source-allow-permissions')).toBe(false);
  });

  it('ask 只读说明，同时保留显式允许/禁止', () => {
    const out = render({ review: review({ trusted: true, preset: 'ask' }) });
    expect(has(out, 'local-source-preset-readonly')).toBe(true);
    expect(has(out, 'local-source-allow-permissions')).toBe(true);
    expect(has(out, 'local-source-deny-permissions')).toBe(true);
  });

  it('blocked 与 cleanup 失败如实显示', () => {
    const out = render({ review: review({ blocked: true, cleanup: 'failed' }) });
    expect(has(out, 'local-source-blocked')).toBe(true);
    expect(out).toContain('收尾失败');
  });

  it('读取失败显示真实错误，不显示 digest', () => {
    const out = render({ error: '没能读取源码状态（当前不可用）' });
    expect(has(out, 'local-source-trust-error')).toBe(true);
    expect(out).toContain('没能读取源码状态');
    expect(has(out, 'local-source-digest')).toBe(false);
  });

  it('busy 时所有动作都禁用', () => {
    const out = render({ review: review(), busy: true });
    const buttons = out.match(/<button[^>]*data-testid="local-source-[^"]+"[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(0);
    for (const tag of buttons) expect(tag).toContain('disabled');
  });
});
