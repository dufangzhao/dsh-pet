import { useEffect, useId, useRef, useState, type JSX } from 'react';
import { Button, Dialog, Field } from '@pet/ui-kit';
import type {
  CompanionAgentView,
  CompanionModelConnectorView,
  CompanionModelView,
} from '@pet/contracts';

import {
  followable,
  availability,
  beginOperation,
  changedUnderneath,
  checkText,
  dirtyOf,
  emptyModelForm,
  pendingAuthChange,
  rebaseOnLatest,
  runRemoveKey,
  runSave,
  runTest,
  seedDraft,
  seedForm,
  selectConnector,
  setKey,
  setMode,
  setSettings,
  summaryText,
  type ModelFormState,
  type ModelTransport,
} from './model-form.js';

export interface ModelDialogProps {
  readonly open: boolean;
  readonly view: CompanionModelView | null;
  readonly live: boolean;
  readonly agentStatus: CompanionAgentView['status'] | null;
  readonly transport: ModelTransport;
  readonly onClose: () => void;
}

/**
 * 模型连接的紧凑设置：选连接、改三项固定字段、可选填网关密钥，
 * 然后只有两个动作——「保存并应用」和「测试连接」。
 *
 * 判断全在 model-form.ts 里（纯函数，可逐条回归）；这里只负责把它接到 DOM。
 * 三条不变量：CAS 用草稿读到时的版本、密钥发起即清空、视图是唯一真相。
 */
export function ModelDialog({
  open,
  view,
  live,
  agentStatus,
  transport,
  onClose,
}: ModelDialogProps): JSX.Element {
  const [form, setForm] = useState<ModelFormState>(emptyModelForm);
  // 每次打开/关闭都换代：关掉之后才回来的响应不能改到下一份表单上。
  const generation = useRef(0);

  // 每次打开都从已保存的值重新开始：上一次的密钥、提示和草稿都不带进来。
  useEffect(() => {
    generation.current += 1;
    if (!open) return;
    setForm(view === null ? emptyModelForm : seedForm(view));
    // 只跟 open 走：视图变化由下面那个 effect 判断是「跟上」还是「保留草稿」。
  }, [open]);

  // 服务端配置变了，而且不是我们自己刚保存的那一份：保留草稿，只标注外部变更。
  // 如果草稿本来就还停在服务端的值上，直接跟过去。
  useEffect(() => {
    if (!open || view === null) return;
    setForm((current) => {
      // 有草稿改动、有待提交的密钥、或有请求在途：这一次刷新与我们无关，
      // 不重铺、不清输入、不解锁。
      if (current.draft === null) return seedForm(view);
      if (!followable(current)) return current;
      // 重新铺表单会清掉提示；刚完成的那次操作答复要留住。
      return { ...seedForm(view), notice: current.notice };
    });
  }, [open, view]);

  if (view === null) {
    return (
      <div className="tc-model-dialog">
        <Dialog open={open} title="模型连接" onClose={onClose}>
          <p className="tc-model__note">这个服务没有提供模型设置。</p>
        </Dialog>
      </div>
    );
  }

  const draft = form.draft ?? seedDraft(view);
  const current = { ...form, draft };
  const selected = view.connectors.find((item) => item.id === draft.connectorId) ?? null;
  const dirty = dirtyOf(draft, view, form.key);
  const rules = availability(current, view, {
    live,
    agentBusy: agentStatus === 'busy',
  });
  const moved = changedUnderneath(draft, view);

  // 点击后发生什么全在 model-form.ts；这里只做「先进入忙碌态（密钥随之离场），
  // 再把最终状态换回来」，所以任何成功/失败/结果不明都不会留着 secret。
  /** 只采纳属于当前这一代表单的结果；关闭后迟到的响应直接丢弃。 */
  const settle = (started: number, next: ModelFormState): void => {
    if (generation.current !== started) return;
    setForm(next);
  };

  const save = async (): Promise<void> => {
    const started = generation.current;
    const key = form.key;
    const pending = beginOperation(current, 'saving');
    setForm(pending);
    settle(started, await runSave(pending, view, transport, key));
  };

  const test = async (): Promise<void> => {
    const started = generation.current;
    const pending = beginOperation(current, 'testing');
    setForm(pending);
    settle(started, await runTest(pending, view, transport));
  };

  const removeKey = async (): Promise<void> => {
    const started = generation.current;
    const pending = beginOperation(current, 'credential');
    setForm(pending);
    settle(started, await runRemoveKey(pending, view, transport));
  };

  return (
    <div className="tc-model-dialog">
      <Dialog
        open={open}
        title="模型连接"
        onClose={onClose}
        footer={
          <>
            <Button onClick={onClose}>关闭</Button>
            <Button
              variant="secondary"
              aria-busy={form.busy === 'testing'}
              disabled={!rules.canTest}
              title={rules.testReason ?? undefined}
              onClick={() => void test()}
            >
              {form.busy === 'testing' ? '正在测试…' : '测试连接'}
            </Button>
            <Button
              variant="primary"
              aria-busy={form.busy === 'saving' || form.busy === 'credential'}
              disabled={!rules.canSave}
              title={rules.saveReason ?? undefined}
              onClick={() => void save()}
            >
              {form.busy === 'saving' || form.busy === 'credential' ? '正在应用…' : '保存并应用'}
            </Button>
          </>
        }
      >
        <div className="tc-model">
          <p className="tc-model__summary">{summaryText(view, agentStatus ?? '')}</p>

          {moved ? (
            <p className="tc-model__note" role="status">
              服务端配置在别处改过。你的修改还在这里，保存时会以你读到的那一版为准。
            </p>
          ) : null}

          <Field label="连接">
            {(control) => (
              <select
                id={control.inputId}
                className="tc-model__control"
                value={draft.connectorId}
                disabled={form.busy !== null}
                onChange={(event) =>
                  setForm((state_) => selectConnector(state_, view, event.target.value))
                }
              >
                {view.connectors.map((connector) => (
                  <option key={connector.id} value={connector.id}>
                    {connector.label}
                    {connector.synthetic ? '（模拟）' : ''}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field label="服务模式" hint="保存时生效">
            {(control) => (
              <select
                id={control.inputId}
                className="tc-model__control"
                value={draft.mode}
                disabled={form.busy !== null}
                onChange={(event) =>
                  setForm((state_) =>
                    setMode(state_, event.target.value === 'model' ? 'model' : 'scripted'),
                  )
                }
              >
                <option value="scripted">脚本演示，不调用模型</option>
                <option value="model">模型回复</option>
              </select>
            )}
          </Field>

          {draft.settings === null ? (
            <p className="tc-model__note">
              这个连接由程序配置，这里只负责选用和测试。
              {selected?.model === null ? '' : ` 模型：${selected?.model}`}
            </p>
          ) : (
            <>
              <Field label="接口地址" hint="含 /v1">
                {(control) => (
                  <input
                    id={control.inputId}
                    className="tc-model__control"
                    value={draft.settings?.baseUrl ?? ''}
                    spellCheck={false}
                    autoComplete="off"
                    disabled={form.busy !== null}
                    onChange={(event) =>
                      setForm((state_) => setSettings(state_, { baseUrl: event.target.value }))
                    }
                  />
                )}
              </Field>
              <Field label="模型">
                {(control) => (
                  <input
                    id={control.inputId}
                    className="tc-model__control"
                    value={draft.settings?.model ?? ''}
                    spellCheck={false}
                    autoComplete="off"
                    disabled={form.busy !== null}
                    onChange={(event) =>
                      setForm((state_) => setSettings(state_, { model: event.target.value }))
                    }
                  />
                )}
              </Field>
              <Field
                label="鉴权方式"
                description="本机回环用公开客户端标识；远程网关用它自己的密钥。"
              >
                {(control) => (
                  <select
                    id={control.inputId}
                    className="tc-model__control"
                    value={draft.settings?.authMode ?? 'local-client-id'}
                    disabled={form.busy !== null}
                    onChange={(event) =>
                      setForm((state_) =>
                        setSettings(state_, {
                          authMode:
                            event.target.value === 'gateway-key'
                              ? 'gateway-key'
                              : 'local-client-id',
                        }),
                      )
                    }
                  >
                    <option value="local-client-id">本机回环，不需要密钥</option>
                    <option value="gateway-key">网关密钥</option>
                  </select>
                )}
              </Field>
            </>
          )}

          <CredentialField
            credential={selected?.credential ?? null}
            value={form.key}
            busy={form.busy !== null}
            pendingAuth={pendingAuthChange(draft, view)}
            onChange={(value) => setForm((state_) => setKey(state_, value))}
            onRemove={() => void removeKey()}
          />

          <p className={`tc-model__check tc-model__check--${view.check.state}`} role="status">
            {checkText(view.check, view, dirty.nonsecret, live)}
          </p>

          {form.notice === null ? null : (
            <p
              className={form.notice.kind === 'error' ? 'tc-model__error' : 'tc-model__note'}
              role={form.notice.kind === 'error' ? 'alert' : 'status'}
            >
              {form.notice.text}
            </p>
          )}

          {/* 冲突的唯一出路：读回最新版本，保留自己填的值，再由用户决定是否保存。 */}
          {form.notice?.kind === 'error' && form.notice.error?.code === 'conflict' ? (
            <Button size="small" onClick={() => setForm((state_) => rebaseOnLatest(state_, view))}>
              读取最新版本，保留我的修改
            </Button>
          ) : null}
        </div>
      </Dialog>
    </div>
  );
}

export function CredentialField({
  credential,
  value,
  busy,
  pendingAuth,
  onChange,
  onRemove,
}: {
  credential: CompanionModelConnectorView['credential'] | null;
  value: string;
  busy: boolean;
  /** 同一连接正从「不需要密钥」改成网关密钥：先保存连接再填密钥。 */
  pendingAuth: boolean;
  onChange: (value: string) => void;
  onRemove: () => void;
}): JSX.Element {
  const id = useId();
  if (credential === null || !credential.required) {
    // 不需要密钥的连接永远只说这一句；只有真的在把鉴权改成网关密钥时，
    // 才提示先保存（后端描述的还是旧的那一份，不能替它猜许可）。
    return (
      <p className="tc-model__note">
        {pendingAuth ? '先把连接保存下来，密钥要按已保存的连接单独填。' : '这个连接不需要密钥。'}
      </p>
    );
  }
  // 后端说不能写就不写：不根据草稿、URL、Host 或 Origin 自己猜许可。
  // 本阶段只有 loopback/受控 SSH 入口可写；远程（含 HTTPS 反代）一律宿主注入。
  if (!credential.writable) {
    return (
      <p className="tc-model__note">
        这个入口不允许在这里写密钥，请在宿主上用环境或密钥管理注入。
        {credential.available ? ' 当前已有可用密钥。' : ' 当前没有可用密钥。'}
      </p>
    );
  }
  return (
    <div className="tc-model__key">
      <label className="tc-model__label" htmlFor={id}>
        网关密钥
      </label>
      <div className="tc-model__keyrow">
        <input
          id={id}
          className="tc-model__control"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          disabled={busy}
          onChange={(event) => onChange(event.target.value)}
          aria-describedby={`${id}-hint`}
        />
        <Button size="small" disabled={busy || !credential.available} onClick={onRemove}>
          清除密钥
        </Button>
      </div>
      <p className="tc-model__note" id={`${id}-hint`}>
        {pendingAuth
          ? '密钥按已保存的连接写入；先保存连接改动，再单独填密钥。'
          : '只用于这一次提交，不保存到浏览器。'}
        {credential.available ? ' 已有可用密钥；留空表示不改。' : ''}
      </p>
    </div>
  );
}
