import { expect } from '@playwright/test';

// Locators are taken from the actual evolving shared PersonaMemory component; reconfirm at UI freeze.
// These helpers do not replace the renderer, hook, preload, Main handler or service.
export function personaMemoryControls(page) {
  const root = page.locator('[aria-label="人格与记忆"]');
  return {
    root,
    name: root.getByTestId('profile-name'), persona: root.getByTestId('profile-persona'),
    saveProfile: root.getByTestId('profile-save'), profileApplied: root.getByTestId('profile-applied'),
    profileMoved: root.getByTestId('profile-moved'), memoryMoved: root.getByTestId('memory-moved'),
    key: root.getByTestId('memory-key'), value: root.getByTestId('memory-value'),
    saveMemory: root.getByTestId('memory-save'), forgetConfirm: root.getByTestId('forget-confirm'),
    forgetCancel: root.getByTestId('forget-cancel'),
    row: (key) => root.getByTestId('memory-row').filter({ has: page.getByText(key, { exact: true }) }),
  };
}

// Counts real DOM insertions while the actual operation's HTTP response is gated.
export async function beginMovedNoticeWatch(page) {
  await page.evaluate(() => {
    if (window.__m3QaNoticeWatch) throw new Error('Notice watch already active');
    const counts = { profile: 0, memory: 0 };
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        for (const [key, id] of [['profile', 'profile-moved'], ['memory', 'memory-moved']]) {
          const selector = `[data-testid="${id}"]`;
          if (node.matches(selector) || node.querySelector(selector)) counts[key]++;
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.__m3QaNoticeWatch = { counts, observer };
  });
  return async () => page.evaluate(() => {
    const watch = window.__m3QaNoticeWatch;
    if (!watch) throw new Error('Notice watch missing');
    watch.observer.disconnect();
    delete window.__m3QaNoticeWatch;
    return watch.counts;
  });
}

export async function openForgetConfirmation(page, key) {
  const control = personaMemoryControls(page);
  const row = control.row(key);
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: '忘记', exact: true }).click();
  const confirm = page.getByRole('group', { name: `确认忘记 ${key}` });
  await expect(confirm).toContainText('当前记忆');
  await expect(confirm).toContainText('对话记录与日志保留');
  return { confirm, row, control };
}
