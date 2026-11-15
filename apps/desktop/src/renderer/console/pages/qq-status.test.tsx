/**
 * 桌面 QQ 只读卡的回归。
 *
 * 守三件事：
 * - 只显示服务端给的 phase/source，不由「已配置」推出「已连接」。
 * - 「打开 Web 管理」传的是渲染时捕获的 connectionId，不是点击那一刻的最新值。
 * - 旧服务没有 qq 字段时整张卡不出现，而不是显示一个空壳。
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup as html } from 'react-dom/server';
import type { QQStatus } from '@pet/contracts';

import { QQStatusCard, qqOf, qqSourceFacts } from './qq-status.js';

const account = {
  protocol: 'official' as const,
  sourcePluginId: 'pet.qq-official',
  instanceId: 'default' as const,
  accountId: 'app-1',
};

const source = (over: Record<string, unknown> = {}): QQStatus['sources'][number] =>
  ({
    protocol: 'official',
    sourcePluginId: 'pet.qq-official',
    desiredEnabled: true,
    source: 'ready',
    phase: 'ready',
    account,
    cleanup: 'settled',
    error: null,
    ...over,
  }) as QQStatus['sources'][number];

const status = (sources: QQStatus['sources'] = [source()]): QQStatus => ({ version: 1, sources });

const accepted = async () => ({ outcome: 'accepted', error: null });

describe('桌面 QQ 只读状态', () => {
  it('显示服务端给的连接状态，不由配置推出已连接', () => {
    expect(qqSourceFacts(source({ phase: 'ready' })).label).toBe('已连接');
    expect(qqSourceFacts(source({ phase: 'connecting' })).label).toBe('正在连接');
    expect(qqSourceFacts(source({ phase: 'offline' })).label).toBe('已离线');
    expect(qqSourceFacts(source({ phase: 'failed' })).label).toBe('连接失败');
    // 已配置但还没连上：不能说成已连接。
    expect(qqSourceFacts(source({ phase: 'unconfigured' })).label).toBe('待配置');
    // 停用的模块即使 phase 曾是 ready，也显示已停用。
    expect(qqSourceFacts(source({ desiredEnabled: false, phase: 'disabled' })).label).toBe(
      '已停用',
    );
    expect(qqSourceFacts(source({ source: 'unavailable' })).label).toBe('不可用');
  });

  it('两个来源各显示一行，带账号与状态', () => {
    const markup = html(
      <QQStatusCard
        qq={status([
          source(),
          source({
            protocol: 'onebot-v11',
            sourcePluginId: 'pet.qq-onebot',
            phase: 'offline',
            account: {
              protocol: 'onebot-v11',
              sourcePluginId: 'pet.qq-onebot',
              instanceId: 'default',
              accountId: '10001',
            },
          }),
        ])}
        connectionId="conn-1"
        openWeb={accepted}
      />,
    );
    expect(markup).toContain('官方 QQ');
    expect(markup).toContain('OneBot v11');
    expect(markup).toContain('app-1');
    expect(markup).toContain('10001');
    expect(markup).toContain('已连接');
    expect(markup).toContain('已离线');
    // 管理入口只在这里出现；说明性小字不再占卡片。
    expect(markup).toContain('打开 Web 管理');
    expect(markup).not.toContain('名单、触发与密钥');
  });

  it('旧服务没有 qq 时整张卡不出现', () => {
    const markup = html(<QQStatusCard qq={undefined} connectionId="conn-1" openWeb={accepted} />);
    expect(markup).toBe('');
    expect(qqOf(null)).toBeUndefined();
    expect(qqOf({ qq: undefined } as never)).toBeUndefined();
  });

  it('没有连接时打开按钮不可用', () => {
    const markup = html(<QQStatusCard qq={status()} connectionId={null} openWeb={accepted} />);
    expect(markup).toContain('disabled');
  });

  it('没有启用任何协议时如实说，不显示空列表', () => {
    const markup = html(<QQStatusCard qq={status([])} connectionId="conn-1" openWeb={accepted} />);
    expect(markup).toContain('服务没有启用任何 QQ 协议');
  });

  it('不暴露任何可编辑字段或密钥', () => {
    const markup = html(<QQStatusCard qq={status()} connectionId="conn-1" openWeb={accepted} />);
    expect(markup).not.toContain('<input');
    expect(markup).not.toContain('type="password"');
    expect(markup).not.toContain('token');
    expect(markup).not.toContain('credential');
  });
});
