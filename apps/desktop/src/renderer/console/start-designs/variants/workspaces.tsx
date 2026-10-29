/**
 * workspaces「三页工作簿」：一条真实状态栏加三个整宽工作页，各自只剩自己的事。
 *
 * 页签是 kit 的原生单选（pb-choice：一块独立选中板），不是旧的那种滑轨分段。
 * 切换只换内容，不换所有者：模型、草稿、录音会话都在同一份 model 上。
 */
import { useState, type JSX } from 'react';

import { Status } from '../../original-ui/kit.js';
import { START_DESIGN_METAS } from '../catalog.js';

import type { StartContext, StartDesign, StartSlots } from '../contracts.js';

import './workspaces.css';

type PageId = 'connect' | 'pet' | 'theme';

/** 顺序就是这三件事在本机上的依赖顺序：先接上，再看它，最后调颜色。 */
const PAGES: readonly { id: PageId; label: string }[] = [
  { id: 'connect', label: '连接模型' },
  { id: 'pet', label: '我的桌宠' },
  { id: 'theme', label: '界面配色' },
];

export const WORKSPACES_DESIGN: StartDesign = {
  meta: START_DESIGN_METAS.workspaces,
  render(context: StartContext, slots: StartSlots): JSX.Element {
    return <WorkspacesSurface context={context} slots={slots} />;
  },
};

function WorkspacesSurface({
  context,
  slots,
}: {
  context: StartContext;
  slots: StartSlots;
}): JSX.Element {
  const [page, setPage] = useState<PageId>('connect');
  const model = context.model;

  return (
    <section className="sd-workspaces" data-testid="workspaces-layout">
      <div className="sd-workspaces__strip">
        <Status tone={model.desktop.mark === 'on' ? 'on' : 'off'}>{model.desktop.text}</Status>
        <div className="sd-workspaces__status">{slots.status}</div>
      </div>

      <div
        className="sd-workspaces__tabs pb-choice"
        role="radiogroup"
        aria-label="开始页的三个工作页"
      >
        {PAGES.map((item) => (
          <label className="pb-choice__option" key={item.id}>
            <input
              type="radio"
              name="sd-workspaces-page"
              value={item.id}
              checked={item.id === page}
              data-testid={'workspaces-tab-' + item.id}
              onChange={() => setPage(item.id)}
            />
            <span className="pb-choice__text">{item.label}</span>
          </label>
        ))}
      </div>

      <div className="sd-workspaces__page" data-page={page} data-testid={'workspaces-page-' + page}>
        {page === 'connect' ? (
          <>
            {slots.provider}
            {slots.connect}
          </>
        ) : null}
        {page === 'pet' ? slots.pet : null}
        {page === 'theme' ? slots.theme : null}
      </div>
    </section>
  );
}
