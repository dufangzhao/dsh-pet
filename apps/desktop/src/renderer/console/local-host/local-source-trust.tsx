/**
 * 源码信任卡：官方 QQ 机器人、OneBot 客户端与 Agent 连接共用同一份「读取 / 信任 / 权限预设」。
 *
 * 后台进程只运行经过确认的插件代码，而且三个源的生产预设初始都是 `deny`。
 * 所以 GUI 必须能走完 读取 → 信任 → 允许 这三步，否则用户信任了源码仍然启用不了。
 *
 * 这里只展示并转发意图：digest 与 permissionEpoch 一律取**用户看到的这份 review**，
 * 组件不缓存、不推断第二份真相，也不自动信任或自动允许。
 */
import type { JSX } from 'react';

import type {
  LocalHostSourceReview,
  ManagedSourceSelector,
  PermissionPreset,
} from '@pet/contracts';

import { Button } from '../minimal-ui/controls.js';
import { Icon } from '../minimal-ui/icons.js';

const PRESET_LABEL: Readonly<Record<PermissionPreset, string>> = {
  allow: '允许',
  ask: '询问',
  deny: '拒绝',
  local: '仅本地',
};

const CLEANUP_LABEL: Readonly<Record<LocalHostSourceReview['cleanup'], string>> = {
  settled: '已收尾',
  pending: '还在收尾',
  failed: '收尾失败',
};

export interface SourceTrustControlsProps {
  readonly selector: ManagedSourceSelector;
  /** 这份信任属于哪个客户端；只用于标题，不参与命令。 */
  readonly label: string;
  /** 上一次成功读取到的 review；null = 没读过或已被换进程清空。 */
  readonly review: LocalHostSourceReview | null;
  /** 最近一次读取/写入失败的真实错误；与 review 分开显示。 */
  readonly error: string | null;
  readonly busy: boolean;
  readonly onReview: () => void;
  readonly onTrust: (review: LocalHostSourceReview, trusted: boolean) => void;
  readonly onPreset: (review: LocalHostSourceReview, preset: PermissionPreset) => void;
}

export function SourceTrustControls({
  selector,
  label,
  review,
  error,
  busy,
  onReview,
  onTrust,
  onPreset,
}: SourceTrustControlsProps): JSX.Element {
  return (
    <div className="host-sub" data-testid={`local-trust-${selector}`}>
      <div className="host-sub__head">
        <h3 className="host-subtitle">源码信任 · {label}</h3>
        <Button
          size="small"
          variant="ghost"
          icon={<Icon name="refresh" />}
          disabled={busy}
          data-testid="local-source-review"
          onClick={onReview}
        >
          读取源码状态
        </Button>
      </div>

      {error === null ? null : (
        <p className="field__error" role="alert" data-testid="local-source-trust-error">
          {error}
        </p>
      )}

      {review === null ? (
        <p className="host-note" data-testid="local-source-review-empty">
          还没读取源码状态。
        </p>
      ) : (
        <>
          <div className="rows rows--tight">
            <div className="row host-row">
              <span className="row__label">摘要</span>
              <span className="row__value" data-testid="local-source-digest">
                {review.digest}
              </span>
            </div>
            <div className="row host-row">
              <span className="row__label">权限</span>
              <span className="row__value" data-testid="local-source-preset">
                {PRESET_LABEL[review.preset]}
              </span>
            </div>
            <div className="row host-row">
              <span className="row__label">信任</span>
              <span className="row__value" data-testid="local-source-trusted">
                {review.trusted ? '已信任' : '未信任'}
              </span>
            </div>
            <div className="row host-row">
              <span className="row__label">收尾</span>
              <span className="row__value" data-testid="local-source-cleanup">
                {CLEANUP_LABEL[review.cleanup]}
              </span>
            </div>
          </div>
          {review.blocked ? (
            <p className="host-note" data-testid="local-source-blocked">
              权限被挡住；选择「允许」后解除。
            </p>
          ) : null}

          {/*
            只有这些显式动作会改权限。信任与预设是两个独立事实：未信任的源
            即使预设为 allow 也不会运行，所以下面会明说这一点，而不是假装允许成功。
            后台进程没有逐次审批的交互界面，因此不提供「本次同意」这种做不到的承诺。
          */}
          <div className="card__foot">
            {review.trusted ? (
              <Button
                size="small"
                variant="ghost"
                icon={<Icon name="unplug" />}
                disabled={busy}
                data-testid="local-source-revoke-trust"
                onClick={() => onTrust(review, false)}
              >
                撤销信任
              </Button>
            ) : (
              <Button
                size="small"
                icon={<Icon name="check" />}
                disabled={busy}
                data-testid="local-source-confirm-trust"
                onClick={() => onTrust(review, true)}
              >
                信任源码
              </Button>
            )}
            {review.preset === 'allow' ? null : (
              <Button
                size="small"
                icon={<Icon name="check" />}
                disabled={busy}
                data-testid="local-source-allow-permissions"
                onClick={() => onPreset(review, 'allow')}
              >
                允许
              </Button>
            )}
            {review.preset === 'deny' ? null : (
              <Button
                size="small"
                variant="ghost"
                icon={<Icon name="x" />}
                disabled={busy}
                data-testid="local-source-deny-permissions"
                onClick={() => onPreset(review, 'deny')}
              >
                禁止
              </Button>
            )}
          </div>
          {!review.trusted ? (
            <p className="host-note" data-testid="local-source-preset-locked">
              未信任，不会运行。
            </p>
          ) : review.preset === 'ask' || review.preset === 'local' ? (
            <p className="host-note" data-testid="local-source-preset-readonly">
              当前为「{PRESET_LABEL[review.preset]}」，只读。
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
