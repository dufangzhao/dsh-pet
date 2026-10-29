/**
 * 三页工作簿：一条真实状态，三个整宽工作页，每一页只剩自己的事。
 *
 * 页签是本地 React 状态，不写进 URL——宿主要校验来源，改地址既不会多出一个可分享的状态，
 * 也会让「这一页真的能打开」变成假话。切换用原生 radio（沿用设置台已有的分段控件词汇），
 * 方向键、焦点环与读屏播报都是白来的。
 *
 * 只渲染当前那一页：离开「界面配色」就是真的离开，主题工作室按它自己的规则撤掉未保存的试色；
 * 录音与会话不在这里，它们由设置台唯一的所有者持有，切页不打断正在录的那一段。
 * 模型草稿与上一条测试回执也一样住在 StartContext 与插槽手里，换页不丢。
 * 「使用向导」由外壳标题行给（console-app 那一颗），这里不画第二颗，插槽 guide 不使用。
 */
import { useState, type CSSProperties, type JSX } from 'react';

import type { StartContext, StartDesign, StartSlots } from '../contracts.js';
import { START_DESIGN_METAS } from '../catalog.js';
import { LabIcon, LAB_GLYPHS } from '../lab-icons.js';
import { petDesktopState } from '../sections.js';

import './workspaces.css';

type PageId = 'connect' | 'pet' | 'theme';

/** 顺序就是这三件事在本机上的依赖顺序：先接上，再看它，最后调颜色。 */
const PAGES: readonly { id: PageId; label: string }[] = [
  { id: 'connect', label: '连接模型' },
  { id: 'pet', label: '我的桌宠' },
  { id: 'theme', label: '界面配色' },
];

function WorkspacesSurface({
  context,
  slots,
}: {
  context: StartContext;
  slots: StartSlots;
}): JSX.Element {
  const [page, setPage] = useState<PageId>('connect');
  const desk = petDesktopState(context.app);
  // 与应用里那项「减少动画」一致：状态照旧说，形状直接跳到位。
  const motionReduced = context.app.values?.reducedMotion ?? false;
  const index = PAGES.findIndex((item) => item.id === page);

  return (
    <section className="sd-workspaces" data-testid="workspaces-layout">
      <div className="sd-workspaces__strip">
        {/* 桌面上有没有这一只：宿主报的那一句，不必进页签就能知道；形状与其他版式共用。 */}
        <span className="sd-workspaces__presence" data-tone={desk.tone}>
          <LabIcon
            glyph={LAB_GLYPHS.desktop}
            active={desk.tone !== 'on'}
            motionReduced={motionReduced}
            size={16}
          />
          {desk.text}
        </span>
        <div className="sd-workspaces__status">{slots.status}</div>
      </div>

      <div
        className="sd-workspaces__tabs console-segmented"
        role="radiogroup"
        aria-label="开始页的三个工作页"
        data-testid="workspaces-tabs"
        style={{ '--segment-index': index } as CSSProperties}
      >
        <span className="console-segmented__thumb" aria-hidden="true" />
        {PAGES.map((item) => (
          <label key={item.id} className="console-segmented__option">
            <input
              type="radio"
              name="sd-workspaces-page"
              checked={item.id === page}
              data-testid={'workspaces-tab-' + item.id}
              onChange={() => setPage(item.id)}
            />
            <span className="console-segmented__text">{item.label}</span>
          </label>
        ))}
      </div>

      <div className="sd-workspaces__page" data-page={page} data-testid={'workspaces-page-' + page}>
        {page === 'connect' ? (
          <>
            {slots.vendors}
            {slots.connect}
          </>
        ) : null}
        {page === 'pet' ? slots.pet : null}
        {page === 'theme' ? slots.theme : null}
      </div>
    </section>
  );
}

/** 版式本体：render 不是组件，有状态的绘制交给下面这一个函数组件。 */
export const WORKSPACES_DESIGN: StartDesign = {
  meta: START_DESIGN_METAS.workspaces,
  render(context: StartContext, slots: StartSlots): JSX.Element {
    return <WorkspacesSurface context={context} slots={slots} />;
  },
};
