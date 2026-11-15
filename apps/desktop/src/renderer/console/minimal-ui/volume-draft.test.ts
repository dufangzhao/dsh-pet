import { describe, expect, it } from 'vitest';
import {
  adoptVolume,
  commitVolume,
  editVolume,
  EMPTY_VOLUME,
  volumeFacts,
} from './volume-draft.js';

/**
 * 真实场景：用户把 85 拖到 42 但没保存，外部窗口把音量存成 30。
 * 草稿必须保留 42，并且要求显式采用最新值——不能被抹成 30，
 * 也不能偷偷用最新 revision 提交把 30 覆盖掉。
 */
describe('本机音量草稿', () => {
  it('外部更新不抹掉用户未保存的草稿', () => {
    // revision 3 时用户拖到 42。
    let state = editVolume(EMPTY_VOLUME, 3, 42);
    expect(volumeFacts(state, 85, 3)).toMatchObject({
      value: 42,
      dirty: true,
      externalChange: false,
    });
    // 外部把已存值改成 30，revision 升到 4。
    const facts = volumeFacts(state, 30, 4);
    expect(facts.value).toBe(42);
    expect(facts.dirty).toBe(true);
    expect(facts.externalChange).toBe(true);
    // 保存仍用**捕获的** revision 3，不借最新的 4。
    expect(facts.expectedRevision).toBe(3);
    state = adoptVolume();
    expect(volumeFacts(state, 30, 4)).toMatchObject({
      value: 30,
      dirty: false,
      externalChange: false,
    });
  });

  it('没有草稿时始终跟随已存值', () => {
    expect(volumeFacts(EMPTY_VOLUME, 85, 1)).toMatchObject({
      value: 85,
      dirty: false,
      externalChange: false,
      expectedRevision: null,
    });
    // 外部把 85 改成 30，没草稿就直接跟随。
    expect(volumeFacts(EMPTY_VOLUME, 30, 2).value).toBe(30);
  });

  it('保存成功后回到跟随已存值', () => {
    const editing = editVolume(EMPTY_VOLUME, 3, 42);
    expect(volumeFacts(editing, 42, 4)).toMatchObject({ value: 42, dirty: false });
    // commit 之后即使 revision 又变，也跟随新值。
    const after = commitVolume();
    expect(volumeFacts(after, 55, 5)).toMatchObject({
      value: 55,
      dirty: false,
      externalChange: false,
      expectedRevision: null,
    });
  });

  it('外部更新后继续拖动仍保留首次编辑基线，只有显式采用才换基线', () => {
    const editing = editVolume(EMPTY_VOLUME, 3, 42);
    expect(volumeFacts(editing, 30, 4)).toMatchObject({
      value: 42,
      externalChange: true,
      expectedRevision: 3,
    });
    const continued = editVolume(editing, 4, 41);
    expect(volumeFacts(continued, 30, 4)).toMatchObject({
      value: 41,
      dirty: true,
      externalChange: true,
      expectedRevision: 3,
    });
    const adopted = editVolume(adoptVolume(), 4, 40);
    expect(volumeFacts(adopted, 30, 4)).toMatchObject({
      value: 40,
      externalChange: false,
      expectedRevision: 4,
    });
  });

  it('外部改动与自己草稿值相同时不算冲突', () => {
    // 用户拖到 42，外部也刚好存成 42：数值一致就不必逼用户二选一。
    const state = editVolume(EMPTY_VOLUME, 3, 42);
    expect(volumeFacts(state, 42, 4)).toMatchObject({
      value: 42,
      dirty: false,
      externalChange: false,
    });
  });
});
