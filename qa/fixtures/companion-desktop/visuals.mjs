import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

async function inspect(app, pet) {
  const css = await pet.evaluate(() => Object.fromEntries(
    [['html', document.documentElement], ['body', document.body], ['root', document.getElementById('root')]]
      .map(([name, element]) => {
        if (!element) throw new Error('Pet root missing');
        const style = getComputedStyle(element);
        return [name, { backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage, opacity: style.opacity }];
      }),
  ));
  const native = await app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().endsWith('/pet/index.html'));
    if (!window) throw new Error('Pet window missing');
    const image = await window.webContents.capturePage();
    const bitmap = image.toBitmap();
    let zero = 0, opaque = 0, min = 255, max = 0;
    for (let i = 3; i < bitmap.length; i += 4) {
      const alpha = bitmap[i];
      min = Math.min(min, alpha); max = Math.max(max, alpha);
      if (alpha === 0) zero++;
      if (alpha === 255) opaque++;
    }
    return { backgroundColor: window.getBackgroundColor(), size: image.getSize(),
      topLeftAlpha: bitmap[3], minAlpha: min, maxAlpha: max, transparentPixels: zero, opaquePixels: opaque };
  });
  return { css, native };
}

// Tests the production console model UI and actual pet renderer, not a duplicate preview.
export async function visualCase(app, consolePage, pet, shot, onMeasurement = () => {}) {
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().endsWith('/console/index.html'));
    if (!window) throw new Error('Console window missing');
    window.setSize(880, 600);
  });
  await consolePage.getByTestId('nav-start').click();
  const open = consolePage.getByTestId('model-open');
  await expect(open).toBeVisible();
  const before = await inspect(app, pet);
  for (const element of Object.values(before.css)) {
    assert.equal(element.backgroundColor, 'rgba(0, 0, 0, 0)');
    assert.equal(element.backgroundImage, 'none');
  }
  await open.click();
  const dialog = consolePage.locator('dialog[open]').filter({ has: consolePage.locator('.tc-model') });
  await expect(dialog).toBeVisible();
  assert.equal(await dialog.locator('input[type="password"]').count(), 0);
  const footer = dialog.locator('.pk-dialog__footer');
  await expect(footer).toBeVisible();
  const boxes = await consolePage.evaluate(() => {
    const footer = document.querySelector('dialog[open] .pk-dialog__footer');
    if (!footer) throw new Error('Model footer missing');
    const rect = footer.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
      width: innerWidth, height: innerHeight };
  });
  assert.ok(boxes.left >= 0 && boxes.right <= boxes.width && boxes.top >= 0 && boxes.bottom <= boxes.height,
    'model footer must be within the minimum-size viewport');
  const during = await inspect(app, pet);
  assert.deepEqual(during.css, before.css);
  await shot(consolePage, 'model-minimum-window');
  await consolePage.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(open).toBeFocused();
  const after = await inspect(app, pet);
  assert.deepEqual(after.css, before.css);
  for (const value of [before, during, after])
    assert.equal(value.native.topLeftAlpha, 0, 'pet captured bitmap corner must remain transparent');
  const measureSidebar = () => consolePage.evaluate(() => {
    const rail = document.querySelector('[data-testid="settings-sidebar"]');
    const footer = rail?.querySelector('.rail__foot');
    const control = rail?.querySelector('[data-testid="connection-refresh"]');
    const label = control?.querySelector('.pb-run__label');
    const status = rail?.querySelector('.pb-run__state');
    if (!rail || !footer || !control || !label || !status) throw new Error('Sidebar status control missing');
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        width: rect.width, height: rect.height };
    };
    const rect = control.getBoundingClientRect();
    const center = document.elementFromPoint((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2);
    return {
      rail: { ...box(rail), clientWidth: rail.clientWidth, scrollWidth: rail.scrollWidth },
      footer: { ...box(footer), clientWidth: footer.clientWidth, scrollWidth: footer.scrollWidth },
      refresh: { ...box(control), clientWidth: control.clientWidth, scrollWidth: control.scrollWidth,
        centerReceivesPointer: !!center && (center === control || control.contains(center)) },
      label: { ...box(label), text: label.textContent, whiteSpace: getComputedStyle(label).whiteSpace,
        clipPath: getComputedStyle(label).clipPath },
      status: { ...box(status), text: status.textContent, whiteSpace: getComputedStyle(status).whiteSpace,
        textOverflow: getComputedStyle(status).textOverflow, overflow: getComputedStyle(status).overflow },
      iconDisplay: getComputedStyle(control.querySelector('.pb-run__icon')).display,
      ariaLabel: control.getAttribute('aria-label'), title: control.getAttribute('title'),
      viewport: { width: innerWidth, height: innerHeight },
    };
  });
  const sidebar = await measureSidebar();
  onMeasurement('minimumSidebar', sidebar);
  await shot(consolePage, 'minimum-sidebar');
  assert.ok(sidebar.rail.scrollWidth <= sidebar.rail.clientWidth, 'minimum rail overflows horizontally');
  assert.ok(sidebar.footer.left >= sidebar.rail.left && sidebar.footer.right <= sidebar.rail.right,
    'minimum footer leaves rail bounds');
  assert.ok(sidebar.refresh.left >= sidebar.rail.left && sidebar.refresh.right <= sidebar.rail.right &&
    sidebar.refresh.width >= 36 && sidebar.refresh.height >= 36 && sidebar.refresh.centerReceivesPointer,
  'minimum refresh button must be reachable inside the rail');
  assert.equal(sidebar.ariaLabel, '刷新连接状态');
  assert.equal(sidebar.title, '刷新连接状态');
  assert.equal(sidebar.status.whiteSpace, 'nowrap');
  assert.equal(sidebar.status.textOverflow, 'ellipsis');
  assert.equal(sidebar.status.overflow, 'hidden');
  assert.notEqual(sidebar.iconDisplay, 'none');
  assert.ok(sidebar.label.width <= 1 && sidebar.label.height <= 1, 'compact label must not wrap');
  const refresh = consolePage.getByTestId('connection-refresh');
  await consolePage.evaluate(() => {
    window.__companionQaClicks = 0;
    document.querySelector('[data-testid="connection-refresh"]').addEventListener('click', () => { window.__companionQaClicks++; });
  });
  await refresh.focus();
  await expect(refresh).toBeFocused();
  await refresh.press('Enter');
  assert.equal(await consolePage.evaluate(() => window.__companionQaClicks), 1);
  await refresh.click();
  assert.equal(await consolePage.evaluate(() => window.__companionQaClicks), 2);
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().endsWith('/console/index.html'));
    if (!window) throw new Error('Console window missing');
    window.setSize(1200, 800);
  });
  await expect.poll(() => consolePage.evaluate(() => innerWidth)).toBeGreaterThan(980);
  const wideSidebar = await measureSidebar();
  onMeasurement('wideSidebar', wideSidebar);
  await shot(consolePage, 'wide-sidebar');
  assert.ok(wideSidebar.rail.scrollWidth <= wideSidebar.rail.clientWidth, 'wide rail overflows horizontally');
  assert.ok(wideSidebar.refresh.centerReceivesPointer && wideSidebar.label.width > 1 && wideSidebar.label.height > 1,
    'wide refresh text must be visible and reachable');
  assert.equal(wideSidebar.iconDisplay, 'none');
  return { before, during, after, viewport: boxes, sidebar, wideSidebar,
    interpretation: 'Bitmap alpha is recorded as measured; Xvfb without a compositor does not establish Windows desktop transparency.' };
}
