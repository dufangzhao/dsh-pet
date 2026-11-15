/**
 * 本机 QQ 接入 UI 的纯派生与草稿回归。
 *
 * 这里守的是**不能用「另一条状态」推出本条状态**：进程在跑不等于客户端连上，
 * 保存成功不等于已连接，停止接入不依赖 Agent 链路。
 */
import { describe, expect, it } from 'vitest';

import { makeError, type QQSourceView } from '@pet/contracts';

import {
  agentLinkLabel,
  canAttachHost,
  canSaveSource,
  canStartHost,
  canStopHost,
  hostErrorText,
  hostLabel,
  qqClientLabel,
  sourceDisabledReason,
  sourceFacts,
  type LocalHostFacts,
} from './local-host-view.js';
import {
  editLocalSource,
  followLocalSource,
  localSecretTargetSaved,
  localSecretValid,
  localSourceSaveCommand,
  rebaseLocalSource,
  seedLocalSource,
  typeLocalSecret,
} from './local-source-draft.js';

const HOST = { hostId: 'host-1', bootId: 'boot-1' };

const hostFacts = (over: Partial<LocalHostFacts> = {}): LocalHostFacts => ({
  phase: 'stopped',
  packageVersion: null,
  hostId: null,
  bootId: null,
  attached: false,
  error: null,
  ...over,
});

const official = (over: Partial<QQSourceView> = {}): QQSourceView =>
  ({
    protocol: 'official',
    sourcePluginId: 'pet.qq-official',
    instanceId: 'default',
    desiredEnabled: false,
    source: 'ready',
    configRevision: 3,
    appliedRevision: 3,
    settings: { protocol: 'official', appId: 'app-1', scenes: ['private'] },
    account: {
      protocol: 'official',
      sourcePluginId: 'pet.qq-official',
      instanceId: 'default',
      accountId: 'app-1',
    },
    bindingId: null,
    phase: 'disabled',
    credential: { available: false, writable: true, version: 'v1', source: 'none' },
    installedVersion: '1.0.0',
    media: { text: 'available', image: 'available', voice: 'available', file: 'available' },
    cleanup: null,
    error: null,
    ...over,
  }) as QQSourceView;

describe('三条状态互不推导', () => {
  it('进程在跑不代表客户端已连接', () => {
    const facts = hostFacts({ phase: 'running', hostId: 'h', bootId: 'b' });
    const source = sourceFacts(official({ phase: 'disabled' }));
    expect(facts.phase).toBe('running');
    expect(source.connected).toBe(false);
  });

  it('源已连接不代表 Agent 链路已连接', () => {
    expect(sourceFacts(official({ phase: 'ready' })).connected).toBe(true);
    expect(agentLinkLabel('offline')).toBe('未连接');
  });

  it('保存成功不等于已连接', () => {
    const source = official({ phase: 'unconfigured', configRevision: 4, appliedRevision: null });
    const facts = sourceFacts(source);
    expect(facts.savedLabel).toBe('已保存 修订 4');
    expect(facts.applied).toBe(false);
    expect(facts.connected).toBe(false);
  });
});

describe('停止接入只看本地事实', () => {
  it('进程在跑时可停，与 Agent 是否在线无关', () => {
    // 这个用例的意义在于：canStopHost 的入参里根本没有 Agent 状态。
    expect(canStopHost(hostFacts({ phase: 'running' }))).toBe(true);
    expect(canStopHost(hostFacts({ phase: 'stopped' }))).toBe(false);
  });

  it('已在运行但未连接时给的是「连接」而不是再启动', () => {
    expect(canStartHost(hostFacts({ phase: 'running' }))).toBe(false);
    expect(canAttachHost(hostFacts({ phase: 'running', attached: false }))).toBe(true);
    expect(canAttachHost(hostFacts({ phase: 'running', attached: true }))).toBe(false);
  });

  it('正在启动时也能停（否则用户会被启动中的进程困住）', () => {
    expect(canStopHost(hostFacts({ phase: 'starting' }))).toBe(true);
  });

  it('停止中不能再启动或再停止', () => {
    const stopping = hostFacts({ phase: 'stopping' });
    expect(canStartHost(stopping)).toBe(false);
    expect(canStopHost(stopping)).toBe(false);
  });
});

describe('禁用要说下一步', () => {
  it('插件不可用时指出先去插件页', () => {
    expect(sourceDisabledReason(official({ source: 'unavailable' }))).toContain('插件页');
    expect(sourceDisabledReason(official({ source: 'disabled' }))).toContain('重新启用');
  });

  it('配置没填完时指出先填配置', () => {
    expect(sourceDisabledReason(official({ phase: 'unconfigured' }))).toContain('填完');
  });

  it('就绪时没有理由', () => {
    expect(sourceDisabledReason(official({ phase: 'disabled' }))).toBeNull();
  });
});

describe('源草稿：脏数据不被无关刷新清掉', () => {
  it('干净草稿跟随视图', () => {
    const draft = seedLocalSource(official(), HOST);
    const followed = followLocalSource(draft, official({ configRevision: 5 }), HOST);
    expect(followed?.owner.configRevision).toBe(5);
    expect(followed?.edited).toBe(false);
  });

  it('脏草稿保留用户输入与它捕获的修订', () => {
    const draft = editLocalSource(seedLocalSource(official(), HOST), (settings) =>
      settings.protocol === 'official' ? { ...settings, appId: 'typed-by-user' } : settings,
    );
    const followed = followLocalSource(draft, official({ configRevision: 9 }), HOST);
    expect(followed?.settings).toMatchObject({ appId: 'typed-by-user' });
    // 关键：基线停在 3，不借最新的 9。
    expect(followed?.owner.configRevision).toBe(3);
  });

  it('进程重启后旧草稿丢弃', () => {
    const draft = editLocalSource(seedLocalSource(official(), HOST), (settings) =>
      settings.protocol === 'official' ? { ...settings, appId: 'old-boot' } : settings,
    );
    const followed = followLocalSource(draft, official(), { hostId: 'host-1', bootId: 'boot-2' });
    expect(followed?.settings).toMatchObject({ appId: 'app-1' });
    expect(followed?.edited).toBe(false);
  });

  it('显式重读只换基线，保留填写内容', () => {
    const draft = editLocalSource(seedLocalSource(official(), HOST), (settings) =>
      settings.protocol === 'official' ? { ...settings, appId: 'kept' } : settings,
    );
    const rebased = rebaseLocalSource(draft, official({ configRevision: 7 }), HOST);
    expect(rebased?.settings).toMatchObject({ appId: 'kept' });
    expect(rebased?.owner.configRevision).toBe(7);
  });

  it('保存命令用草稿自己的修订', () => {
    const draft = editLocalSource(seedLocalSource(official(), HOST), (settings) =>
      settings.protocol === 'official' ? { ...settings, appId: 'x' } : settings,
    );
    expect(localSourceSaveCommand(draft)?.expectedRevision).toBe(3);
  });

  it('干净的草稿没有保存命令', () => {
    expect(localSourceSaveCommand(seedLocalSource(official(), HOST))).toBeNull();
  });
});

describe('本地密钥绑定已保存的源', () => {
  it('首次输入捕获归属，之后只改值', () => {
    const source = official();
    const first = typeLocalSecret(null, 'a', source, HOST);
    const second = typeLocalSecret(first, 'ab', source, HOST);
    expect(second.value).toBe('ab');
    expect(second.configRevision).toBe(3);
    expect(localSecretValid(second, source, HOST)).toBe(true);
  });

  it('源修订变化后旧密钥失效', () => {
    const secret = typeLocalSecret(null, 'k', official(), HOST);
    expect(localSecretValid(secret, official({ configRevision: 4 }), HOST)).toBe(false);
  });

  it('进程重启后旧密钥失效', () => {
    const secret = typeLocalSecret(null, 'k', official(), HOST);
    expect(localSecretValid(secret, official(), { hostId: 'host-1', bootId: 'boot-2' })).toBe(
      false,
    );
  });

  it('草稿未保存时不允许写密钥', () => {
    const draft = editLocalSource(seedLocalSource(official(), HOST), (settings) => settings);
    expect(localSecretTargetSaved(draft, official())).toBe(false);
    expect(localSecretTargetSaved(seedLocalSource(official(), HOST), official())).toBe(true);
  });
});

describe('保存可点条件', () => {
  it('插件就绪、不忙、有改动才可点', () => {
    expect(canSaveSource({ plugin: 'ready', busy: false, dirty: true })).toBe(true);
    expect(canSaveSource({ plugin: 'ready', busy: true, dirty: true })).toBe(false);
    expect(canSaveSource({ plugin: 'ready', busy: false, dirty: false })).toBe(false);
    expect(canSaveSource({ plugin: 'unavailable', busy: false, dirty: true })).toBe(false);
  });
});

describe('接入文案', () => {
  it('每个阶段都有中文', () => {
    expect(hostLabel(hostFacts({ phase: 'running' }))).toBe('运行中');
    expect(hostLabel(hostFacts({ phase: 'stopping' }))).toBe('正在停止');
    expect(hostLabel(hostFacts({ phase: 'failed' }))).toBe('启动失败');
  });

  it('客户端名称先说平台，未知协议原样显示', () => {
    expect(qqClientLabel('onebot-v11')).toBe('SnowLuma / NapCat（OneBot v11）');
    expect(qqClientLabel('official')).toBe('官方 QQ 机器人');
    expect(qqClientLabel('other-protocol')).toBe('other-protocol');
  });

  it('启动程序出错时说的是程序问题，不是没授权', () => {
    expect(hostErrorText(makeError('internal'))).toBe('QQ 连接启动程序出错，请更新客户端。');
    // 授权失败仍是原来的固定文案，不被这句话盖掉。
    expect(hostErrorText(makeError('permission-denied'))).toBe('没有获得授权');
  });
});
