/**
 * 开始页：一条连接、一个服务模型、一只桌宠。
 *
 * 连接是主人唯一要动手的地方：地址是普通非secret配置，令牌只在这一次对话框里存在。
 * 令牌输入在调用 connect 的同一步、发出之前就清空；失败、挂起、冲突都不留 secret。
 * 模型表单复用文本客户端那份受控实现（只吃 ModelTransport），桌面侧把
 * saveModel/testModel 绑到当前 connectionId；写密钥的方法在桌面端恒为拒绝。
 */
import { createReadOnlyModelTransport, ModelDialog } from '@pet/text-client/model-ui';
import type { CompanionModelSaveCommand, CompanionModelTestCommand } from '@pet/contracts';
import { useEffect, useId, useRef, useState, type CSSProperties, type JSX } from 'react';

import { PetAvatar } from '../../pet/PetAvatar.js';
import { usePokeableAvatar } from '../preview-behavior.js';
import { PET_PALETTES } from '../palettes.js';
import type { CompanionView } from '../../shared/use-companion.js';
import type { LocalPresentationView } from '../../shared/use-local-presentation.js';
import {
  agentModeLabel,
  canConnect,
  updatesConnection,
  clockTime,
  connectionView,
  endpointBaseline,
  endpointMoved,
  rebaseOnConnect,
  hostOf,
  petStateOf,
} from '../../shared/companion-state.js';
import { Button, Card, Field, Status, type StatusTone } from '../minimal-ui/controls.js';
import type { VoiceController } from '@pet/text-client/voice-input-ui';
import { VoiceCard } from './voice-card.js';
import { QQStatusCard, qqOf } from './qq-status.js';

import '@pet/text-client/model.css';

export interface StartPageProps {
  companion: CompanionView;
  presentation: LocalPresentationView;
  voice: VoiceController;
  notify: (message: string, tone: 'ok' | 'danger') => void;
}

const STATUS_TONE: Readonly<Record<string, StatusTone>> = {
  ok: 'ok',
  warn: 'warn',
  danger: 'danger',
  muted: 'muted',
  off: 'off',
};

function toneOf(tone: string): StatusTone {
  return STATUS_TONE[tone] ?? 'muted';
}

export function StartPage({ companion, presentation, voice, notify }: StartPageProps): JSX.Element {
  return (
    <>
      <ConnectionCard companion={companion} notify={notify} />
      <ModelCard companion={companion} />
      <QQStatusCard
        qq={qqOf(companion.state?.snapshot ?? null)}
        connectionId={companion.state?.connectionId ?? null}
        openWeb={companion.openWeb}
      />
      <VoiceCard companion={companion} voice={voice} notify={notify} />
      <PetCard companion={companion} presentation={presentation} notify={notify} />
    </>
  );
}

/* ---------------------------------------------------------------- 连接服务 */

function ConnectionCard({
  companion,
  notify,
}: {
  companion: CompanionView;
  notify: StartPageProps['notify'];
}): JSX.Element {
  const state = companion.state;
  const [baseUrl, setBaseUrl] = useState('');
  /**
   * 这份地址草稿是从哪一版 Config 读来的。
   *
   * CAS 必须用**草稿基线**，不能用「现在最新」：外部把 A(rev1) 改成 C(rev2) 期间
   * 用户草稿 B 没动，拿 rev2 提交就会静默覆盖 C，冲突核对等于没有。
   */
  const [baseline, setBaseline] = useState<number | null>(null);
  const [token, setToken] = useState('');
  const [missing, setMissing] = useState(false);
  const [asking, setAsking] = useState(false);
  /**
   * 自己这次提交还在途。
   *
   * Main 会先把新的 Config 版本 publish 出来（首次连接时还可能停在 connecting），
   * 而 `connect` 的 promise 还没回来。那段时间里 `baseline` 落后是**我自己**造成的，
   * 不能报成「别处改过」——那是假提示。只用一个表单内的布尔，不建全局状态。
   */
  const [submitting, setSubmitting] = useState(false);
  const tokenInput = useRef<HTMLInputElement>(null);
  const addressId = useId();
  const tokenId = useId();
  const busy = submitting || state?.phase === 'connecting' || state?.phase === 'retiring';
  // 有连接时这次提交是「更新」：在线换地址/换令牌不必先断开。
  const label =
    state === null
      ? '输入令牌并连接'
      : state.phase === 'offline'
        ? '输入令牌并重新连接'
        : updatesConnection(state)
          ? '更新连接或更换令牌'
          : '输入令牌并连接';

  // 只在这份草稿还没起过稿时铺一次，并同时记下它的 Config 基线。
  // 之后外部再改地址，也不覆盖用户正在编辑的内容——保留草稿并标注外部变更。
  useEffect(() => {
    // 只在还没起稿时铺一次：baseUrl 与它的基线一起写，之后不再被外部改动覆盖。
    if (state === null || baseline !== null) return;
    setBaseUrl((draft) => (draft === '' ? state.baseUrl : draft));
    setBaseline(state.configRevision);
  }, [state, baseline]);

  /**
   * 外部把 Config 改到了别的版本：这份草稿已经不是最新那一版的输入了。
   *
   * 自己提交在途时不算：那期间的 revision 前进是本次写入的中间态。
   * settle 之后基线已经跟到 committed 版本，此时再比，外部改动照旧会被识别。
   */
  const movedUnderneath =
    state !== null && endpointMoved(baseline, state.configRevision, submitting);

  useEffect(() => {
    if (asking) tokenInput.current?.focus();
  }, [asking]);

  const connection = state === null ? null : connectionView(state);

  const submit = async (): Promise<void> => {
    const address = baseUrl.trim();
    const secret = token.trim();
    if (address === '') {
      setMissing(true);
      return;
    }
    if (secret === '') {
      setMissing(true);
      return;
    }
    setMissing(false);
    // 先清空再用捕获到的局部值发出：失败、超时、挂起、CAS 冲突都不留 secret。
    setToken('');
    setAsking(false);
    setSubmitting(true);
    try {
      const result = await companion.connect({
        baseUrl: address,
        token: secret,
        // 草稿读入时的基线，不是「现在最新」的那一份。
        expectedRevision: endpointBaseline(baseline, state?.configRevision ?? 0),
      });
      if (result.outcome === 'accepted') {
        // 用这次写入真正落下的版本推进基线：不猜 +1，也不拿最新视图抹掉别处的更新。
        // 读的是 connect 的返回值，不是提交前那次渲染的 state —— 那里还是旧版本。
        setBaseline((current) => rebaseOnConnect(result.configRevision, current));
      } else if (result.outcome === 'failed' && result.error !== null) {
        // 冲突时保留草稿、保留旧基线：由用户显式重读或再提交，不自动吞掉别处的改动。
        notify(`连接没有建立：${result.error}`, 'danger');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card
      title="连接服务"
      id="connection-card"
      action={
        connection === null ? null : (
          <span data-testid="start-status">
            <Status tone={toneOf(connection.tone)}>{connection.label}</Status>
            {state?.confirmedAt == null ? null : (
              <span className="row__value"> · 最后确认 {clockTime(state.confirmedAt)}</span>
            )}
          </span>
        )
      }
    >
      {companion.available ? null : (
        <p role="alert" data-testid="start-no-bridge">
          <Status tone="warn">这台机器没有连接服务的通道，所以这里没有可填的表单。</Status>
        </p>
      )}

      {connection?.detail === null || connection === null ? null : (
        <p className="row__value" role="status">
          {connection.detail}
        </p>
      )}
      {state !== null && state.error !== null ? (
        <p className="field__error" role="alert" data-testid="start-error">
          {state.error.messageKey === 'errors.auth-failed'
            ? '访问令牌被拒绝。'
            : `连接没有建立：${connection?.label ?? ''}`}
        </p>
      ) : null}
      {companion.readError === null ? null : (
        <p className="field__error" role="alert">
          {companion.readError}
        </p>
      )}

      {state !== null && state.phase === 'live' && state.snapshot !== null ? (
        <div className="rows" data-testid="start-identity">
          <Row label="服务里的助手" value={state.snapshot.agent.name} />
          <Row label="模式" value={agentModeLabel(state.snapshot.agent)} />
          <Row label="人格修订" value={String(state.snapshot.agent.profileRevision)} />
          <Row label="地址" value={state.baseUrl} />
        </div>
      ) : null}

      {companion.available ? (
        <form
          className="connection-form"
          data-testid="start-connect-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {/* 别处改过 Config：保留草稿，说明它不再是那一版的输入，重读要用户自己点。 */}
          {movedUnderneath ? (
            <p className="field__error" role="alert" data-testid="start-address-moved">
              服务地址在别处改过。你的草稿还在，但保存会以你读到的那一版为准。
              <Button
                size="small"
                data-testid="start-address-rebase"
                onClick={() => {
                  if (state === null) return;
                  // 换成另一个目标：旧令牌属于旧地址，一并清掉。
                  setBaseUrl(state.baseUrl);
                  setToken('');
                  setBaseline(state.configRevision);
                }}
              >
                读取最新地址
              </Button>
            </p>
          ) : null}

          <Field label="服务地址" {...(missing ? { error: '请填服务地址。' } : {})}>
            {({ inputId }) => (
              <input
                id={inputId}
                className="input"
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="http://127.0.0.1:4120"
                value={baseUrl}
                disabled={busy}
                data-testid="start-address"
                onChange={(event) => {
                  // 令牌是为「当时那个目标」填的：换了地址就不再适用，不能带过去。
                  setBaseUrl(event.target.value);
                  setToken('');
                }}
              />
            )}
          </Field>

          {asking ? (
            <Field label="访问令牌" {...(missing ? { error: '请填入访问令牌。' } : {})}>
              {({ inputId }) => (
                <input
                  ref={tokenInput}
                  id={inputId}
                  className="input"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={token}
                  disabled={busy}
                  data-testid="start-token"
                  onChange={(event) => setToken(event.target.value)}
                />
              )}
            </Field>
          ) : null}

          <p className="row__value" id={addressId}>
            令牌只用于这一次连接，不写进配置、不进 URL，也不跨进程保留。
          </p>

          <div className="card__foot">
            {asking ? (
              <>
                <Button type="submit" variant="primary" busy={busy} data-testid="start-connect">
                  {busy
                    ? '正在连接…'
                    : state !== null && updatesConnection(state)
                      ? '更新连接'
                      : '连接'}
                </Button>
                {/* 收起输入时也清掉已填的令牌：不留下看不见的 secret。 */}
                <Button
                  variant="ghost"
                  data-testid="start-cancel-token"
                  disabled={busy}
                  onClick={() => {
                    setToken('');
                    setAsking(false);
                  }}
                >
                  取消
                </Button>
              </>
            ) : (
              <Button
                variant="primary"
                disabled={busy || (state !== null && !canConnect(state))}
                data-testid="start-ask-token"
                onClick={() => setAsking(true)}
              >
                {label}
              </Button>
            )}
            {state !== null && state.phase === 'offline' && state.connectionId !== null ? (
              <Button data-testid="start-reconnect" onClick={() => void companion.reconnect()}>
                用这次进程里的令牌重连
              </Button>
            ) : null}
            {state !== null && state.connectionId !== null ? (
              <Button
                data-testid="start-disconnect"
                disabled={busy}
                onClick={() => void companion.disconnect()}
              >
                断开
              </Button>
            ) : null}
            <Button
              variant="ghost"
              data-testid="start-refresh"
              disabled={companion.loading}
              onClick={companion.refresh}
            >
              {companion.loading ? '读取中…' : '重新读取'}
            </Button>
          </div>
          {asking ? null : (
            <p className="row__value" id={tokenId}>
              {state === null
                ? '正在读取连接状态…'
                : state.baseUrl === ''
                  ? '还没有保存过地址。'
                  : `已保存 ${hostOf(state.baseUrl)}；令牌不跨进程保留，需要重新输入。`}
            </p>
          )}
        </form>
      ) : null}
    </Card>
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

/* ---------------------------------------------------------------- 服务模型 */

function ModelCard({ companion }: { companion: CompanionView }): JSX.Element | null {
  const state = companion.state;
  const [open, setOpen] = useState(false);
  const connectionId = state?.connectionId ?? null;
  const view = state?.snapshot?.model ?? null;

  /**
   * 表单只做保存与测试；写密钥在桌面端恒被拒绝，所以没有密钥输入。
   * 每个动作都带发起时的 connectionId，换代之后的回执由 transport 侧丢弃。
   */
  const transport = createReadOnlyModelTransport({
    saveModel: (command: CompanionModelSaveCommand) => companion.saveModel(command),
    testModel: (command: CompanionModelTestCommand) => companion.testModel(command),
  });

  if (state === null || view === null) return null;

  const applied = view.applied;
  const connector = view.connectors.find((item) => item.id === applied?.connectorId) ?? null;
  const summary =
    applied === null
      ? view.desired.mode === 'scripted'
        ? '现在用脚本回复。要接真实模型，先选连接并填好地址和模型。'
        : '模型模式已选，但还没有可用的连接。'
      : !view.enabled
        ? '连接已就绪，但前台还没有切到它。'
        : state.snapshot?.agent.status === 'unavailable'
          ? '模型模式已选，但连接当前不可用。'
          : `模型回复 · ${connector?.label ?? applied.connectorId}`;

  return (
    <Card
      title="模型连接"
      id="model-connection-card"
      action={
        <Button size="small" data-testid="model-open" onClick={() => setOpen(true)}>
          设置
        </Button>
      }
    >
      <p className="row__value" data-testid="model-summary">
        {summary}
      </p>
      {connector === null ? null : (
        <div className="rows rows--tight">
          <Row label="连接" value={connector.label} />
          <Row label="模型" value={connector.model ?? '未指定'} />
          <Row label="凭据来源" value={connector.credential.source} />
        </div>
      )}
      <p className="row__value">
        保存与测试都针对已应用的这一份；密钥只能由服务操作员在服务端注入，这里不代写。
      </p>
      {open ? (
        <ModelDialog
          key={connectionId ?? 'no-connection'}
          open={open}
          view={view}
          live={state.phase === 'live'}
          agentStatus={state.snapshot?.agent.status ?? null}
          transport={transport}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </Card>
  );
}

/* -------------------------------------------------------------------- 桌宠 */

const POSES = [
  { pose: 'idle', glyph: '○', label: '预览待机' },
  { pose: 'listening', glyph: '◉', label: '预览聆听' },
  { pose: 'replying', glyph: '↗', label: '预览回应' },
] as const;

function PetCard({
  companion,
  presentation,
  notify,
}: {
  companion: CompanionView;
  presentation: LocalPresentationView;
  notify: StartPageProps['notify'];
}): JSX.Element {
  const preferences = presentation.snapshot?.preferences ?? null;
  const palette = preferences?.palette ?? 'morning';
  const colors = PET_PALETTES[palette];
  const figure = preferences?.figure ?? 'minimal';
  const size = preferences?.size ?? 'normal';
  const state = companion.state;
  const live = state === null ? 'idle' : petStateOf(state);
  const [pose, setPose] = useState<string | null>(null);
  const [night, setNight] = useState(false);
  const { expression, sceneRef, poke } = usePokeableAvatar(undefined);
  const desktop = presentation.snapshot?.desktop ?? null;

  const save = async (patch: Parameters<LocalPresentationView['save']>[0], label: string) => {
    const ok = await presentation.save(patch);
    if (!ok) notify(`${label}没有保存。`, 'danger');
  };

  return (
    <Card title="桌宠" id="start-pet-card">
      {presentation.available ? null : (
        <p role="alert">
          <Status tone="warn">这台机器没有本地外观通道，下面的开关不会生效。</Status>
        </p>
      )}
      <div
        ref={sceneRef}
        className="stage stage--wide"
        role="region"
        aria-label="桌宠预览"
        data-palette={palette}
        data-scene-dark={night ? 'true' : 'false'}
        {...(pose === null ? {} : { 'data-preview-pose': pose })}
        data-testid="start-pet"
        style={
          {
            '--pet-body-top': colors.top,
            '--pet-body-bottom': colors.bottom,
            '--pet-face': colors.face,
            '--halo': colors.halo,
          } as CSSProperties
        }
      >
        <button
          type="button"
          className="stage-theme"
          aria-label="切换预览场景明暗"
          aria-pressed={night}
          onClick={() => setNight((now) => !now)}
        >
          ☼
        </button>
        <button
          type="button"
          className="stage__pet"
          data-size={size}
          data-figure={figure}
          aria-label="戳它一下"
          data-testid="pet-poke"
          onClick={poke}
        >
          <PetAvatar
            state={live}
            expression={expression}
            figure={figure}
            name={state?.snapshot?.agent.name ?? null}
          />
        </button>
        <span className="stage__ground" aria-hidden="true" />
        <div className="stage-toolbar" role="group" aria-label="预览状态">
          {POSES.map((option) => (
            <button
              key={option.pose}
              type="button"
              className="stage-tool"
              aria-label={option.label}
              aria-pressed={pose === option.pose}
              onClick={() => setPose((now) => (now === option.pose ? null : option.pose))}
            >
              {option.glyph}
            </button>
          ))}
        </div>
      </div>

      <div className="preview-window-actions">
        <Button
          variant="ghost"
          busy={presentation.saving}
          disabled={!presentation.available || desktop?.shown === false}
          data-testid="pet-hide"
          onClick={() => void save({ visible: false }, '在桌面隐藏')}
        >
          在桌面隐藏
        </Button>
        <Button
          variant="ghost"
          busy={presentation.saving}
          disabled={!presentation.available || desktop?.shown === true}
          data-testid="pet-show"
          onClick={() => void save({ visible: true }, '在桌面显示')}
        >
          在桌面显示
        </Button>
        <span className="row__value" role="status">
          {desktop === null ? '桌面状态未读取' : desktop.shown ? '正在桌面显示' : '当前隐藏'}
        </span>
      </div>

      {presentation.notice === null ? null : (
        <p className="field__error" role="alert">
          {presentation.notice}
        </p>
      )}

      <div className="rows">
        <SwitchRow
          label="允许拖动"
          checked={preferences?.draggable ?? true}
          disabled={!presentation.available || presentation.saving}
          testId="pref-draggable"
          onChange={(next) => void save({ draggable: next }, '允许拖动')}
        />
        <SwitchRow
          label="减少动画"
          checked={preferences?.reducedMotion ?? false}
          disabled={!presentation.available || presentation.saving}
          testId="pref-reduced-motion"
          onChange={(next) => void save({ reducedMotion: next }, '减少动画')}
        />
      </div>

      <p className="row__value">
        形态、配色、大小与气泡细节在「外观」与「人格」两页；它们改的是这台机器上的呈现，
        不会改服务里的助手。
      </p>
    </Card>
  );
}

function SwitchRow({
  label,
  checked,
  disabled,
  testId,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  testId: string;
  onChange: (next: boolean) => void;
}): JSX.Element {
  return (
    <label className="row">
      <span className="row__text">
        <span className="row__label">{label}</span>
      </span>
      <span className="switch">
        <input
          type="checkbox"
          role="switch"
          data-testid={testId}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <i aria-hidden="true" />
      </span>
    </label>
  );
}
