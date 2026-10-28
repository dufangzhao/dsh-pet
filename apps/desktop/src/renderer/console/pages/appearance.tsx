import type { JSX } from 'react';

import { Section } from '@pet/ui-kit';

import { saveChoice } from '../app-views.js';
import { ConsoleStatus } from '../console-status.js';
import { figureLabel, paletteLabel, sizeLabel } from '../labels.js';
import { PET_PALETTES, PetPreview } from '../pet-preview.js';
import { SettingsRow, SettingsRows } from '../settings-shell.js';
import type { ApplicationPreferences } from '@pet/contracts';
import type { ApplicationState, StringPreferenceField } from '../use-application.js';

export interface AppearancePageProps {
  app: ApplicationState;
  notify: (message: string, tone: 'ok' | 'danger') => void;
}

/**
 * 装扮页：形态、配色、大小与显示。
 *
 * 每一行都直接写进同一份偏好：桌面窗与预览读同一份值，改完这里桌面上的那一只就跟着变。
 * 选项只有宿主契约里存在的那几个，不摆没有消费者的开关。
 */
export function AppearancePage({ app, notify }: AppearancePageProps): JSX.Element {
  const values = app.values;

  return (
    <ConsoleStatus
      loading={app.loading}
      error={app.error}
      available={app.available}
      onRetry={app.refresh}
    >
      {values === null || app.snapshot === null ? null : (
        <div className="pk-split">
          <div className="pk-split__main">
            <Section title="桌面形态与配色" description="这些选择保存后立即生效在桌面上。">
              <SettingsRows>
                <ChoiceRow
                  label="桌面形态"
                  values={values}
                  field="figure"
                  saving={app.saving}
                  options={(['minimal', 'round'] as const).map((value) => ({
                    value,
                    text: figureLabel(value),
                  }))}
                  testId="pref-figure"
                  onSave={(value) => void saveChoice(app, notify, { figure: value })}
                />
                <ChoiceRow
                  label="配色"
                  values={values}
                  field="palette"
                  saving={app.saving}
                  options={(['morning', 'lavender', 'pine', 'orange'] as const).map((value) => ({
                    value,
                    text: paletteLabel(value),
                    swatch: PET_PALETTES[value],
                  }))}
                  testId="pref-palette"
                  onSave={(value) => void saveChoice(app, notify, { palette: value })}
                />
                <ChoiceRow
                  label="大小"
                  values={values}
                  field="size"
                  saving={app.saving}
                  options={(['small', 'normal', 'large'] as const).map((value) => ({
                    value,
                    text: sizeLabel(value),
                  }))}
                  testId="pref-size"
                  onSave={(value) => void saveChoice(app, notify, { size: value })}
                />
              </SettingsRows>
            </Section>

            <Section title="在桌面上怎么待着" description="只改窗口本身，不动角色形象。">
              <SettingsRows>
                <SwitchRow
                  label="在桌面显示桌宠"
                  checked={values.visible}
                  onText="显示"
                  offText="隐藏"
                  disabled={app.saving}
                  description="隐藏后 tray 与设置台还在，预览仍可用同一份值画。"
                  onSave={(next) => void saveChoice(app, notify, { visible: next })}
                />
                <SwitchRow
                  label="保持置顶"
                  checked={values.alwaysOnTop}
                  onText="置顶"
                  offText="跟随"
                  disabled={app.saving}
                  onSave={(next) => void saveChoice(app, notify, { alwaysOnTop: next })}
                />
                <SwitchRow
                  label="允许拖动"
                  checked={values.draggable}
                  onText="可拖动"
                  offText="固定位置"
                  disabled={app.saving}
                  description="拖动完成后会记进同一条日常记录。"
                  onSave={(next) => void saveChoice(app, notify, { draggable: next })}
                />
                <SwitchRow
                  label="减少动画"
                  checked={values.reducedMotion}
                  onText="少动"
                  offText="正常"
                  disabled={app.saving}
                  description="桌面的角色动作随之收敛；系统若已设置减少动态，这里同样生效。"
                  onSave={(next) => void saveChoice(app, notify, { reducedMotion: next })}
                />
              </SettingsRows>
            </Section>
          </div>

          <div className="pk-split__aside">
            <PetPreview values={values} agent={app.snapshot.agent} />
          </div>
        </div>
      )}
    </ConsoleStatus>
  );
}

interface ChoiceRowProps<K extends StringPreferenceField> {
  label: string;
  values: ApplicationPreferences;
  field: K;
  options: readonly {
    value: ApplicationPreferences[K];
    text: string;
    swatch?: { top: string; bottom: string };
  }[];
  saving: boolean;
  testId: string;
  onSave: (value: ApplicationPreferences[K]) => void;
}

/**
 * 一组互斥选择：原生 radio 保留方向键与读屏，
 * 选中态同时用文字加粗、边框变色和圆点表达，不靠颜色单独说话。
 */
function ChoiceRow<K extends StringPreferenceField>(props: ChoiceRowProps<K>): JSX.Element {
  const current = props.values[props.field];

  return (
    <SettingsRow label={props.label} labelFor="group">
      {({ labelledBy }) => (
        <div className="pk-choices" role="radiogroup" aria-labelledby={labelledBy}>
          {props.options.map((option) => (
            <label className="pk-choice" key={option.value}>
              <input
                type="radio"
                name={props.field}
                value={option.value}
                checked={current === option.value}
                disabled={props.saving}
                data-testid={`${props.testId}-${option.value}`}
                onChange={() => props.onSave(option.value)}
              />
              {option.swatch === undefined ? null : (
                <span
                  className="pk-choice__swatch"
                  style={{
                    background: `linear-gradient(180deg, ${option.swatch.top}, ${option.swatch.bottom})`,
                  }}
                  aria-hidden="true"
                />
              )}
              {option.text}
            </label>
          ))}
        </div>
      )}
    </SettingsRow>
  );
}

interface SwitchRowProps {
  label: string;
  checked: boolean;
  onText: string;
  offText: string;
  description?: string;
  disabled: boolean;
  onSave: (next: boolean) => void;
}

/** 开关用原生 checkbox，状态另有文字：关掉时读到的是「隐藏」，不是一盏灰掉的灯。 */
function SwitchRow({
  label,
  checked,
  onText,
  offText,
  description,
  disabled,
  onSave,
}: SwitchRowProps): JSX.Element {
  return (
    <SettingsRow label={label} description={description}>
      <label className="pk-choice">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onSave(event.target.checked)}
        />
        {checked ? onText : offText}
      </label>
    </SettingsRow>
  );
}
