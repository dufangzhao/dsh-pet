import type { ModelConnectionSnapshot, ModelService } from '@pet/contracts';
import { describe, expect, it } from 'vitest';

import type { ModelSaveResult } from '../use-model-connection.js';
import {
  canSave,
  canSignIn,
  canTest,
  desktopPresence,
  keyBlockReason,
  keySavedFor,
  micBlockReason,
  activeNote,
  draftDiffers,
  providerMark,
  providerNote,
  providerRowsOf,
  resolvePicked,
  saveBlockReason,
  saveReceiptOf,
  searchRows,
  sectionPhase,
  signInLine,
  testBlockReason,
} from './behavior.js';

const service = (over: Partial<ModelService> & { id: string; service: string }): ModelService => ({
  label: over.id,
  region: 'global',
  defaultModel: 'm-1',
  models: ['m-1'],
  keyHint: '粘贴 API Key',
  keyUrl: 'https://example.invalid/keys',
  auth: 'api-key',
  available: true,
  ...over,
});

const snapshot = (over: Partial<ModelConnectionSnapshot> = {}): ModelConnectionSnapshot => ({
  revision: 1,
  services: [],
  endpoints: [],
  active: null,
  paused: false,
  credentialStorageAvailable: true,
  ...over,
});

/** 基线验证过的判断，五种排法都必须共用同一套：这里锁住规则本身。 */
describe('保存与测试的判断', () => {
  const deepseek = service({ id: 'deepseek', service: 'deepseek' });

  it('Key 留空只有填在用的那一家时才放行', () => {
    const base = { saving: false, picked: deepseek, model: 'm-1', key: '' };
    expect(canSave({ ...base, inUse: true })).toBe(true);
    expect(saveBlockReason({ ...base, inUse: false })).toMatch('还没有可用的 Key');
  });

  it('写入在飞、这家没接进来、模型名空着都不放行', () => {
    const ok = { picked: deepseek, model: 'm-1', key: 'sk-x', inUse: false };
    expect(canSave({ ...ok, saving: true })).toBe(false);
    expect(
      canSave({
        ...ok,
        saving: false,
        picked: service({
          id: 'x',
          service: 'x',
          available: false,
          unavailableReason: '扩展没启用',
        }),
      }),
    ).toBe(false);
    expect(canSave({ ...ok, saving: false, model: '  ' })).toBe(false);
  });

  it('没读到目录时不猜一家能保存', () => {
    expect(
      saveBlockReason({ saving: false, picked: undefined, model: 'm', key: 'k', inUse: false }),
    ).toMatch('还没读到');
  });

  it('测试连接只对在用那一家开放，且不并发第二次点击', () => {
    expect(canTest({ hasActive: false, testing: false })).toBe(false);
    expect(canTest({ hasActive: true, testing: false })).toBe(true);
    expect(canTest({ hasActive: true, testing: true })).toBe(false);
    expect(testBlockReason({ hasActive: false, testing: false })).toMatch('先保存一家');
  });

  it('浏览器登录：进行中不重复点，未接入不放行', () => {
    expect(canSignIn({ signingIn: false, available: true })).toBe(true);
    expect(canSignIn({ signingIn: true, available: true })).toBe(false);
    expect(canSignIn({ signingIn: false, available: false })).toBe(false);
  });
});

describe('Key 那一栏的真实原因', () => {
  it('还没读到配置与本机存不住是两句话', () => {
    expect(keyBlockReason(null)).toMatch('还没读到');
    expect(keyBlockReason(snapshot({ credentialStorageAvailable: false }))).toMatch(
      '凭据存储不可用',
    );
    expect(keyBlockReason(snapshot())).toBeNull();
  });

  it('本机存过 Key 读宿主的 endpoint 记录，不靠输入框有没有字', () => {
    const snap = snapshot({ endpoints: [{ id: 'deepseek', model: 'm', keyConfigured: true }] });
    expect(keySavedFor(snap, 'deepseek')).toBe(true);
    expect(keySavedFor(snap, 'other')).toBe(false);
    expect(keySavedFor(snap, undefined)).toBe(false);
  });

  /** native 抓到的假推断：默认配置记录在场，但凭据没存过。 */
  it('有默认端点记录不等于有 Key：keyConfigured=false 就是没存过', () => {
    const withDefaultOnly = snapshot({
      endpoints: [{ id: 'deepseek', model: 'deepseek-flash', keyConfigured: false }],
    });
    expect(keySavedFor(withDefaultOnly, 'deepseek')).toBe(false);
    expect(providerMark({ available: true, inUse: false, current: true, keySaved: false })).toBe(
      'draft',
    );
    expect(providerMark({ available: true, inUse: false, current: false, keySaved: false })).toBe(
      'available',
    );
    // 真存过凭据才轮到"存过优先于当前"
    expect(providerMark({ available: true, inUse: false, current: true, keySaved: true })).toBe(
      'saved',
    );
  });
});

describe('目录归组、搜索与选中', () => {
  const catalog = [
    service({ id: 'deepseek', service: 'deepseek' }),
    service({ id: 'qwen', service: 'qwen', region: 'cn', models: ['qwen3.8-max'] }),
    service({ id: 'qwen-intl', service: 'qwen', region: 'intl', models: ['qwen3.8-max'] }),
    service({ id: 'kimi', service: 'kimi', region: 'cn' }),
    service({ id: 'kimi-intl', service: 'kimi', region: 'intl' }),
  ];

  it('五家两块平台归成三家，中国大陆那块当 main', () => {
    const rows = providerRowsOf(catalog);
    expect(rows.map((row) => row.name)).toEqual(['deepseek', 'qwen', 'kimi']);
    expect(rows[1]?.main.id).toBe('qwen');
    expect(rows[1]?.alt?.id).toBe('qwen-intl');
  });

  it('先读到 intl 也换得过来，不丢服务', () => {
    const rows = providerRowsOf([
      service({ id: 'glm-intl', service: 'glm', region: 'intl' }),
      service({ id: 'glm', service: 'glm', region: 'cn' }),
    ]);
    expect(rows[0]?.main.id).toBe('glm');
    expect(rows[0]?.alt?.id).toBe('glm-intl');
  });

  it('搜索命中名称、标识与模型名；空白就是整份', () => {
    const rows = providerRowsOf(catalog);
    expect(searchRows(rows, '  ')).toHaveLength(3);
    expect(searchRows(rows, 'KIMI').map((row) => row.name)).toEqual(['kimi']);
    expect(searchRows(rows, 'qwen3.8-max').map((row) => row.name)).toEqual(['qwen']);
    expect(searchRows(rows, '不存在的名字')).toHaveLength(0);
  });

  it('点过的优先，其次在用的，再次第一家接得进来的', () => {
    const rows = providerRowsOf(catalog);
    expect(resolvePicked(rows, 'kimi-intl', 'qwen')?.id).toBe('kimi-intl');
    expect(resolvePicked(rows, null, 'qwen')?.id).toBe('qwen');
    expect(
      resolvePicked(
        providerRowsOf([service({ id: 'off', service: 'off', available: false })]),
        null,
        null,
      )?.id,
    ).toBe('off');
  });
});

describe('一行该怎么标与整体读到的是什么', () => {
  const kimi = service({ id: 'kimi', service: 'kimi' });
  const off = { ...kimi, available: false };

  it('未接入、在用、当前挑了、存过 Key、可挑：五种含义不合并', () => {
    expect(providerMark({ available: false, inUse: false, current: true, keySaved: true })).toBe(
      'unavailable',
    );
    expect(providerMark({ available: true, inUse: true, current: true, keySaved: true })).toBe(
      'in-use',
    );
    expect(providerMark({ available: true, inUse: false, current: true, keySaved: false })).toBe(
      'draft',
    );
    expect(providerMark({ available: true, inUse: false, current: false, keySaved: true })).toBe(
      'saved',
    );
    expect(providerMark({ available: true, inUse: false, current: false, keySaved: false })).toBe(
      'available',
    );
    expect(off.id).toBe('kimi');
  });

  /** QA21dc 的真状态缺陷：Key 已写进本机、那次探测被网络拒（active 仍是 null）。 */
  it('真实已存的状态排在"是不是当前"前面：存过 Key 就不许说"还没保存"', () => {
    expect(providerMark({ available: true, inUse: false, current: true, keySaved: true })).toBe(
      'saved',
    );
    expect(providerNote('saved', 'api-key')).toBe('本机存过 Key，填新的会覆盖');
    expect(providerNote('saved', 'api-key')).not.toMatch('还没保存');
    expect(draftDiffers({ model: 'deepseek-flash' }, 'deepseek-flash', '')).toBe(false);
    expect(draftDiffers({ model: 'deepseek-flash' }, 'deepseek-chat', '')).toBe(true);
    expect(draftDiffers({ model: 'deepseek-flash' }, 'deepseek-flash', 'sk-new')).toBe(true);
    expect(draftDiffers(null, '', '')).toBe(false);
    expect(draftDiffers(null, 'deepseek-flash', '')).toBe(true);
    expect(providerNote('saved', 'api-key', true)).toBe('本机存过 Key，这次改动还没保存');
    expect(providerNote('in-use', 'api-key', true)).toBe('在用，这次改动还没保存');
  });

  it('「挑了，还没保存」只属于当前且本机还没存过的那一家；没挑中的说"可选"', () => {
    expect(providerNote('draft', 'api-key')).toBe('挑了，还没保存');
    expect(providerNote('available', 'api-key')).toBe('可选，填 API Key');
    expect(providerNote('available', 'browser')).toBe('可选，用浏览器登录');
    expect(providerNote('in-use', 'api-key')).toBe('在用');
  });

  it('「现在在用」分三档：这一家 / 没有在用 / 在用者是别家', () => {
    expect(
      activeNote({ receiptActive: true, activeId: 'kimi', activeLabel: 'Kimi', writtenId: 'kimi' }),
    ).toEqual({ tone: 'on', text: '就是这一家' });
    expect(
      activeNote({ receiptActive: false, activeId: null, activeLabel: null, writtenId: 'kimi' }),
    ).toEqual({ tone: 'off', text: '当前没有在用连接' });
    const other = activeNote({
      receiptActive: false,
      activeId: 'qwen',
      activeLabel: '通义千问',
      writtenId: 'kimi',
    });
    expect(other.tone).toBe('warn');
    expect(other.text).toBe('在用的是通义千问');
    // 写入时就是这一家、此刻仍在用：不许退成"别的一家"
    expect(
      activeNote({ receiptActive: false, activeId: 'kimi', activeLabel: 'Kimi', writtenId: 'kimi' })
        .tone,
    ).toBe('on');
  });
  it('桥在不在、在读、没接过、存过没在用、在用与暂停，各是一个值', () => {
    expect(sectionPhase(false, null, false, null)).toBe('no-bridge');
    expect(sectionPhase(true, null, true, null)).toBe('loading');
    expect(sectionPhase(true, null, false, '读不到')).toBe('read-failed');
    expect(sectionPhase(true, snapshot(), false, null)).toBe('nothing-yet');
    expect(
      sectionPhase(
        true,
        snapshot({ endpoints: [{ id: 'kimi', model: 'm', keyConfigured: true }] }),
        false,
        null,
      ),
    ).toBe('saved-only');
    expect(
      sectionPhase(
        true,
        snapshot({ active: { id: 'kimi', model: 'm', label: 'Kimi' } }),
        false,
        null,
      ),
    ).toBe('in-use');
    expect(
      sectionPhase(
        true,
        snapshot({ active: { id: 'kimi', model: 'm', label: 'Kimi' }, paused: true }),
        false,
        null,
      ),
    ).toBe('in-use-paused');
  });
});

describe('回执的三条事实分开存', () => {
  const result = (over: Partial<ModelSaveResult>): ModelSaveResult => ({
    saved: true,
    ok: true,
    error: null,
    test: { ok: true, elapsedMs: 12 },
    activeId: 'kimi',
    ...over,
  });

  it('写进本机、探测通过、正在用它是三句分别的话', () => {
    const receipt = saveReceiptOf(result({}), 'kimi');
    expect(receipt).toMatchObject({ saved: true, tested: true, active: true });
    expect(receipt.text).toBe('已连接，桌宠开始接话。');
  });

  it('保存成功但探测没过：tested 与 active 都不许亮', () => {
    const receipt = saveReceiptOf(
      result({ ok: false, test: { ok: false, elapsedMs: null, reason: '鉴权失败' } }),
      'kimi',
    );
    expect(receipt.saved).toBe(true);
    expect(receipt.tested).toBe(false);
    expect(receipt.text).toMatch('鉴权失败');
  });

  it('写进去了但在用的是别的一家：active 为假', () => {
    const receipt = saveReceiptOf(result({ activeId: 'other' }), 'kimi');
    expect(receipt.active).toBe(false);
    expect(receipt.text).toMatch('另一个端点');
  });

  it('没写进去就三条都不亮', () => {
    const receipt = saveReceiptOf(result({ saved: false, error: '桥拒绝', test: null }), 'kimi');
    expect(receipt).toMatchObject({ saved: false, tested: false, active: false });
  });

  it('登录的 waiting 不是失败也不是成功', () => {
    expect(signInLine('waiting', false)).toMatch('不算已连接');
    expect(signInLine('failed', false)).toBe('登录没有完成。');
    expect(signInLine('done', true)).toMatch('读到登录完成');
    expect(signInLine(undefined, false)).toBeNull();
  });
});

describe('桌宠与录音的真实一句话', () => {
  it('读不到、暂停、没配识别模型是三件不同的事', () => {
    expect(micBlockReason(null)).toBe('正在读取录音状态');
    expect(micBlockReason({ paused: true, canRecord: true })).toMatch('已暂停');
    expect(micBlockReason({ canRecord: false, settings: { modelId: null } })).toMatch('语音输入');
    expect(micBlockReason({ canRecord: false, settings: { modelId: 'm' } })).toBe('现在还不能录音');
    expect(micBlockReason({ canRecord: true })).toBeNull();
  });

  it('桌面上有没有这一只只报宿主给的那句', () => {
    expect(desktopPresence(null).text).toBe('桌宠未就绪');
    expect(desktopPresence({ available: false, shown: true })).toEqual({
      mark: 'off',
      text: '桌宠未就绪',
    });
    expect(desktopPresence({ available: true, shown: true })).toEqual({
      mark: 'on',
      text: '在桌面上',
    });
    expect(desktopPresence({ available: true, shown: false })).toEqual({
      mark: 'off',
      text: '已隐藏',
    });
  });
});
