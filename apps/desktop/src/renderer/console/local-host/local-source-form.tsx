/**
 * QQ 客户端表单：官方与 OneBot 共用一套，不复制两份保存逻辑。
 *
 * 两个协议的差异只在「有哪些字段」，而字段之外的草稿/CAS/密钥规则完全一样，
 * 所以差异用 `protocol === 'onebot-v11'` 分支表达，而不是复制组件。
 * 每个客户端一张独立卡，不和接入卡或别的客户端挤在一起。
 */
import type { JSX } from 'react';

import type {
  LocalHostSourceReview,
  PermissionPreset,
  QQSourceSettings,
  QQSourceView,
} from '@pet/contracts';

import { Button, Card, Field, Status } from '../minimal-ui/controls.js';
import { Icon } from '../minimal-ui/icons.js';
import type { LocalSourceDraft } from './local-source-draft.js';
import { localSourceSaveCommand, localSecretTargetSaved } from './local-source-draft.js';
import { canSaveSource, qqClientLabel, sourceFacts } from './local-host-view.js';
import { SourceTrustControls } from './local-source-trust.js';

export interface LocalSourceFormProps {
  readonly source: QQSourceView;
  readonly draft: LocalSourceDraft | null;
  /** 源码审查结果；null = 还没读过，或已被换进程清空。 */
  readonly review: LocalHostSourceReview | null;
  /** 上一次读取/写入失败的真实错误；与 review 分开，不清空已显示的事实。 */
  readonly reviewError: string | null;
  /** 密钥输入框的值；由父组件持有，发起即清空。 */
  readonly secretValue: string;
  /** 这个密钥是否仍属于当前已保存的源。 */
  readonly secretUsable: boolean;
  readonly busy: boolean;
  readonly onEdit: (change: (settings: QQSourceSettings) => QQSourceSettings) => void;
  readonly onSecretChange: (value: string) => void;
  readonly onReview: () => void;
  readonly onTrust: (review: LocalHostSourceReview, trusted: boolean) => void;
  readonly onPreset: (review: LocalHostSourceReview, preset: PermissionPreset) => void;
  readonly onSave: (command: NonNullable<ReturnType<typeof localSourceSaveCommand>>) => void;
  readonly onWriteSecret: (value: string) => void;
  readonly onClearSecret: () => void;
  readonly onRebase: () => void;
}

export function LocalSourceForm({
  source,
  draft,
  review,
  reviewError,
  secretValue,
  secretUsable,
  busy,
  onEdit,
  onSecretChange,
  onReview,
  onTrust,
  onPreset,
  onSave,
  onWriteSecret,
  onClearSecret,
  onRebase,
}: LocalSourceFormProps): JSX.Element {
  const facts = sourceFacts(source);
  const dirty = draft?.edited === true;
  const command = localSourceSaveCommand(draft);
  const targetSaved = localSecretTargetSaved(draft, source);
  const settings = draft?.settings ?? source.settings;
  const title = qqClientLabel(source.protocol);

  return (
    <Card
      title={title}
      testId={`local-source-form-${source.protocol}`}
      action={<Status>{facts.nativeLabel}</Status>}
    >
      <div className="rows rows--tight">
        <div className="row host-row">
          <span className="row__label">配置</span>
          <span className="row__value" data-testid="local-source-form-saved">
            {facts.savedLabel}
          </span>
        </div>
        <div className="row host-row">
          <span className="row__label">生效</span>
          <span className="row__value" data-testid="local-source-form-applied">
            {facts.appliedLabel}
          </span>
        </div>
      </div>

      <div className="host-fields">
        {settings.protocol === 'official' ? (
          <OfficialFields settings={settings} busy={busy} onEdit={onEdit} />
        ) : (
          <OneBotFields settings={settings} busy={busy} onEdit={onEdit} />
        )}
      </div>

      <SourceTrustControls
        selector={source.protocol}
        label={title}
        review={review}
        error={reviewError}
        busy={busy}
        onReview={onReview}
        onTrust={onTrust}
        onPreset={onPreset}
      />

      <div className="card__foot">
        <Button
          variant="primary"
          size="small"
          icon={<Icon name="check" />}
          disabled={!canSaveSource({ plugin: source.source, busy, dirty })}
          data-testid="local-source-save"
          onClick={() => {
            if (command !== null) onSave(command);
          }}
        >
          保存配置
        </Button>
        {/* 冲突后唯一出路：显式重读，不自动覆盖。 */}
        {dirty ? (
          <Button
            size="small"
            variant="ghost"
            icon={<Icon name="refresh" />}
            disabled={busy}
            data-testid="local-source-rebase"
            onClick={onRebase}
          >
            读取最新配置
          </Button>
        ) : null}
      </div>

      {/*
        密钥区。两个前置条件都要说清：
        配置还没保存时写密钥会落到旧配置上；密钥属于别的 target 时也作废。
      */}
      <div className="host-sub" data-testid="local-source-secret">
        <h3 className="host-subtitle">平台密钥</h3>
        <p className="host-note" data-testid="local-source-secret-state">
          {source.credential.available
            ? `已配置（版本 ${source.credential.version}）`
            : '还没有配置密钥'}
        </p>
        {!targetSaved ? (
          <p className="host-note" data-testid="local-source-secret-blocked">
            先把上面的配置保存下来，再填密钥。
          </p>
        ) : null}
        <Field label="临时密钥" hint="只用于本次运行；停止后需要重新输入">
          {({ inputId, describedBy }) => (
            <input
              id={inputId}
              className="input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              aria-describedby={describedBy}
              value={secretValue}
              disabled={!targetSaved || busy || !source.credential.writable}
              data-testid="local-source-secret-input"
              onChange={(event) => onSecretChange(event.target.value)}
            />
          )}
        </Field>
        <div className="card__foot">
          <Button
            size="small"
            icon={<Icon name="key" />}
            disabled={
              !targetSaved ||
              busy ||
              !secretUsable ||
              secretValue.trim() === '' ||
              !source.credential.writable
            }
            data-testid="local-source-secret-write"
            onClick={() => onWriteSecret(secretValue)}
          >
            写入密钥
          </Button>
          <Button
            size="small"
            variant="ghost"
            icon={<Icon name="x" />}
            disabled={busy || !source.credential.available}
            data-testid="local-source-secret-clear"
            onClick={onClearSecret}
          >
            清除密钥
          </Button>
        </div>
      </div>
    </Card>
  );
}

interface FieldProps {
  readonly settings: QQSourceSettings;
  readonly busy: boolean;
  readonly onEdit: (change: (settings: QQSourceSettings) => QQSourceSettings) => void;
}

function OfficialFields({ settings, busy, onEdit }: FieldProps): JSX.Element {
  if (settings.protocol !== 'official') return <></>;
  return (
    <>
      <Field label="AppID" hint="QQ 开放平台的机器人 AppID">
        {({ inputId, describedBy }) => (
          <input
            id={inputId}
            className="input"
            aria-describedby={describedBy}
            value={settings.appId}
            disabled={busy}
            spellCheck={false}
            data-testid="local-source-app-id"
            onChange={(event) => {
              const value = event.target.value;
              onEdit((current) =>
                current.protocol === 'official' ? { ...current, appId: value } : current,
              );
            }}
          />
        )}
      </Field>
      <Field label="场景" hint="私聊与群聊至少选一个">
        {({ inputId, describedBy }) => (
          <div id={inputId} aria-describedby={describedBy} className="host-checks">
            {(['private', 'group'] as const).map((scene) => (
              <label key={scene} className="host-check">
                <input
                  type="checkbox"
                  checked={settings.scenes.includes(scene)}
                  disabled={busy}
                  data-testid={`local-source-scene-${scene}`}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    onEdit((current) => {
                      if (current.protocol !== 'official') return current;
                      const scenes = checked
                        ? [...current.scenes, scene]
                        : current.scenes.filter((item) => item !== scene);
                      // 至少留一个场景：全清掉会让配置永远无法启用。
                      if (scenes.length === 0) return current;
                      return { ...current, scenes };
                    });
                  }}
                />
                {scene === 'private' ? '私聊' : '群聊'}
              </label>
            ))}
          </div>
        )}
      </Field>
    </>
  );
}

function OneBotFields({ settings, busy, onEdit }: FieldProps): JSX.Element {
  if (settings.protocol !== 'onebot-v11') return <></>;
  return (
    <>
      <Field label="机器人账号" hint="OneBot 侧登录的那个 QQ 号">
        {({ inputId, describedBy }) => (
          <input
            id={inputId}
            className="input"
            aria-describedby={describedBy}
            value={settings.accountId}
            disabled={busy}
            spellCheck={false}
            data-testid="local-source-account-id"
            onChange={(event) => {
              const value = event.target.value;
              onEdit((current) =>
                current.protocol === 'onebot-v11' ? { ...current, accountId: value } : current,
              );
            }}
          />
        )}
      </Field>
      <Field label="监听地址" hint="反向 WS 在本机绑定哪个地址；127.0.0.1 只接受本机连接">
        {({ inputId, describedBy }) => (
          <input
            id={inputId}
            className="input"
            aria-describedby={describedBy}
            value={settings.listenHost}
            disabled={busy}
            spellCheck={false}
            data-testid="local-source-listen-host"
            onChange={(event) => {
              const value = event.target.value;
              onEdit((current) =>
                current.protocol === 'onebot-v11' ? { ...current, listenHost: value } : current,
              );
            }}
          />
        )}
      </Field>
      <Field label="监听端口" hint="端口冲突时改这里；不合法会明确报错，不会悄悄换值">
        {({ inputId, describedBy }) => (
          <input
            id={inputId}
            className="input"
            type="number"
            min={1}
            max={65535}
            aria-describedby={describedBy}
            value={settings.listenPort}
            disabled={busy}
            data-testid="local-source-listen-port"
            onChange={(event) => {
              const value = event.target.value;
              onEdit((current) =>
                current.protocol === 'onebot-v11'
                  ? { ...current, listenPort: Number(value) || 0 }
                  : current,
              );
            }}
          />
        )}
      </Field>
      <Field label="路径" hint="SnowLuma / NapCat 连过来时用的 WS 路径">
        {({ inputId, describedBy }) => (
          <input
            id={inputId}
            className="input"
            aria-describedby={describedBy}
            value={settings.path}
            disabled={busy}
            spellCheck={false}
            data-testid="local-source-path"
            onChange={(event) => {
              const value = event.target.value;
              onEdit((current) =>
                current.protocol === 'onebot-v11' ? { ...current, path: value } : current,
              );
            }}
          />
        )}
      </Field>
      {/*
        端点提示只描述**已保存的**配置。草稿没保存时明说，
        不把还没生效的地址说成「已连接端点」。
      */}
      <p className="host-note host-fields__wide" data-testid="local-source-endpoint">
        {savedEndpoint(settings)}
      </p>
    </>
  );
}

/** 已保存配置的端点描述；只读 settings，不推断连接状态。 */
function savedEndpoint(settings: QQSourceSettings): string {
  if (settings.protocol !== 'onebot-v11') return '';
  const host =
    settings.listenHost === '0.0.0.0' || settings.listenHost === '::'
      ? '所有网卡（外部可达）'
      : settings.listenHost;
  return `反向 WS 地址：ws://${host}:${String(settings.listenPort)}${settings.path}`;
}
