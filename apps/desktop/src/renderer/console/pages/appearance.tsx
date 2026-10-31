import { useId, type JSX } from 'react';

import type { ApplicationPreferences } from '@pet/contracts';

import { saveChoice } from '../app-views.js';
import { ConsoleStatus } from '../console-status.js';
import { figureLabel, paletteLabel, sizeLabel } from '../labels.js';
import { Card, Switch } from '../minimal-ui/controls.js';
import { PET_PALETTES, PetPreview } from '../pet-preview.js';
import type { ApplicationState } from '../use-application.js';

export interface AppearancePageProps {
  app: ApplicationState;
  notify: (message: string, tone: 'ok' | 'danger') => void;
}

const FIGURES = ['minimal', 'round'] as const;
const PALETTES = ['morning', 'lavender', 'pine', 'orange'] as const;
const SIZES = ['small', 'normal', 'large'] as const;

/**
 * 装扮页：形态、配色、大小与显示。
 *
 * 每一行都直接写进同一份偏好：桌面窗与预览读同一份值，改完这里桌面上的那一只就跟着变。
 * 选项只有宿主契约里存在的那几个，不摆没有消费者的开关；界面配色不在这里，
 * 它属于开始页那间配色工作室。
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
        <div className="appearance__grid">
          <div className="appearance__main">
            <Card title="桌面形态与配色">
              <Segmented
                label="形态"
                name="figure"
                value={values.figure}
                options={FIGURES.map((value) => ({ value, text: figureLabel(value) }))}
                disabled={app.saving}
                testId="pref-figure"
                onSelect={(value) => void saveChoice(app, notify, { figure: value })}
              />

              <Swatches
                value={values.palette}
                disabled={app.saving}
                onSelect={(value) => void saveChoice(app, notify, { palette: value })}
              />

              <Segmented
                label="大小"
                name="size"
                value={values.size}
                options={SIZES.map((value) => ({ value, text: sizeLabel(value) }))}
                disabled={app.saving}
                testId="pref-size"
                onSelect={(value) => void saveChoice(app, notify, { size: value })}
              />
            </Card>

            <Card title="在桌面上怎么待着">
              <div className="rows">
                <Switch
                  label="在桌面显示桌宠"
                  checked={values.visible}
                  disabled={app.saving}
                  onChange={(next) => void saveChoice(app, notify, { visible: next })}
                />
                <Switch
                  label="保持置顶"
                  checked={values.alwaysOnTop}
                  disabled={app.saving}
                  onChange={(next) => void saveChoice(app, notify, { alwaysOnTop: next })}
                />
                <Switch
                  label="允许拖动"
                  checked={values.draggable}
                  disabled={app.saving}
                  onChange={(next) => void saveChoice(app, notify, { draggable: next })}
                />
                <Switch
                  label="减少动画"
                  checked={values.reducedMotion}
                  disabled={app.saving}
                  onChange={(next) => void saveChoice(app, notify, { reducedMotion: next })}
                />
              </div>
            </Card>
          </div>

          <PetPreview values={values} agent={app.snapshot.agent} />
        </div>
      )}
    </ConsoleStatus>
  );
}

interface SegmentedProps<T extends string> {
  label: string;
  name: string;
  value: T;
  options: readonly { value: T; text: string }[];
  disabled: boolean;
  testId: string;
  onSelect: (value: T) => void;
}

/**
 * 一组互斥选择：原生 radio 保留方向键与读屏，选中态同时用底色、字重和边框表达，
 * 不靠颜色单独说话。
 */
function Segmented<T extends string>({
  label,
  name,
  value,
  options,
  disabled,
  testId,
  onSelect,
}: SegmentedProps<T>): JSX.Element {
  const labelId = useId();

  return (
    <div className="field">
      <span className="field__label" id={labelId}>
        {label}
      </span>
      <div className="segmented" role="radiogroup" aria-labelledby={labelId}>
        {options.map((option) => (
          <label className="segment" key={option.value}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              disabled={disabled}
              data-testid={`${testId}-${option.value}`}
              onChange={() => onSelect(option.value)}
            />
            <span>{option.text}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

interface SwatchesProps {
  value: ApplicationPreferences['palette'];
  disabled: boolean;
  onSelect: (value: ApplicationPreferences['palette']) => void;
}

/** 配色选择带上真实的色块：颜色来自 PetPreview 那一张表，不在这里另抄一份。 */
function Swatches({ value, disabled, onSelect }: SwatchesProps): JSX.Element {
  const labelId = useId();

  return (
    <div className="field">
      <span className="field__label" id={labelId}>
        配色
      </span>
      <div className="choices" role="radiogroup" aria-labelledby={labelId}>
        {PALETTES.map((palette) => {
          const colors = PET_PALETTES[palette];
          return (
            <label className="choice" key={palette}>
              <input
                type="radio"
                name="palette"
                value={palette}
                checked={value === palette}
                disabled={disabled}
                data-testid={`pref-palette-${palette}`}
                onChange={() => onSelect(palette)}
              />
              <span
                className="choice__swatch"
                style={{
                  background: `linear-gradient(180deg, ${colors.top}, ${colors.bottom})`,
                }}
                aria-hidden="true"
              />
              <span className="choice__name">{paletteLabel(palette)}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
