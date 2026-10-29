import type { ModelConnectionSnapshot, ModelService } from '@pet/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { ApplicationState } from '../use-application.js';
import type { DemoState } from '../use-demo.js';
import type { ModelConnectionState } from '../use-model-connection.js';
import { useStartSlots } from './sections.js';

import type { StartContext, StartDraft } from './contracts.js';

/**
 * 插槽的渲染状态回归：guard 说能保存，按钮就必须可点；说不能，就必须禁用。
 *
 * 这一组是 native 回归抓出来的接线缺陷补上的——只测纯 guard 的返回值测不出
 * "disabled={saveEnabled(...)}" 少了一个取反：那种写法下无 Key 时按钮亮着、有 Key 反而禁用。
 * 渲染的是真插槽组件，只有状态容器是夹具。
 */
const noop = (): void => undefined;

const deepseek: ModelService = {
  id: 'deepseek',
  label: 'DeepSeek',
  region: 'global',
  service: 'deepseek',
  defaultModel: 'deepseek-flash',
  models: ['deepseek-flash'],
  keyHint: '粘贴 API Key',
  keyUrl: 'https://example.invalid/keys',
  auth: 'api-key',
  available: true,
};

const active = { id: 'deepseek', model: 'deepseek-flash', label: 'DeepSeek' };

function snapshotOf(over: Partial<ModelConnectionSnapshot> = {}): ModelConnectionSnapshot {
  return {
    revision: 1,
    services: [deepseek],
    endpoints: [],
    active: null,
    paused: false,
    credentialStorageAvailable: true,
    ...over,
  };
}

function draftOf(over: Partial<StartDraft> = {}): StartDraft {
  return {
    pickedId: null,
    model: 'deepseek-flash',
    key: '',
    chatOpen: false,
    setPickedId: noop,
    setModel: noop,
    setKey: noop,
    setChatOpen: noop,
    resetForEndpoint: noop,
    ...over,
  };
}

interface Fixture {
  readonly models?: Partial<ModelConnectionState>;
  readonly draft?: Partial<StartDraft>;
}

function contextOf(over: Fixture = {}): StartContext {
  const models: Partial<ModelConnectionState> = {
    available: true,
    loading: false,
    error: null,
    saving: false,
    testing: false,
    pausing: false,
    signingIn: false,
    signIn: null,
    snapshot: snapshotOf(),
    ...over.models,
  };
  return {
    app: {
      available: false,
      snapshot: null,
      values: null,
      saving: false,
    } as unknown as ApplicationState,
    demo: { available: false, snapshot: null } as unknown as DemoState,
    models: models as ModelConnectionState,
    draft: draftOf(over.draft),
    notify: noop,
    goToView: noop,
    onOpenPlugins: noop,
  };
}

/** 渲染真插槽：两个按钮的 disabled 属性就是用户看到的可点性。 */
function SlotsHarness({ ctx }: { ctx: StartContext }): React.ReactElement {
  const slots = useStartSlots(ctx);
  return (
    <>
      {slots.status}
      {slots.connect}
    </>
  );
}

function render(over: Fixture = {}): string {
  return renderToStaticMarkup(<SlotsHarness ctx={contextOf(over)} />);
}

/** React 把 disabled="" 写在开标签前面，所以断言看整个开标签。 */
function tag(html: string, testId: string): string {
  const at = html.indexOf('data-testid="' + testId + '"');
  if (at < 0) {
    throw new Error('缺少 testid：' + testId);
  }
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
}

describe('插槽的按钮禁用状态', () => {
  it('没有在用端点也没填 Key：保存与测试都禁用', () => {
    const html = render();
    expect(tag(html, 'model-save')).toContain('disabled');
    expect(tag(html, 'model-test')).toContain('disabled');
  });

  it('填了 Key 就能保存；还没接上时测试仍然禁用', () => {
    const html = render({ draft: { key: 'sk-abc' } });
    expect(tag(html, 'model-save')).not.toContain('disabled');
    expect(tag(html, 'model-test')).toContain('disabled');
  });

  it('在用那一家：Key 可留空就保存，测试也放开', () => {
    const html = render({
      models: { snapshot: snapshotOf({ active }) },
      draft: { pickedId: 'deepseek', key: '' },
    });
    expect(tag(html, 'model-save')).not.toContain('disabled');
    expect(tag(html, 'model-test')).not.toContain('disabled');
    expect(html).toContain('留空沿用已保存的 Key');
  });

  it('写入中禁用保存，测试中禁用测试', () => {
    const saving = render({ models: { saving: true }, draft: { key: 'sk-abc' } });
    expect(tag(saving, 'model-save')).toContain('disabled');

    const testing = render({
      models: { testing: true, snapshot: snapshotOf({ active }) },
      draft: { pickedId: 'deepseek' },
    });
    expect(tag(testing, 'model-test')).toContain('disabled');
  });

  it('换了一家就不是"沿用"：没给新 Key 不许保存', () => {
    const html = render({
      models: { snapshot: snapshotOf({ active: { id: 'other', model: 'm', label: 'Other' } }) },
      draft: { pickedId: 'deepseek', key: '' },
    });
    expect(tag(html, 'model-save')).toContain('disabled');
    expect(html).not.toContain('留空沿用已保存的 Key');
  });
});
