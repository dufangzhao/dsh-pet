import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type {
  ConsoleApprovalPrompt,
  ConsoleBuiltinPackage,
  ConsoleSecurityPlugin,
  ConsoleSecuritySnapshot,
} from '@pet/contracts';
import { PERMISSION_PRESET_DESCRIPTIONS, PERMISSION_PRESETS } from '@pet/contracts';

import { PermissionsPage } from './permissions.js';

/**
 * 渲染回归：这几条是 M2-05 的核心承诺——审批一次一放、超时不再可答、
 * 信任入口只在有指纹时出现。只断言用户看得到的文字与按钮状态。
 */

const owner = { pluginId: 'demo.plugin', instanceId: 'default', generation: 1 };

const plugin = (over: Partial<ConsoleSecurityPlugin> = {}): ConsoleSecurityPlugin => ({
  owner,
  name: '示例插件',
  version: '1.0.0',
  state: 'unready',
  desiredActive: true,
  origin: 'user',
  protected: false,
  permissions: [{ kind: 'microphone' }],
  digest: 'a'.repeat(64),
  trusted: false,
  preset: 'ask',
  blocked: false,
  ...over,
});

const prompt = (over: Partial<ConsoleApprovalPrompt> = {}): ConsoleApprovalPrompt => ({
  requestId: 'req-1',
  owner,
  taskId: 'task-1',
  permission: { kind: 'microphone' },
  permissionDigest: 'b'.repeat(64),
  deadlineAt: Date.now() + 30_000,
  ...over,
});

const security = (over: Partial<ConsoleSecuritySnapshot> = {}): ConsoleSecuritySnapshot => ({
  sessionOnly: true,
  availableBuiltins: [],
  plugins: [plugin()],
  pending: [],
  ...over,
});

const builtin = (over: Partial<ConsoleBuiltinPackage> = {}): ConsoleBuiltinPackage => ({
  pluginId: 'core.demo',
  name: '示例内置功能',
  version: '2.0.0',
  digest: 'c'.repeat(64),
  permissions: [{ kind: 'clipboard', access: 'read' }],
  ...over,
});

const noop = (): void => undefined;

function render(over: Partial<ConsoleSecuritySnapshot> = {}): string {
  return renderToStaticMarkup(
    <PermissionsPage
      security={security(over)}
      loading={false}
      error={null}
      available={true}
      onRetry={noop}
      onApplyChange={noop}
      onUncertain={noop}
      notify={noop}
    />,
  );
}

function buttonTag(html: string, testId: string): string {
  return html.match(new RegExp(`<button[^>]*data-testid="${testId}"[^>]*>`))?.[0] ?? '';
}

function buttonText(html: string, testId: string): string {
  const match = html.match(
    new RegExp(`<button[^>]*data-testid="${testId}"[^>]*>([\\s\\S]*?)</button>`),
  );
  return (match?.[1] ?? '').replace(/<[^>]*>/g, '');
}

describe('待审批请求', () => {
  it('列出权限内容，并把答复限定在这次请求上', () => {
    const html = render({ pending: [prompt()] });
    expect(html).toContain('示例插件');
    expect(html).toContain('使用麦克风');
    expect(buttonText(html, 'approval-allow-req-1')).toBe('同意这一次');
    expect(buttonText(html, 'approval-deny-req-1')).toBe('拒绝');
    expect(html).toContain('剩余');
    expect(buttonTag(html, 'approval-allow-req-1')).not.toContain('disabled');
  });

  it('超时后两个按钮都关掉，不替宿主判定结果', () => {
    const html = render({ pending: [prompt({ deadlineAt: Date.now() - 1_000 })] });
    expect(html).toContain('已超时');
    expect(buttonTag(html, 'approval-allow-req-1')).toContain('disabled');
    expect(buttonTag(html, 'approval-deny-req-1')).toContain('disabled');
  });

  it('没有请求时说明这里会是空的，不假装有队列', () => {
    const html = render();
    expect(html).toContain('没有等待审批的请求');
    expect(html).not.toContain('同意这一次');
  });
});

describe('来源信任', () => {
  it('未确认的插件给确认入口，已确认的给取消入口', () => {
    const html = render({ plugins: [plugin()] });
    expect(html).toContain('未确认');
    expect(buttonText(html, 'trust-demo.plugin')).toBe('确认来源信任');

    const trusted = render({ plugins: [plugin({ trusted: true })] });
    expect(trusted).toContain('已确认可信');
    expect(buttonText(trusted, 'trust-demo.plugin')).toBe('取消信任');
  });

  it('没有指纹就没有可比较的对象，确认入口不可用', () => {
    const html = render({ plugins: [plugin({ digest: null })] });
    expect(html).toContain('暂时无法确认来源');
    expect(buttonTag(html, 'trust-demo.plugin')).toContain('disabled');
  });

  it('只展示指纹前缀，完整值留给确认对话框', () => {
    const html = render();
    expect(html).toContain('包指纹 aaaaaaaa');
  });
});

describe('权限预设', () => {
  it('显示当前档位与三档说明', () => {
    const html = render({ plugins: [plugin({ preset: 'deny' })] });
    expect(html).toContain('当前预设：全部拒绝');
    // 说明文字只在 contracts 维护一份：这里断言三档都真的显示出来，不复制措辞。
    for (const preset of PERMISSION_PRESETS) {
      expect(html).toContain(`value="${preset}"`);
      expect(html).toContain(PERMISSION_PRESET_DESCRIPTIONS[preset]);
    }
  });

  it('暂停时一个档位都不选中，用户才能重新选一次恢复', () => {
    const html = render({ plugins: [plugin({ blocked: true })] });
    expect(html).toContain('已暂停');
    expect(html).not.toContain('checked=""');
  });
});

describe('恢复内置功能', () => {
  it('列出卸载掉的内置功能与它声明的权限，恢复只是那一行上的动作', () => {
    const html = render({ availableBuiltins: [builtin()] });
    expect(html).toContain('示例内置功能');
    expect(html).toContain('版本 2.0.0');
    expect(html).toContain('读取剪贴板');
    expect(buttonText(html, 'restore-core.demo')).toBe('恢复');
    expect(html).not.toContain('没有可恢复的内置功能');
  });

  it('没有可恢复的功能时说明这里会是空的', () => {
    expect(render()).toContain('没有可恢复的内置功能');
  });
});

describe('审计', () => {
  it('打开页面先说明正在读取，不显示空列表', () => {
    const html = render();
    expect(html).toContain('正在读取审计记录…');
    expect(html).not.toContain('还没有记录');
  });
});
