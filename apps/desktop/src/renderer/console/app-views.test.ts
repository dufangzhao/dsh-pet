import type { ApplicationPage, OwnerRef } from '@pet/contracts';
import { APPLICATION_PLUGIN_IDS } from '@pet/contracts';
import { describe, expect, it } from 'vitest';

import {
  RECOVERY_ITEMS,
  appViewOf,
  navItemsOf,
  resolveSelection,
  saveChoice,
} from './app-views.js';
import type { ApplicationState } from './use-application.js';

/** 页面来自宿主：这里只断言识别、顺序与撤回后的落点，不写死七个页面。 */
const owner = (pluginId: string): OwnerRef => ({ pluginId, instanceId: 'i1', generation: 1 });

function page(over: Partial<ApplicationPage> & { id: string }): ApplicationPage {
  return {
    id: over.id,
    owner: over.owner ?? owner('pet.page-' + over.id),
    title: over.title ?? over.id,
    order: over.order ?? 0,
    manifest: over.manifest ?? {},
  };
}

describe('应用页面识别', () => {
  it('按 manifest 的 panels[].builtin 认出应用视图', () => {
    const view = (builtin: string) =>
      appViewOf(page({ id: 'whatever', manifest: { panels: [{ builtin }] } }));
    expect(view('pet.persona')).toBe('persona');
    expect(view('pet.voice')).toBe('voice');
  });

  it('没有 panels 时按页面插件 id 认；两个都不认识就是通用配置页', () => {
    expect(appViewOf(page({ id: 'x', owner: owner('pet.page-appearance') }))).toBe('appearance');
    expect(appViewOf(page({ id: APPLICATION_PLUGIN_IDS.voice }))).toBe('voice');
    expect(
      appViewOf(
        page({
          id: 'other',
          owner: owner('community.translator'),
          manifest: { panels: [{ title: '翻译' }] },
        }),
      ),
    ).toBe('generic');
  });

  it('图标按视图给语义，认不出的外部页只给通用格子', () => {
    const items = navItemsOf([
      page({ id: 'p', order: 10, manifest: { panels: [{ builtin: 'pet.persona' }] } }),
      page({ id: 'community', order: 20, owner: owner('community.translator') }),
    ]);
    expect(items.map((item) => item.icon)).toEqual(['bot', 'panel']);
    expect(RECOVERY_ITEMS.map((item) => item.icon)).toEqual(['puzzle', 'info']);
  });

  it('导航顺序跟着宿主的 order，不是本机数组顺序', () => {
    const items = navItemsOf([page({ id: 'voice', order: 30 }), page({ id: 'start', order: 10 })]);
    expect(items.map((item) => item.id)).toEqual(['start', 'voice']);
  });

  it('选项保存成功不弹全局提示，失败照旧说原因', async () => {
    const messages: string[] = [];
    const notify = (message: string): void => {
      messages.push(message);
    };
    // 只有 save 被用到；其余字段与这次行为无关。
    const appWith = (save: ApplicationState['save']): ApplicationState =>
      ({ save }) as unknown as ApplicationState;

    await saveChoice(
      appWith(async () => ({ ok: true, error: null })),
      notify,
      { palette: 'pine' },
    );
    // 连点形态/配色/大小不该堆一串“已保存。”。
    expect(messages).toEqual([]);

    await saveChoice(
      appWith(async () => ({ ok: false, error: '这条偏好已被别处改过。' })),
      notify,
      { palette: 'pine' },
    );
    expect(messages).toEqual(['这个选择没有写进去：这条偏好已被别处改过。']);
  });

  it('当前页被撤回时落到扩展；用户还没选过时落在第一个日常页', () => {
    const items = [...navItemsOf([page({ id: 'start', order: 10 })]), ...RECOVERY_ITEMS];
    expect(resolveSelection(items, null)).toBe('start');
    expect(resolveSelection(items, 'persona')).toBe('plugins');
    expect(resolveSelection(items, 'about')).toBe('about');
  });
});
