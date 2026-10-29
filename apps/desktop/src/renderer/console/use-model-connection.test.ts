import { describe, expect, it } from 'vitest';

import { makeError, type ModelSignInStatus } from '@pet/contracts';

import { describeTest, saveMessage, signInOutcome, testResultOf } from './use-model-connection.js';

/**
 * 「保存并开始」的宿主返回 ok 只代表配置写进去了，那一次探测可能仍然失败。
 * 这里守的是界面因此说哪一句：不能把写进去说成连上了，也不能吞掉失败原因。
 */
describe('模型连接回执', () => {
  it('写进去且探测通过、且这台机器真的切过去了，才说已连接', () => {
    expect(
      saveMessage(
        {
          saved: true,
          ok: true,
          error: null,
          test: { ok: true, elapsedMs: 120 },
          activeId: 'qwen',
        },
        'qwen',
      ),
    ).toBe('已连接，桌宠开始接话。');
  });

  it('写进去但没切成在用：说保存了，不说已连接', () => {
    const line = saveMessage(
      {
        saved: true,
        ok: true,
        error: null,
        test: { ok: true, elapsedMs: 5 },
        activeId: 'deepseek',
      },
      'qwen',
    );
    expect(line).toContain('配置已保存');
    expect(line).not.toContain('已连接');
  });

  it('写进去但探测没过：报宿主的原因，并说明 Key 留下了', () => {
    const line = saveMessage(
      {
        saved: true,
        ok: false,
        error: '连接失败：401',
        test: { ok: false, elapsedMs: null, reason: '401' },
        activeId: 'qwen',
      },
      'qwen',
    );
    expect(line).toContain('连接失败：401');
    expect(line).toContain('留在这台机器上');
    expect(line).not.toContain('已连接');
  });

  it('压根没写进去：只说没成功，不提 Key 留着', () => {
    const line = saveMessage(
      { saved: false, ok: false, error: '这条配置已被别处改过。', test: null, activeId: null },
      'qwen',
    );
    expect(line).toBe('连接没有成功：这条配置已被别处改过。');
  });

  it('测试通过带耗时；宿主没给耗时就不编一个数', () => {
    expect(describeTest({ ok: true, elapsedMs: 320 })).toBe('连接正常，耗时 320 ms。');
    expect(describeTest({ ok: true, elapsedMs: null })).toBe('连接正常。');
  });

  it('失败没原因时只说没给出原因，不写一句猜测', () => {
    expect(describeTest({ ok: false, elapsedMs: null })).toBe('连接失败，没有给出原因。');
    expect(describeTest({ ok: false, elapsedMs: 12, reason: '域名解析失败' })).toBe(
      '连接失败：域名解析失败',
    );
  });

  it('桥拒绝时算"没有测到"，把宿主的原因原样带出来', () => {
    const result = testResultOf({ ok: false, error: makeError('unavailable', false) });
    expect(result.ok).toBe(false);
    expect(result.elapsedMs).toBeNull();
    expect(result.reason ?? '').not.toBe('');
  });

  it('登录还在等的时候不算成功', () => {
    const waiting: ModelSignInStatus = { phase: 'waiting', signedIn: false, reason: null };
    expect(signInOutcome(waiting, null).ok).toBe(false);
    const done: ModelSignInStatus = { phase: 'done', signedIn: true, reason: null };
    expect(signInOutcome(done, null).ok).toBe(true);
    const failed: ModelSignInStatus = {
      phase: 'failed',
      signedIn: false,
      reason: '浏览器没有回话',
    };
    expect(signInOutcome(failed, null)).toEqual({ ok: false, error: '浏览器没有回话' });
  });
});
