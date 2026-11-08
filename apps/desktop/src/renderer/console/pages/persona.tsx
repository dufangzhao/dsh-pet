/**
 * 人格页：服务里那个助手的只读身份 + 这台机器上的呈现细节。
 *
 * 人格正文属于服务，这一版只读：修订号或 agentId 与当前快照不符时只报冲突，
 * 不自动重读、不写回本地偏好。气泡字号、速度、发光、双击与状态气泡这些是本地呈现，
 * 走 presentation.save，与服务人格无关。
 */
import { errorMessage } from '@pet/contracts';
import { useCallback, useEffect, useId, useRef, useState, type JSX } from 'react';

import { Button, Card, Status } from '../minimal-ui/controls.js';
import { SpeechSettingsPanel } from '../minimal-ui/speech-settings.js';
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
  const [profile, setProfile] = useState<{
    agentId: string;
    name: string;
    persona: string;
    revision: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const generation = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    if (state === null || state.connectionId === null) return;
    const started = ++generation.current;
    setLoading(true);
    setFailure(null);
    const result = await companion.readProfile();
    if (generation.current !== started) return;
    setLoading(false);
    if (result.ok) setProfile(result.value);
    else if (result.error.code === 'conflict')
      setFailure('人格在别处刚改过，这一版对不上；等下一次刷新后再看。');
    else setFailure(`人格没有读出来：${errorMessage(result.error)}`);
  }, [companion, state]);

  // 目标换了就丢掉旧正文：不拿上一个服务的人格冒充现在这一个。
  useEffect(() => {
    setProfile(null);
    setFailure(null);
    generation.current += 1;
  }, [state?.connectionId]);

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
            busy={loading}
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
            <Row label="名字" value={snapshot.agent.name} />
            <Row label="模式" value={agentModeLabel(snapshot.agent)} />
            <Row label="人格修订" value={String(snapshot.agent.profileRevision)} />
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

        {profile === null ? (
          <p className="row__value">人格正文按需读取：它可能很长，所以不放进每次刷新的快照里。</p>
        ) : (
          <>
            <div className="rows rows--tight">
              <Row label="正文修订" value={String(profile.revision)} />
              <Row label="服务身份" value={profile.agentId} />
            </div>
            <pre className="persona-prompt" data-testid="persona-body">
              {profile.persona}
            </pre>
          </>
        )}
        <p className="row__value">
          人格由服务保存。这一版不能在这里修改；本地只改下面这些呈现细节。
        </p>
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

      <Card title="声音">
        <SpeechSettingsPanel />
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
