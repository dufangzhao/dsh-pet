import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { ModelConnectionSnapshot, ModelService } from '@pet/contracts';

import { StartConnectForm, StartConnectionStatus, StartProviderChooser } from './sections.js';

import type { ProviderChoice, StartModel } from './use-start-model.js';

/**
 * 控件的可用性回归：这里渲染的是真插槽组件，只有状态容器是夹具。
 *
 * 上一轮 native 抓到的是接线缺陷——guard 正着说"能保存"，渲染处忘了取反，
 * 按钮就与规则反着长。只看纯函数的返回值测不出来，必须看真 DOM 上的 disabled。
 * 同时锁住一件事：Start 的呈现里不许再出现旧复制品的类名（胶囊芯片、滑轨分段、pk-input）。
 */
const noop = (): void => undefined;

const deepseek: ModelService = {
  id: 'deepseek',
  label: 'DeepSeek',
  region: 'cn',
  service: 'deepseek',
  defaultModel: 'deepseek-flash',
  models: ['deepseek-flash'],
  keyHint: '粘贴 API Key',
  keyUrl: 'https://example.invalid/keys',
  auth: 'api-key',
  available: true,
};

const choice: ProviderChoice = {
  service: deepseek,
  row: { name: 'deepseek', main: deepseek },
  current: true,
  mark: 'draft',
  keySaved: false,
  dirty: false,
};

function model(over: Partial<StartModel> = {}): StartModel {
  return {
    available: true,
    loading: false,
    error: null,
    notice: null,
    phase: 'nothing-yet',
    paused: false,
    snapshotLabel: null,
    activeId: null,
    activeLabel: null,
    saveTargetId: null,
    rows: [choice.row],
    choices: [choice],
    query: '',
    setQuery: noop,
    picked: deepseek,
    pickedId: null,
    inUse: false,
    mark: 'draft',
    keySaved: false,
    sibling: undefined,
    model: 'deepseek-flash',
    key: '',
    reasoningEffort: 'default',
    setReasoningEffort: noop,
    modelList: {
      fetching: false,
      options: deepseek.models,
      error: null,
      notice: null,
      allowed: false,
    },
    getModels: noop,
    setModel: noop,
    setKey: noop,
    can: { save: false, test: false, signIn: false },
    reasons: {
      save: '这一家还没有可用的 Key：填一个，或改回在用的那一家。',
      test: '还没有在用的连接：先保存一家，再测它。',
      signIn: null,
    },
    dirty: false,
    keyBlock: null,
    busy: {
      saving: false,
      testing: false,
      signingIn: false,
      sending: false,
      visibility: false,
      pausing: false,
    },
    saved: null,
    tested: null,
    signing: null,
    pick: noop,
    save: noop,
    test: noop,
    signIn: noop,
    cancelSignIn: noop,
    openKeyPage: noop,
    switchRegion: noop,
    togglePaused: noop,
    refresh: noop,
    openPlugins: noop,
    appAvailable: true,
    desktopShown: false,
    desktop: { mark: 'off', text: '桌宠未就绪' },
    pet: { values: null, agent: null },
    setDesktopVisible: noop,
    goToView: noop,
    ...over,
  };
}

const render = (over: Partial<StartModel> = {}): string =>
  renderToStaticMarkup(
    <>
      <StartConnectionStatus model={model(over)} />
      <StartProviderChooser model={model(over)} />
      <StartConnectForm model={model(over)} />
    </>,
  );

/** 夹具要改哪一行目录：只在需要的测试里换，别把断言藏在夹具里。 */
function snapshotWithActive(): ModelConnectionSnapshot {
  return {
    revision: 2,
    services: [deepseek],
    endpoints: [{ id: 'deepseek', model: 'deepseek-flash', keyConfigured: true }],
    active: { id: 'deepseek', model: 'deepseek-flash', label: 'DeepSeek' },
    paused: false,
    credentialStorageAvailable: true,
  };
}

function tag(html: string, testId: string): string {
  const at = html.indexOf('data-testid="' + testId + '"');
  if (at < 0) {
    throw new Error('缺少 testid：' + testId);
  }
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
}

describe('保存与测试按钮跟着真判断走', () => {
  it('判断说不能保存，真按钮就是禁用', () => {
    expect(tag(render(), 'model-save')).toContain('disabled');
    expect(tag(render(), 'model-test')).toContain('disabled');
  });

  it('判断说能保存，真按钮就必须可点（这一条抓的是忘了取反）', () => {
    const html = render({ can: { save: true, test: false, signIn: false } });
    expect(tag(html, 'model-save')).not.toContain('disabled');
    expect(tag(html, 'model-test')).toContain('disabled');
  });

  it('写入中：保存按钮禁用并标 busy，而不是亮着让人再点一次', () => {
    const html = render({
      busy: { ...model().busy, saving: true },
      can: { save: true, test: false, signIn: false },
    });
    expect(tag(html, 'model-save')).toContain('disabled');
    expect(tag(html, 'model-save')).toContain('aria-busy="true"');
  });

  it('按不下去的原因写在明面上，不藏着', () => {
    const html = render();
    expect(html).toContain('model-save-reason');
    expect(html).toContain('还没有可用的 Key');
  });
});

describe('在用与挑了没保存分得开', () => {
  it('没在用：状态牌说"还没有在用连接"，只有当前那一家说「挑了，还没保存」', () => {
    const html = render();
    expect(html).toContain('还没有在用连接');
    expect(html).toContain('挑了，还没保存');
    expect(html).not.toContain('已连接，桌宠开始接话。');
  });

  it('目录里没被挑中的那一家说"可选"，不跟着冒充有草稿', () => {
    const other: ProviderChoice = {
      ...choice,
      current: false,
      mark: 'available',
      keySaved: false,
      dirty: false,
      service: { ...deepseek, id: 'kimi', label: 'Kimi', service: 'kimi' },
      row: { name: 'kimi', main: { ...deepseek, id: 'kimi', label: 'Kimi', service: 'kimi' } },
    };
    const html = render({ choices: [choice, other] });
    expect(html).toContain('可选，填 API Key');
    expect(html).toContain('model-pick-kimi');
    // 当前那一家才配得上"还没保存"这句
    const kimi = html.slice(html.indexOf('model-pick-kimi'), html.indexOf('model-pick-kimi') + 600);
    expect(kimi).not.toContain('挑了，还没保存');
  });

  it('在用：状态牌报那一家与模型名，目录那一行标「在用」', () => {
    const snap = snapshotWithActive();
    const html = render({
      phase: 'in-use',
      snapshotLabel: snap.active?.label + ' · ' + snap.active?.model,
      inUse: true,
      mark: 'in-use',
      keySaved: true,
      choices: [{ ...choice, mark: 'in-use', keySaved: true }],
      can: { save: true, test: true, signIn: false },
      reasons: { save: null, test: null, signIn: null },
    });
    expect(html).toContain('DeepSeek · deepseek-flash');
    expect(html).toContain('在用');
    expect(tag(html, 'model-test')).not.toContain('disabled');
    expect(html).toContain('留空就沿用这台机器上已经存着的那一份');
  });
});

describe('Key 那一栏只报真实原因', () => {
  it('本机存不住凭据时说存不住，并把这一栏禁用', () => {
    const html = render({ keyBlock: '本机凭据存储不可用：现在写进去也存不住。' });
    expect(tag(html, 'key-input')).toContain('disabled');
    expect(html).toContain('凭据存储不可用');
    expect(html).not.toContain('这一家还没有存过 Key');
  });

  it('读到配置了就不报存不住', () => {
    expect(render()).not.toContain('现在写进去也存不住');
  });
});

describe('回执的三条事实分开摆', () => {
  it('保存后：写进本机、这一次探测、现在在用各一行，措辞不合并', () => {
    const html = render({
      saved: {
        saved: true,
        tested: false,
        active: false,
        text: '配置已保存，但这台机器在用的还是另一个端点。',
      },
    });
    expect(html).toContain('model-receipt');
    expect(html).toContain('已保存');
    expect(html).toContain('没通过');
    expect(html).toContain('就是这一家');
  });

  it('没有回执的时候不摆空板子，也不演一次成功', () => {
    expect(render()).not.toContain('model-receipt');
  });

  /** QA21dc 的真状态缺陷：Key 已写进本机、那次探测被网络拒（此刻谁都没在用）。 */
  it('保存了但没在用：说"当前没有在用连接"，不许说"还是别的一家"', () => {
    const html = render({
      saved: { saved: true, tested: false, active: false, text: '连接没有成功：网络被拒。' },
      saveTargetId: 'deepseek',
      phase: 'saved-only',
    });
    expect(html).toContain('当前没有在用连接');
    expect(html).not.toContain('还是别的一家');
    expect(html).toContain('已保存');
    expect(html).toContain('没通过');
  });

  it('此刻在用者是别的一家才说"在用的是…"，带上真名字', () => {
    const html = render({
      saved: {
        saved: true,
        tested: true,
        active: false,
        text: '配置已保存，但这台机器在用的还是另一个端点。',
      },
      saveTargetId: 'deepseek',
      activeId: 'qwen',
      activeLabel: '通义千问',
      phase: 'in-use',
      snapshotLabel: '通义千问 · qwen3.8-flash',
    });
    expect(html).toContain('在用的是通义千问');
    expect(html).not.toContain('当前没有在用连接');
  });

  /** native 抓到的假推断：目录里有默认配置记录不等于本机存过 Key。 */
  it('默认端点在场但 keyConfigured=false：一行都不许说"本机存过 Key"', () => {
    const rows: ProviderChoice[] = [
      {
        ...choice,
        mark: 'draft',
        keySaved: false,
        dirty: false,
      },
      {
        ...choice,
        current: false,
        mark: 'available',
        keySaved: false,
        dirty: false,
        service: { ...deepseek, id: 'kimi', label: 'Kimi', service: 'kimi' },
        row: { name: 'kimi', main: { ...deepseek, id: 'kimi', label: 'Kimi', service: 'kimi' } },
      },
    ];
    const html = render({ choices: rows, mark: 'draft', keySaved: false });
    expect(html).not.toContain('本机存过 Key');
    expect(html).toContain('可选，填 API Key');
    expect(html).toContain('挑了，还没保存');
  });

  it('本机存过 Key 的当前那一家：注记说存过，不喊"还没保存"；真改了才说改动没保存', () => {
    const clean: ProviderChoice = { ...choice, mark: 'saved', keySaved: true, dirty: false };
    // 表单标题那一格也跟着说存过，不再喊"还没保存"
    const stored = render({ choices: [clean], mark: 'saved', keySaved: true, saved: null });
    expect(stored).toContain('本机存过 Key，填新的会覆盖');
    expect(stored).not.toContain('还没保存');

    const edited: ProviderChoice = { ...clean, dirty: true };
    expect(render({ choices: [edited], mark: 'saved', keySaved: true })).toContain(
      '本机存过 Key，这次改动还没保存',
    );
  });

  it('测试回来的那一句话直接标在测试按钮旁边', () => {
    const html = render({
      tested: { ran: true, passed: true, text: '连接正常，耗时 12 ms。' },
      can: { save: true, test: true, signIn: false },
      phase: 'in-use',
      snapshotLabel: 'DeepSeek · deepseek-flash',
      inUse: true,
    });
    expect(html).toContain('连接正常，耗时 12 ms。');
  });
});

describe('目录的新形状', () => {
  it('搜索、切换读法与计数都在，且没有旧胶囊类名', () => {
    const html = render();
    expect(tag(html, 'model-provider-search')).not.toContain('disabled');
    expect(html).toContain('model-provider-toggle');
    expect(html).toContain('model-provider-count');
    expect(html).toContain('model-pick-deepseek');
    for (const old of ['start-chip', 'pk-input', 'pk-button', 'pk-pill', 'console-segmented']) {
      expect(html).not.toContain(old);
    }
  });

  it('未接入的那一家看得见但点不动', () => {
    const blocked: ProviderChoice = {
      ...choice,
      current: false,
      service: {
        ...deepseek,
        id: 'off',
        label: '没接进来的一家',
        available: false,
        unavailableReason: '扩展没启用',
      },
      mark: 'unavailable',
      dirty: false,
    };
    const html = render({ choices: [choice, blocked] });
    expect(tag(html, 'model-pick-off')).toContain('disabled');
    expect(html).toContain('未接入');
  });

  it('一句都匹配不上时报零家，不画一张空网格冒充目录', () => {
    const html = render({ query: '没有这个名字', choices: [] });
    expect(html).toContain('model-provider-empty');
    expect(html).toContain('0 / 1 家');
  });
});
