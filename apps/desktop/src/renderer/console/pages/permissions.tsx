import type {
  AuditEntry,
  ConsoleApprovalPrompt,
  ConsoleBuiltinPackage,
  ConsoleSecurityChange,
  ConsoleSecurityPlugin,
  ConsoleSecuritySnapshot,
  PermissionPreset,
} from '@pet/contracts';
import { ERROR_MESSAGES, PERMISSION_PRESETS, PERMISSION_PRESET_DESCRIPTIONS } from '@pet/contracts';
import { useCallback, useEffect, useId, useState, type JSX, type ReactNode } from 'react';

import { Dialog } from '@pet/ui-kit';

import { ConsoleStatus } from '../console-status.js';
import {
  auditEvent,
  auditSource,
  clockTime,
  describePermission,
  ownerKey,
  permissionKind,
  pluginOrigin,
  presetLabel,
  shortDigest,
} from '../labels.js';
import { Button, Card, Status } from '../minimal-ui/controls.js';
import { AUDIT_PAGE_SIZE, useAudit, type AuditState } from '../use-audit.js';
import { restoreKey, useSecurityActions, type SecurityOutcome } from '../use-security-actions.js';

export interface PermissionsPageProps {
  /** 安全快照由外壳持有：待审批提示在别的页面也要可见。 */
  security: ConsoleSecuritySnapshot | null;
  loading: boolean;
  error: string | null;
  available: boolean;
  onRetry: () => void;
  /** 写操作返回的两份真实快照，先应用再判断 operationError。 */
  onApplyChange: (change: ConsoleSecurityChange) => void;
  /** 结果未确认：两份快照都可能过期，由外壳统一收起。 */
  onUncertain: () => void;
  notify: (message: string, tone: 'ok' | 'danger') => void;
}

interface TrustRequest {
  plugin: ConsoleSecurityPlugin;
  approved: boolean;
}

/**
 * 权限与数据页：来源信任、权限预设、待审批请求与审计。
 *
 * 这里没有任何“自动批准”：信任要一次明确确认，审批要逐项答复，
 * 预设只决定哪些操作还需要问。插件声明的权限始终是请求，不是授权。
 */
export function PermissionsPage({
  security,
  loading,
  error,
  available,
  onRetry,
  onApplyChange,
  onUncertain,
  notify,
}: PermissionsPageProps): JSX.Element {
  const actions = useSecurityActions({ onApply: onApplyChange, onUncertain });
  const audit = useAudit(available);
  const [trusting, setTrusting] = useState<TrustRequest | null>(null);
  const [restoring, setRestoring] = useState<ConsoleBuiltinPackage | null>(null);

  const report = useCallback(
    (outcome: SecurityOutcome, done: string) => {
      notify(outcome.ok ? done : (outcome.error ?? '操作没有完成。'), outcome.ok ? 'ok' : 'danger');
    },
    [notify],
  );

  const askTrust = useCallback((plugin: ConsoleSecurityPlugin) => {
    setTrusting({ plugin, approved: !plugin.trusted });
  }, []);

  const confirmTrust = useCallback(async () => {
    const request = trusting;
    setTrusting(null);
    if (request === null) {
      return;
    }
    const outcome = await actions.setTrust(request.plugin, request.approved);
    report(
      outcome,
      request.approved
        ? `已确认 ${request.plugin.name} 的来源信任。`
        : `已取消 ${request.plugin.name} 的来源信任。`,
    );
  }, [actions, report, trusting]);

  const confirmRestore = useCallback(async () => {
    const builtin = restoring;
    setRestoring(null);
    if (builtin === null) {
      return;
    }
    const outcome = await actions.restore(builtin);
    report(outcome, `已恢复 ${builtin.name}。确认来源信任后可以启用。`);
  }, [actions, report, restoring]);

  const changePreset = useCallback(
    async (plugin: ConsoleSecurityPlugin, preset: PermissionPreset) => {
      const outcome = await actions.setPreset(plugin, preset);
      report(outcome, `已把 ${plugin.name} 的权限预设改为「${presetLabel(preset)}」。`);
    },
    [actions, report],
  );

  const answer = useCallback(
    async (prompt: ConsoleApprovalPrompt, approved: boolean, name: string) => {
      const outcome = await actions.answer(prompt, approved);
      report(outcome, approved ? `已同意 ${name} 的这一次请求。` : `已拒绝 ${name} 的这一次请求。`);
    },
    [actions, report],
  );

  const names = namesOf(security);

  return (
    <>
      <ConsoleStatus loading={loading} error={error} available={available} onRetry={onRetry}>
        {security === null ? null : (
          <>
            <ApprovalQueue
              prompts={security.pending}
              names={names}
              pending={actions.pending}
              onAnswer={answer}
            />

            {security.plugins.length === 0 ? (
              <Card title="来源信任">
                <p className="row__desc">还没有可确认的插件</p>
              </Card>
            ) : (
              security.plugins.map((plugin) => (
                <TrustCard
                  key={ownerKey(plugin.owner)}
                  plugin={plugin}
                  busy={actions.pending.has(ownerKey(plugin.owner))}
                  onAsk={askTrust}
                  onPreset={changePreset}
                />
              ))
            )}

            <BuiltinCard
              builtins={security.availableBuiltins}
              pending={actions.pending}
              onAsk={setRestoring}
            />

            <AuditSection audit={audit} names={names} />

            <Card title="本地数据">
              <div className="rows rows--tight">
                <Row label="清除本地数据">暂不支持</Row>
                <Row label="导出数据">暂不支持</Row>
              </div>
            </Card>
          </>
        )}
      </ConsoleStatus>

      <TrustDialog request={trusting} onClose={() => setTrusting(null)} onConfirm={confirmTrust} />
      <RestoreDialog
        builtin={restoring}
        onClose={() => setRestoring(null)}
        onConfirm={confirmRestore}
      />
    </>
  );
}

function namesOf(security: ConsoleSecuritySnapshot | null): ReadonlyMap<string, string> {
  return new Map(security?.plugins.map((plugin) => [ownerKey(plugin.owner), plugin.name]) ?? []);
}

/** 一行「名称在左、值在右」：四张卡片共用这一种排法。 */
function Row({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="row">
      <span className="row__text">
        <span className="row__label">{label}</span>
      </span>
      <span className="row__value">{children}</span>
    </div>
  );
}

/* ---- 待审批 ---- */

interface ApprovalQueueProps {
  prompts: readonly ConsoleApprovalPrompt[];
  names: ReadonlyMap<string, string>;
  pending: ReadonlySet<string>;
  onAnswer: (prompt: ConsoleApprovalPrompt, approved: boolean, name: string) => void;
}

/**
 * 待审批队列。每一项只对那一次操作有效，超时由宿主拒绝；
 * 本地只在倒计时走完后把按钮关掉，不替宿主判定结果。
 */
function ApprovalQueue({ prompts, names, pending, onAnswer }: ApprovalQueueProps): JSX.Element {
  const now = useNow(prompts.length > 0);

  return (
    <Card title="待审批请求">
      {prompts.length === 0 ? (
        <p className="row__desc">没有等待审批的请求</p>
      ) : (
        <div className="rows rows--tight">
          {prompts.map((prompt) => {
            const left = prompt.deadlineAt - now;
            const expired = left <= 0;
            const name = names.get(ownerKey(prompt.owner)) ?? prompt.owner.pluginId;
            const busy = pending.has(prompt.requestId);
            return (
              <div className="row" key={prompt.requestId}>
                <span className="row__text">
                  <span className="row__label">{name}</span>
                  <span className="row__desc">{describePermission(prompt.permission)}</span>
                  <span className="row__desc">
                    {expired ? '已超时，等待结果' : `剩余 ${secondsOf(left)} 秒`}
                  </span>
                </span>
                <span className="row__value">
                  <Button
                    variant="primary"
                    disabled={expired || busy}
                    data-testid={'approval-allow-' + prompt.requestId}
                    onClick={() => onAnswer(prompt, true, name)}
                  >
                    同意这一次
                  </Button>
                  <Button
                    disabled={expired || busy}
                    data-testid={'approval-deny-' + prompt.requestId}
                    onClick={() => onAnswer(prompt, false, name)}
                  >
                    拒绝
                  </Button>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/** 每秒走一次的时钟；没有待审批项时不挂定时器。 */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function secondsOf(left: number): number {
  return Math.max(1, Math.ceil(left / 1000));
}

/* ---- 来源信任与权限预设 ---- */

interface TrustCardProps {
  plugin: ConsoleSecurityPlugin;
  busy: boolean;
  onAsk: (plugin: ConsoleSecurityPlugin) => void;
  onPreset: (plugin: ConsoleSecurityPlugin, preset: PermissionPreset) => void;
}

/**
 * 一个插件的来源与权限：信任是这次运行的确认，预设决定敏感操作还要不要问。
 * 两者都只对本次运行有效，所以放在同一张卡上，但各自说的是自己的事。
 */
function TrustCard({ plugin, busy, onAsk, onPreset }: TrustCardProps): JSX.Element {
  const presetLabelId = useId();

  return (
    <Card
      title={plugin.name}
      action={
        <Status tone={plugin.trusted ? 'ok' : 'warn'}>
          {plugin.trusted ? '已确认可信' : '未确认'}
        </Status>
      }
    >
      <div className="rows rows--tight">
        <Row label="来源">{pluginOrigin(plugin.origin)}</Row>
        <Row label="版本">{plugin.version}</Row>
      </div>

      <p className="row__desc">
        {plugin.digest === null
          ? '还没有这个插件包的指纹，暂时无法确认来源。'
          : `包指纹 ${shortDigest(plugin.digest)}`}
      </p>

      <div className="field">
        <span className="field__label" id={presetLabelId}>
          权限预设
        </span>
        <p className="row__desc">
          {plugin.blocked
            ? '已暂停：所有敏感操作都会被拒绝。切换预设即可恢复。'
            : `当前预设：${presetLabel(plugin.preset)}`}
        </p>
        <div className="choices" role="radiogroup" aria-labelledby={presetLabelId}>
          {PERMISSION_PRESETS.map((preset) => (
            <label className="choice" key={preset}>
              <input
                type="radio"
                name={'preset-' + ownerKey(plugin.owner)}
                value={preset}
                /*
                 * 暂停时一个都不选中：这样再点当前那一档也会触发 onChange，
                 * 用户才有办法从“已暂停”回到正常状态。
                 */
                checked={plugin.preset === preset && !plugin.blocked}
                disabled={busy}
                onChange={() => onPreset(plugin, preset)}
              />
              <span className="row__text">
                <span className="choice__name">{presetLabel(preset)}</span>
                <span className="row__desc">{PERMISSION_PRESET_DESCRIPTIONS[preset]}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="card__foot">
        <Button
          variant={plugin.trusted ? 'secondary' : 'primary'}
          disabled={busy || plugin.digest === null}
          data-testid={'trust-' + plugin.owner.pluginId}
          onClick={() => onAsk(plugin)}
        >
          {plugin.trusted ? '取消信任' : '确认来源信任'}
        </Button>
      </div>
    </Card>
  );
}

interface TrustDialogProps {
  request: TrustRequest | null;
  onClose: () => void;
  onConfirm: () => void;
}

/**
 * 信任确认对话框：把“确认的是哪一份代码”摆出来——指纹、版本、来源和它声明的权限。
 * 初始焦点给“取消”，最安全的那一个。
 */
function TrustDialog({ request, onClose, onConfirm }: TrustDialogProps): JSX.Element {
  const plugin = request?.plugin ?? null;
  const approving = request?.approved === true;

  return (
    <Dialog
      open={request !== null}
      title={
        plugin === null
          ? ''
          : approving
            ? `确认信任 ${plugin.name}？`
            : `取消 ${plugin.name} 的来源信任？`
      }
      onClose={onClose}
      footer={
        <>
          <Button data-autofocus onClick={onClose}>
            取消
          </Button>
          <Button
            variant={approving ? 'primary' : 'danger'}
            data-testid="trust-confirm"
            onClick={onConfirm}
          >
            {approving ? '确认信任' : '取消信任'}
          </Button>
        </>
      }
    >
      {plugin === null ? null : approving ? (
        <TrustBody plugin={plugin} />
      ) : (
        <p>取消后这个插件无法再启动，已经发出的权限请求会立即失效。配置与数据保留在本机。</p>
      )}
    </Dialog>
  );
}

function TrustBody({ plugin }: { plugin: ConsoleSecurityPlugin }): JSX.Element {
  return (
    <>
      <div className="rows rows--tight">
        <Row label="版本">{plugin.version}</Row>
        <Row label="来源">{pluginOrigin(plugin.origin)}</Row>
        <Row label="包指纹">{plugin.digest ?? '未知'}</Row>
      </div>
      <p>
        确认后，这个插件可以在本次运行中启动。它声明的敏感操作仍然逐个询问，不会因为确认信任就自动通过。
      </p>
      {plugin.permissions.length === 0 ? (
        <p>没有声明额外权限。</p>
      ) : (
        <>
          <p>它声明需要：</p>
          <ul>
            {plugin.permissions.map((permission, index) => (
              <li key={permission.kind + '|' + index}>{describePermission(permission)}</li>
            ))}
          </ul>
        </>
      )}
      <p className="row__desc">信任只在本次运行有效；插件代码变化后需要重新确认。</p>
    </>
  );
}

/* ---- 审计 ---- */

interface AuditSectionProps {
  audit: AuditState;
  names: ReadonlyMap<string, string>;
}

function AuditSection({ audit, names }: AuditSectionProps): JSX.Element {
  const page = audit.page;
  const retained = page === null ? 0 : page.total - page.dropped;
  const newest = Math.max(0, retained - AUDIT_PAGE_SIZE);

  return (
    <Card
      title="审计"
      action={
        <Button
          size="small"
          variant="ghost"
          data-testid="audit-refresh"
          disabled={audit.loading}
          onClick={audit.refresh}
        >
          {audit.loading ? '读取中…' : '刷新'}
        </Button>
      }
    >
      {audit.error !== null ? (
        <div className="card__foot" role="alert">
          <Status tone="danger">{'读取审计失败：' + audit.error}</Status>
          <Button size="small" onClick={audit.refresh}>
            重新读取
          </Button>
        </div>
      ) : page === null ? (
        <p className="row__desc">正在读取审计记录…</p>
      ) : page.entries.length === 0 ? (
        <p className="row__desc">还没有记录</p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th scope="col">时间</th>
                <th scope="col">插件</th>
                <th scope="col">事件</th>
                <th scope="col">摘要</th>
              </tr>
            </thead>
            <tbody>
              {page.entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{clockTime(entry.at)}</td>
                  <td>{names.get(ownerKey(entry.owner)) ?? entry.owner.pluginId}</td>
                  <td>{eventText(entry)}</td>
                  <td>{digestText(entry)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="row__desc">{rangeText(audit, page.total, page.dropped)}</p>
          <div className="card__foot">
            <Button
              size="small"
              variant="ghost"
              disabled={audit.loading || audit.offset === 0}
              onClick={() => audit.load(Math.max(0, audit.offset - AUDIT_PAGE_SIZE))}
            >
              更早
            </Button>
            <Button
              size="small"
              variant="ghost"
              disabled={audit.loading || audit.offset >= newest}
              onClick={() => audit.load(audit.offset + AUDIT_PAGE_SIZE)}
            >
              更新
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

/** 一条审计的事件那一格：来源、事件与权限类型。 */
function eventText(entry: AuditEntry): string {
  return [auditSource(entry.source), auditEvent(entry.event), permissionKind(entry.kind)].join(
    ' · ',
  );
}

/** 摘要只给前缀；有错误码时补一句固定文案。 */
function digestText(entry: AuditEntry): string {
  const head = '#' + shortDigest(entry.targetHash);
  return entry.errorCode === undefined ? head : head + ' · ' + ERROR_MESSAGES[entry.errorCode];
}

/** 这一页覆盖了哪几条、总共多少条，以及被宿主丢弃的更早记录。 */
function rangeText(audit: AuditState, total: number, dropped: number): string {
  const first = audit.offset + 1;
  const last = audit.offset + (audit.page?.entries.length ?? 0);
  return (
    `第 ${first}–${last} 条，共 ${total} 条` + (dropped > 0 ? `（更早的 ${dropped} 条已丢弃）` : '')
  );
}

/* ---- 恢复内置功能 ---- */

interface BuiltinCardProps {
  builtins: readonly ConsoleBuiltinPackage[];
  pending: ReadonlySet<string>;
  onAsk: (builtin: ConsoleBuiltinPackage) => void;
}

/**
 * 一个已卸载的内置功能。这里只说明它是什么、声明了什么，恢复本身要再确认一次：
 * 恢复不等于信任，也不会自动启用。
 */
function BuiltinCard({ builtins, pending, onAsk }: BuiltinCardProps): JSX.Element {
  return (
    <Card title="恢复内置功能">
      {builtins.length === 0 ? (
        <p className="row__desc">没有可恢复的内置功能</p>
      ) : (
        <div className="rows rows--tight">
          {builtins.map((builtin) => (
            <div className="row" key={builtin.pluginId}>
              <span className="row__text">
                <span className="row__label">{builtin.name}</span>
                <span className="row__desc">
                  {`内置 · 版本 ${builtin.version} · 包指纹 ${shortDigest(builtin.digest)}`}
                </span>
                <span className="row__desc">
                  {builtin.permissions.length === 0
                    ? '没有声明额外权限。'
                    : builtin.permissions.map(describePermission).join('、')}
                </span>
              </span>
              <span className="row__value">
                <Button
                  disabled={pending.has(restoreKey(builtin.pluginId))}
                  data-testid={'restore-' + builtin.pluginId}
                  onClick={() => onAsk(builtin)}
                >
                  恢复
                </Button>
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

interface RestoreDialogProps {
  builtin: ConsoleBuiltinPackage | null;
  onClose: () => void;
  onConfirm: () => void;
}

/** 恢复确认：说清楚恢复之后还要做什么，别让人以为恢复完就能用。 */
function RestoreDialog({ builtin, onClose, onConfirm }: RestoreDialogProps): JSX.Element {
  return (
    <Dialog
      open={builtin !== null}
      title={builtin === null ? '' : `恢复 ${builtin.name}？`}
      onClose={onClose}
      footer={
        <>
          <Button data-autofocus onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" data-testid="restore-confirm" onClick={onConfirm}>
            恢复
          </Button>
        </>
      }
    >
      {builtin === null ? null : (
        <>
          <p>
            恢复只把这个内置功能放回插件列表。它不会因此被信任，也不会自动启用；之后仍要在“来源信任”里确认，再手动启用。
          </p>
          <div className="rows rows--tight">
            <Row label="版本">{builtin.version}</Row>
            <Row label="包指纹">{builtin.digest}</Row>
          </div>
        </>
      )}
    </Dialog>
  );
}
