/**
 * QQ 客户端接入卡：显式启动/连接/停止后台进程，并把三层状态分开显示。
 *
 * 这一层不碰 IPC、不碰 Node，只通过 typed callbacks 把意图交给 Main。
 * 所有「当前是什么状态」都来自 props；组件自己不维护第二份真相。
 */
import type { JSX } from 'react';

import type { QQSourceView } from '@pet/contracts';

import { Button, Card, IconButton, Status, type StatusTone } from '../minimal-ui/controls.js';
import { Icon } from '../minimal-ui/icons.js';
import {
  agentLinkLabel,
  canAttachHost,
  canStartHost,
  canStopHost,
  hostLabel,
  qqClientLabel,
  sourceDisabledReason,
  sourceFacts,
  type LocalHostFacts,
} from './local-host-view.js';

/** Main 侧固定方法表；组件只声明自己用到的那几个。 */
export interface LocalHostActions {
  readonly start: () => void;
  readonly attach: () => void;
  readonly stop: () => void;
  readonly refresh: () => void;
  readonly toggleSource: (protocol: QQSourceView['protocol'], enabled: boolean) => void;
}

export interface LocalHostCardProps {
  readonly facts: LocalHostFacts;
  /** 后台进程上报的 QQ 源；未运行时为空。 */
  readonly sources: readonly QQSourceView[];
  /** daemon→Agent 的链路阶段；与源的平台连接是两件事。 */
  readonly agentLinkPhase: string | null;
  readonly agentLinkTarget: string | null;
  readonly busy: boolean;
  readonly actions: LocalHostActions;
  /** server 策略仍在 Web 管；这里只提供打开入口。 */
  readonly openServerPolicy: (() => void) | null;
}

const HOST_TONE: Readonly<Record<LocalHostFacts['phase'], StatusTone>> = {
  stopped: 'muted',
  starting: 'warn',
  running: 'ok',
  stopping: 'warn',
  failed: 'danger',
};

export function LocalHostCard({
  facts,
  sources,
  agentLinkPhase,
  agentLinkTarget,
  busy,
  actions,
  openServerPolicy,
}: LocalHostCardProps): JSX.Element {
  const stopAllowed = canStopHost(facts) && !busy;
  const startAllowed = canStartHost(facts) && !busy;
  const attachAllowed = canAttachHost(facts) && !busy;

  return (
    <Card
      title="QQ 客户端接入"
      testId="local-host-card"
      action={<Status tone={HOST_TONE[facts.phase]}>{hostLabel(facts)}</Status>}
    >
      {/* 一句话说清这是什么，其余全是事实。 */}
      <p className="card__note" data-testid="local-host-line">
        支持 SnowLuma / NapCat（OneBot v11）和官方 QQ 机器人。
      </p>
      <p className="host-facts" data-testid="local-host-facts">
        <span data-testid="local-host-phase">{hostLabel(facts)}</span>
        {facts.packageVersion === null ? null : (
          <span data-testid="local-host-version">版本 {facts.packageVersion}</span>
        )}
        {facts.attached ? (
          <span data-testid="local-host-attached">已连接到运行中的进程</span>
        ) : null}
        {/* 显示进程身份，让「换了一个进程」在界面上可判定。 */}
        {facts.hostId === null ? null : (
          <span data-testid="local-host-identity">{facts.hostId}</span>
        )}
      </p>

      {facts.error === null ? null : (
        <p className="field__error" role="alert" data-testid="local-host-error">
          {facts.error}
        </p>
      )}

      <div className="host-actions" data-testid="local-host-controls">
        <Button
          variant="primary"
          size="small"
          icon={<Icon name="power" />}
          disabled={!startAllowed}
          data-testid="local-host-start"
          onClick={actions.start}
        >
          启动
        </Button>
        {/*
          进程已经在跑但 GUI 没连上时，给的是「连接」而不是再启动一个。
          这就是「重开 GUI 不重复 spawn」在界面上的表达。
        */}
        <Button
          size="small"
          icon={<Icon name="plug" />}
          disabled={!attachAllowed}
          data-testid="local-host-attach"
          onClick={actions.attach}
        >
          连接
        </Button>
        {/*
          停止只看本地事实：服务端连不上时也必须能停。
          因此这里**不**检查 agentLinkPhase。
        */}
        <Button
          size="small"
          variant="ghost"
          icon={<Icon name="stop" />}
          disabled={!stopAllowed}
          data-testid="local-host-stop"
          onClick={actions.stop}
        >
          停止
        </Button>
        <IconButton
          label="刷新连接状态"
          data-testid="local-host-refresh"
          disabled={busy}
          onClick={actions.refresh}
        >
          <Icon name="refresh" />
        </IconButton>
      </div>
      <p className="host-note host-note--danger" data-testid="local-host-stop-note">
        停止会断开本机 QQ 连接；云端任务不受影响。
      </p>

      {/* 第二行：QQ 客户端的原生连接。 */}
      <div className="host-sub" data-testid="local-source-list">
        <h3 className="host-subtitle">QQ 客户端</h3>
        {sources.length === 0 ? (
          <p className="host-note" data-testid="local-source-empty">
            {facts.phase === 'running' ? '还没有上报任何 QQ 客户端。' : '未运行时没有 QQ 客户端。'}
          </p>
        ) : (
          <div className="host-source-list">
            {sources.map((source) => {
              const sourceFactsView = sourceFacts(source);
              const reason = sourceDisabledReason(source);
              const sourceName = qqClientLabel(source.protocol);
              return (
                <div
                  className="host-source"
                  key={`${source.protocol}:${source.instanceId}`}
                  data-testid={`local-source-${source.protocol}`}
                >
                  <div className="host-source__head">
                    <span className="row__label">{sourceName}</span>
                    <span
                      className="host-source__phase"
                      data-testid={`local-source-phase-${source.protocol}`}
                    >
                      {sourceFactsView.nativeLabel}
                    </span>
                    <IconButton
                      label={`${source.desiredEnabled ? '停用' : '启用'}${sourceName}`}
                      variant="secondary"
                      size="small"
                      disabled={busy || reason !== null}
                      data-testid={`local-source-toggle-${source.protocol}`}
                      onClick={() => actions.toggleSource(source.protocol, !source.desiredEnabled)}
                    >
                      <Icon name="power" />
                    </IconButton>
                  </div>
                  <div className="host-source__facts">
                    <span data-testid={`local-source-saved-${source.protocol}`}>
                      配置 · {sourceFactsView.savedLabel}
                    </span>
                    <span data-testid={`local-source-applied-${source.protocol}`}>
                      生效 · {sourceFactsView.appliedLabel}
                    </span>
                  </div>
                  {reason === null ? null : (
                    <p className="host-note" data-testid={`local-source-reason-${source.protocol}`}>
                      {reason}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 第三行：daemon→Agent 链路。与上面两条互不推导。 */}
      <div className="host-sub" data-testid="local-agent-link">
        <h3 className="host-subtitle">Agent 连接</h3>
        <div className="row host-row">
          <span className="row__label">状态</span>
          <span className="row__value" data-testid="local-agent-phase">
            {agentLinkPhase === null ? '未配置' : agentLinkLabel(agentLinkPhase)}
          </span>
        </div>
        {agentLinkTarget === null ? null : (
          <div className="row host-row">
            <span className="row__label">目标</span>
            <span className="row__value" data-testid="local-agent-target">
              {agentLinkTarget}
            </span>
          </div>
        )}
      </div>

      {/*
        server 侧的名单/principal/群策略仍由 Web 管；这里只放一个入口，
        并明确标注它管的是 server，避免把本地客户端配置和云端策略混为一谈。
      */}
      {openServerPolicy === null ? null : (
        <div className="host-policy" data-testid="local-server-policy">
          <Button
            size="small"
            variant="ghost"
            icon={<Icon name="external-link" />}
            data-testid="local-open-server-policy"
            onClick={openServerPolicy}
          >
            打开 server 管理
          </Button>
        </div>
      )}
    </Card>
  );
}
