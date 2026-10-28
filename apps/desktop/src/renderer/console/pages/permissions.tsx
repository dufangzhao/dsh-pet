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
import { useCallback, useEffect, useState, type JSX } from 'react';

import { Button, Dialog, EmptyState, List, ListItem, Section, StatusBadge } from '@pet/ui-kit';

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

            <Section
              title="来源信任"
              description="安装或启用插件是一次信任决定。信任只在本次运行有效，插件代码变化后需要重新确认。"
            >
              {security.plugins.length === 0 ? (
                <EmptyState
                  title="还没有可确认的插件"
                  description="安装插件后，它的来源与包指纹会出现在这里。"
                />
              ) : (
                <ul className="plugin-list" aria-label="插件来源信任">
                  {security.plugins.map((plugin) => (
                    <TrustRow
                      key={ownerKey(plugin.owner)}
                      plugin={plugin}
                      busy={actions.pending.has(ownerKey(plugin.owner))}
                      onAsk={askTrust}
                    />
                  ))}
                </ul>
              )}
            </Section>

            <Section
              title="权限预设"
              description="预设决定敏感操作是自动执行还是需要审批。切换立即生效，同样只在本次运行有效。"
            >
              {security.plugins.length === 0 ? (
                <EmptyState
                  title="还没有可设置的插件"
                  description="安装插件后可以在这里调整它的权限预设。"
                />
              ) : (
                <ul className="plugin-list" aria-label="插件权限预设">
                  {security.plugins.map((plugin) => (
                    <PresetRow
                      key={ownerKey(plugin.owner)}
                      plugin={plugin}
                      busy={actions.pending.has(ownerKey(plugin.owner))}
                      onPreset={changePreset}
                    />
                  ))}
                </ul>
              )}
            </Section>

            <Section
              title="恢复内置功能"
              description="卸载结果保存在本机，重启后也不会自己回来；在这里可以装回去。恢复只把功能放回插件列表，不确认信任，也不自动启用。"
            >
              {security.availableBuiltins.length === 0 ? (
                <EmptyState
                  title="没有可恢复的内置功能"
                  description="卸载内置功能之后，它会出现在这里。"
                />
              ) : (
                <ul className="plugin-list" aria-label="可恢复的内置功能">
                  {security.availableBuiltins.map((builtin) => (
                    <BuiltinRow
                      key={builtin.pluginId}
                      builtin={builtin}
                      busy={actions.pending.has(restoreKey(builtin.pluginId))}
                      onAsk={setRestoring}
                    />
                  ))}
                </ul>
              )}
            </Section>

            <AuditSection audit={audit} names={names} />

            <Section title="数据">
              <EmptyState title="数据管理尚未接入" description="清除对话记录与导出数据暂不可用。" />
            </Section>
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
    <Section
      title="待审批请求"
      description="每一项只对那一次操作有效，不形成长期授权。超时未答复会自动拒绝，晚到的答复会被丢弃。"
    >
      {prompts.length === 0 ? (
        <EmptyState
          title="没有等待审批的请求"
          description="插件发起需要审批的操作时会出现在这里。"
        />
      ) : (
        <ul className="approval-list" aria-label="待审批请求">
          {prompts.map((prompt) => {
            const left = prompt.deadlineAt - now;
            const expired = left <= 0;
            const name = names.get(ownerKey(prompt.owner)) ?? prompt.owner.pluginId;
            const busy = pending.has(prompt.requestId);
            return (
              <li className="approval-row" key={prompt.requestId}>
                <div className="approval-row__head">
                  <span className="approval-row__name">{name}</span>
                  <span className="approval-row__deadline">
                    {expired ? '已超时，等待结果' : `剩余 ${secondsOf(left)} 秒`}
                  </span>
                </div>
                <p className="approval-row__permission">{describePermission(prompt.permission)}</p>
                <div className="approval-row__actions">
                  <Button
                    size="small"
                    variant="primary"
                    disabled={expired || busy}
                    data-testid={`approval-allow-${prompt.requestId}`}
                    onClick={() => onAnswer(prompt, true, name)}
                  >
                    同意这一次
                  </Button>
                  <Button
                    size="small"
                    disabled={expired || busy}
                    data-testid={`approval-deny-${prompt.requestId}`}
                    onClick={() => onAnswer(prompt, false, name)}
                  >
                    拒绝
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
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

/* ---- 来源信任 ---- */

interface TrustRowProps {
  plugin: ConsoleSecurityPlugin;
  busy: boolean;
  onAsk: (plugin: ConsoleSecurityPlugin) => void;
}

function TrustRow({ plugin, busy, onAsk }: TrustRowProps): JSX.Element {
  return (
    <li className="plugin-row" data-owner-key={ownerKey(plugin.owner)}>
      <div className="plugin-row__head">
        <span className="plugin-row__name">{plugin.name}</span>
        <StatusBadge tone={plugin.trusted ? 'ok' : 'warn'}>
          {plugin.trusted ? '已确认可信' : '未确认'}
        </StatusBadge>
        <span className="plugin-row__meta">
          {pluginOrigin(plugin.origin)} · 版本 {plugin.version}
        </span>
      </div>
      <p className="plugin-row__hint">
        {plugin.digest === null
          ? '还没有这个插件包的指纹，暂时无法确认来源。'
          : `包指纹 ${shortDigest(plugin.digest)} · 确认只对这份代码有效`}
      </p>
      <div className="plugin-row__actions">
        <Button
          size="small"
          variant={plugin.trusted ? 'secondary' : 'primary'}
          disabled={busy || plugin.digest === null}
          data-testid={`trust-${plugin.owner.pluginId}`}
          onClick={() => onAsk(plugin)}
        >
          {plugin.trusted ? '取消信任' : '确认来源信任'}
        </Button>
      </div>
    </li>
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
    <div className="package-dialog">
      <dl className="package-dialog__facts">
        <div>
          <dt>版本</dt>
          <dd>{plugin.version}</dd>
        </div>
        <div>
          <dt>来源</dt>
          <dd>{pluginOrigin(plugin.origin)}</dd>
        </div>
        <div>
          <dt>包指纹</dt>
          <dd className="package-dialog__digest">{plugin.digest ?? '未知'}</dd>
        </div>
      </dl>
      <p>
        确认后，这个插件可以在本次运行中启动。它声明的敏感操作仍然逐个询问，不会因为确认信任就自动通过。
      </p>
      {plugin.permissions.length === 0 ? (
        <p>没有声明额外权限。</p>
      ) : (
        <>
          <p>它声明需要：</p>
          <ul className="package-dialog__permissions">
            {plugin.permissions.map((permission, index) => (
              <li key={`${permission.kind}|${index}`}>{describePermission(permission)}</li>
            ))}
          </ul>
        </>
      )}
      <p className="console-muted">信任只在本次运行有效；插件代码变化后需要重新确认。</p>
    </div>
  );
}

/* ---- 权限预设 ---- */

interface PresetRowProps {
  plugin: ConsoleSecurityPlugin;
  busy: boolean;
  onPreset: (plugin: ConsoleSecurityPlugin, preset: PermissionPreset) => void;
}

function PresetRow({ plugin, busy, onPreset }: PresetRowProps): JSX.Element {
  return (
    <li className="plugin-row" data-owner-key={ownerKey(plugin.owner)}>
      <fieldset className="preset-group">
        <legend className="preset-group__legend">{plugin.name}</legend>
        <p className="plugin-row__hint">
          {plugin.blocked
            ? '已暂停：所有敏感操作都会被拒绝。切换预设即可恢复。'
            : `当前预设：${presetLabel(plugin.preset)}`}
        </p>
        <div className="preset-options">
          {PERMISSION_PRESETS.map((preset) => (
            <label className="preset-option" key={preset}>
              <input
                type="radio"
                className="preset-option__radio"
                name={`preset-${ownerKey(plugin.owner)}`}
                value={preset}
                /*
                 * 暂停时一个都不选中：这样再点当前那一档也会触发 onChange，
                 * 用户才有办法从“已暂停”回到正常状态。
                 */
                checked={plugin.preset === preset && !plugin.blocked}
                disabled={busy}
                onChange={() => onPreset(plugin, preset)}
              />
              <span className="preset-option__body">
                <span className="preset-option__label">{presetLabel(preset)}</span>
                <span className="preset-option__text">
                  {PERMISSION_PRESET_DESCRIPTIONS[preset]}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </li>
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
    <Section
      title="审计"
      description="每次请求与结果都记一条，只含元数据：谁、何时、什么类型、结果如何，不含内容与参数值。"
      actions={
        <button
          type="button"
          className="console-action"
          data-testid="audit-refresh"
          onClick={audit.refresh}
          disabled={audit.loading}
        >
          {audit.loading ? '读取中…' : '刷新'}
        </button>
      }
    >
      {audit.error !== null ? (
        <EmptyState
          title="读取审计失败"
          description={audit.error}
          action={<Button onClick={audit.refresh}>重新读取</Button>}
        />
      ) : page === null ? (
        <p className="console-muted">正在读取审计记录…</p>
      ) : page.entries.length === 0 ? (
        <EmptyState
          title="还没有记录"
          description="插件发起权限请求或审批之后，这里会出现对应的记录。"
        />
      ) : (
        <>
          <List label="审计记录">
            {page.entries.map((entry) => (
              <ListItem
                key={entry.id}
                title={`${names.get(ownerKey(entry.owner)) ?? entry.owner.pluginId} · ${auditEvent(entry.event)}`}
                description={describeEntry(entry)}
                meta={clockTime(entry.at)}
              />
            ))}
          </List>
          <div className="audit-nav">
            <span className="config-count">
              第 {audit.offset + 1}–{audit.offset + page.entries.length} 条，共 {page.total} 条
              {page.dropped > 0 ? `（更早的 ${page.dropped} 条已丢弃）` : ''}
            </span>
            <Button
              size="small"
              variant="quiet"
              disabled={audit.loading || audit.offset === 0}
              onClick={() => audit.load(Math.max(0, audit.offset - AUDIT_PAGE_SIZE))}
            >
              更早
            </Button>
            <Button
              size="small"
              variant="quiet"
              disabled={audit.loading || audit.offset >= newest}
              onClick={() => audit.load(audit.offset + AUDIT_PAGE_SIZE)}
            >
              更新
            </Button>
          </div>
        </>
      )}
    </Section>
  );
}

/** 一条审计的次要信息：来源、类型、指纹前缀，有错误码时补一句固定文案。 */
function describeEntry(entry: AuditEntry): string {
  const parts = [
    auditSource(entry.source),
    permissionKind(entry.kind),
    `#${shortDigest(entry.targetHash)}`,
  ];
  if (entry.errorCode !== undefined) {
    parts.push(ERROR_MESSAGES[entry.errorCode]);
  }
  return parts.join(' · ');
}

/* ---- 恢复内置功能 ---- */

interface BuiltinRowProps {
  builtin: ConsoleBuiltinPackage;
  busy: boolean;
  onAsk: (builtin: ConsoleBuiltinPackage) => void;
}

/**
 * 一个已卸载的内置功能。这里只说明它是什么、声明了什么，恢复本身要再确认一次：
 * 恢复不等于信任，也不会自动启用。
 */
function BuiltinRow({ builtin, busy, onAsk }: BuiltinRowProps): JSX.Element {
  return (
    <li className="plugin-row" data-builtin-id={builtin.pluginId}>
      <div className="plugin-row__head">
        <span className="plugin-row__name">{builtin.name}</span>
        <span className="plugin-row__meta">
          {pluginOrigin('builtin')} · 版本 {builtin.version} · 包指纹 {shortDigest(builtin.digest)}
        </span>
      </div>
      {builtin.permissions.length === 0 ? (
        <p className="plugin-row__hint">没有声明额外权限。</p>
      ) : (
        <details className="plugin-row__permissions">
          <summary className="plugin-row__summary">
            声明的权限（{builtin.permissions.length}）· 这是请求，不是授权
          </summary>
          <ul className="plugin-row__permission-list">
            {builtin.permissions.map((permission, index) => (
              <li key={`${permission.kind}|${index}`}>{describePermission(permission)}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="plugin-row__actions">
        <Button
          size="small"
          disabled={busy}
          data-testid={`restore-${builtin.pluginId}`}
          onClick={() => onAsk(builtin)}
        >
          恢复
        </Button>
      </div>
    </li>
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
        <div className="package-dialog">
          <p>
            恢复只把这个内置功能放回插件列表。它不会因此被信任，也不会自动启用；之后仍要在“来源信任”里确认，再手动启用。
          </p>
          <dl className="package-dialog__facts">
            <div>
              <dt>版本</dt>
              <dd>{builtin.version}</dd>
            </div>
            <div>
              <dt>包指纹</dt>
              <dd className="package-dialog__digest">{builtin.digest}</dd>
            </div>
          </dl>
        </div>
      )}
    </Dialog>
  );
}
