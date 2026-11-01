import { useId, useState, type JSX } from 'react';

import type { ApplicationPreferences, PersonaTemplate } from '@pet/contracts';
import { APPLICATION_PROFILE_MAX_PROMPT } from '@pet/contracts';

import { ConsoleStatus } from '../console-status.js';
import { PROFILE_CONFLICT, describeError } from '../copy.js';
import { replyLanguage, styleLabel } from '../labels.js';
import { Button, Card, Field, Select, Status, Switch } from '../minimal-ui/controls.js';
import { SpeechSettingsPanel } from '../minimal-ui/speech-settings.js';
import { PersonaPromptEditor } from '../persona-prompt-editor.js';
import type { ApplicationState } from '../use-application.js';

export interface PersonaPageProps {
  app: ApplicationState;
  notify: (message: string, tone: 'ok' | 'danger') => void;
}

const HABIT_FIELDS = [
  'petName',
  'userName',
  'replyLanguage',
  'style',
  'doubleClickTyping',
  'statusBubble',
  'saidBubble',
  'bubbleFontSize',
  'bubbleSpeed',
  'glow',
  'hover',
] as const;
const BUBBLE_SWITCHES = [
  ['doubleClickTyping', '双击桌宠打开聊天'],
  ['statusBubble', '显示处理状态气泡'],
  ['saidBubble', '显示回复气泡'],
] as const;
const RANGES = [
  { field: 'bubbleFontSize', label: '气泡字号', min: 80, max: 160, unit: '%' },
  { field: 'bubbleSpeed', label: '气泡消失速度', min: 50, max: 200, unit: '%' },
  { field: 'glow', label: '角色外发光', min: 0, max: 16, unit: '' },
] as const;

/** All edits stay in the shared profile draft until an explicit CAS save succeeds. */
export function PersonaPage({ app, notify }: PersonaPageProps): JSX.Element {
  const [tab, setTab] = useState<'habits' | 'templates'>('habits');
  const base = useId();
  const values = app.values;
  const stored = app.snapshot?.profile ?? null;
  const prompt = app.snapshot?.prompt ?? null;
  const selected =
    values?.personaTemplates.find((item) => item.id === values.personaTemplate) ?? null;
  const habitEdited = HABIT_FIELDS.some((field) => app.edited.has(field));
  const templateEdited =
    app.edited.has('personaTemplate') ||
    app.edited.has('personaTemplates') ||
    app.edited.has('personaPrompt');
  const templateValid =
    values !== null &&
    values.personaPrompt.trim() !== '' &&
    values.personaPrompt.length <= APPLICATION_PROFILE_MAX_PROMPT &&
    values.personaTemplates.every(
      (item) =>
        item.name.trim() !== '' &&
        item.prompt.trim() !== '' &&
        item.prompt.length <= APPLICATION_PROFILE_MAX_PROMPT,
    );

  const save = async (patch: Partial<ApplicationPreferences>, label: string): Promise<void> => {
    const outcome = await app.save(patch);
    notify(
      outcome.ok ? `${label}已保存。` : `${label}没有保存：${outcome.error ?? '未知原因'}`,
      outcome.ok ? 'ok' : 'danger',
    );
  };
  const saveHabits = (): void => {
    if (!values) return;
    void save(
      {
        petName: values.petName.trim(),
        userName: values.userName.trim(),
        replyLanguage: values.replyLanguage,
        style: values.style,
        doubleClickTyping: values.doubleClickTyping,
        statusBubble: values.statusBubble,
        saidBubble: values.saidBubble,
        bubbleFontSize: values.bubbleFontSize,
        bubbleSpeed: values.bubbleSpeed,
        glow: values.glow,
        hover: values.hover,
      },
      '习惯',
    );
  };
  const saveTemplates = (): void => {
    if (!values) return;
    if (!templateValid) {
      notify('请填写模板名称和正文，并检查正文长度。草稿已保留。', 'danger');
      return;
    }
    void save(
      {
        personaTemplate: values.personaTemplate,
        personaPrompt: values.personaPrompt,
        personaTemplates: values.personaTemplates.map((item) => ({
          ...item,
          name: item.name.trim(),
        })),
      },
      '人格模板',
    );
  };
  const chooseTemplate = (id: string): void => {
    const item = values?.personaTemplates.find((entry) => entry.id === id);
    if (!item) return;
    app.edit('personaTemplate', item.id);
    app.edit('personaPrompt', item.prompt);
  };
  const editTemplate = (patch: Partial<Pick<PersonaTemplate, 'name' | 'prompt'>>): void => {
    if (!values || !selected || selected.builtin) return;
    app.edit(
      'personaTemplates',
      values.personaTemplates.map((item) =>
        item.id === selected.id ? { ...item, ...patch } : item,
      ),
    );
  };
  const editPrompt = (text: string): void => {
    app.edit('personaPrompt', text);
    editTemplate({ prompt: text });
  };
  const createTemplate = (copy: boolean): void => {
    if (!values || values.personaTemplates.length >= 16) return;
    const item: PersonaTemplate = {
      id: `custom-${crypto.randomUUID()}`,
      name: copy ? `${selected?.name ?? '当前人格'}副本`.slice(0, 40) : '新模板',
      prompt: copy ? values.personaPrompt : '',
      builtin: false,
    };
    app.edit('personaTemplates', [...values.personaTemplates, item]);
    app.edit('personaTemplate', item.id);
    app.edit('personaPrompt', item.prompt);
  };
  const resetTemplate = (): void => {
    if (!selected || !values) return;
    const original = stored?.data.personaTemplates.find((item) => item.id === selected.id);
    if (!original) return;
    app.edit(
      'personaTemplates',
      values.personaTemplates.map((item) => (item.id === original.id ? { ...original } : item)),
    );
    app.edit('personaPrompt', original.prompt);
  };

  return (
    <ConsoleStatus
      loading={app.loading}
      error={app.error}
      available={app.available}
      onRetry={app.refresh}
    >
      {values === null || prompt === null ? null : (
        <>
          <div className="persona-tabs" role="tablist" aria-label="人设设置">
            {(['habits', 'templates'] as const).map((name) => (
              <button
                key={name}
                type="button"
                className="persona-tab"
                role="tab"
                id={`${base}-tab-${name}`}
                aria-controls={`${base}-panel-${name}`}
                aria-selected={tab === name}
                tabIndex={tab === name ? 0 : -1}
                data-testid={`persona-tab-${name}`}
                onClick={() => setTab(name)}
                onKeyDown={(event) => {
                  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                  event.preventDefault();
                  const next =
                    event.key === 'Home'
                      ? 'habits'
                      : event.key === 'End'
                        ? 'templates'
                        : tab === 'habits'
                          ? 'templates'
                          : 'habits';
                  setTab(next);
                  document.getElementById(`${base}-tab-${next}`)?.focus();
                }}
              >
                {name === 'habits' ? '习惯' : '人格模板'}
              </button>
            ))}
          </div>
          {app.conflict ? (
            <p role="alert" className="field__error">
              {PROFILE_CONFLICT} 草稿仍保留。
              <Button size="small" onClick={app.refresh}>
                读取最新版本
              </Button>
            </p>
          ) : null}
          <div
            className="persona-panel"
            role="tabpanel"
            id={`${base}-panel-habits`}
            aria-labelledby={`${base}-tab-habits`}
            hidden={tab !== 'habits'}
          >
            <Card
              title="基本设定"
              action={<Status>{habitEdited ? '有未保存的改动' : '与已保存设置一致'}</Status>}
            >
              <div className="field-row">
                <Field label="它的名字" className="field--grow">
                  {({ inputId }) => (
                    <div className="inputForm">
                      <input
                        id={inputId}
                        className="input"
                        value={values.petName}
                        maxLength={40}
                        autoComplete="off"
                        disabled={app.saving}
                        data-testid="pref-pet-name"
                        onChange={(event) => app.edit('petName', event.target.value)}
                      />
                    </div>
                  )}
                </Field>
                <Field label="称呼你" className="field--grow">
                  {({ inputId }) => (
                    <div className="inputForm">
                      <input
                        id={inputId}
                        className="input"
                        value={values.userName}
                        maxLength={40}
                        autoComplete="off"
                        disabled={app.saving}
                        data-testid="pref-user-name"
                        onChange={(event) => app.edit('userName', event.target.value)}
                      />
                    </div>
                  )}
                </Field>
              </div>
              <div className="field-row">
                <Field label="回复语言" className="field--grow">
                  {({ inputId }) => (
                    <Select
                      id={inputId}
                      value={values.replyLanguage}
                      data-testid="pref-reply-language"
                      disabled={app.saving}
                      options={(['zh-CN', 'en'] as const).map((value) => ({
                        value,
                        label: replyLanguage(value),
                      }))}
                      onChange={(event) => {
                        const next = event.target.value;
                        if (next === 'zh-CN' || next === 'en') app.edit('replyLanguage', next);
                      }}
                    />
                  )}
                </Field>
                <Field label="说话风格" className="field--grow">
                  {({ inputId }) => (
                    <Select
                      id={inputId}
                      value={values.style}
                      data-testid="pref-style-select"
                      disabled={app.saving}
                      options={(['quiet', 'natural', 'lively'] as const).map((value) => ({
                        value,
                        label: styleLabel(value),
                      }))}
                      onChange={(event) => {
                        const next = event.target.value;
                        if (next === 'quiet' || next === 'natural' || next === 'lively')
                          app.edit('style', next);
                      }}
                    />
                  )}
                </Field>
              </div>
            </Card>
            <Card title="聊天与气泡">
              <div className="rows rows--tight">
                {BUBBLE_SWITCHES.map(([field, label]) => (
                  <Switch
                    key={field}
                    label={label}
                    checked={values[field]}
                    disabled={app.saving}
                    data-testid={`pref-${field}`}
                    onChange={(checked) => app.edit(field, checked)}
                  />
                ))}
              </div>
              <div className="field">
                <span className="field__label">悬停时显示</span>
                <div className="persona-switches">
                  {(['chat', 'voice'] as const).map((kind) => (
                    <Switch
                      key={kind}
                      label={kind === 'chat' ? '文字聊天' : '语音输入'}
                      checked={values.hover.includes(kind)}
                      disabled={app.saving}
                      onChange={(checked) =>
                        app.edit(
                          'hover',
                          checked
                            ? [...values.hover, kind]
                            : values.hover.filter((item) => item !== kind),
                        )
                      }
                    />
                  ))}
                </div>
              </div>
              <div className="persona-ranges">
                {RANGES.map(({ field, label, min, max, unit }) => (
                  <div className="persona-range" key={field}>
                    <label className="persona-range__label" htmlFor={`${base}-${field}`}>
                      {label}
                    </label>
                    <input
                      id={`${base}-${field}`}
                      type="range"
                      className="slider"
                      min={min}
                      max={max}
                      step={1}
                      value={values[field]}
                      disabled={app.saving}
                      data-testid={`pref-${field}`}
                      onChange={(event) => app.edit(field, Number(event.target.value))}
                    />
                    <output className="persona-range__value" htmlFor={`${base}-${field}`}>
                      {values[field]}
                      {unit}
                    </output>
                  </div>
                ))}
              </div>
              <p className="row__desc">气泡速度越高，停留时间越短。待机时不显示常驻气泡。</p>
              <div className="card__foot">
                <Button
                  variant="primary"
                  data-testid="pref-names-save"
                  busy={app.saving}
                  disabled={!habitEdited || !values.petName.trim() || !values.userName.trim()}
                  onClick={saveHabits}
                >
                  保存习惯
                </Button>
              </div>
            </Card>
            <SpeechSettingsPanel />
            <Card title="角色能力">
              <p className="row__desc">
                当前极简角色支持拖动、触碰、表情和聊天。自由漫游、自动唤醒、睡眠与帧率控制尚未接入；相关已保存设置会保留，当前角色不会执行这些动作。
              </p>
            </Card>
          </div>
          <div
            className="persona-panel"
            role="tabpanel"
            id={`${base}-panel-templates`}
            aria-labelledby={`${base}-tab-templates`}
            hidden={tab !== 'templates'}
          >
            <Card
              title="人格模板"
              action={<Status>{templateEdited ? '有未保存的改动' : '与已保存模板一致'}</Status>}
            >
              <div className="field-row">
                <Field label="模板" className="field--grow">
                  {({ inputId }) => (
                    <Select
                      id={inputId}
                      value={values.personaTemplate}
                      disabled={app.saving}
                      data-testid="persona-template-select"
                      options={[
                        ...(selected
                          ? []
                          : [{ value: values.personaTemplate, label: '当前模板不在库中' }]),
                        ...values.personaTemplates.map((item) => ({
                          value: item.id,
                          label: item.name + (item.builtin ? '（内置）' : ''),
                        })),
                      ]}
                      onChange={(event) => chooseTemplate(event.target.value)}
                    />
                  )}
                </Field>
                <Field label="模板名" className="field--grow">
                  {({ inputId }) => (
                    <div className="inputForm">
                      <input
                        id={inputId}
                        className="input"
                        value={selected?.name ?? ''}
                        maxLength={40}
                        disabled={app.saving || !selected || selected.builtin}
                        data-testid="persona-template-name"
                        onChange={(event) => editTemplate({ name: event.target.value })}
                      />
                    </div>
                  )}
                </Field>
              </div>
              <p className="row__desc">
                {selected?.builtin
                  ? '内置模板可以复制后改名。修改下方正文只改变当前人格，不会覆盖内置模板。'
                  : '模板库、当前选择与正文会在同一次保存中写入。'}
              </p>
              <div className="card__foot">
                <Button
                  disabled={app.saving || values.personaTemplates.length >= 16}
                  onClick={() => createTemplate(false)}
                >
                  新建
                </Button>
                <Button
                  disabled={app.saving || values.personaTemplates.length >= 16}
                  onClick={() => createTemplate(true)}
                >
                  复制
                </Button>
                <Button
                  disabled={
                    app.saving ||
                    !stored?.data.personaTemplates.some((item) => item.id === selected?.id)
                  }
                  onClick={resetTemplate}
                >
                  重置本模板
                </Button>
                <Button
                  variant="primary"
                  data-testid="persona-template-save"
                  busy={app.saving}
                  disabled={!templateEdited || !templateValid}
                  onClick={saveTemplates}
                >
                  保存模板
                </Button>
                <span className="row__value">{values.personaTemplates.length} / 16 个模板</span>
              </div>
            </Card>
            <PersonaPromptEditor
              draft={values.personaPrompt}
              saved={stored?.data.personaPrompt}
              onChangeDraft={editPrompt}
              onSave={saveTemplates}
              state={prompt.state}
              error={promptError(app.snapshot, app.conflict)}
              maxLength={APPLICATION_PROFILE_MAX_PROMPT}
              saving={app.saving}
              disabled={app.loading || app.saving}
              onReload={app.refresh}
            />
          </div>
        </>
      )}
    </ConsoleStatus>
  );
}

function promptError(
  snapshot: ApplicationState['snapshot'],
  conflict: boolean,
): string | undefined {
  if (conflict) return PROFILE_CONFLICT;
  if (snapshot?.prompt.state !== 'error') return undefined;
  return snapshot.error === null
    ? '提示词尚未生效。请检查设置后重试。'
    : describeError(snapshot.error);
}
