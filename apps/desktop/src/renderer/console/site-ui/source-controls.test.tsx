/**
 * 这三件（外加选项组与名称块）的输出回归：断言的是浏览器与读屏真的拿到的东西——
 * 原生 type/checked、busy 有没有真的 disable、可访问名称里混没混进补充语、
 * 调用方自己传的原生 aria-* 有没有被适配层吃掉。样式不在这里测，由对照板与原生检查看。
 */
import { renderToStaticMarkup as html } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SourceButton } from './source-button.js';
import { SourceField, SourceInput } from './source-input.js';
import { SourcePanel } from './source-panel.js';
import { SourceRadioGroup } from './source-radio.js';
import { SourceNotice, SourceStatus } from './source-status.js';
import { SourceSwitch } from './source-switch.js';
import { SourceTile } from './source-tile.js';
import { SiteGlyphIcon } from './site-icons.js';

describe('按钮', () => {
  it('等待时真的按下不动、禁用并标 aria-busy', () => {
    const out = html(<SourceButton busy>正在写入这台机器…</SourceButton>);
    expect(out).toContain('disabled=""');
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain('data-busy="true"');
    expect(out).toContain('su-button');
  });

  it('busy=false 不吃掉调用方自己传的原生 aria-busy', () => {
    const out = html(<SourceButton aria-busy="false">测试连接</SourceButton>);
    expect(out).toContain('aria-busy="false"');
    expect(out).not.toContain('data-busy');
  });

  it('默认 type=button，提交由调用方写；轻重三档只换填充与描边的有无', () => {
    expect(html(<SourceButton>登录并连接</SourceButton>)).toContain('type="button"');
    expect(
      html(
        <SourceButton type="submit" variant="primary">
          保存并开始
        </SourceButton>,
      ),
    ).toContain('su-button su-button--primary');
    expect(html(<SourceButton variant="quiet">使用向导</SourceButton>)).toContain(
      'su-button--quiet',
    );
    expect(
      html(
        <SourceButton variant="danger" size="small">
          停用
        </SourceButton>,
      ),
    ).toContain('su-button--danger su-button--small');
  });
});

describe('输入栏与名称块', () => {
  it('invalid=true 才标 aria-invalid，false 时不抹调用方自己传的那一句', () => {
    expect(html(<SourceInput invalid value="" readOnly onChange={() => undefined} />)).toContain(
      'aria-invalid="true"',
    );
    expect(
      html(<SourceInput aria-invalid="false" value="" readOnly onChange={() => undefined} />),
    ).toContain('aria-invalid="false"');
  });

  it('名称走原生 <label htmlFor>，补充与失败串进 aria-describedby', () => {
    const out = html(
      <SourceField label="模型名" hint="可以直接打。" error="模型名不能空着。">
        {({ inputId, describedBy }) => (
          <SourceInput
            id={inputId}
            aria-describedby={describedBy}
            value=""
            readOnly
            onChange={() => undefined}
          />
        )}
      </SourceField>,
    );
    // 名称是一句原生 <label for>，指着控件那一格；补充与失败都在它外面
    expect(out).toMatch(/<label class="su-field__label"[^>]* for="[^"]+-input">模型名<\/label>/);
    expect(out).toMatch(/<input id="[^"]+-input"[^>]*class="su-input"/);
    expect(out).toContain('role="alert"');
    const ids = out.match(/id="([^"]+)"/g) ?? [];
    const described = out.match(/aria-describedby="([^"]+)"/);
    expect(described).not.toBeNull();
    for (const id of (described?.[1] ?? '').split(' ')) {
      expect(ids.map((s) => s.slice(4, -1))).toContain(id);
    }
  });

  it('节点模式整块就是一张 label，不再嵌第二个 label', () => {
    const out = html(<SourceField label="回复语言">一句补充</SourceField>);
    // 整块就是那张 label：里面不能再有第二颗 label 指着不存在的控件
    expect(out).toContain('<label class="su-field__slot">');
    expect(out.match(/<label/g)).toHaveLength(1);
  });
});

describe('开关', () => {
  it('可访问名称只有那一句名称，补充走 aria-describedby', () => {
    const out = html(
      <SourceSwitch
        label="暂时不回应"
        hint="只是让它先不开口。"
        pressed
        onChange={() => undefined}
      />,
    );
    expect(out).toContain('type="checkbox"');
    expect(out).toContain('checked');
    expect(out).toMatch(/aria-labelledby="[^"]+"/);
    const described = out.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(described).toBeDefined();
    expect(out).toContain('id="' + described + '"');
    expect(out).toContain('su-switch__name');
  });

  it('按不动时是原生 disabled，状态同时写在 data-state 上', () => {
    const out = html(
      <SourceSwitch label="跟随日落换夜相" pressed={false} disabled onChange={() => undefined} />,
    );
    expect(out).toContain('disabled=""');
    expect(out).toContain('data-state="off"');
  });
});

describe('选项组（stupid-seahorse-9）', () => {
  it('三挡都是原生 radio 同名，选中那一条 checked；完整名称给读屏，可见两字不再当一次名字', () => {
    const out = html(
      <SourceRadioGroup
        label="明暗"
        name="console-theme"
        value="dark"
        options={[
          { value: 'light', label: '浅色', ariaLabel: '一直浅色' },
          { value: 'dark', label: '黑夜', ariaLabel: '一直黑夜' },
          { value: 'system', label: '系统', ariaLabel: '跟随系统' },
        ]}
        onChange={() => undefined}
      />,
    );
    expect(out.match(/type="radio"/g)).toHaveLength(3);
    expect(out.match(/name="console-theme"/g)).toHaveLength(3);
    expect((out.match(/checked/g) ?? []).length).toBe(1);
    expect(out).toContain('aria-label="一直黑夜"');
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain('<legend');
  });
});

describe('外壳与状态', () => {
  it('段落标题就是这一节的名称（原生 aria-labelledby）', () => {
    const out = html(<SourcePanel title="连接模型">正文</SourcePanel>);
    expect(out).toContain('<section class="su-panel"');
    const labelled = out.match(/aria-labelledby="([^"]+)"/)?.[1];
    expect(labelled).toBeDefined();
    expect(out).toContain('id="' + labelled + '">连接模型');
  });

  it('danger 打断，其余按 live 决定播不播', () => {
    expect(html(<SourceNotice tone="danger">没保存。</SourceNotice>)).toContain('role="alert"');
    expect(html(<SourceNotice tone="ok">已保存。</SourceNotice>)).toContain('role="status"');
    expect(
      html(
        <SourceNotice tone="neutral" live={false}>
          说明一句。
        </SourceNotice>,
      ),
    ).not.toContain('role=');
    expect(html(<SourceStatus tone="ok">在用</SourceStatus>)).toContain('data-tone="ok"');
  });

  it('瓦片选中沿用原件那句反色，未接入的那一枚看得见但点不动', () => {
    expect(html(<SourceTile selected>DeepSeek</SourceTile>)).toContain('data-selected="true"');
    expect(html(<SourceTile selected>DeepSeek</SourceTile>)).toContain('aria-pressed="true"');
    expect(
      html(
        <SourceTile disabled title="这台机器还没接">
          GLM
        </SourceTile>,
      ),
    ).toContain('disabled=""');
  });

  it('字形按 vendored 的那一格画：24 单位网格、线宽 2、有名才报', () => {
    const out = html(<SiteGlyphIcon name="player-play" size={16} label="开始" />);
    expect(out).toContain('viewBox="0 0 24 24"');
    expect(out).toContain('stroke-width="2"');
    expect(out).toContain('role="img"');
    expect(out).toContain('<title>开始</title>');
    // 路径由 morphicons 从 vendored 的 d 采样而来：起点仍是那一条的第一个坐标
    expect(out).toMatch(/<path d="M7 4/i);
    expect(html(<SiteGlyphIcon name="eye" size={16} />)).not.toContain('role="img"');
  });
});
