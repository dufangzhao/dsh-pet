/**
 * 风格家族评审入口：一次一家的**整扇窗**，上面只有一条中立的评审横栏。
 *
 * 这里不画任何一家的板面，也不把某家已经画好的外壳借来当别人的框：横栏与说明行用字面颜色，
 * 不吃 pb 令牌，也不吃那 36 格——评审入口本身不能把某一家的样子冒充成通用底。
 * 没交付的那一家是禁用的，写清楚为什么；换家族不换 model，正在输入的模型名与 Key 不丢。
 *
 * 只在未打包的 --start-design-lab 实例里出现，并且由 console-app 作为**根分支**渲染：
 * 这条路上不挂设置台外壳（侧栏、页头、页脚都不在），正常入口一个像素都不变。
 */
import { useState, type JSX } from 'react';

import { failureLine } from '../start-designs/behavior.js';
import type { StartOwners } from '../start-designs/use-start-model.js';
import { useStartModel } from '../start-designs/use-start-model.js';

import type { StyleFamily, StyleFamilyId } from './contracts.js';
import {
  PENDING_NOTE,
  REVIEW_DEFAULT_FAMILY,
  STYLE_FAMILIES,
  STYLE_FAMILY_ORDER,
  deliveredFamilyIds,
  familySelectorId,
  resolveFamily,
} from './registry.js';

/** 角色本体那一份样式：引一次，五家都有，不必各自再抄。 */
import './character.css';
import './gallery.css';

export type FamilyView = 'start' | 'board';

export interface StyleFamilyGalleryProps {
  /** 全场那几个所有者：模型连接、录音会话、应用偏好、提示与路由，一个都不新建。 */
  readonly owners: StartOwners;
  /** 默认落点；那一家还没交付时落到第一个真的能看的，别让评审对着空壳。 */
  readonly initial?: StyleFamilyId;
  /** 回到「排法对照」：旧的五种摆放是排法，不是风格，从这里看一眼再回来。 */
  readonly onOpenLayouts?: () => void;
}

/** 这一家能不能看：有组件才算。 */
export function familyReady(families: readonly StyleFamily[], id: StyleFamilyId): boolean {
  return resolveFamily(families, id)?.Component !== null;
}

/**
 * 打开时落在哪一家（纯函数，测试直接读）：指定的那一家能看就用它，
 * 否则用第一个能看的；一家都没交就保留指定值，让说明行把「都没交」如实讲出来。
 */
export function pickInitialFamily(
  families: readonly StyleFamily[],
  initial: StyleFamilyId,
): StyleFamilyId {
  if (familyReady(families, initial)) return initial;
  for (const id of STYLE_FAMILY_ORDER) {
    if (familyReady(families, id)) return id;
  }
  return initial;
}

export function StyleFamilyGallery({
  owners,
  initial = REVIEW_DEFAULT_FAMILY,
  onOpenLayouts,
}: StyleFamilyGalleryProps): JSX.Element {
  // 状态与动作只有这一份：换家族、换视图都不重新读宿主。
  const model = useStartModel(owners);
  const [familyId, setFamilyId] = useState<StyleFamilyId>(() =>
    pickInitialFamily(STYLE_FAMILIES, initial),
  );
  const [board, setBoard] = useState(false);
  const [guiding, setGuiding] = useState(false);

  const family: StyleFamily = resolveFamily(STYLE_FAMILIES, familyId) ?? STYLE_FAMILIES[0];
  const Component = family.Component;
  const delivered = deliveredFamilyIds(STYLE_FAMILIES);
  const view: FamilyView = board ? 'board' : 'start';

  /**
   * 「使用向导」的动作只有这一份：应用所有者与提示通道都在这层，家族拿到的是成品节点。
   * 它落在哪一颗按钮上、写什么字，由那一家自己决定（拿到就摆，没摆就看不见）。
   */
  const runGuide = (): void => {
    setGuiding(true);
    void owners.app.startGuide().then((outcome) => {
      setGuiding(false);
      owners.notify(
        outcome.ok ? '引导已经在桌宠那边开始。' : failureLine(outcome.error ?? '未知原因'),
        outcome.ok ? 'ok' : 'danger',
      );
    });
  };
  const guide = (
    <button
      type="button"
      className="sf-guide"
      disabled={!owners.app.available || owners.app.saving || guiding}
      title="由桌宠在桌面上再走一遍"
      data-testid="start-guide"
      onClick={runGuide}
    >
      {guiding ? '正在叫桌宠开始…' : '使用向导'}
    </button>
  );

  return (
    <div
      className="sf-gallery"
      data-testid="style-family-gallery"
      data-family={family.id}
      data-view={view}
    >
      <header className="sf-chrome">
        <span className="sf-chrome__label">风格方案</span>
        <span className="sf-chrome__families" role="radiogroup" aria-label="选一种风格">
          {STYLE_FAMILY_ORDER.map((id) => {
            const candidate = resolveFamily(STYLE_FAMILIES, id);
            const ready = candidate !== null && candidate.Component !== null;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={id === family.id}
                className={id === family.id ? 'sf-chrome__pick is-on' : 'sf-chrome__pick'}
                disabled={!ready}
                title={ready && candidate !== null ? candidate.description : PENDING_NOTE}
                data-testid={familySelectorId(id)}
                onClick={() => setFamilyId(id)}
              >
                {candidate === null ? id : candidate.name}
              </button>
            );
          })}
        </span>
        <span className="sf-chrome__views" role="radiogroup" aria-label="看这一种风格的哪一面">
          <button
            type="button"
            role="radio"
            aria-checked={!board}
            className={board ? 'sf-chrome__view' : 'sf-chrome__view is-on'}
            data-testid="style-view-start"
            onClick={() => setBoard(false)}
          >
            Start 视图
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={board}
            className={board ? 'sf-chrome__view is-on' : 'sf-chrome__view'}
            data-testid="style-view-board"
            onClick={() => setBoard(true)}
          >
            控件与状态
          </button>
        </span>
        <span className="sf-chrome__count" data-testid="style-family-count">
          {delivered.length + ' / ' + STYLE_FAMILY_ORDER.length + ' 种风格'}
        </span>
        {onOpenLayouts === undefined ? null : (
          <button
            type="button"
            className="sf-chrome__link"
            data-testid="style-open-layouts"
            onClick={onOpenLayouts}
          >
            排法对照（旧五种摆放，不是风格方案）
          </button>
        )}
      </header>

      <p className="sf-chrome__note" data-testid="style-family-note">
        {family.name + ' — ' + family.description}
      </p>

      <section className="sf-stage" data-testid="style-family-stage">
        {Component === null ? (
          <p className="sf-pending" data-testid="style-family-missing">
            {family.name + '：' + PENDING_NOTE}
          </p>
        ) : (
          /* key 按家族打：换一家就是重挂，呈现种子与试色跟着重来，不把上一家的草稿带过去。 */
          <div
            className="sf-window"
            data-testid="style-family-root"
            data-family={family.id}
            data-view={view}
            key={family.id}
          >
            <Component model={model} board={board} guide={guide} />
          </div>
        )}
      </section>
    </div>
  );
}
