/**
 * 桌面上的 QQ 只读状态。
 *
 * 桌面不做 QQ 管理：配置、密钥、媒体能力都在服务 Web。这里只回答两个问题——
 * 「接了哪几个协议、现在是什么状态」和「去哪管理」。所以这里不出现任何可编辑
 * 字段，也不自己推断连接是否可用：`phase`/`source` 全部来自服务端快照。
 *
 * 数据来自 `state.snapshot.qq`（由既有的 getState/onChanged 提供），
 * 没有第二个 reader，也没有轮询。
 */
import { useState, type JSX } from 'react';
import type { CompanionSnapshot, QQStatus } from '@pet/contracts';

import { Button, Card, Status, type StatusTone } from '../minimal-ui/controls.js';

/** 协议在界面上的名字；未知协议原样显示，不猜。 */
const PROTOCOL_LABEL: Readonly<Record<string, string>> = {
  official: '官方 QQ',
  'onebot-v11': 'OneBot v11',
};

type QQSourceStatus = QQStatus['sources'][number];

/** 状态徽标：只按服务端给的 source/phase 说，不由「已配置」推出「已连接」。 */
export function qqSourceFacts(source: QQSourceStatus): {
  readonly label: string;
  readonly tone: StatusTone;
} {
  if (source.source === 'unavailable') return { label: '不可用', tone: 'danger' };
  if (!source.desiredEnabled) return { label: '已停用', tone: 'muted' };
  switch (source.phase) {
    case 'ready':
      return { label: '已连接', tone: 'ok' };
    case 'connecting':
      return { label: '正在连接', tone: 'warn' };
    case 'authenticating':
      return { label: '正在验证', tone: 'warn' };
    case 'offline':
      return { label: '已离线', tone: 'warn' };
    case 'retiring':
      return { label: '正在断开', tone: 'warn' };
    case 'failed':
      return { label: '连接失败', tone: 'danger' };
    case 'unconfigured':
      return { label: '待配置', tone: 'muted' };
    default:
      return { label: '已停用', tone: 'muted' };
  }
}

export interface QQStatusCardProps {
  /** 服务端快照；旧服务没有 qq 字段。 */
  readonly qq: QQStatus | undefined;
  readonly connectionId: string | null;
  readonly openWeb: () => Promise<{ readonly outcome: string; readonly error: string | null }>;
}

export function QQStatusCard({ qq, connectionId, openWeb }: QQStatusCardProps): JSX.Element | null {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // 旧服务没有 QQ：不摆一张空卡，也不假装支持。
  if (qq === undefined) return null;

  const open = async (): Promise<void> => {
    setBusy(true);
    setFailure(null);
    const result = await openWeb();
    // 结果只说明「这次点击的结论」：失败就如实说，不当成打开了。
    if (result.outcome !== 'accepted') setFailure(result.error ?? '没能打开管理页。');
    setBusy(false);
  };

  return (
    <Card
      title="QQ"
      id="qq-card"
      action={
        <Button
          size="small"
          busy={busy}
          disabled={connectionId === null}
          data-testid="qq-open-web"
          onClick={() => void open()}
        >
          打开 Web 管理
        </Button>
      }
    >
      {qq.sources.length === 0 ? (
        <p className="row__value" data-testid="qq-empty">
          服务没有启用任何 QQ 协议。
        </p>
      ) : (
        <div className="rows" data-testid="qq-sources">
          {qq.sources.map((source) => {
            const facts = qqSourceFacts(source);
            return (
              <div
                className="row"
                key={source.protocol}
                data-testid={`qq-source-${source.protocol}`}
              >
                <span className="row__text">
                  <span className="row__label">
                    {PROTOCOL_LABEL[source.protocol] ?? source.protocol}
                  </span>
                  {source.account === null ? null : (
                    <span className="row__value">{source.account.accountId}</span>
                  )}
                </span>
                <Status tone={facts.tone}>{facts.label}</Status>
              </div>
            );
          })}
        </div>
      )}

      {failure === null ? null : (
        <p className="field__error" role="alert" data-testid="qq-open-failed">
          {failure}
        </p>
      )}

      <p className="row__value" data-testid="qq-manage-hint">
        名单、触发与密钥都在服务 Web 上管理。
      </p>
    </Card>
  );
}

/** 从快照里取 QQ 状态；没有就是 undefined（旧服务）。 */
export function qqOf(snapshot: CompanionSnapshot | null): QQStatus | undefined {
  return snapshot?.qq;
}
