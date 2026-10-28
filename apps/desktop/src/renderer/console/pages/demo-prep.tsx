import type {
  ConsolePlugin,
  ConsoleSecurityChange,
  ConsoleSecurityPlugin,
  ConsoleSecuritySnapshot,
  DemoPluginStatus,
  DemoSnapshot,
} from '@pet/contracts';
import { DEMO_PLUGIN_IDS } from '@pet/contracts';
import { useCallback, useEffect, useState, type JSX } from 'react';

import { Button, Dialog, List, ListItem, Section, StatusBadge } from '@pet/ui-kit';

import { demoPluginState, describePermission, pluginOrigin } from '../labels.js';
import type { PageId } from '../pages.js';
import type { PluginActionOutcome } from '../use-plugin-actions.js';
import type { DemoState } from '../use-demo.js';
import { useSecurityActions } from '../use-security-actions.js';

export interface DemoPrepProps {
  demo: DemoState;
  /** 向导只认这份真实安全快照：来源、指纹与声明的权限都从这里读。 */
  security: ConsoleSecuritySnapshot | null;
  onRefreshSecurity: () => void;
  onApplyChange: (change: ConsoleSecurityChange) => void;
  onUncertain: () => void;
  notify: (message: string, tone: 'ok' | 'danger') => void;
  /** 启用走外壳唯一的插件动作通道，返回宿主的真实结果。 */
  onEnable: (plugin: ConsolePlugin) => Promise<PluginActionOutcome>;
  onGoTo: (page: PageId) => void;
}

/** 开启顺序固定：识别 → 对话 → 语音 → 形象。 */
const REQUIRED: readonly string[] = [
  DEMO_PLUGIN_IDS.asr,
  DEMO_PLUGIN_IDS.demo,
  DEMO_PLUGIN_IDS.voice,
  DEMO_PLUGIN_IDS.avatar,
];

interface PrepRow {
  readonly pluginId: string;
  readonly name: string;
  readonly detail: string;
  readonly badge: { text: string; tone: 'ok' | 'warn' | 'danger' | 'neutral' };
  /** 还缺什么；null 表示这一项已经就绪。 */
  readonly problem: string | null;
  readonly fix: { label: string; page: PageId } | null;
}

/** Demo 准备清单：一项一行，缺什么就说什么，能给出去口的就给。 */
export function DemoPrep({
  demo,
  security,
  onRefreshSecurity,
  onApplyChange,
  onUncertain,
  notify,
  onEnable,
  onGoTo,
}: DemoPrepProps): JSX.Element | null {
  const snapshot = demo.snapshot;
  const [wizing, setWizard] = useState(false);
  if (snapshot === null) {
    return null;
  }
  const rows = prepRows(snapshot);
  const missing = rows.filter((row) => row.problem !== null);

  return (
    <Section
      title="Demo 准备清单"
      description="跑 Demo 需要的功能插件。信任与启用各要确认一次，清单只报当前状态。"
      actions={
        <>
          <Button
            size="small"
            variant="quiet"
            data-testid="demo-prep-refresh"
            onClick={() => {
              demo.refresh();
              onRefreshSecurity();
            }}
          >
            {demo.loading ? '读取中…' : '刷新'}
          </Button>
          <Button
            size="small"
            variant="primary"
            data-testid="demo-prep-open"
            onClick={() => {
              // 打开向导先重读一次安全快照：列表要给用户看当前真实的指纹。
              onRefreshSecurity();
              setWizard(true);
            }}
          >
            按选择准备
          </Button>
        </>
      }
    >
      <List label="准备项">
        {rows.map((row) => (
          <PrepRowItem key={row.pluginId} row={row} onGoTo={onGoTo} />
        ))}
      </List>
      {missing.length === 0 ? (
        <p className="config-banner config-banner--ok" role="status">
          没有缺项，可以直接用下面的对话。
        </p>
      ) : (
        <p className="console-muted">还差 {missing.length} 项，用「按选择准备」逐项确认。</p>
      )}
      <DemoPrepWizard
        open={wizing}
        security={security}
        snapshot={snapshot}
        onApplyChange={onApplyChange}
        onUncertain={onUncertain}
        onEnable={onEnable}
        notify={notify}
        onClose={() => setWizard(false)}
      />
    </Section>
  );
}

/** 一行准备项：缺什么就说缺什么，有出口就给出口。 */
function PrepRowItem({
  row,
  onGoTo,
}: {
  row: PrepRow;
  onGoTo: (page: PageId) => void;
}): JSX.Element {
  const fix = row.fix;
  return (
    <ListItem
      title={row.name}
      description={row.problem === null ? row.detail : `${row.detail} · ${row.problem}`}
      trailing={<StatusBadge tone={row.badge.tone}>{row.badge.text}</StatusBadge>}
      meta={
        fix === null ? null : (
          <Button
            size="small"
            variant="quiet"
            data-testid={`demo-prep-go-${row.pluginId}`}
            onClick={() => onGoTo(fix.page)}
          >
            去{fix.label}
          </Button>
        )
      }
    />
  );
}

function prepRows(snapshot: DemoSnapshot): PrepRow[] {
  const byId = new Map(snapshot.plugins.map((plugin) => [plugin.pluginId, plugin]));
  const rows: PrepRow[] = REQUIRED.map((pluginId) => {
    const status = byId.get(pluginId) ?? null;
    return prepRow(pluginId, status);
  });
  rows.push(modelRow(snapshot));
  rows.push(keyRow(snapshot));
  return rows;
}

function prepRow(pluginId: string, status: DemoPluginStatus | null): PrepRow {
  if (status === null) {
    return {
      pluginId,
      name: pluginId,
      detail: '还没有装上这个功能。',
      badge: { text: '未安装', tone: 'danger' },
      problem: '还没有这个功能',
      fix: { label: '插件', page: 'plugins' },
    };
  }
  const state = demoPluginState(status.state);
  const detail = `版本 ${status.version ?? '未知'} · ${pluginOrigin(status.origin ?? 'builtin')} · 来源信任${status.trusted ? '已确认' : '未确认'}`;
  if (status.state === 'active') {
    return {
      pluginId,
      name: status.name,
      detail,
      badge: { text: state.text, tone: state.tone },
      problem: null,
      fix: null,
    };
  }
  const problem = !status.trusted ? '还没有确认来源信任' : `当前状态：${state.text}`;
  const fix = !status.trusted
    ? { label: '权限与数据', page: 'permissions' as PageId }
    : { label: '插件', page: 'plugins' as PageId };
  return {
    pluginId,
    name: status.name,
    detail,
    badge: { text: state.text, tone: state.tone },
    problem,
    fix,
  };
}

/** 模型只在想说话时才必需：文字 Demo 不选模型也能跑。 */
function modelRow(snapshot: DemoSnapshot): PrepRow {
  const selected = snapshot.settings.modelId;
  const model = snapshot.models.find((item) => item.id === selected) ?? null;
  // preparedModelId 只说明"最近加载完的是哪个"；它为空不代表模型没准备好。
  const loaded = selected !== null && snapshot.preparedModelId === selected;
  const name = model?.name ?? selected ?? '';
  return {
    pluginId: 'model',
    name: '本地识别模型',
    detail:
      selected === null
        ? '文字对话无需识别模型；录音前请选择模型。'
        : model === null
          ? '已选 ' + selected + ' · 这个模型不在当前列表里'
          : loaded
            ? '已选 ' + name + ' · 最近已加载完成'
            : model.cached
              ? '已选 ' + name + ' · 已在本机，首次录音时校验并加载'
              : '已选 ' + name + ' · 还没有下载',
    badge:
      selected === null
        ? { text: '未选择', tone: 'neutral' }
        : model === null
          ? { text: '不在列表', tone: 'warn' }
          : loaded
            ? { text: '已加载', tone: 'ok' }
            : model.cached
              ? { text: '已在本机', tone: 'ok' }
              : { text: '缺缓存', tone: 'danger' },
    problem: selected !== null && (model === null || !model.cached) ? '模型还要下载或重选' : null,
    fix: { label: '语音输入', page: 'voice' },
  };
}

function keyRow(snapshot: DemoSnapshot): PrepRow {
  const deepseek = snapshot.settings.replyMode === 'deepseek';
  const has = snapshot.keyConfigured;
  return {
    pluginId: 'key',
    name: '回复来源',
    detail: deepseek
      ? has
        ? '真实 DeepSeek：已存有 Key（保存不等于已验证）。'
        : '选了真实 DeepSeek，还没有填 Key。'
      : '离线脚本演示，不需要 Key。',
    badge: {
      text: deepseek ? (has ? '真实回复' : '缺 Key') : '离线演示',
      tone: deepseek && !has ? 'warn' : 'neutral',
    },
    problem: deepseek && !has ? '还没有填 Key' : null,
    fix: { label: '模型', page: 'models' },
  };
}

interface WizardProps {
  open: boolean;
  security: ConsoleSecuritySnapshot | null;
  snapshot: DemoSnapshot;
  onApplyChange: (change: ConsoleSecurityChange) => void;
  onUncertain: () => void;
  onEnable: (plugin: ConsolePlugin) => Promise<PluginActionOutcome>;
  notify: (message: string, tone: 'ok' | 'danger') => void;
  onClose: () => void;
}

interface Step {
  readonly label: string;
  readonly ok: boolean;
  readonly error: string | null;
}

/**
 * 准备向导：把每一项要授予的东西摊开让用户逐条勾。
 *
 * 一勾就是一次明确的信任确认；本地预设默认不勾，勾了才会去 setPreset；
 * 启用按固定顺序，任一步失败就停下报真实原因，不继续往下推。
 */
function DemoPrepWizard({
  open,
  security,
  snapshot,
  onApplyChange,
  onUncertain,
  onEnable,
  notify,
  onClose,
}: WizardProps): JSX.Element {
  const actions = useSecurityActions({ onApply: onApplyChange, onUncertain });
  const [trusted, setTrusted] = useState<ReadonlySet<string>>(new Set());
  const [useLocalPreset, setUseLocalPreset] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [running, setRunning] = useState(false);

  // 每次重新打开都回到"还没选"的状态：上一次的勾选不代表这一次的意图。
  useEffect(() => {
    if (open) {
      setTrusted(new Set());
      setUseLocalPreset(false);
      setSteps([]);
    }
  }, [open]);

  const candidates = candidatesOf(security, snapshot);
  const selected = candidates.filter((item) => trusted.has(item.pluginId));

  const run = useCallback(async (): Promise<void> => {
    if (selected.length === 0 || security === null) {
      return;
    }
    setRunning(true);
    const log: Step[] = [];
    for (const item of selected) {
      const grant = await actions.setTrust(item.plugin, true);
      log.push({ label: `${item.plugin.name} · 确认来源信任`, ok: grant.ok, error: grant.error });
      if (!grant.ok) {
        break;
      }
      if (useLocalPreset) {
        const preset = await actions.setPreset(item.plugin, 'local');
        log.push({
          label: `${item.plugin.name} · 权限预设设为本地放行`,
          ok: preset.ok,
          error: preset.error,
        });
        if (!preset.ok) {
          break;
        }
      }
      if (item.plugin.state !== 'active') {
        const enabled = await onEnable(item.plugin);
        log.push({ label: `${item.plugin.name} · 启用`, ok: enabled.ok, error: enabled.error });
        if (!enabled.ok) {
          break;
        }
      }
    }
    setSteps(log);
    setRunning(false);
    const failed = log.find((step) => !step.ok);
    notify(
      failed === undefined ? '按选择准备完了。' : `停在：${failed.label}`,
      failed === undefined ? 'ok' : 'danger',
    );
  }, [actions, notify, onEnable, security, selected, useLocalPreset]);

  return (
    <Dialog
      open={open}
      title="按选择准备 Demo"
      onClose={onClose}
      footer={
        <>
          <Button data-autofocus onClick={onClose}>
            关闭
          </Button>
          <Button
            variant="primary"
            disabled={running || selected.length === 0}
            data-testid="demo-prep-run"
            onClick={() => void run()}
          >
            {running ? '正在准备…' : `准备选中的 ${selected.length} 项`}
          </Button>
        </>
      }
    >
      {security === null ? (
        <p>还没读到安全快照。用清单上的“刷新”再读一次。</p>
      ) : candidates.length === 0 ? (
        <p>没有需要确认的项：要用的功能都已就绪。</p>
      ) : (
        <>
          <p>
            勾一项就同意一次：信任只对这一份代码、这一次运行有效。
            本地预设默认不勾，勾了才会改成「本地放行」。
          </p>
          <label className="pk-check demo-prep__preset">
            <input
              type="checkbox"
              checked={useLocalPreset}
              onChange={(event) => setUseLocalPreset(event.target.checked)}
            />
            <span>同时把选中插件的权限预设设为「本地放行」</span>
          </label>
          <ul className="plugin-list" aria-label="待确认的内置功能">
            {candidates.map((item) => (
              <li className="plugin-row" key={item.pluginId}>
                <label className="demo-prep__row">
                  <input
                    type="checkbox"
                    checked={trusted.has(item.pluginId)}
                    onChange={(event) => {
                      setTrusted((current) => {
                        const next = new Set(current);
                        if (event.target.checked) {
                          next.add(item.pluginId);
                        } else {
                          next.delete(item.pluginId);
                        }
                        return next;
                      });
                    }}
                  />
                  <span className="demo-prep__body">
                    <span className="plugin-row__name">{item.plugin.name}</span>
                    <span className="plugin-row__meta">
                      {'版本 ' +
                        item.plugin.version +
                        ' · ' +
                        pluginOrigin(item.plugin.origin) +
                        ' · ' +
                        item.note}
                    </span>
                    {/* 完整指纹：确认信任要对得上具体那份代码。 */}
                    <span className="package-dialog__digest">{item.plugin.digest ?? '无指纹'}</span>
                    <span className="plugin-row__hint">
                      {item.plugin.permissions.length === 0
                        ? '没有声明额外权限。'
                        : item.plugin.permissions.map(describePermission).join(' · ')}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      {steps.length === 0 ? null : (
        <List label="准备结果">
          {steps.map((step) => (
            <ListItem
              key={step.label}
              title={step.label}
              description={step.ok ? '完成' : (step.error ?? '没有完成')}
              trailing={
                <StatusBadge tone={step.ok ? 'ok' : 'danger'}>
                  {step.ok ? '已做' : '未成'}
                </StatusBadge>
              }
            />
          ))}
        </List>
      )}
    </Dialog>
  );
}

interface Candidate {
  readonly pluginId: string;
  readonly plugin: ConsoleSecurityPlugin;
  readonly note: string;
}

/** 候选 = 清单里仍缺信任或缺启用的那几项，按固定顺序排。 */
function candidatesOf(
  security: ConsoleSecuritySnapshot | null,
  snapshot: DemoSnapshot,
): Candidate[] {
  if (security === null) {
    return [];
  }
  const wanted = REQUIRED.filter((id) => needsPrep(snapshot, id));
  const out: Candidate[] = [];
  for (const pluginId of wanted) {
    const plugin = security.plugins.find((item) => item.owner.pluginId === pluginId);
    if (plugin === undefined) {
      continue;
    }
    out.push({
      pluginId,
      plugin,
      note: plugin.trusted ? '已确认可信' : '需要确认信任',
    });
  }
  return out;
}

function needsPrep(snapshot: DemoSnapshot, pluginId: string): boolean {
  const status = snapshot.plugins.find((item) => item.pluginId === pluginId);
  if (status === undefined) {
    return false;
  }
  return !status.trusted || status.state !== 'active';
}
