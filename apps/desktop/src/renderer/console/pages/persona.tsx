import { useId, useState, type JSX } from 'react';

import type { ApplicationPreferences } from '@pet/contracts';
import { APPLICATION_PROFILE_MAX_PROMPT } from '@pet/contracts';

import { saveChoice } from '../app-views.js';
import { ConsoleStatus } from '../console-status.js';
import { PROFILE_CONFLICT, describeError } from '../copy.js';
import { replyLanguage, styleLabel } from '../labels.js';
import { Button, Card, Field } from '../minimal-ui/controls.js';
import { PersonaPromptEditor } from '../persona-prompt-editor.js';
import type { ApplicationState } from '../use-application.js';

export interface PersonaPageProps {
  app: ApplicationState;
  notify: (message: string, tone: 'ok' | 'danger') => void;
}

const LANGUAGES = ['zh-CN', 'en'] as const;
const STYLES = ['quiet', 'natural', 'lively'] as const;

/**
 * 人设页：称呼、语言、说话风格，以及它真正读到的那段提示词。
 *
 * 文本（名字、正文）留草稿 + 显式保存；选择（语言、风格）点了就写。
 * 提示词的已保存 / 待生效 / 已生效 / 失败来自宿主快照，界面不自己推断；
 * 完整提示词仍交给 PersonaPromptEditor，这里不复制一份只读正文。
 */
export function PersonaPage({ app, notify }: PersonaPageProps): JSX.Element {
  const [savingNames, setSavingNames] = useState(false);
  const languageId = useId();
  const styleId = useId();

  const values = app.values;
  const stored = app.snapshot?.profile ?? null;
  const prompt = app.snapshot?.prompt ?? null;
  const nameEdited = app.edited.has('petName') || app.edited.has('userName');

  const saveNames = async (): Promise<void> => {
    if (values === null) {
      return;
    }
    const patch: Partial<ApplicationPreferences> = {
      petName: values.petName.trim(),
      userName: values.userName.trim(),
    };
    setSavingNames(true);
    const outcome = await app.save(patch);
    setSavingNames(false);
    notify(
      outcome.ok ? '名字已保存。' : `名字没有保存：${outcome.error ?? '未知原因'}`,
      outcome.ok ? 'ok' : 'danger',
    );
  };

  const savePrompt = async (): Promise<void> => {
    if (values === null) {
      return;
    }
    const outcome = await app.save({ personaPrompt: values.personaPrompt });
    notify(
      outcome.ok
        ? '提示词已保存；什么时候开始用它回复，看上面的生效状态。'
        : `提示词没有保存：${outcome.error ?? '未知原因'}`,
      outcome.ok ? 'ok' : 'danger',
    );
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
          <Card
            title="基本设定"
            action={
              <span className="row__value" role="status">
                {nameEdited ? '名字还没保存' : '名字与本机存的一致'}
              </span>
            }
          >
            <div className="field-row">
              <Field label="它的名字" className="field--grow">
                {({ inputId }) => (
                  <div className="inputForm">
                    <input
                      className="input"
                      id={inputId}
                      value={values.petName}
                      maxLength={40}
                      autoComplete="off"
                      spellCheck={false}
                      disabled={app.saving || savingNames}
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
                      className="input"
                      id={inputId}
                      value={values.userName}
                      maxLength={40}
                      autoComplete="off"
                      spellCheck={false}
                      disabled={app.saving || savingNames}
                      data-testid="pref-user-name"
                      onChange={(event) => app.edit('userName', event.target.value)}
                    />
                  </div>
                )}
              </Field>
            </div>

            <div className="field">
              <span className="field__label" id={languageId}>
                回复语言
              </span>
              <div className="segmented" role="radiogroup" aria-labelledby={languageId}>
                {LANGUAGES.map((option) => (
                  <label className="segment" key={option}>
                    <input
                      type="radio"
                      name="reply-language"
                      value={option}
                      checked={values.replyLanguage === option}
                      disabled={app.saving}
                      onChange={() => void saveChoice(app, notify, { replyLanguage: option })}
                    />
                    <span>{replyLanguage(option)}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="field">
              <span className="field__label" id={styleId}>
                说话风格
              </span>
              <div className="segmented" role="radiogroup" aria-labelledby={styleId}>
                {STYLES.map((option) => (
                  <label className="segment" key={option}>
                    <input
                      type="radio"
                      name="style"
                      value={option}
                      checked={values.style === option}
                      disabled={app.saving}
                      data-testid={`pref-style-${option}`}
                      onChange={() => void saveChoice(app, notify, { style: option })}
                    />
                    <span>{styleLabel(option)}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="card__foot">
              <Button
                variant="primary"
                disabled={!nameEdited || app.saving || savingNames}
                data-testid="pref-names-save"
                onClick={() => void saveNames()}
              >
                {savingNames ? '正在保存…' : '保存名字'}
              </Button>
            </div>
          </Card>

          <PersonaPromptEditor
            draft={values.personaPrompt}
            saved={stored === null ? undefined : stored.data.personaPrompt}
            onChangeDraft={(next) => app.edit('personaPrompt', next)}
            onSave={() => void savePrompt()}
            segments={prompt.segments}
            state={prompt.state}
            error={promptError(app.snapshot, app.conflict)}
            maxLength={APPLICATION_PROFILE_MAX_PROMPT}
            saving={app.saving}
            disabled={app.loading}
            onReload={app.refresh}
          />
        </>
      )}
    </ConsoleStatus>
  );
}

/**
 * 冲突与没生效不是一件事：冲突说明这条保存被版本挡住了，
 * 草稿还留着；没生效只报宿主给的原因，报不出来就明说报不出来，不猜。
 */
function promptError(
  snapshot: ApplicationState['snapshot'],
  conflict: boolean,
): string | undefined {
  if (snapshot === null) {
    return undefined;
  }
  if (conflict) {
    return PROFILE_CONFLICT;
  }
  if (snapshot.prompt.state !== 'error') {
    return undefined;
  }
  return snapshot.error === null
    ? '提示词没有生效。可以重试保存，或重新读取一次。'
    : describeError(snapshot.error);
}
