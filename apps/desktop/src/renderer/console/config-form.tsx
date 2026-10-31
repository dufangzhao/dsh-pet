import type { JsonValue } from '@pet/contracts';
import { Fragment, type JSX, type ReactNode } from 'react';

import type { ConfigNode } from './config-schema.js';
import {
  canonical,
  draftAt,
  type ConfigErrors,
  type Draft,
  type DraftPath,
  pointerOf,
} from './config-draft.js';
import { Button, Field, Select, type FieldControl } from './minimal-ui/controls.js';

/** 生效方式只说保存后需要做什么，不暗示已经启用或可用。 */
const APPLY_TEXT = {
  immediate: '生效：立即',
  reload: '生效：重载',
  restart: '生效：重启',
} as const;

const UNSUPPORTED = '该字段类型暂不支持。';

export interface ConfigFormProps {
  root: ConfigNode;
  draft: Draft;
  errors: ConfigErrors;
  disabled: boolean;
  onChange: (path: DraftPath, next: Draft) => void;
  onPresence: (path: DraftPath, node: ConfigNode, present: boolean) => void;
  onAddItem: (path: DraftPath) => void;
  onRemoveItem: (path: DraftPath, index: number) => void;
}

/**
 * 表单主体：完全由 Schema 驱动，不认任何具体字段名。
 * 根对象只提供字段列表，不再套一层分组——页面标题已经说明了这是谁的配置。
 */
export function ConfigForm(props: ConfigFormProps): JSX.Element {
  const root = props.root;
  return (
    <div className="config-form__body" data-config-field="">
      {root.description === undefined ? null : <p className="row__desc">{root.description}</p>}
      {root.properties.map((child) => (
        <Fragment key={child.key}>{renderEntry(props, child, [child.key], child.title)}</Fragment>
      ))}
    </div>
  );
}

function choiceLabel(value: JsonValue): string {
  return typeof value === 'string' ? value : canonical(value);
}

/**
 * 属性是否存在决定"未设置"，值本身（空串、false、0、null、空数组）都算已设置。
 * 数组项没有"未设置"这种状态：它在数组里就是存在。
 */
function isPresent(draft: Draft, path: DraftPath): boolean {
  const key = path.at(-1);
  if (typeof key !== 'string' || path.length === 0) {
    return true;
  }
  const parentPath = path.slice(0, -1);
  const parent = parentPath.length === 0 ? draft : draftAt(draft, parentPath);
  return parent.t === 'object' && parent.v[key] !== undefined;
}

/** 只有对象属性可能是"可选且当前未设置"；数组项一律当作已设置。 */
function isOptionalProperty(node: ConfigNode, path: DraftPath): boolean {
  return typeof path.at(-1) === 'string' && !node.required;
}

function descriptionOf(node: ConfigNode): string | undefined {
  if (!node.credentialRef) {
    return node.description;
  }
  return node.description === undefined
    ? '只引用已声明的凭据，这里不输入也不验证真实 Key。'
    : `${node.description} 只引用已声明的凭据，不验证真实 Key。`;
}

/**
 * 字段脚上的一行：「设置此项」与生效方式。
 * 开关只在可选属性上出现；旁边那一句是这一项保存后要做什么。
 */
function FieldMeta({
  label,
  node,
  path,
  present,
  disabled,
  onPresence,
}: {
  label: string;
  node: ConfigNode;
  path: DraftPath;
  present: boolean;
  disabled: boolean;
  onPresence: ConfigFormProps['onPresence'];
}): JSX.Element {
  return (
    <div className="field-row">
      {isOptionalProperty(node, path) ? (
        <span className="row__value">
          <span className="row__label">设置此项</span>
          <span className="switch">
            <input
              type="checkbox"
              role="switch"
              aria-label={label + '：设置此项'}
              checked={present}
              disabled={disabled}
              onChange={(event) => onPresence(path, node, event.target.checked)}
            />
            <i aria-hidden="true" />
          </span>
        </span>
      ) : null}
      <span className="row__desc">{APPLY_TEXT[node.apply]}</span>
    </div>
  );
}

/** 一个字段位的外壳：值在 data-config-field 里，脚上的开关与生效方式在外面。 */
function FieldShell({
  pointer,
  kind,
  children,
  meta,
  description,
}: {
  pointer: string;
  kind: string;
  children: ReactNode;
  meta: ReactNode;
  description: string | undefined;
}): JSX.Element {
  return (
    <div className="field">
      <div data-config-field={pointer} data-config-kind={kind}>
        {children}
      </div>
      {meta}
      {description === undefined ? null : <p className="row__desc">{description}</p>}
    </div>
  );
}

/**
 * 一个字段位：先判断是否设置，再交给具体渲染。
 * 未设置的可选项不取草稿值——它本来就没有值。
 */
function renderEntry(
  props: ConfigFormProps,
  node: ConfigNode,
  path: DraftPath,
  label: string,
): ReactNode {
  const optional = isOptionalProperty(node, path);
  const present = optional ? isPresent(props.draft, path) : true;
  const pointer = pointerOf(path);
  const description = descriptionOf(node);
  const meta = (
    <FieldMeta
      label={label}
      node={node}
      path={path}
      present={present}
      disabled={props.disabled}
      onPresence={props.onPresence}
    />
  );

  if (optional && !present) {
    return (
      <FieldShell pointer={pointer} kind={node.kind} meta={meta} description={description}>
        <span className="field__label">{label}</span>
        <p className="row__desc">未设置，保存时不写入这一项。</p>
      </FieldShell>
    );
  }

  return renderNode(props, node, path, label, description, meta, pointer);
}

function renderNode(
  props: ConfigFormProps,
  node: ConfigNode,
  path: DraftPath,
  label: string,
  description: string | undefined,
  meta: ReactNode,
  pointer: string,
): ReactNode {
  // const 只展示真实固定值，不给可编辑控件；可选 const 仍靠开关决定是否写入。
  if (node.constant !== undefined) {
    return (
      <FieldShell pointer={pointer} kind="const" meta={meta} description={description}>
        <span className="field__label">{label}</span>
        <p className="row__value">{'固定为 ' + choiceLabel(node.constant)}</p>
      </FieldShell>
    );
  }

  if (node.kind === 'object') {
    return (
      <div className="field">
        <fieldset className="config-group" data-config-field={pointer} data-config-kind="object">
          <legend className="config-group__legend">{label}</legend>
          {description === undefined ? null : <p className="row__desc">{description}</p>}
          <div className="config-group__body">
            {node.properties.map((child) => (
              <Fragment key={child.key}>
                {renderEntry(props, child, [...path, child.key], child.title)}
              </Fragment>
            ))}
          </div>
        </fieldset>
        {meta}
      </div>
    );
  }

  if (node.kind === 'array') {
    return renderArray(props, node, path, label, description, meta, pointer);
  }

  return renderScalar(props, node, path, label, description, meta, pointer);
}

function renderArray(
  props: ConfigFormProps,
  node: ConfigNode,
  path: DraftPath,
  label: string,
  description: string | undefined,
  meta: ReactNode,
  pointer: string,
): ReactNode {
  const draft = draftAt(props.draft, path);
  const items = draft.t === 'array' ? draft.v : [];
  const error = props.errors[pointer];
  const full = node.maxItems !== undefined && items.length >= node.maxItems;

  return (
    <div className="field">
      <fieldset className="config-group" data-config-field={pointer} data-config-kind="array">
        <legend className="config-group__legend">{label}</legend>
        {description === undefined ? null : <p className="row__desc">{description}</p>}
        <div className="config-group__body">
          {items.length === 0 ? <p className="row__desc">还没有条目。</p> : null}
          {items.map((_, index) => (
            <div className="config-item" key={index} data-config-item={index}>
              <div className="config-item__body">
                {node.item === null ? (
                  <p className="row__desc">{UNSUPPORTED}</p>
                ) : (
                  renderEntry(props, node.item, [...path, index], `${label} ${index + 1}`)
                )}
              </div>
              <Button
                size="small"
                variant="ghost"
                disabled={props.disabled}
                onClick={() => props.onRemoveItem(path, index)}
              >
                删除{label} {index + 1}
              </Button>
            </div>
          ))}
          {error === undefined ? null : (
            <p className="field__error" role="alert">
              {error}
            </p>
          )}
          <div className="config-actions">
            <Button
              size="small"
              disabled={props.disabled || full || node.item === null}
              onClick={() => props.onAddItem(path)}
            >
              添加{label}
            </Button>
            {node.maxItems === undefined ? null : (
              <span className="config-count">
                {items.length} / {node.maxItems}
              </span>
            )}
          </div>
        </div>
      </fieldset>
      {meta}
    </div>
  );
}

function renderScalar(
  props: ConfigFormProps,
  node: ConfigNode,
  path: DraftPath,
  label: string,
  description: string | undefined,
  meta: ReactNode,
  pointer: string,
): ReactNode {
  const draft = draftAt(props.draft, path);
  const error = props.errors[pointer];

  return (
    <div className="field">
      <div data-config-field={pointer} data-config-kind={node.kind}>
        <Field label={label} {...(error === undefined ? {} : { error })}>
          {(control) => renderControl(props, node, draft, path, control)}
        </Field>
      </div>
      {meta}
      {description === undefined ? null : <p className="row__desc">{description}</p>}
    </div>
  );
}

function renderControl(
  props: ConfigFormProps,
  node: ConfigNode,
  draft: Draft,
  path: DraftPath,
  control: FieldControl,
): ReactNode {
  const disabled = props.disabled;
  const set = (next: Draft): void => props.onChange(path, next);

  if (node.choices !== undefined) {
    const value = draft.t === 'choice' ? draft.v : '';
    return (
      <Select
        id={control.inputId}
        value={value}
        disabled={disabled}
        aria-describedby={control.describedBy}
        aria-invalid={control.invalid || undefined}
        options={[
          { value: '', label: '请选择…' },
          ...node.choices.map((choice) => ({
            value: canonical(choice),
            label: choiceLabel(choice),
          })),
        ]}
        onChange={(event) => set({ t: 'choice', v: event.target.value })}
      />
    );
  }

  switch (node.kind) {
    case 'boolean':
      return (
        <span className="switch">
          <input
            type="checkbox"
            role="switch"
            id={control.inputId}
            checked={draft.t === 'bool' && draft.v}
            disabled={disabled}
            aria-describedby={control.describedBy}
            aria-invalid={control.invalid || undefined}
            onChange={(event) => set({ t: 'bool', v: event.target.checked })}
          />
          <i aria-hidden="true" />
        </span>
      );
    case 'number':
    case 'integer':
      return (
        <input
          className="input"
          id={control.inputId}
          type="text"
          inputMode={node.kind === 'integer' ? 'numeric' : 'decimal'}
          value={draft.t === 'number' ? draft.v : ''}
          disabled={disabled}
          aria-describedby={control.describedBy}
          aria-invalid={control.invalid || undefined}
          onChange={(event) => set({ t: 'number', v: event.target.value })}
        />
      );
    case 'null':
      return <p className="row__desc">这一项固定为空值（null）。</p>;
    case 'string':
      return (
        <input
          className="input"
          id={control.inputId}
          type="text"
          value={draft.t === 'text' ? draft.v : ''}
          disabled={disabled}
          aria-describedby={control.describedBy}
          aria-invalid={control.invalid || undefined}
          onChange={(event) => set({ t: 'text', v: event.target.value })}
        />
      );
    default:
      return <p className="row__desc">{UNSUPPORTED}</p>;
  }
}
