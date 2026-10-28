import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PersonaPromptEditor, type PersonaPromptEditorProps } from './persona-prompt-editor.js';

/**
 * 提示词编辑器最要紧的是两句不许说谎：
 * 保存成功不等于已经生效；正文超限不能替用户截断。
 */
const base = {
  draft: '你是小蓝。',
  onChangeDraft: () => undefined,
  onSave: () => undefined,
};

function render(over: Partial<PersonaPromptEditorProps> = {}): string {
  return renderToStaticMarkup(<PersonaPromptEditor {...base} {...over} />);
}

describe('人设完整提示词编辑器', () => {
  it('待生效只说等待，收到 applied 才称已生效', () => {
    const pending = render({ state: 'pending' });
    expect(pending).toContain('等待当前处理结束后生效');
    expect(pending).not.toContain('已生效');
    expect(render({ state: 'applied' })).toContain('已生效');
    expect(render({ state: 'saved' })).toContain('已保存');
  });

  it('还没有结果时不显示生效状态', () => {
    expect(render()).not.toContain('pk-prompt__status');
  });

  it('超限不截断也不提交，并说清上限', () => {
    const html = render({ draft: '啊'.repeat(30), maxLength: 20 });
    expect(html).not.toContain('maxlength');
    expect(html).toContain('超过 20 的上限');
    expect(html).toContain('30 / 20 字符');
    expect(html).toContain('aria-invalid="true"');
    const save = /<button[^>]*>保存正文<\/button>/.exec(html)?.[0];
    expect(save).toBeDefined();
    expect(save).toContain('disabled');
  });

  it('草稿与已保存正文一致时保存是空操作，不同才提示有未保存改动', () => {
    const clean = render({ draft: 'A', saved: 'A' });
    expect(clean).not.toContain('有未保存的改动');
    expect(/<button[^>]*>保存正文<\/button>/.exec(clean)?.[0]).toContain('disabled');
    expect(render({ draft: 'A', saved: 'B' })).toContain('有未保存的改动');
  });

  it('失败原因只出现在正文这一处', () => {
    const html = render({ state: 'error', error: '这条配置已被别处改过，保存被拒绝。' });
    expect(html).toContain('应用失败');
    expect(html).toContain('这条配置已被别处改过');
    expect(html.match(/role="alert"/g)).toHaveLength(1);
  });

  it('只读段按发送顺序原样展示，不给可编辑控件', () => {
    const html = render({
      segments: [
        { id: 'tools', label: '可用工具', text: '本机时间、桌面显隐' },
        {
          id: 'environment',
          label: '运行环境',
          text: '现在是 17:02\n今天还没有对话记录',
          note: '每次发送前由应用填入',
        },
      ],
    });
    expect(html).toContain('实际发出的完整前缀');
    expect(html).toContain('pk-prompt__segment-label">可用工具</span>');
    const block = '<pre class="pk-prompt__segment-text">';
    expect(html).toContain(block + '现在是 17:02\n今天还没有对话记录</pre>');
    expect(html.match(/<textarea/g)).toHaveLength(1);
  });

  it('没有段时不出现空的只读区；没有重新读取能力时也不画这个按钮', () => {
    const html = render();
    expect(html).not.toContain('实际发出的完整前缀');
    expect(html).not.toContain('重新读取');
    expect(render({ onReload: () => undefined })).toContain('重新读取');
  });
});
