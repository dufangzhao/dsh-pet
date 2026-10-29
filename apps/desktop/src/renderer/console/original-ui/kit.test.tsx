import { renderToStaticMarkup as html } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Button, Disclosure, Field, Notice, Status, Tile, Toggle } from './kit.js';

/**
 * 原创控件的输出回归：断言的是浏览器真的拿到的东西（原生属性、禁用、关联 id、播报角色），
 * 不是 class 好不好看。这几条各自守一个真会塌的地方：
 * busy 忘了禁用、可访问名称混进补充语、错误没串进 describedBy、Toggle 的原生 props 被吃掉。
 */
/**
 * React 把认不出的 prop 当未知属性传到 DOM 上，并在控制台记一句
 * “does not recognize the … prop”——details 就是这一类：它只认 open。
 * 本套因此把 defaultOpen 落成 open 初值，绝不把这个名字往下传。
 * 这条守的是运行时输出，不是样式。
 */
describe('不把非原生 prop 漏给 DOM', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('每块控件渲染时控制台一声不响', () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    html(
      <div>
        <Disclosure label="界面配色的 36 格" defaultOpen>
          内容
        </Disclosure>
        <Disclosure label="模型目录" open onOpenChange={() => undefined}>
          内容
        </Disclosure>
        <Button busy variant="primary" leading={<span>标</span>}>
          正在保存…
        </Button>
        <Field label="模型名称" hint="留空就用默认值">
          <input className="pb-input" defaultValue="deepseek-chat" />
        </Field>
        <Toggle label="跟随日落换夜相" hint="傍晚自己变" pressed onChange={() => undefined} />
        <Tile selected note="已存有 Key">
          DeepSeek
        </Tile>
        <Status tone="on">在桌面上</Status>
        <Notice tone="ok">已保存。</Notice>
      </div>,
    );
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([]);
  });
});

describe('板扣按钮', () => {
  it('等待结果时既标 aria-busy 也真的禁用，没等时不多这两个属性', () => {
    const busy = html(<Button busy>正在保存…</Button>);
    expect(busy).toContain('disabled=""');
    expect(busy).toContain('aria-busy="true"');
    expect(busy).toContain('data-busy="true"');
    expect(busy).toContain('class="pb-btn pb-btn--neutral');
    const ready = html(<Button variant="primary">保存并开始</Button>);
    expect(ready).not.toContain('disabled');
    expect(ready).not.toContain('aria-busy');
    expect(ready).toContain('pb-btn--primary');
  });

  it('type 默认 button，调用方要提交表单时能改回来；原生 props 与 data-testid 落在按钮上', () => {
    expect(html(<Button>停用</Button>)).toContain('type="button"');
    expect(html(<Button type="submit">保存</Button>)).toContain('type="submit"');
    expect(html(<Button data-testid="model-save">保存并开始</Button>)).toContain(
      'data-testid="model-save"',
    );
  });

  it('禁用与小的那一挡各自说得清', () => {
    expect(html(<Button disabled>测试连接</Button>)).toContain('disabled=""');
    expect(html(<Button size="small">测试连接</Button>)).toContain('pb-btn--sm');
    expect(html(<Button leading={<span>标</span>}>装扮</Button>)).toContain('pb-lead');
  });
});

describe('铭牌字段', () => {
  it('节点模式整块板子是 label：可访问名称只有名称，补充在 label 之外', () => {
    const markup = html(
      <Field label="模型名称" hint="留空用这家默认值">
        <input className="pb-input" defaultValue="deepseek-chat" />
      </Field>,
    );
    const plate = /<label class="pb-field__plate">([\s\S]*?)<\/label>/.exec(markup)?.[1] ?? '';
    expect(plate).toContain('模型名称');
    expect(plate).toContain('pb-input');
    expect(plate).not.toContain('留空用这家默认值');
    // 补充仍然在场，只是排在板子后面。
    expect(markup.indexOf('pb-field__hint')).toBeGreaterThan(markup.indexOf('pb-field__slot'));
    expect(markup).toContain('留空用这家默认值');
  });

  it('函数模式把 inputId、hint 与错误一起串好，并标 aria-invalid', () => {
    const markup = html(
      <Field label="说话风格" hint="只影响它的回复" error="这个名字太长了。">
        {({ inputId, describedBy, invalid }) => (
          <input
            id={inputId}
            aria-describedby={describedBy}
            aria-invalid={invalid ? true : undefined}
            defaultValue="阿茶"
          />
        )}
      </Field>,
    );
    const forId = /<label class="pb-field__name" id="([^"]+)" for="([^"]+)">/.exec(markup);
    const inputId = /<input id="([^"]+)"/.exec(markup)?.[1];
    expect(forId?.[2]).toBe(inputId);
    const describedBy = /aria-describedby="([^"]+)"/.exec(markup)?.[1] ?? '';
    expect(describedBy.split(' ')).toHaveLength(2);
    for (const id of describedBy.split(' ')) {
      expect(markup).toContain('id="' + id + '"');
    }
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('这个名字太长了。');
  });

  it('没有错误时不造 role=alert，也不留空容器', () => {
    const markup = html(
      <Field label="回复语言">
        <input className="pb-input" defaultValue="简体中文" />
      </Field>,
    );
    expect(markup).not.toContain('role="alert"');
    expect(markup).not.toContain('pb-field--bad');
  });
});

describe('插销开关', () => {
  it('状态落在原生 checkbox 上，data-testid 之类的 props 直接进 input，不做第二套命名', () => {
    const on = html(
      <Toggle
        label="开机后自己出现在桌面"
        pressed
        onChange={() => undefined}
        data-testid="pet-show"
      />,
    );
    expect(on).toContain('type="checkbox"');
    expect(on).toContain('role="switch"');
    expect(on).toMatch(/<input[^>]*checked/);
    expect(on).toContain('data-testid="pet-show"');
    expect(on).toContain('data-pressed="true"');
    const off = html(<Toggle label="跟随日落换夜相" pressed={false} onChange={() => undefined} />);
    expect(off).not.toMatch(/<input[^>]*checked/);
    expect(off).toContain('data-pressed="false"');
  });

  it('禁用与补充：禁用交给原生属性，补充不进可访问名称', () => {
    const markup = html(
      <Toggle
        label="这台机器不给录音"
        hint="没有麦克风权限"
        pressed={false}
        disabled
        onChange={() => undefined}
      />,
    );
    expect(markup).toMatch(/<input[^>]*disabled/);
    expect(markup).toContain('aria-describedby');
    const name = /<label class="pb-toggle__name"[^>]*>([\s\S]*?)<\/label>/.exec(markup)?.[1] ?? '';
    expect(name).toContain('这台机器不给录音');
    expect(name).not.toContain('没有麦克风权限');
    expect(markup).toContain('没有麦克风权限');
  });
});

describe('状态牌与回执', () => {
  it('语气落在 data-tone 上，文字始终在场', () => {
    expect(html(<Status tone="on">在桌面上</Status>)).toContain('data-tone="on"');
    expect(html(<Status tone="on">在桌面上</Status>)).toContain('在桌面上');
  });

  it('失败打断播报，成功只报一句，不播报时连 role 都不给', () => {
    expect(html(<Notice tone="danger">连接没有成功。</Notice>)).toContain('role="alert"');
    expect(html(<Notice tone="ok">已保存。</Notice>)).toContain('role="status"');
    const silent = html(
      <Notice tone="neutral" live={false}>
        只是说明。
      </Notice>,
    );
    expect(silent).not.toContain('role=');
    expect(
      html(
        <Notice tone="warn" action={<Button size="small">重新读取</Button>}>
          没测过。
        </Notice>,
      ),
    ).toContain('pb-notice__action');
  });
});

describe('选择瓦片与抽屉段', () => {
  it('选中用 aria-pressed，一组要单选时原生 role 与 aria-checked 能直接透传', () => {
    const selected = html(<Tile selected>DeepSeek</Tile>);
    expect(selected).toContain('aria-pressed="true"');
    expect(selected).toContain('data-selected="true"');
    const radio = html(
      <Tile role="radio" aria-checked selected>
        Kimi
      </Tile>,
    );
    expect(radio).toContain('role="radio"');
    expect(radio).toContain('aria-checked="true"');
    const off = html(
      <Tile note="未接入" disabled>
        智谱 GLM
      </Tile>,
    );
    expect(off).toContain('disabled=""');
    expect(off).toContain('未接入');
    expect(off).not.toContain('aria-pressed');
  });

  it('抽屉段是真 details/summary；受控展开落在 open 上，非受控交给浏览器', () => {
    const opened = html(
      <Disclosure label="界面配色的 36 格" open>
        内容
      </Disclosure>,
    );
    expect(opened).toContain('<details class="pb-fold" open="">');
    expect(opened).toContain('<summary class="pb-fold__summary">');
    // React 的 details 没有 defaultOpen 这个 prop，所以本套把它落成 open 初值。
    const quiet = html(
      <Disclosure label="模型目录" defaultOpen>
        内容
      </Disclosure>,
    );
    expect(quiet).toContain('<details class="pb-fold" open="">');
    expect(quiet).toContain('pb-fold__body');
    expect(html(<Disclosure label="模型目录">内容</Disclosure>)).not.toContain('open');
  });
});
