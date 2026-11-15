/**
 * 本机 QQ 接入卡的渲染回归。
 *
 * 静态渲染只能证明「说了什么、控件在不在、禁没禁用」。真实点击、IPC 往返
 * 与 Electron 集成必须由 native 套件证明，这里不冒充。
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup as html } from 'react-dom/server';

import type { QQSourceView } from '@pet/contracts';

import { LocalHostCard } from './local-host-card.js';
import type { LocalHostFacts } from './local-host-view.js';

const noop = (): void => undefined;

const actions = {
  start: noop,
  attach: noop,
  stop: noop,
  refresh: noop,
  toggleSource: noop,
};

const facts = (over: Partial<LocalHostFacts> = {}): LocalHostFacts => ({
  phase: 'stopped',
  packageVersion: null,
  hostId: null,
  bootId: null,
  attached: false,
  error: null,
  ...over,
});

const source = (over: Partial<QQSourceView> = {}): QQSourceView =>
  ({
    protocol: 'official',
    sourcePluginId: 'pet.qq-official',
    instanceId: 'default',
    desiredEnabled: false,
    source: 'ready',
    configRevision: 3,
    appliedRevision: 3,
    settings: { protocol: 'official', appId: 'app-1', scenes: ['private'] },
    account: null,
    bindingId: null,
    phase: 'disabled',
    credential: { available: false, writable: true, version: 'v1', source: 'none' },
    installedVersion: '1.0.0',
    media: { text: 'available', image: 'available', voice: 'available', file: 'available' },
    cleanup: null,
    error: null,
    ...over,
  }) as QQSourceView;

/** 取某个 testid 的整个 <button> 标签，便于判断 disabled 与文案。 */
const button = (out: string, testid: string): string => {
  const match = new RegExp(`<button[^>]*data-testid="${testid}"[^>]*>`).exec(out);
  if (match === null) throw new Error(`no button ${testid}`);
  return match[0];
};

const render = (props: Partial<Parameters<typeof LocalHostCard>[0]> = {}): string =>
  html(
    <LocalHostCard
      facts={facts()}
      sources={[]}
      agentLinkPhase={null}
      agentLinkTarget={null}
      busy={false}
      actions={actions}
      openServerPolicy={null}
      {...props}
    />,
  );

describe('本机 QQ 接入卡', () => {
  it('未运行时启动可点、停止不可点', () => {
    const out = render();
    expect(button(out, 'local-host-start')).not.toContain('disabled');
    expect(button(out, 'local-host-stop')).toContain('disabled');
  });

  it('在跑时停止可点、启动不可点', () => {
    const out = render({ facts: facts({ phase: 'running', hostId: 'h', bootId: 'b' }) });
    expect(button(out, 'local-host-stop')).not.toContain('disabled');
    expect(button(out, 'local-host-start')).toContain('disabled');
  });

  it('已运行但未连接时提示连接已有进程', () => {
    const out = render({
      facts: facts({ phase: 'running', attached: false, hostId: 'h', bootId: 'b' }),
    });
    expect(button(out, 'local-host-attach')).not.toContain('disabled');
  });

  it('已连接已有进程时不再提示连接', () => {
    const out = render({
      facts: facts({ phase: 'running', attached: true, hostId: 'h', bootId: 'b' }),
    });
    expect(button(out, 'local-host-attach')).toContain('disabled');
    expect(out).toContain('已连接到运行中的进程');
  });

  it('停止说明里讲清云端工作不受影响', () => {
    const out = render({ facts: facts({ phase: 'running', hostId: 'h', bootId: 'b' }) });
    expect(out).toContain('data-testid="local-host-stop-note"');
    expect(out).toContain('云端');
  });

  it('未运行时说明没有 QQ 客户端，而不是显示空壳', () => {
    const out = render();
    expect(out).toContain('data-testid="local-source-empty"');
    expect(out).toContain('未运行时没有 QQ 客户端');
  });
});

describe('源的三层状态分开写', () => {
  it('保存、生效、原生连接各有自己的行', () => {
    const out = render({
      facts: facts({ phase: 'running', hostId: 'h', bootId: 'b' }),
      sources: [source({ phase: 'unconfigured', appliedRevision: null })],
    });
    expect(out).toContain('data-testid="local-source-saved-official"');
    expect(out).toContain('data-testid="local-source-applied-official"');
    expect(out).toContain('data-testid="local-source-phase-official"');
    expect(out).toContain('已保存 修订 3');
    expect(out).toContain('尚未应用');
    expect(out).toContain('还没填完配置');
  });

  it('配置已保存但平台没连上时，不说成已连接', () => {
    const out = render({
      facts: facts({ phase: 'running', hostId: 'h', bootId: 'b' }),
      sources: [source({ phase: 'offline' })],
    });
    expect(out).toContain('已保存 修订 3');
    expect(out).toContain('平台连接已断开');
    expect(out).not.toContain('平台已连接');
  });

  it('两个协议都渲染，各自独立', () => {
    const out = render({
      facts: facts({ phase: 'running', hostId: 'h', bootId: 'b' }),
      sources: [
        source(),
        source({
          protocol: 'onebot-v11',
          sourcePluginId: 'pet.qq-onebot',
          settings: {
            protocol: 'onebot-v11',
            accountId: '10001',
            mode: 'reverse-ws',
            channelMode: 'universal',
            mediaProfile: 'snowluma-v11',
            listenHost: '127.0.0.1',
            listenPort: 6700,
            path: '/onebot',
          },
        }),
      ],
    });
    expect(out).toContain('data-testid="local-source-official"');
    expect(out).toContain('data-testid="local-source-onebot-v11"');
    expect(out).toContain('SnowLuma / NapCat（OneBot v11）');
  });

  it('插件不可用时说明先去插件页', () => {
    const out = render({
      facts: facts({ phase: 'running', hostId: 'h', bootId: 'b' }),
      sources: [source({ source: 'unavailable' })],
    });
    expect(out).toContain('data-testid="local-source-reason-official"');
    expect(out).toContain('插件页');
  });

  it('启用/停用按钮反映当前期望状态', () => {
    const off = render({
      facts: facts({ phase: 'running', hostId: 'h', bootId: 'b' }),
      sources: [source({ desiredEnabled: false })],
    });
    expect(off).toContain('aria-label="启用官方 QQ 机器人"');
    const on = render({
      facts: facts({ phase: 'running', hostId: 'h', bootId: 'b' }),
      sources: [source({ desiredEnabled: true, phase: 'ready' })],
    });
    expect(on).toContain('aria-label="停用官方 QQ 机器人"');
  });
});

describe('Agent 链路独立显示', () => {
  it('未配置时明说未配置', () => {
    const out = render();
    expect(out).toContain('data-testid="local-agent-phase"');
    expect(out).toContain('未配置');
  });

  it('链路断开时不影响接入仍在运行的显示', () => {
    const out = render({
      facts: facts({ phase: 'running', hostId: 'h', bootId: 'b' }),
      agentLinkPhase: 'offline',
    });
    expect(out).toContain('运行中');
    expect(out).toContain('未连接');
  });
});

describe('server 策略入口标注归属', () => {
  it('没有入口时不显示', () => {
    expect(render()).not.toContain('data-testid="local-server-policy"');
  });

  it('有入口时明确说属于 server', () => {
    const out = render({ openServerPolicy: noop });
    expect(out).toContain('data-testid="local-open-server-policy"');
    expect(out).toContain('打开 server 管理');
    expect(out).not.toContain('名单与群策略');
  });
});
