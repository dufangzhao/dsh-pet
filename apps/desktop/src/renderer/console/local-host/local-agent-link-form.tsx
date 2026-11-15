/**
 * daemon→Agent 链路。
 *
 * 这是**本机 QQ 接入进程**到 Agent 的连接，不是本窗口自己那条。两者指向同一个 Agent，
 * 但用途不同：本窗口那条承载个人对话，这条承载 QQ 客户端。
 *
 * 所以这里**不让用户手填 Agent ID / State 世代**：内部身份由 Main 从当前
 * 个人连接里捕获并受 lease 保护地交给后台进程。用户只需要说「用现在这条连接」。
 */
import type { JSX } from 'react';

import {
  errorMessage,
  type LocalAgentLinkView,
  type LocalHostSourceReview,
  type PermissionPreset,
} from '@pet/contracts';

import { Button, Card, Field, Status } from '../minimal-ui/controls.js';
import { Icon } from '../minimal-ui/icons.js';
import { SourceTrustControls } from './local-source-trust.js';

export interface LocalAgentLinkFormProps {
  readonly view: LocalAgentLinkView | null;
  /** 这条链路自己的源码信任；与 QQ 客户端各存一份。 */
  readonly review: LocalHostSourceReview | null;
  readonly reviewError: string | null;
  readonly secretValue: string;
  readonly busy: boolean;
  /** 本窗口自己那条连接的身份；null = 本窗口没连上。 */
  readonly currentConnectionId: string | null;
  /** 本窗口自己那条连接是否 live；只用于文案。 */
  readonly agentLive: boolean;
  readonly onSecretChange: (value: string) => void;
  /** 把本机接入进程连接到**当前**这条个人连接指向的 Agent。 */
  readonly onLink: () => void;
  readonly onWriteKey: () => void;
  readonly onClearKey: () => void;
  readonly onSetEnabled: (enabled: boolean) => void;
  readonly onReview: () => void;
  readonly onTrust: (review: LocalHostSourceReview, trusted: boolean) => void;
  readonly onPreset: (review: LocalHostSourceReview, preset: PermissionPreset) => void;
}

const PHASE_TEXT: Readonly<Record<LocalAgentLinkView['phase'], string>> = {
  disabled: '未启用',
  offline: '未连接',
  connecting: '正在连接',
  connected: '已连接',
  retiring: '正在断开',
  failed: '连接失败',
};

export function LocalAgentLinkForm({
  view,
  review,
  reviewError,
  secretValue,
  busy,
  currentConnectionId,
  agentLive,
  onSecretChange,
  onLink,
  onWriteKey,
  onClearKey,
  onSetEnabled,
  onReview,
  onTrust,
  onPreset,
}: LocalAgentLinkFormProps): JSX.Element {
  const phase = view?.phase ?? 'disabled';
  const enabled = phase !== 'disabled';
  // 密钥只能写到后台进程当前持有的目标；没有目标就无从绑定。
  const hasTarget = view !== null;

  return (
    <Card
      title="Agent 连接"
      testId="local-agent-link-section"
      action={<Status>{PHASE_TEXT[phase]}</Status>}
    >
      {view?.error == null ? null : (
        <p className="field__error" role="alert" data-testid="local-agent-link-error">
          {errorMessage(view.error)}
        </p>
      )}

      {/*
        目标只读显示。这些值由 Main 从当前个人连接捕获，用户不该也不能手改——
        手填内部 Agent ID 只会造出一个连不上的配置。
      */}
      <div className="rows rows--tight">
        <div className="row host-row">
          <span className="row__label">状态</span>
          <span className="row__value" data-testid="local-agent-link-phase">
            {PHASE_TEXT[phase]}
          </span>
        </div>
        <div className="row host-row">
          <span className="row__label">服务地址</span>
          <span className="row__value" data-testid="local-agent-base-url">
            {view === null || view.target.baseUrl === '' ? '还没连接' : view.target.baseUrl}
          </span>
        </div>
        <div className="row host-row">
          <span className="row__label">Agent</span>
          <span className="row__value" data-testid="local-agent-id">
            {view === null || view.target.agentId === '' ? '还没连接' : view.target.agentId}
          </span>
        </div>
      </div>

      <div className="card__foot">
        <Button
          variant="primary"
          size="small"
          icon={<Icon name="plug" />}
          disabled={busy || currentConnectionId === null}
          data-testid="local-agent-link"
          onClick={onLink}
        >
          用当前连接
        </Button>
        {currentConnectionId === null ? (
          <span className="host-note" data-testid="local-agent-link-blocked">
            本窗口还没连上 Agent；先连接，再让本机接入跟随这条连接。
          </span>
        ) : agentLive ? null : (
          <span className="host-note" data-testid="local-agent-link-offline">
            本窗口的连接当前不在线，但目标仍然可以绑定。
          </span>
        )}
      </div>

      {/*
        启用/停用是**独立**的 revision 域，不是改目标。
        停止本机接入不看这一条——那是本地动作。
      */}
      <div className="card__foot">
        <Button
          size="small"
          variant="ghost"
          icon={<Icon name={enabled ? 'unplug' : 'plug'} />}
          disabled={busy || !hasTarget}
          data-testid="local-agent-toggle"
          onClick={() => onSetEnabled(!enabled)}
        >
          {enabled ? '停用链路' : '启用链路'}
        </Button>
      </div>

      {/*
        后台进程只运行被信任、且预设不是 deny 的插件。首次启用前必须在这里
        读取源码 → 信任 → 允许；这条链路与 QQ 客户端共用同一张信任卡。
      */}
      <SourceTrustControls
        selector="agent-link"
        label="Agent 连接"
        review={review}
        error={reviewError}
        busy={busy}
        onReview={onReview}
        onTrust={onTrust}
        onPreset={onPreset}
      />

      <div className="host-sub" data-testid="local-agent-secret">
        <h3 className="host-subtitle">服务令牌</h3>
        <p className="host-note" data-testid="local-agent-secret-state">
          {view?.hasCredential === true
            ? `已配置（版本 ${view.credentialVersion}）`
            : '还没有配置令牌'}
        </p>
        {hasTarget ? null : (
          <p className="host-note" data-testid="local-agent-secret-blocked">
            先把上面的目标绑定好，再填令牌。
          </p>
        )}
        <Field label="临时令牌" hint="只交给本机接入进程一次，本窗口不保留">
          {({ inputId, describedBy }) => (
            <input
              id={inputId}
              className="input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              aria-describedby={describedBy}
              value={secretValue}
              disabled={busy || !hasTarget}
              data-testid="local-agent-secret-input"
              onChange={(event) => onSecretChange(event.target.value)}
            />
          )}
        </Field>
        <div className="card__foot">
          <Button
            size="small"
            icon={<Icon name="key" />}
            disabled={busy || !hasTarget || secretValue.trim() === ''}
            data-testid="local-agent-secret-write"
            onClick={onWriteKey}
          >
            写入令牌
          </Button>
          <Button
            size="small"
            variant="ghost"
            icon={<Icon name="x" />}
            disabled={busy || view?.hasCredential !== true}
            data-testid="local-agent-secret-clear"
            onClick={onClearKey}
          >
            清除令牌
          </Button>
        </div>
      </div>
    </Card>
  );
}
