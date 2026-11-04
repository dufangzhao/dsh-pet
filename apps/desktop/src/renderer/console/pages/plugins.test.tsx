import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { ConsolePlugin, ConsolePluginAction, ConsoleSnapshot } from '@pet/contracts';
import { makeError } from '@pet/contracts';

import { PluginsPage } from './plugins.js';

/**
 * 插件卡只守四条用户能看见的事实：
 * 一件开关说的是「想不想让它跑」而不是「此刻跑没跑起来」；
 * 整张卡能进设置，开关和卸载不会顺带跳页；卸载只有图标但有名字；
 * 说明书里那两句话已经不在卡上。
 */
const noop = (): void => undefined;
const OWNER_KEY = 'pet.asr-local|i1|1';

function plugin(over: Partial<ConsolePlugin> = {}): ConsolePlugin {
  return {
    desiredActive: false,
    owner: { pluginId: 'pet.asr-local', instanceId: 'i1', generation: 1 },
    name: '本地语音识别',
    version: '1.2.0',
    state: 'disabled',
    origin: 'user',
    protected: false,
    permissions: [],
    ...over,
  };
}

function page(
  plugins: ConsolePlugin[],
  over: {
    pending?: ReadonlyMap<string, ConsolePluginAction>;
    onOpenConfig?: ((plugin: ConsolePlugin) => void) | undefined;
  } = {},
): string {
  const snapshot: ConsoleSnapshot = {
    version: 1,
    host: {
      version: 1,
      runtime: 'ready',
      installedPlugins: plugins.length,
      activePlugins: plugins.filter((item) => item.state === 'active').length,
      unreadyPlugins: plugins.filter((item) => item.state === 'unready').length,
      pendingRestartPlugins: plugins.filter((item) => item.state === 'pending_restart').length,
      runningTasks: 0,
      pendingWork: 0,
    },
    plugins,
    contributions: [],
    app: { name: 'AI 桌宠', version: '0.0.0', electron: '45', node: '24', platform: 'win32-x64' },
  };
  return renderToStaticMarkup(
    <PluginsPage
      snapshot={snapshot}
      loading={false}
      error={null}
      available
      onRetry={noop}
      onOpenConfig={'onOpenConfig' in over ? over.onOpenConfig : noop}
      onOpenPermissions={noop}
      pending={over.pending ?? new Map()}
      onAction={noop}
      stopping={false}
      onRequestStopAll={noop}
    />,
  );
}

/** 元素开标签：React 把 disabled="" 写在最前面，所以断言看整段开标签。 */
function tagOf(html: string, testId: string): string {
  const at = html.indexOf('data-testid="' + testId + '"');
  if (at < 0) {
    throw new Error('缺少 testid：' + testId);
  }
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
}

describe('扩展页的插件卡', () => {
  it('不再有声明权限的说明、内置来源解释与单独的配置按钮', () => {
    const html = page([
      plugin({
        state: 'active',
        desiredActive: true,
        origin: 'builtin',
        permissions: [{ kind: 'microphone' }],
      }),
    ]);
    expect(html).not.toContain('这是请求，不是授权');
    expect(html).not.toContain('随应用提供');
    expect(html).not.toContain('plugin-config-');
    expect(html.match(/role="switch"/g)).toHaveLength(1);
  });

  it('开关读 desiredActive：未就绪但仍想启用时显示开启，且还能停用', () => {
    const on = page([plugin({ state: 'unready', desiredActive: true, origin: 'builtin' })]);
    const input = tagOf(on, 'plugin-toggle-pet.asr-local');
    expect(input).toContain('aria-label="启用 本地语音识别"');
    expect(input).toContain('checked');
    expect(input).not.toContain('disabled');
    expect(on).toContain('未就绪');

    const off = page([plugin({ state: 'disabled', desiredActive: false })]);
    expect(tagOf(off, 'plugin-toggle-pet.asr-local')).not.toContain('checked');
    expect(tagOf(off, 'plugin-toggle-pet.asr-local')).not.toContain('disabled');
  });

  it('受保护的包不能停用也不能卸载，但按 actionsFor 该能启用时开关照样能按', () => {
    const running = page([
      plugin({ state: 'active', desiredActive: true, protected: true, origin: 'builtin' }),
    ]);
    expect(tagOf(running, 'plugin-toggle-pet.asr-local')).toContain('checked');
    expect(tagOf(running, 'plugin-toggle-pet.asr-local')).toContain('disabled');
    expect(running).not.toContain('aria-label="卸载');

    const stopped = page([
      plugin({ state: 'disabled', desiredActive: false, protected: true, origin: 'builtin' }),
    ]);
    expect(tagOf(stopped, 'plugin-toggle-pet.asr-local')).not.toContain('disabled');
    expect(stopped).not.toContain('aria-label="卸载');
  });

  it('被拒绝的插件只留卸载，开关停在关闭处', () => {
    const html = page([plugin({ state: 'rejected', desiredActive: false })]);
    expect(tagOf(html, 'plugin-toggle-pet.asr-local')).toContain('disabled');
    expect(tagOf(html, 'plugin-toggle-pet.asr-local')).not.toContain('checked');
    expect(html).toContain('aria-label="卸载 本地语音识别"');
  });

  it('动作进行中：开关与卸载都停下，并说清在做什么', () => {
    const html = page([plugin({ state: 'active', desiredActive: true })], {
      pending: new Map<string, ConsolePluginAction>([[OWNER_KEY, 'disable']]),
    });
    expect(tagOf(html, 'plugin-toggle-pet.asr-local')).toContain('checked');
    expect(tagOf(html, 'plugin-toggle-pet.asr-local')).toContain('disabled');
    expect(tagOf(html, 'plugin-uninstall-pet.asr-local')).toContain('disabled');
    // 配置入口和旧版那颗按钮一样，动作没回来之前不跳页。
    expect(tagOf(html, 'plugin-open-pet.asr-local')).toContain('disabled');
    expect(html).toContain('正在停用…');
  });

  it('失败后的下一步说的是开关上的动作：想启用着的先停再开', () => {
    const on = page([plugin({ state: 'failed', desiredActive: true })]);
    expect(tagOf(on, 'plugin-toggle-pet.asr-local')).toContain('checked');
    expect(on).toContain('启用没有完成；先停用，再重新启用。');
    expect(on).not.toContain('plugin-retry-');
    const off = page([plugin({ state: 'failed', desiredActive: false })]);
    expect(tagOf(off, 'plugin-toggle-pet.asr-local')).not.toContain('checked');
    expect(off).toContain('启用没有完成；重新启用。');
  });

  it('受保护的包未就绪且想启用：开关停在开启处，另给一颗重试启用', () => {
    const html = page([
      plugin({ state: 'unready', desiredActive: true, protected: true, origin: 'builtin' }),
    ]);
    const toggle = tagOf(html, 'plugin-toggle-pet.asr-local');
    expect(toggle).toContain('checked');
    expect(toggle).toContain('disabled');
    const retry = tagOf(html, 'plugin-retry-pet.asr-local');
    expect(retry).toContain('aria-label="重试启用 本地语音识别"');
    expect(retry).not.toContain('disabled');
    expect(html).toContain('可以重试启用');
    // 受保护的包停不掉，文案不能让人先去停用。
    expect(html).not.toContain('先停用');
    expect(html).not.toContain('aria-label="卸载');
  });

  it('受保护又缺信任：重试与权限页入口并排，文案不让人先停用', () => {
    const html = page([
      plugin({
        state: 'failed',
        desiredActive: true,
        protected: true,
        origin: 'builtin',
        reason: makeError('permission-denied'),
      }),
    ]);
    expect(tagOf(html, 'plugin-retry-pet.asr-local')).toContain(
      'aria-label="重试启用 本地语音识别"',
    );
    expect(html).toContain('确认后可以重试启用。');
    expect(html).not.toContain('先停用');
    expect(html).toContain('前往权限与数据');
  });

  it('受保护的重试也等结果：动作进行中按不下去', () => {
    const html = page(
      [plugin({ state: 'unready', desiredActive: true, protected: true, origin: 'builtin' })],
      { pending: new Map<string, ConsolePluginAction>([[OWNER_KEY, 'enable']]) },
    );
    expect(tagOf(html, 'plugin-retry-pet.asr-local')).toContain('disabled');
    expect(html).toContain('正在启用…');
  });

  it('受保护的包已经停用：开关自己就是启用，不再多一颗重试', () => {
    const html = page([
      plugin({ state: 'disabled', desiredActive: false, protected: true, origin: 'builtin' }),
    ]);
    expect(tagOf(html, 'plugin-toggle-pet.asr-local')).not.toContain('disabled');
    expect(html).not.toContain('plugin-retry-');
  });

  it.each(['activating', 'deactivating', 'pending_restart'] as const)(
    '%s 的插件：开关停下但照实显示想不想要，卸载也不出现',
    (state) => {
      const on = page([plugin({ state, desiredActive: true })]);
      expect(tagOf(on, 'plugin-toggle-pet.asr-local')).toContain('checked');
      expect(tagOf(on, 'plugin-toggle-pet.asr-local')).toContain('disabled');
      expect(on).not.toContain('aria-label="卸载');

      const off = page([plugin({ state, desiredActive: false })]);
      expect(tagOf(off, 'plugin-toggle-pet.asr-local')).not.toContain('checked');
      expect(tagOf(off, 'plugin-toggle-pet.asr-local')).toContain('disabled');
      expect(off).not.toContain('aria-label="卸载');
    },
  );

  it('整张卡是设置入口：标题按钮只包名字，开关与卸载都不在按钮里面', () => {
    const html = page([plugin({ state: 'active', desiredActive: true })]);
    const open = /<button[^>]*class="plugin-card__open"[^>]*>([\s\S]*?)<\/button>/.exec(html);
    expect(open?.[1]?.trim()).toBe('本地语音识别');
    expect(open?.[0]).not.toContain('<input');
    expect(open?.[0]).not.toContain('aria-label="卸载');
    expect(html).toContain('data-openable="true"');
  });

  it('没有可打开的设置时标题不是按钮，卡面也不装作能点', () => {
    const html = page([plugin()], { onOpenConfig: undefined });
    expect(html).not.toContain('plugin-card__open');
    expect(html).toContain('data-openable="false"');
  });

  it('卸载是一颗有名字的图标按钮，卡面上没有第二颗文字按钮', () => {
    const html = page([plugin({ state: 'active', desiredActive: true })]);
    const remove = tagOf(html, 'plugin-uninstall-pet.asr-local');
    expect(remove).toContain('type="button"');
    expect(remove).toContain('aria-label="卸载 本地语音识别"');
    expect(html).toContain('<svg');
    expect(html).not.toContain('>卸载<');
  });

  it('失败原因与下一步都照宿主的话说，需要信任时给权限页入口', () => {
    const html = page([
      plugin({ state: 'failed', desiredActive: true, reason: makeError('permission-denied') }),
    ]);
    expect(html).toContain('role="alert"');
    expect(html).toContain('没有获得授权');
    expect(html).toContain('还没有确认这个插件包可信');
    expect(html).toContain('前往权限与数据');
  });
});
