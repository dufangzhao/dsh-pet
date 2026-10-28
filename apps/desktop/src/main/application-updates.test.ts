import { expect, it } from 'vitest';
import { ApplicationUpdateDialogs, type ApplicationUpdateState } from './application-updates.js';
it('shows only real updater state and rejects stale or duplicate dialog actions', async () => {
  const ui = new ApplicationUpdateDialogs(() => {});
  expect(ui.dialog()).toBeNull();
  let state: ApplicationUpdateState = {
    phase: 'available',
    version: 'fixture-2',
    summary: 'Fixture release',
  };
  let emit = () => {};
  let downloads = 0,
    installs = 0;
  ui.bind({
    current: () => state,
    subscribe: (listener) => {
      emit = listener;
      return () => {};
    },
    download: async () => {
      downloads++;
      state = { phase: 'downloading', version: 'fixture-2' };
      emit();
    },
    install: async () => {
      installs++;
      state = { phase: 'completed', version: 'fixture-2' };
      emit();
    },
  });
  const available = ui.dialog()!;
  expect(await ui.answer(available.id, available.step, 'install')).toBe(false);
  expect(await ui.answer(available.id, available.step, 'download')).toBe(true);
  expect(downloads).toBe(1);
  expect(await ui.answer(available.id, available.step, 'download')).toBe(false);
  expect(ui.dialog()?.text).toBe('更新包正在下载。');
  state = { phase: 'downloading', version: 'fixture-2', percent: 35 };
  emit();
  expect(ui.dialog()?.text).toBe('已下载 35%');
  state = { phase: 'failed', version: 'fixture-2', message: 'Fixture failure' };
  emit();
  expect(ui.dialog()?.choices[0]?.label).toBe('重试');
  state = { phase: 'ready', version: 'fixture-2' };
  emit();
  const ready = ui.dialog()!;
  expect(await ui.answer(ready.id, ready.step, 'install')).toBe(true);
  expect(installs).toBe(1);
  expect(ui.dialog()?.title).toBe('更新已完成');
  ui.close();
  expect(ui.dialog()).toBeNull();
});
