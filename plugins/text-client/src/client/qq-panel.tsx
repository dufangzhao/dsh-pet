/**
 * QQ 管理面板：owner 在服务 Web 上配置两个协议模块与全部策略。
 *
 * 判断都在 qq-form.ts（纯函数，可逐条回归）；这里只把它接到 DOM。
 * 三个不可越界的表达：
 * - 保存成功 ≠ 已连接：连接状态只读视图的 phase/account。
 * - 平台接受 ≠ 用户已读：投递区只报 accepted/failed/unknown。
 * - 文字恒有：语音是附加开关，没有「只发语音」的选项。
 */
import { useEffect, useRef, useState, type JSX } from 'react';
import {
  Button,
  Dialog,
  EmptyState,
  Field,
  List,
  ListItem,
  Section,
  StatusBadge,
} from '@pet/ui-kit';

import { QQJudgeForm } from './qq-judge-form.js';
import { QQAliasEditor, QQAllowlists } from './qq-allowlists.js';
import { QQGroupSettingsEditor } from './qq-group-settings.js';
import {
  errorMessage,
  type QQDeliveryPage,
  type QQDeliveryView,
  type QQJudgeSettingsCommand,
  type QQSourceView,
  type QQView,
  type Result,
} from '@pet/contracts';

import {
  adoptSave,
  appliedFacts,
  clearGroupSettings,
  connectionFacts,
  editPolicy,
  editSource,
  emptyQQForm,
  followView,
  groupSettingsOf,
  judgeSaveCommand,
  editJudge,
  sameJudgeOwner,
  adoptJudge,
  failJudge,
  judgeTargetSaved,
  judgeSecretValid,
  type JudgeSecretDraft,
  mediaLabel,
  ownerOf,
  sameSourceOwner,
  policySaveCommand,
  rebaseOnView,
  sameGroup,
  seedPolicy,
  selectSource,
  setGroupSettings,
  sourceSaveCommand,
  type QQFormState,
  type QQSourceOwner,
} from './qq-form.js';

export interface QQTransport {
  /** 这次服务连接的身份；换连接后旧闭包的结果不能落地。 */
  readonly connectionId: string;
  read(): Promise<Result<QQView>>;
  savePolicy(command: {
    expectedRevision: number;
    settings: QQView['policy']['settings'];
  }): Promise<Result<QQView>>;
  saveSource(command: {
    protocol: QQSourceView['protocol'];
    expectedRevision: number;
    settings: QQSourceView['settings'];
  }): Promise<Result<QQView>>;
  writeCredential(command: {
    protocol: QQSourceView['protocol'];
    expectedRevision: number;
    expectedCredentialVersion: string;
    value: string | null;
  }): Promise<Result<QQView>>;
  saveJudge(command: QQJudgeSettingsCommand): Promise<Result<QQView>>;
  writeJudgeCredential(command: {
    providerRef: string;
    expectedConfigRevision: number;
    expectedCredentialVersion: string;
    value: string | null;
  }): Promise<Result<QQView>>;
  setEnabled(pluginId: string, commandId: string, enabled: boolean): Promise<Result<unknown>>;
  readDeliveries(after?: string): Promise<Result<QQDeliveryPage>>;
  /** 单条投递的完整事实：parts、每次尝试与真实错误。 */
  readDelivery(id: string): Promise<Result<QQDeliveryView>>;
}

export interface QQPanelProps {
  readonly open: boolean;
  readonly view: QQView | null;
  readonly transport: QQTransport;
  readonly onClose: () => void;
  /**
   * 把真实视图交回**唯一**的 view owner。
   *
   * 面板自己重读只更新本地表单；来源的 account/readiness/applied/keyWritable
   * 都在视图里，不发布回去的话，保存完界面还是旧状态——只能关掉重开。
   */
  readonly onView: (view: QQView) => void;
}

/**
 * 一份密钥草稿。
 *
 * 它和 target 一起捕获：来源换了、连接换了，这份密钥就不属于当前界面了。
 * `configRevision`/`credentialVersion` 也在这里，保存时用**捕获的**那两版做 CAS，
 * 不用点击那一刻的最新值。
 */
interface SecretDraft {
  readonly value: string;
  readonly target: QQSourceOwner;
  readonly expectedCredentialVersion: string;
}

const PROTOCOL_LABEL: Record<QQSourceView['protocol'], string> = {
  official: '官方 QQ WebSocket',
  'onebot-v11': 'OneBot v11（反向 Universal）',
};

export function QQPanel({ open, view, transport, onClose, onView }: QQPanelProps): JSX.Element {
  const [form, setForm] = useState<QQFormState>(emptyQQForm);
  const [protocol, setProtocol] = useState<QQSourceView['protocol'] | null>(null);
  const [deliveries, setDeliveries] = useState<QQDeliveryPage | null>(null);
  const [detail, setDetail] = useState<QQDeliveryView | null>(null);
  const [detailFailure, setDetailFailure] = useState<string | null>(null);
  const generation = useRef(0);
  /**
   * 密钥草稿带它自己的归属：用户给 A 填钥匙期间，来源可能被换成 B。
   * 那时旧密钥不能拿 B 的最新 CAS 写下去——所以密钥和 target 一起捕获，
   * target 一变就清掉，旧闭包也认不出自己。
   */
  const [secret, setSecret] = useState<SecretDraft | null>(null);
  /** judge 的密钥草稿：和来源密钥一样，发起即离场，且绑定捕获的 target。 */
  const [judgeSecret, setJudgeSecret] = useState<JudgeSecretDraft | null>(null);
  /** 最新的选中模块；迟到的 completion 用它，不用发起时的闭包值。 */
  const protocolRef = useRef<QQSourceView['protocol'] | null>(null);
  /** 在途操作的 token：只有自己那次还在生效时才允许改界面。 */
  const operation = useRef<symbol | null>(null);

  /**
   * 选中哪个模块：用户显式选过就用它，否则用视图里的第一个。
   *
   * 不能只靠 effect 初始化 `protocol`——视图比打开动作晚到时，第一次渲染
   * 会短暂地「没有可选模块」，把整块配置区藏起来。
   */
  const effectiveProtocol = protocol ?? view?.sources[0]?.protocol ?? null;
  protocolRef.current = effectiveProtocol;
  const selected = selectSource(view, effectiveProtocol);
  const connectionId = transport.connectionId;
  /**
   * 当前生效的连接身份。
   *
   * 直接拿 `transport.connectionId === connectionId` 比是假比较——两个都来自
   * 同一个闭包，永远相等。ref 每次渲染更新，await 之后读到的才是此刻的连接。
   */
  const currentOwner = useRef(connectionId);
  currentOwner.current = connectionId;

  /** 面板关闭/卸载后，任何在途结果都不许改表单。 */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const target = selected === null ? null : ownerOf(selected, connectionId);
  /** judge 的密钥只在它捕获的那个已保存 target 上有效。 */
  const judgeSecretOk = view !== null && judgeSecretValid(judgeSecret, view, connectionId);
  const secretMatches =
    secret !== null && target !== null && sameSourceOwner(secret.target, target);

  // 每次打开都从服务端值重新开始：上一次的密钥与草稿不带进来。
  useEffect(() => {
    generation.current += 1;
    if (!open) return;
    setSecret(null);
    setDeliveries(null);
    setForm(emptyQQForm);
    setProtocol(view?.sources[0]?.protocol ?? null);
  }, [open]);

  // 视图变了：只重铺没被编辑过的那一份，正在改的草稿原样留着。
  useEffect(() => {
    if (!open || view === null) return;
    setForm((current) =>
      followView(current, view, selectSource(view, effectiveProtocol), connectionId),
    );
  }, [open, view, effectiveProtocol, connectionId]);

  /**
   * 已保存的 judge target 一变，旧密钥立即作废。
   *
   * 不这样做的话，这次 reread 会把干净的表单重铺成新 target 的基线，
   * 而裸字符串密钥还是旧 target 的——它就会带着新 target 的合法 CAS 被写过去。
   */
  useEffect(() => {
    if (judgeSecret === null || view === null) return;
    if (!judgeSecretValid(judgeSecret, view, connectionId)) setJudgeSecret(null);
  }, [judgeSecret, view, connectionId]);

  const settle = (started: number, next: QQFormState): void => {
    if (generation.current !== started) return;
    setForm(next);
  };

  /** 这次操作是否仍是当前那次：面板没关、没换连接、没有更新的操作顶掉它。 */
  const live = (token: symbol, started: number): boolean =>
    alive.current &&
    generation.current === started &&
    operation.current === token &&
    currentOwner.current === connectionId;

  const run = async (
    busy: NonNullable<QQFormState['busy']>,
    work: () => Promise<Result<QQView>>,
    kind: 'policy' | 'source',
    owner: QQSourceOwner | null,
  ): Promise<void> => {
    const started = generation.current;
    const token = Symbol(busy);
    operation.current = token;
    setForm((current) => ({ ...current, busy, notice: null, failure: null }));
    const result = await work();
    if (!live(token, started)) return;
    // 来源换代后旧闭包的保存结果不能落到新表单上。
    if (kind === 'source' && owner !== null) {
      const current = selected === null ? null : ownerOf(selected, connectionId);
      if (!sameSourceOwner(current, owner)) {
        setForm((state) => ({ ...state, busy: null }));
        return;
      }
    }
    settle(started, adoptSave(form, result, kind).form);
    /**
     * 无论成败都重读：两段 CAS 可能只提交了一半，只在成功时重读会把
     * 「可能已写入」说成「完全没保存」。`followView` 只让**干净**的部分跟随，
     * 脏草稿连同它读到的旧 revision 一起保留，直到用户显式 rebase。
     */
    const reread = await transport.read();
    if (!live(token, started) || !reread.ok) return;
    // 交回唯一的 view owner：来源状态与 judge readiness 都在里面。
    onView(reread.value);
    setForm((current) => {
      /**
       * 用**此刻最新的** protocol 与 selected 重铺，不是发起时闭包里那份。
       * 用户可能在保存期间切到了另一个模块；用旧 protocol 重铺会把 B 的
       * 表单按 A 的来源重置，B 刚填的值就没了。
       */
      const latestProtocol = currentOwner.current === connectionId ? protocolRef.current : null;
      const followed = followView(
        current,
        reread.value,
        selectSource(reread.value, latestProtocol),
        connectionId,
      );
      return { ...followed, notice: current.notice, failure: current.failure };
    });
  };

  const savePolicy = (): void => {
    const command = policySaveCommand(form, view);
    if (command === null) return;
    void run('policy', () => transport.savePolicy(command), 'policy', null);
  };

  const saveSource = (): void => {
    const command = sourceSaveCommand(form);
    if (command === null) return;
    void run('source', () => transport.saveSource(command), 'source', form.source?.owner ?? null);
  };

  /**
   * 保存密钥。
   *
   * 用草稿里**捕获的** target 与 credential 版本提交，不用点击那一刻的最新值：
   * 用户给 A 填钥匙期间来源若被换成 B，这次写入必须整体作废，而不是拿 B 的
   * 最新 CAS 把 A 的钥匙写下去。
   */
  const saveCredential = async (): Promise<void> => {
    if (secret === null || !secretMatches || secret.value.trim() === '') return;
    const started = generation.current;
    const token = Symbol('credential');
    operation.current = token;
    const captured = secret;
    // 密钥发起即离场：它不留在组件状态里。
    setSecret(null);
    setForm((current) => ({ ...current, busy: 'credential', notice: null, failure: null }));
    const result = await transport.writeCredential({
      protocol: captured.target.protocol,
      expectedRevision: captured.target.configRevision,
      expectedCredentialVersion: captured.expectedCredentialVersion,
      value: captured.value,
    });
    if (!live(token, started)) return;
    // 来源或连接换代：结果不落地。
    if (!sameSourceOwner(target, captured.target)) {
      setForm((state) => ({ ...state, busy: null }));
      return;
    }
    settle(started, adoptSave(form, result, 'source').form);
  };

  /**
   * 保存 judge 设置。
   *
   * 两段 CAS：policy 半用 policy 草稿的基线，连接半用 **judge 草稿捕获的**
   * configRevision。点击那一刻不去读最新 view。
   */
  const saveJudge = async (): Promise<void> => {
    const command = judgeSaveCommand(form);
    if (command === null) return;
    const started = generation.current;
    const token = Symbol('judge');
    operation.current = token;
    const captured = form.judge;
    setForm((current) => ({ ...current, busy: 'judge', notice: null, failure: null }));
    const result = await transport.saveJudge(command);
    if (!live(token, started)) return;
    // judge 的 configRevision 变了：这次结果不再属于当前草稿。
    if (captured !== null && !sameJudgeOwner(captured, connectionId)) {
      setForm((current) => ({ ...current, busy: null }));
      return;
    }
    // 成功用返回视图推进 judge 基线；失败保留草稿与它捕获的基线。
    // 两条路径都不动 policy 的其他部分（allowlist/群设置可能还有未保存的编辑）。
    settle(
      started,
      result.ok ? adoptJudge(form, result.value, connectionId) : failJudge(form, result.error),
    );
    const reread = await transport.read();
    if (!live(token, started) || !reread.ok) return;
    // 交回唯一的 view owner：来源状态与 judge readiness 都在里面。
    onView(reread.value);
    setForm((current) => {
      /**
       * 用**此刻最新的** protocol 与 selected 重铺，不是发起时闭包里那份。
       * 用户可能在保存期间切到了另一个模块；用旧 protocol 重铺会把 B 的
       * 表单按 A 的来源重置，B 刚填的值就没了。
       */
      const latestProtocol = currentOwner.current === connectionId ? protocolRef.current : null;
      const followed = followView(
        current,
        reread.value,
        selectSource(reread.value, latestProtocol),
        connectionId,
      );
      return { ...followed, notice: current.notice, failure: current.failure };
    });
  };

  /** 写/清 judge 自己的密钥。用捕获的 configRevision 与 credential 版本。 */
  const writeJudgeKey = async (value: string | null): Promise<void> => {
    if (view === null || form.judge === null) return;
    if (!view.judge.credential.writable) return;
    /**
     * 密钥只能写到**它捕获的那个已保存 target**。
     *
     * 两种拒绝都要有：本地改了连接但还没保存（屏幕上那个 target 服务端没有），
     * 以及外部把已保存 target 换掉了（reread 会让干净表单跟到新基线，但密钥
     * 仍属于旧 target）。任一情况都一个请求都不发。
     */
    if (!judgeTargetSaved(form, view)) {
      setForm((current) => ({
        ...current,
        notice: '判断模型的连接改过但还没保存；先保存连接，再写密钥。',
      }));
      return;
    }
    if (value !== null && !judgeSecretOk) {
      setJudgeSecret(null);
      setForm((current) => ({
        ...current,
        notice: '这个密钥所属的判断模型已改变；请重新输入。',
      }));
      return;
    }
    const started = generation.current;
    const token = Symbol('judge-credential');
    operation.current = token;
    // 写入用密钥草稿捕获的那一份；清除用当前已保存的基线（清除不涉及 target 漂移）。
    const target = judgeSecret ?? {
      providerRef: form.judge.settings.providerRef,
      configRevision: form.judge.configRevision,
      credentialVersion: form.judge.credentialVersion,
    };
    setJudgeSecret(null);
    setForm((current) => ({ ...current, busy: 'judge-credential', notice: null, failure: null }));
    const result = await transport.writeJudgeCredential({
      providerRef: target.providerRef,
      expectedConfigRevision: target.configRevision,
      expectedCredentialVersion: target.credentialVersion,
      value,
    });
    if (!live(token, started)) return;
    settle(
      started,
      result.ok ? adoptJudge(form, result.value, connectionId) : failJudge(form, result.error),
    );
    const reread = await transport.read();
    if (!live(token, started) || !reread.ok) return;
    setForm((current) =>
      followView(
        current,
        reread.value,
        selectSource(reread.value, effectiveProtocol),
        connectionId,
      ),
    );
  };

  const toggle = async (): Promise<void> => {
    if (selected === null) return;
    const started = generation.current;
    setForm((current) => ({ ...current, busy: 'toggle', notice: null, failure: null }));
    const result = await transport.setEnabled(
      selected.sourcePluginId,
      `qq-toggle-${selected.protocol}-${Date.now()}`,
      !selected.desiredEnabled,
    );
    if (generation.current !== started) return;
    if (!result.ok) {
      settle(started, {
        ...form,
        busy: null,
        failure: result.error,
        notice: `没有切换：${errorMessage(result.error)}`,
      });
      return;
    }
    // 回执只证明命令被记录：必须重读，才能知道来源是不是真的连上了。
    const reread = await transport.read();
    if (generation.current !== started) return;
    settle(
      started,
      reread.ok
        ? {
            ...followView(
              form,
              reread.value,
              selectSource(reread.value, effectiveProtocol),
              connectionId,
            ),
            busy: null,
            notice: '已提交切换；连接状态以下面显示为准。',
          }
        : { ...form, busy: null, notice: '已提交切换，但没能读到最新状态。' },
    );
  };

  const loadDeliveries = async (): Promise<void> => {
    const result = await transport.readDeliveries();
    if (!result.ok) {
      setForm((current) => ({ ...current, failure: result.error }));
      return;
    }
    setDeliveries(result.value);
  };

  /**
   * 展开一条投递。
   *
   * 摘要只有 phase/outcome，看不出「哪一段失败、失败原因是什么」；
   * 所以详情是另一个读取，按点击时捕获的 id 取，失败如实说。
   */
  const openDelivery = async (id: string): Promise<void> => {
    setDetailFailure(null);
    setDetail(null);
    const result = await transport.readDelivery(id);
    if (!result.ok) {
      setDetailFailure(`没能读到这条投递的详情：${errorMessage(result.error)}`);
      return;
    }
    setDetail(result.value);
  };

  if (view === null) {
    return (
      <div className="tc-qq-dialog">
        <Dialog open={open} title="QQ" onClose={onClose}>
          <p className="tc-qq__note">这个服务没有提供 QQ 设置。</p>
        </Dialog>
      </div>
    );
  }

  const facts = selected === null ? null : connectionFacts(selected);
  const applied = selected === null ? null : appliedFacts(selected);
  const policy = form.policy ?? seedPolicy(view);
  const policyDirty = form.policy?.edited === true;
  const sourceDirty = form.source?.edited === true;
  // judge 也是可编辑的一份：它脏的时候同样要能 rebase，否则只能关掉重开。
  const judgeDirty = form.judge?.edited === true;
  const busy = form.busy !== null;

  return (
    <div className="tc-qq-dialog">
      <Dialog
        open={open}
        title="QQ"
        onClose={onClose}
        footer={<Button onClick={onClose}>关闭</Button>}
      >
        <div className="tc-qq">
          {form.notice === null ? null : (
            <p className="tc-qq__note" role="status" data-testid="qq-notice">
              {form.notice}
            </p>
          )}
          {form.failure === null ? null : (
            <p className="tc-qq__note tc-qq__note--error" role="alert" data-testid="qq-failure">
              {errorMessage(form.failure)}
            </p>
          )}

          <Section
            title="协议模块"
            description="两个模块各自独立启停与连接；它们都接到同一个助手。"
          >
            <List label="QQ 协议模块">
              {view.sources.map((source) => {
                const state = connectionFacts(source);
                return (
                  <ListItem
                    key={source.protocol}
                    title={PROTOCOL_LABEL[source.protocol]}
                    description={
                      source.account === null ? null : `账号 ${source.account.accountId}`
                    }
                    meta={<StatusBadge tone={state.tone}>{state.label}</StatusBadge>}
                    trailing={
                      <Button
                        size="small"
                        data-testid={`qq-select-${source.protocol}`}
                        onClick={() => setProtocol(source.protocol)}
                      >
                        {source.protocol === effectiveProtocol ? '正在配置' : '配置'}
                      </Button>
                    }
                  />
                );
              })}
            </List>
          </Section>

          {selected === null ? (
            <EmptyState
              title="还没有可配置的协议模块"
              description="服务没有注册任何 QQ 协议来源。"
            />
          ) : (
            <>
              <Section
                title="连接"
                description="保存只写入配置；是否真的连上，看下面这一行的状态。"
              >
                <p className="tc-qq__line" data-testid="qq-connection">
                  <StatusBadge tone={facts?.tone ?? 'neutral'}>
                    {facts?.label ?? '未知'}
                  </StatusBadge>
                  {facts?.detail === null || facts?.detail === undefined ? null : (
                    <span className="tc-qq__detail">{facts.detail}</span>
                  )}
                  {applied === null ? null : <span className="tc-qq__detail">{applied}</span>}
                </p>
                <div className="tc-qq__row">
                  <Button disabled={busy} data-testid="qq-toggle" onClick={() => void toggle()}>
                    {selected.desiredEnabled ? '停用这个模块' : '启用这个模块'}
                  </Button>
                </div>

                {selected.protocol === 'official' ? (
                  <Field label="AppID" hint="官方机器人平台的 AppID">
                    {({ inputId, describedBy }) => (
                      <input
                        id={inputId}
                        className="pk-input"
                        aria-describedby={describedBy}
                        value={
                          form.source?.settings.protocol === 'official'
                            ? form.source.settings.appId
                            : ''
                        }
                        data-testid="qq-app-id"
                        onChange={(event) => {
                          const value = event.target.value;
                          setForm((current) =>
                            editSource(current, (settings) =>
                              settings.protocol === 'official'
                                ? { ...settings, appId: value }
                                : settings,
                            ),
                          );
                        }}
                      />
                    )}
                  </Field>
                ) : (
                  <Field label="机器人账号" hint="OneBot 侧登录的那个 QQ 号">
                    {({ inputId, describedBy }) => (
                      <input
                        id={inputId}
                        className="pk-input"
                        aria-describedby={describedBy}
                        value={
                          form.source?.settings.protocol === 'onebot-v11'
                            ? form.source.settings.accountId
                            : ''
                        }
                        data-testid="qq-account-id"
                        onChange={(event) => {
                          const value = event.target.value;
                          setForm((current) =>
                            editSource(current, (settings) =>
                              settings.protocol === 'onebot-v11'
                                ? { ...settings, accountId: value }
                                : settings,
                            ),
                          );
                        }}
                      />
                    )}
                  </Field>
                )}

                {form.source?.settings.protocol === 'onebot-v11' ? (
                  <>
                    <Field
                      label="监听地址"
                      hint="反向 WS 在本机绑定哪个地址；留 127.0.0.1 只接受本机连接"
                    >
                      {({ inputId, describedBy }) => (
                        <input
                          id={inputId}
                          className="pk-input"
                          aria-describedby={describedBy}
                          value={
                            form.source?.settings.protocol === 'onebot-v11'
                              ? form.source.settings.listenHost
                              : ''
                          }
                          spellCheck={false}
                          data-testid="qq-listen-host"
                          onChange={(event) => {
                            const value = event.target.value;
                            setForm((current) =>
                              editSource(current, (settings) =>
                                settings.protocol === 'onebot-v11'
                                  ? { ...settings, listenHost: value }
                                  : settings,
                              ),
                            );
                          }}
                        />
                      )}
                    </Field>

                    <Field
                      label="监听端口"
                      hint="端口冲突时改这里；不合法会明确报错，不会悄悄取别的值"
                    >
                      {({ inputId, describedBy }) => (
                        <input
                          id={inputId}
                          className="pk-input"
                          type="number"
                          min={1}
                          max={65535}
                          aria-describedby={describedBy}
                          value={
                            form.source?.settings.protocol === 'onebot-v11'
                              ? form.source.settings.listenPort
                              : ''
                          }
                          data-testid="qq-listen-port"
                          onChange={(event) => {
                            const value = event.target.value;
                            setForm((current) =>
                              editSource(current, (settings) =>
                                settings.protocol === 'onebot-v11'
                                  ? { ...settings, listenPort: Number(value) || 0 }
                                  : settings,
                              ),
                            );
                          }}
                        />
                      )}
                    </Field>

                    <Field label="路径" hint="SnowLuma 连过来时用的 WS 路径">
                      {({ inputId, describedBy }) => (
                        <input
                          id={inputId}
                          className="pk-input"
                          aria-describedby={describedBy}
                          value={
                            form.source?.settings.protocol === 'onebot-v11'
                              ? form.source.settings.path
                              : ''
                          }
                          spellCheck={false}
                          data-testid="qq-listen-path"
                          onChange={(event) => {
                            const value = event.target.value;
                            setForm((current) =>
                              editSource(current, (settings) =>
                                settings.protocol === 'onebot-v11'
                                  ? { ...settings, path: value }
                                  : settings,
                              ),
                            );
                          }}
                        />
                      )}
                    </Field>

                    {/*
                    端点提示只描述**已保存的**配置；草稿没保存或未应用时明说，
                    不把 0.0.0.0 或还没生效的地址说成「已连接端点」。
                  */}
                    <p className="tc-qq__note" data-testid="qq-endpoint-hint">
                      {(() => {
                        const saved = selected.settings;
                        if (saved.protocol !== 'onebot-v11') return null;
                        const host =
                          saved.listenHost === '0.0.0.0' || saved.listenHost === '::'
                            ? '所有网卡（含外部可达）'
                            : saved.listenHost;
                        const applied =
                          selected.appliedRevision === selected.configRevision
                            ? ''
                            : '（这份配置还没生效，下面是已保存值）';
                        return `反向 WS 地址：ws://${host}:${saved.listenPort}${saved.path}${applied}`;
                      })()}
                    </p>
                  </>
                ) : null}

                <div className="tc-qq__row">
                  <Button
                    variant="primary"
                    size="small"
                    disabled={!sourceDirty || busy}
                    data-testid="qq-save-source"
                    onClick={saveSource}
                  >
                    保存连接设置
                  </Button>
                </div>

                <Field
                  label="密钥"
                  hint={
                    selected.credential.writable
                      ? '只写进服务的凭据存储，不显示回读值'
                      : '当前不可写，需要在本机配置'
                  }
                >
                  {({ inputId, describedBy }) => (
                    <input
                      id={inputId}
                      className="pk-input"
                      type="password"
                      aria-describedby={describedBy}
                      value={secretMatches ? (secret?.value ?? '') : ''}
                      disabled={!selected.credential.writable || busy}
                      data-testid="qq-credential"
                      onChange={(event) => {
                        const value = event.target.value;
                        // 首次输入就捕获归属与 CAS 基线；之后只改值。
                        setSecret((current) =>
                          target === null
                            ? null
                            : {
                                value,
                                target: sameSourceOwner(current?.target ?? null, target)
                                  ? (current?.target ?? target)
                                  : target,
                                expectedCredentialVersion:
                                  current !== null && sameSourceOwner(current.target, target)
                                    ? current.expectedCredentialVersion
                                    : selected.credential.version,
                              },
                        );
                      }}
                    />
                  )}
                </Field>
                <p className="tc-qq__note" data-testid="qq-credential-state">
                  {selected.credential.available
                    ? `已配置（${selected.credential.source}）`
                    : '还没有配置密钥'}
                </p>
                <div className="tc-qq__row">
                  <Button
                    size="small"
                    disabled={
                      !selected.credential.writable ||
                      !secretMatches ||
                      (secret?.value.trim() ?? '') === '' ||
                      busy
                    }
                    data-testid="qq-save-credential"
                    onClick={() => void saveCredential()}
                  >
                    保存密钥
                  </Button>
                </div>

                <p className="tc-qq__note" data-testid="qq-media">
                  媒体：
                  {(['text', 'image', 'voice', 'file'] as const)
                    .map((kind) => `${kind} ${mediaLabel(selected.media[kind])}`)
                    .join(' · ')}
                </p>
              </Section>

              <Section title="准入名单" description="名单为空时没有任何人、任何群会被处理。">
                <QQAllowlists
                  settings={policy.settings}
                  account={selected.account}
                  disabled={busy}
                  onChange={(change) => setForm((current) => editPolicy(current, change))}
                />
              </Section>

              <Section title="别名与机器人" description="把 QQ 用户显式绑到 principal。">
                <QQAliasEditor
                  settings={policy.settings}
                  account={selected.account}
                  disabled={busy}
                  onChange={(change) => setForm((current) => editPolicy(current, change))}
                />
              </Section>

              <Section title="群触发（全局默认）" description="下面可以按群覆盖。">
                <QQGroupSettingsEditor
                  value={policy.settings.groupDefaults}
                  disabled={busy}
                  scopeLabel="对所有群生效，除非某个群单独覆盖。"
                  testId="qq-group-default"
                  onChange={(next) =>
                    setForm((current) =>
                      editPolicy(current, (settings) => ({ ...settings, groupDefaults: next })),
                    )
                  }
                />
              </Section>

              {policy.settings.groupAllowlist.length === 0 ? null : (
                <Section title="按群覆盖" description="只对上面允许的群生效。">
                  {policy.settings.groupAllowlist.map((entry) => {
                    const group = groupSettingsOf(policy.settings, entry.account, entry.groupId);
                    const overridden = policy.settings.groups.some((item) =>
                      sameGroup(item, entry),
                    );
                    // 两个账号的同号群必须各有自己的 key，否则列表会互相顶掉。
                    const key = `${entry.account.protocol}\u0000${entry.account.sourcePluginId}\u0000${entry.account.instanceId}\u0000${entry.account.accountId}\u0000${entry.groupId}`;
                    return (
                      <div className="tc-qq__group" key={key}>
                        <p className="tc-qq__line">
                          群 {entry.groupId} · {entry.account.accountId}
                          {overridden ? '（已覆盖）' : '（用全局默认）'}
                        </p>
                        <QQGroupSettingsEditor
                          value={group}
                          disabled={busy}
                          scopeLabel={
                            overridden ? '这个群使用下面的设置。' : '这个群当前跟随全局默认。'
                          }
                          testId={`qq-group-${key}`}
                          onChange={(next) =>
                            setForm((current) =>
                              editPolicy(current, (settings) =>
                                setGroupSettings(settings, entry.account, entry.groupId, next),
                              ),
                            )
                          }
                        />
                        {overridden ? (
                          <Button
                            size="small"
                            variant="quiet"
                            data-testid={`qq-clear-group-${entry.groupId}`}
                            onClick={() =>
                              setForm((current) =>
                                editPolicy(current, (settings) =>
                                  clearGroupSettings(settings, entry.account, entry.groupId),
                                ),
                              )
                            }
                          >
                            恢复全局默认
                          </Button>
                        ) : null}
                      </div>
                    );
                  })}
                </Section>
              )}

              <Section
                title="输出"
                description="文字一定发送；语音是额外附加，关掉不会让回复没有内容。"
              >
                <label className="tc-qq__check">
                  <input
                    type="checkbox"
                    checked={policy.settings.voiceOutputEnabled}
                    data-testid="qq-voice-output"
                    onChange={(event) =>
                      setForm((current) =>
                        editPolicy(current, (settings) => ({
                          ...settings,
                          voiceOutputEnabled: event.target.checked,
                        })),
                      )
                    }
                  />{' '}
                  额外发送语音
                </label>
              </Section>

              <Section title="参与判断模型" description="可选的主动回复判断；不参与生成。">
                <QQJudgeForm
                  view={view.judge}
                  form={form}
                  secretValue={judgeSecret?.value ?? ''}
                  onSecretChange={(value) => {
                    // 首次输入就捕获完整归属；之后只改值，绝不随干净 view 的基线漂移。
                    if (view === null) return;
                    setJudgeSecret((current) => {
                      const saved = view.judge.settings;
                      const keep =
                        current !== null &&
                        current.providerRef === saved.providerRef &&
                        current.baseUrl === saved.connection.baseUrl &&
                        current.model === saved.connection.model &&
                        current.authMode === saved.connection.authMode &&
                        current.configRevision === view.judge.configRevision &&
                        current.credentialVersion === view.judge.credential.version &&
                        current.connectionId === connectionId;
                      return {
                        value,
                        providerRef: saved.providerRef,
                        baseUrl: saved.connection.baseUrl,
                        model: saved.connection.model,
                        authMode: saved.connection.authMode,
                        configRevision: keep ? current.configRevision : view.judge.configRevision,
                        credentialVersion: keep
                          ? current.credentialVersion
                          : view.judge.credential.version,
                        connectionId,
                      };
                    });
                  }}
                  actions={{
                    saving: form.busy === 'judge',
                    writing: form.busy === 'judge-credential',
                    dirty: form.judge?.edited === true,
                    onEdit: (change) => setForm((current) => editJudge(current, change)),
                    onSave: () => void saveJudge(),
                    onWriteKey: (value) => void writeJudgeKey(value),
                  }}
                />
              </Section>

              <div className="tc-qq__row">
                <Button
                  variant="primary"
                  disabled={!policyDirty || busy}
                  data-testid="qq-save-policy"
                  onClick={savePolicy}
                >
                  保存策略
                </Button>
                {policyDirty || sourceDirty || judgeDirty ? (
                  <Button
                    size="small"
                    variant="quiet"
                    disabled={busy}
                    data-testid="qq-rebase"
                    onClick={() => {
                      if (view === null) return;
                      setForm((current) => rebaseOnView(current, view));
                    }}
                  >
                    放弃修改并读取最新
                  </Button>
                ) : null}
              </div>
            </>
          )}

          <Section title="投递" description="平台接受与用户是否收到是两件事。">
            <div className="tc-qq__row">
              <Button
                size="small"
                data-testid="qq-load-deliveries"
                onClick={() => void loadDeliveries()}
              >
                读取最近投递
              </Button>
            </div>
            {deliveries === null ? (
              <p className="tc-qq__note">还没有读取。</p>
            ) : deliveries.deliveries.length === 0 ? (
              <EmptyState title="没有投递记录" description="这个服务还没有向 QQ 发过消息。" />
            ) : (
              <List label="最近投递">
                {deliveries.deliveries.map((item) => (
                  <ListItem
                    key={item.id}
                    title={item.id}
                    description={`${item.phase} · ${item.outcome}`}
                    meta={new Date(item.updatedAt).toLocaleString()}
                    trailing={
                      <Button
                        size="small"
                        variant="quiet"
                        data-testid={`qq-delivery-${item.id}`}
                        onClick={() => void openDelivery(item.id)}
                      >
                        详情
                      </Button>
                    }
                  />
                ))}
              </List>
            )}

            {detailFailure === null ? null : (
              <p
                className="tc-qq__note tc-qq__note--error"
                role="alert"
                data-testid="qq-delivery-failure"
              >
                {detailFailure}
              </p>
            )}

            {detail === null ? null : (
              <div className="tc-qq__group" data-testid="qq-delivery-detail">
                <p className="tc-qq__line">
                  <span className="tc-qq__detail">
                    {detail.phase} · {detail.outcome} · 文本 {detail.textRepresentation} · 允许{' '}
                    {detail.allowedMessageParts} 段
                  </span>
                </p>
                {detail.error === null ? null : (
                  <p className="tc-qq__note tc-qq__note--error">{errorMessage(detail.error)}</p>
                )}
                <List label="投递分段">
                  {detail.parts.map((part) => (
                    <ListItem
                      key={part.id}
                      title={`#${part.index} ${part.requirement}`}
                      description={`准备 ${part.preparation} · ${
                        part.send === null ? '未发送' : `发送 ${part.send.outcome}`
                      }`}
                      meta={part.content.kind}
                    />
                  ))}
                </List>
              </div>
            )}
          </Section>
        </div>
      </Dialog>
    </div>
  );
}
