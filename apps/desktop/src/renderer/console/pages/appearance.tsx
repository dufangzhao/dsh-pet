/**
 * 外观页：桌面上的样子，写的是本机呈现记录。
 *
 * 每一项都直接保存一次（带 expectedRevision 的 CAS）；失败时说明原因并保留宿主那一份，
 * 界面不保存"将要生效的值"。预览读的是同一份偏好，所以改完桌面那只就跟着变。
 */
import { type JSX } from 'react';

import { Card, Status, Switch } from '../minimal-ui/controls.js';
import { MinimalThemeStudio } from '../minimal-ui/theme-studio.js';
import { figureLabel, paletteLabel, sizeLabel } from '../labels.js';
import { PET_PALETTES } from '../palettes.js';
import type { ApplicationPreferences } from '@pet/contracts';
import type { LocalPresentationView } from '../../shared/use-local-presentation.js';

export interface AppearancePageProps {
  presentation: LocalPresentationView;
  notify: (message: string, tone: 'ok' | 'danger') => void;
}

const FIGURES = ['minimal', 'round'] as const;
const PALETTES: readonly ApplicationPreferences['palette'][] = [
  'morning',
  'lavender',
  'pine',
  'orange',
];
const SIZES = ['small', 'normal', 'large'] as const;

export function AppearancePage({ presentation, notify }: AppearancePageProps): JSX.Element {
  const preferences = presentation.snapshot?.preferences ?? null;
  const disabled = presentation.saving || !presentation.available;

  const save = async (patch: Parameters<LocalPresentationView['save']>[0], label: string) => {
    const ok = await presentation.save(patch);
    if (!ok) notify(`这个选择没有写进去：${label}`, 'danger');
  };

  if (preferences === null) {
    return (
      <Card title="桌面形态与配色">
        <p className="row__value" role="status">
          {presentation.loading ? '正在读取外观记录…' : '这台机器没有可用的外观记录。'}
        </p>
        {presentation.error === null ? null : (
          <p className="field__error" role="alert">
            {presentation.error}
          </p>
        )}
      </Card>
    );
  }

  return (
    <div className="appearance__grid">
      <div className="appearance__main">
        <Card title="桌面形态与配色" action={<Status>{disabled ? '保存中…' : '本机呈现'}</Status>}>
          <Segmented
            label="形态"
            name="figure"
            value={preferences.figure}
            options={FIGURES.map((value) => ({ value, text: figureLabel(value) }))}
            disabled={disabled}
            testId="pref-figure"
            onSelect={(value) => void save({ figure: value }, '形态')}
          />
          <Swatches
            value={preferences.palette}
            disabled={disabled}
            onSelect={(value) => void save({ palette: value }, '配色')}
          />
          <Segmented
            label="大小"
            name="size"
            value={preferences.size}
            options={SIZES.map((value) => ({ value, text: sizeLabel(value) }))}
            disabled={disabled}
            testId="pref-size"
            onSelect={(value) => void save({ size: value }, '大小')}
          />
        </Card>

        <Card title="在桌面上怎么待着">
          <div className="rows">
            <Switch
              label="在桌面显示桌宠"
              checked={preferences.visible}
              disabled={disabled}
              data-testid="pref-visible"
              onChange={(next) => void save({ visible: next }, '在桌面显示')}
            />
            <Switch
              label="保持置顶"
              checked={preferences.alwaysOnTop}
              disabled={disabled}
              data-testid="pref-always-on-top"
              onChange={(next) => void save({ alwaysOnTop: next }, '保持置顶')}
            />
            <Switch
              label="允许拖动"
              checked={preferences.draggable}
              disabled={disabled}
              data-testid="pref-draggable"
              onChange={(next) => void save({ draggable: next }, '允许拖动')}
            />
            <Switch
              label="减少动画"
              checked={preferences.reducedMotion}
              disabled={disabled}
              data-testid="pref-reduced-motion"
              onChange={(next) => void save({ reducedMotion: next }, '减少动画')}
            />
          </div>
        </Card>

        {/* 界面配色仍由原来那一个主题所有者管：它管控制台的明暗与令牌，也同步到桌宠。 */}
        <Card title="界面配色">
          <MinimalThemeStudio />
        </Card>

        {presentation.notice === null ? null : (
          <p className="field__error" role="alert">
            {presentation.notice}
          </p>
        )}
        {presentation.error === null ? null : (
          <p className="field__error" role="alert">
            {presentation.error}
          </p>
        )}
      </div>
    </div>
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

/** 一组互斥选择：原生 radio 保留方向键与读屏，选中态不只靠颜色。 */
function Segmented<T extends string>({
  label,
  name,
  value,
  options,
  disabled,
  testId,
  onSelect,
}: SegmentedProps<T>): JSX.Element {
  return (
    <fieldset className="field" disabled={disabled}>
      <legend className="field__label">{label}</legend>
      <div className="segmented">
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
            <span className="segment__text">{option.text}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Swatches({
  value,
  disabled,
  onSelect,
}: {
  value: ApplicationPreferences['palette'];
  disabled: boolean;
  onSelect: (value: ApplicationPreferences['palette']) => void;
}): JSX.Element {
  return (
    <fieldset className="field" disabled={disabled}>
      <legend className="field__label">配色</legend>
      <div className="segmented">
        {PALETTES.map((palette) => (
          <label className="segment" key={palette}>
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
              className="segment__text"
              style={{
                background: PET_PALETTES[palette].bottom,
                color: PET_PALETTES[palette].face,
              }}
            >
              {paletteLabel(palette)}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
