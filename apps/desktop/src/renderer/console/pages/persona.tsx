/**
 * 人格页：服务里那个助手的只读身份 + 这台机器上的呈现细节。
 *
 * 人格正文属于服务，这一版只读：修订号或 agentId 与当前快照不符时只报冲突，
 * 不自动重读、不写回本地偏好。气泡字号、速度、发光、双击与状态气泡这些是本地呈现，
 * 走 presentation.save，与服务人格无关。
 */
import {
  errorMessage,
  type CompanionMemoryForgetCommand,
  type CompanionMemoryUpsertCommand,
  type CompanionMemoryView,
  type CompanionProfileSaveCommand,
  type CompanionProfileView,
  type Result,
} from '@pet/contracts';
import { PersonaMemory } from '@pet/text-client/persona-memory-ui';
import '@pet/text-client/persona-memory.css';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type JSX } from 'react';

import { Button, Card, Status } from '../minimal-ui/controls.js';
import type { CompanionView } from '../../shared/use-companion.js';
import type { LocalPresentationView } from '../../shared/use-local-presentation.js';
import { agentModeLabel, clockTime, connectionView } from '../../shared/companion-state.js';

export interface PersonaPageProps {
  companion: CompanionView;
  presentation: LocalPresentationView;
  notify: (message: string, tone: 'ok' | 'danger') => void;
}

const RANGES = [
  { field: 'bubbleFontSize', label: '气泡字号', min: 80, max: 160, unit: '%' },
  { field: 'bubbleSpeed', label: '气泡消失速度', min: 50, max: 200, unit: '%' },
  { field: 'glow', label: '角色外发光', min: 0, max: 16, unit: '' },
] as const;

const SWITCHES = [
  ['doubleClickTyping', '双击桌宠打开聊天'],
  ['statusBubble', '显示处理状态气泡'],
  ['saidBubble', '显示回复气泡'],
] as const;

export function PersonaPage({ companion, presentation, notify }: PersonaPageProps): JSX.Element {
  const state = companion.state;
  const snapshot = state?.snapshot ?? null;
  const preferences = presentation.snapshot?.preferences ?? null;
  const [profile, setProfile] = useState<CompanionProfileView | null>(null);
  const [memory, setMemory] = useState<CompanionMemoryView | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const generation = useRef(0);
  /** 这份正文是按哪一个 profileRevision 读的：服务端一升版就作废，等显式重读。 */
  const profileReadAt = useRef<number | null>(null);

  /**
   * 共享组件要的五件事，全部转到这个窗口已有的 bridge 上。
   * 结构式声明：组件不认识 CompanionView，只认识这五个方法。
   */
  const transport = useMemo(
    () => ({
      readProfile: (): Promise<Result<CompanionProfileView>> => companion.readProfile(),
      saveProfile: (command: CompanionProfileSaveCommand) => companion.saveProfile(command),
      readMemory: (): Promise<Result<CompanionMemoryView>> => companion.readMemory(),
      upsertFact: (command: CompanionMemoryUpsertCommand) => companion.upsertFact(command),
      forgetFact: (command: CompanionMemoryForgetCommand) => companion.forgetFact(command),
    }),
    [companion],
  );

  /**
   * 记忆视图由**快照**派生：它是唯一 owner，SSE 新到的 facts/application 必须能显示。
   * 显式读取只用于表单的 read/rebase，不能变成一层永远压住快照的缓存。
   * 只有当快照还没有 memory metadata、而显式读取拿到了完整视图时才用它。
   */
  const memoryView = useMemo<CompanionMemoryView | null>(() => {
    if (snapshot !== null && snapshot.memory !== undefined)
      return { ...snapshot.memory, agentId: snapshot.agent.id, facts: snapshot.facts };
    return memory;
  }, [memory, snapshot]);

  const load = useCallback(async (): Promise<void> => {
    if (state === null || state.connectionId === null) return;
    const started = ++generation.current;
    setFailure(null);
    const [profileResult, memoryResult] = await Promise.all([
      companion.readProfile(),
      companion.readMemory(),
    ]);
    if (generation.current !== started) return;
    if (profileResult.ok) {
      setProfile(profileResult.value);
      profileReadAt.current = profileResult.value.revision;
    } else if (profileResult.error.code === 'conflict')
      setFailure('人格在别处刚改过，这一版对不上；等下一次刷新后再看。');
    else setFailure(`人格没有读出来：${errorMessage(profileResult.error)}`);
    // 记忆读不出来不算致命：快照里那份 metadata 仍然可以渲染。
    if (memoryResult.ok) setMemory(memoryResult.value);
  }, [companion, state]);

  // 目标换了就丢掉旧正文：不拿上一个服务的人格冒充现在这一个。
  useEffect(() => {
    setProfile(null);
    setMemory(null);
    setFailure(null);
    profileReadAt.current = null;
    generation.current += 1;
  }, [state?.connectionId]);

  /**
   * 服务端 profileRevision 变了：这份正文不再是当前值。
   *
   * 但**不能置空**——置空会让组件以为这个 feature 不支持（只读/不可编辑），
   * 外部改动提示也一起消失。保留已读到的正文并标成 stale，同时自动重读一次；
   * 重读失败也留着旧正文，由用户决定。
   */
  const canonicalProfileRevision = snapshot?.agent.profileRevision ?? null;
  const profileStale =
    canonicalProfileRevision !== null &&
    profileReadAt.current !== null &&
    profileReadAt.current !== canonicalProfileRevision;

  useEffect(() => {
    if (canonicalProfileRevision === null) return;
    if (profileReadAt.current === null) return;
    if (profileReadAt.current === canonicalProfileRevision) return;
    // 合并成一次重读，不因为一次 save 就永远要求手动点。
    const started = ++generation.current;
    void companion.readProfile().then((result) => {
      if (generation.current !== started) return;
      if (result.ok) {
        setProfile(result.value);
        profileReadAt.current = result.value.revision;
      }
    });
  }, [canonicalProfileRevision, companion]);

  const save = async (patch: Parameters<LocalPresentationView['save']>[0], label: string) => {
    const ok = await presentation.save(patch);
    if (!ok) notify(`${label}没有保存。`, 'danger');
  };

  const connection = state === null ? null : connectionView(state);
  const canRead = state !== null && state.connectionId !== null && state.phase === 'live';

  return (
    <>
      <Card
        title="服务里的助手"
        action={
          <Button
            size="small"
            disabled={!canRead}
            data-testid="persona-read"
            onClick={() => void load()}
          >
            {profile === null ? '读取人格' : '重新读取'}
          </Button>
        }
      >
        {snapshot === null ? (
          <p className="row__value" role="status">
            {connection === null ? '正在读取连接状态…' : '还没有连上服务。'}
          </p>
        ) : (
          <div className="rows rows--tight">
            <Row label="服务身份" value={snapshot.agent.id} />
            <Row label="模式" value={agentModeLabel(snapshot.agent)} />
            <Row
              label="最后确认"
              value={state?.confirmedAt == null ? '尚未确认' : clockTime(state.confirmedAt)}
            />
          </div>
        )}

        {failure === null ? null : (
          <p className="field__error" role="alert" data-testid="persona-error">
            {failure}
          </p>
        )}

        {/* 人格与记忆：编辑规则全在共享的 memory-form 里，这里只做 bridge 适配。 */}
        <PersonaMemory
          transport={transport}
          live={state !== null && state.phase === 'live'}
          agentStatus={snapshot?.agent.status ?? null}
          profile={profile}
          profileStale={profileStale}
          profileApplication={snapshot?.agent.profileApplication}
          memory={memoryView}
          targetKey={state?.connectionId ?? 'none'}
          onNotice={(message: string) => notify(message, 'ok')}
        />
      </Card>

      <Card
        title="聊天与气泡"
        action={<Status>{presentation.saving ? '正在保存…' : '本机呈现'}</Status>}
      >
        {preferences === null ? (
          <p className="row__value" role="status">
            还没有读到本机的外观记录。
          </p>
        ) : (
          <>
            <div className="rows">
              {SWITCHES.map(([field, label]) => (
                <label className="row" key={field}>
                  <span className="row__text">
                    <span className="row__label">{label}</span>
                  </span>
                  <span className="switch">
                    <input
                      type="checkbox"
                      role="switch"
                      data-testid={'pref-' + field}
                      checked={Boolean(preferences[field])}
                      disabled={presentation.saving}
                      onChange={(event) => void save({ [field]: event.target.checked }, label)}
                    />
                    <i aria-hidden="true" />
                  </span>
                </label>
              ))}
            </div>
            <div className="rows">
              {RANGES.map((range) => (
                <RangeRow
                  key={range.field}
                  label={range.label}
                  min={range.min}
                  max={range.max}
                  unit={range.unit}
                  value={Number(preferences[range.field] ?? 0)}
                  disabled={presentation.saving}
                  testId={'pref-' + range.field}
                  onCommit={(next) => void save({ [range.field]: next }, range.label)}
                />
              ))}
            </div>
          </>
        )}
        {presentation.error === null ? null : (
          <p className="field__error" role="alert">
            {presentation.error}
          </p>
        )}
      </Card>
    </>
  );
}

/** 拖动时只改本地显示，松手才写；写的是这一份记录的 revision。 */
function RangeRow({
  label,
  min,
  max,
  unit,
  value,
  disabled,
  testId,
  onCommit,
}: {
  label: string;
  min: number;
  max: number;
  unit: string;
  value: number;
  disabled: boolean;
  testId: string;
  onCommit: (next: number) => void;
}): JSX.Element {
  const id = useId();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <div className="row">
      <span className="row__text">
        <label className="row__label" htmlFor={id}>
          {label}
        </label>
      </span>
      <span className="row__value">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={1}
          value={draft}
          disabled={disabled}
          data-testid={testId}
          onChange={(event) => setDraft(Number(event.target.value))}
          onPointerUp={() => onCommit(draft)}
          onKeyUp={() => onCommit(draft)}
        />
        {draft}
        {unit}
      </span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="row">
      <span className="row__text">
        <span className="row__label">{label}</span>
      </span>
      <span className="row__value">{value}</span>
    </div>
  );
}
