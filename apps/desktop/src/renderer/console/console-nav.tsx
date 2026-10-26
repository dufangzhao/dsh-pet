import type { JSX } from 'react';

import { NAV_TEST_IDS, PAGE_TITLES, PAGES, type PageId } from './pages.js';

export interface ConsoleNavProps {
  current: PageId;
  onSelect: (page: PageId) => void;
}

/** 侧栏导航：真实按钮，当前页用 aria-current="page" 标出，Tab 顺序与视觉顺序一致。 */
export function ConsoleNav({ current, onSelect }: ConsoleNavProps): JSX.Element {
  return (
    <nav className="console-nav" aria-label="设置页导航">
      <ul className="console-nav__list">
        {PAGES.map((page) => (
          <li key={page}>
            <button
              type="button"
              className="console-nav__button"
              data-testid={NAV_TEST_IDS[page]}
              aria-current={page === current ? 'page' : undefined}
              onClick={() => onSelect(page)}
            >
              {PAGE_TITLES[page]}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
