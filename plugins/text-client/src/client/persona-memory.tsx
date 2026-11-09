/**
 * 人格与当前记忆的受控组件：web 与桌面共用这一份，样式在 persona-memory.css。
 *
 * 组件本身不决定能不能写、发什么命令、基线怎么推进——那些全在 memory-form.ts 里，
 * 可以逐条回归。这里只负责把纯规则接到 DOM，并且守住三件事：
 * 1. 只采纳属于当前这一代表单的结果（关闭/换目标后迟到的响应直接丢弃）；
 * 2. 自己的提交在途时不把中间版本报成「别处改过」；
 * 3. 值原样提交，不 trim、不改写。
 */
import { useEffect, useId, useRef, useState, type JSX } from 'react';
import { Button, Field } from '@pet/ui-kit';
import {
  COMPANION_MEMORY_MAX_DATA_BYTES,
  COMPANION_MEMORY_MAX_FACTS,
  COMPANION_MEMORY_MAX_KEY_UNITS,
  COMPANION_MEMORY_MAX_VALUE_UNITS,
  errorMessage,
  type CompanionAgentView,
  type CompanionApplication,
  type CompanionFact,
  type CompanionMemoryForgetCommand,
  type CompanionMemoryMutationResult,
  type CompanionMemoryStatus,
  type CompanionMemoryUpsertCommand,
  type CompanionMemoryView,
  type CompanionProfileSaveCommand,
  type CompanionProfileView,
  type KernelError,
  type Result,
} from '@pet/contracts';

import {
  adoptMemory,
  codePointLength,
  adoptProfile,
  applicationLabel,
  availability,
  beginOperation,
  cancelEditing,
  editingFact,
  forgetSucceeded,
  emptyPersonaMemoryForm,
  failOperation,
  keyProblem,
  memoryChangedUnderneath,
  memoryEditable,
  memoryPlan,
  originLabel,
  profileChangedUnderneath,
  profileEditable,
  profilePlan,
  rebaseOnLatest,
  seedProfile,
  startAdding,
  startEditing,
  upsertCommand,
  valueProblem,
  type PersonaMemoryForm,
} from './memory-form.js';

/**
 * 组件要的全部能力，结构式声明：不绑具体的 CompanionClient。
 * 两个客户端各自把已有方法传进来即可。
 */
export interface PersonaMemoryTransport {
  readProfile(): Promise<Result<CompanionProfileView>>;
  saveProfile(command: CompanionProfileSaveCommand): Promise<Result<CompanionProfileView>>;
  readMemory(): Promise<Result<CompanionMemoryView>>;
  upsertFact(command: CompanionMemoryUpsertCommand): Promise<Result<CompanionMemoryMutationResult>>;
  forgetFact(command: CompanionMemoryForgetCommand): Promise<Result<CompanionMemoryMutationResult>>;
}

export interface PersonaMemoryProps {
  readonly transport: PersonaMemoryTransport;
  /** 当前连接是否可用；false 时整块只读并说明原因。 */
  readonly live: boolean;
  readonly agentStatus: CompanionAgentView['status'] | null;
  /** 快照里的人格/记忆 metadata；缺哪一项就只禁哪一项。 */
  readonly profile: CompanionProfileView | null;
  /** 这份正文是按旧 revision 读的：仍然显示，但标出来等重读。 */
  readonly profileStale?: boolean;
  /**
   * 快照里那份应用事实。
   *
   * profileApplication 可以在 profileRevision 不变的情况下变化（比如前台重建成功），
   * 只读正文里那份会让它永远停在读到的旧值。
   */
  readonly profileApplication?: CompanionApplication | undefined;
  /** 最近一次正文读取失败：显示一个可达的重读入口，不自动重试。 */
  /**
   * 服务端正文比这个表单的基线更新（外部改动）。
   *
   * 与 profileStale 不同：那个说的是「读到的正文旧了」，这个说的是
   * 「用户手里的草稿对不上服务端了」。脏草稿时后者才是要提示的东西。
   */
  readonly profileReadFailed?: boolean;
  readonly onRetryProfile?: (() => void) | undefined;
  readonly memory: CompanionMemoryView | null;
  /** 换目标时递增，旧响应不得落到新目标上。 */
  readonly targetKey: string;
  readonly onNotice?: (message: string) => void;
}

/** 一次意图一个 ID；同一份未改动的重试复用同一个。 */
function newCommandId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function PersonaMemory({
  transport,
  live,
  agentStatus,
  profile,
  profileStale = false,
  profileApplication,
  profileReadFailed = false,
  onRetryProfile,
  memory,
  targetKey,
  onNotice,
}: PersonaMemoryProps): JSX.Element {
  const [form, setForm] = useState<PersonaMemoryForm>(emptyPersonaMemoryForm);
  const [intent, setIntent] = useState<{ commandId: string; fingerprint: string } | null>(null);
  /**
   * 打开的确认框捕获的那一次忘记意图。
   *
   * 键、行版本、集合版本、目标与表单代都在**打开时**冻结：确认按钮点击时
   * 不能再读一次最新 status，否则删的可能是别人刚改过的那一行。
   */
  const [forgetting, setForgetting] = useState<{
    readonly fact: CompanionFact;
    readonly memoryRevision: number;
    readonly targetKey: string;
    readonly generation: number;
    readonly commandId: string;
  } | null>(null);
  const generation = useRef(0);
  /**
   * 同一时刻只允许一个操作在途。
   *
   * 纯 setState 的 busy 不防同一 tick 的两次点击（React 还没提交），
   * 所以用一个具体的 ref 做同步锁；它和 generation 一起保证：
   * 只有仍属于当前目标/表单/操作的回执才被采纳。
   */
  /**
   * 当前在途操作的归属。
   *
   * 不能只放一个 boolean：A 在途 → 换目标 → B 在途 → A 结算时若无条件清掉，
   * 就会把 B 的锁解开，B 也能被双发。这里记的是**这一次操作的 token**，
   * 只有它自己结算才释放。
   */
  const inFlight = useRef<symbol | null>(null);
  /** 卸载后迟到的回执不能再 announce 到下一个页面。 */
  const mounted = useRef(true);
  const nameId = useId();
  const personaId = useId();
  const keyId = useId();
  const valueId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => {
      // 卸载即换代：之后回来的回执一律作废，也不再 announce。
      mounted.current = false;
      generation.current += 1;
    };
  }, []);

  // 换目标就换代：旧目标的人格/记忆不能留在新连接的表单里。
  useEffect(() => {
    generation.current += 1;
    inFlight.current = null;
    setForm(emptyPersonaMemoryForm);
    setIntent(null);
    setForgetting(null);
  }, [targetKey]);

  /**
   * 服务端给了新的人格正文：没在编辑、也没有请求在途时跟过去。
   *
   * 不能只在「还没捕获过基线」时跟：一次保存之后基线已是正数，
   * 之后同一 Agent 在别处又改了正文，未编辑的表单仍然该显示新的。
   * 「只有显式 rebase 才推进基线」保护的是**脏草稿**，不是把干净表单永久冻住。
   */
  useEffect(() => {
    if (profile === null) return;
    setForm((current) => {
      if (current.profileEdited || current.busy !== null) return current;
      // 没捕获过基线，或服务端正文比基线更新：跟着走。
      if (current.profileBaseline === null || profile.revision > current.profileBaseline)
        return seedProfile(current, profile);
      return current;
    });
  }, [profile]);

  /**
   * 首帧就要有内容：不能等 effect 才把服务端人格铺进输入框，
   * 否则第一帧显示空字段并提示「名字不能为空」——那是假的。
   */
  const effective =
    form.profileBaseline === null && profile !== null && !form.profileEdited
      ? seedProfile(form, profile)
      : form;

  const facts = memory?.facts ?? [];
  const status = memory ?? null;

  /**
   * 记忆基线只在**起稿那一刻**从真实 status 捕获一次，之后是草稿自己的值。
   *
   * 不能每次 render 都把 null 换成最新 status.revision：那样「空集 rev0 起稿 →
   * 另一窗口写到 rev1 → 提交」会偷用 1，把别人的写入当成本次基线。
   * 0 是合法基线（空集），不是「未初始化」。
   */
  const memoryBase = form.memoryBaseline;
  const supportsProfile = profileEditable(profile);
  const supportsMemory = memoryEditable(status);
  const rules = availability(effective, {
    live,
    agentBusy: agentStatus === 'busy',
    profileSupported: supportsProfile,
    memorySupported: supportsMemory,
  });
  const profileMoved =
    profile !== null &&
    profileChangedUnderneath(effective.profileBaseline, profile, form.busy === 'profile');
  const memoryMoved =
    status !== null &&
    memoryChangedUnderneath(
      memoryBase,
      status,
      facts,
      effective.editingKey,
      effective.factBaseline,
      form.busy === 'memory',
    );
  const row = editingFact(effective, facts);
  // 未动过的空草稿不是错误：只在真的输入过之后才报问题，且只报一次。
  // 校验始终生效（按钮用它）；「现在先不红」只是渲染层的决定。
  const keyIssue = keyProblem(effective.key, COMPANION_MEMORY_MAX_KEY_UNITS);
  const valueIssue = valueProblem(effective.value, COMPANION_MEMORY_MAX_VALUE_UNITS);
  /**
   * 空的未编辑草稿不显示红字：初始和刚保存后都该安静。
   * 但按钮仍然按真实校验禁用，所以不会出现「能点但什么都不发生」。
   */
  const keyError = effective.memoryTouched ? keyIssue : null;
  const valueError = effective.memoryTouched ? valueIssue : null;

  const settle = (started: number, next: PersonaMemoryForm): void => {
    if (generation.current !== started) return;
    setForm(next);
  };
  const announce = (text: string): void => {
    if (!mounted.current) return;
    onNotice?.(text);
  };
  /** 同步锁：同一 tick 的第二次点击在 setState 生效前就被挡住。 */
  const claim = (): symbol | null => {
    if (inFlight.current !== null) return null;
    const token = Symbol('persona-memory-operation');
    inFlight.current = token;
    return token;
  };
  /** 只释放自己那一次；旧操作的结算不能解开后来者的锁。 */
  const release = (token: symbol): void => {
    if (inFlight.current === token) inFlight.current = null;
  };

  const saveProfile = async (): Promise<void> => {
    const command = profilePlan(effective, profile);
    if (command === null) return;
    const token = claim();
    if (token === null) return;
    const started = generation.current;
    setForm(beginOperation(effective, 'profile'));
    let result: Awaited<ReturnType<PersonaMemoryTransport['saveProfile']>>;
    try {
      result = await transport.saveProfile(command);
    } catch {
      // transport 抛错也必须放锁并清忙碌态，否则这个表单再也点不动。
      release(token);
      if (generation.current !== started) return;
      setForm((current) => ({
        ...current,
        busy: null,
        notice: { kind: 'error', text: '没有保存：这次请求没有返回结果。', error: null },
      }));
      announce('没有保存：这次请求没有返回结果。');
      return;
    }
    release(token);
    if (generation.current !== started) return;
    if (result.ok) {
      settle(started, adoptProfile(effective, result.value));
      return;
    }
    const text =
      result.error.code === 'conflict'
        ? '人格在别处刚改过。你填的内容还在，核对后再保存。'
        : `没有保存：${errorMessage(result.error)}`;
    settle(started, failOperation(effective, result.error, text));
    announce(text);
  };

  const writeMemory = async (): Promise<void> => {
    if (status === null) return;
    // 基线用首帧从真实 status 捕获的那一版，不是默认 0。
    const base: PersonaMemoryForm = { ...effective };
    const plan = memoryPlan(base, 'upsert', newCommandId, intent);
    if (plan === null) return;
    const token = claim();
    if (token === null) return;
    const started = generation.current;
    setIntent({ commandId: plan.commandId, fingerprint: plan.fingerprint });
    setForm(beginOperation(base, 'memory'));
    let result: Awaited<ReturnType<PersonaMemoryTransport['upsertFact']>>;
    try {
      result = await transport.upsertFact(upsertCommand(base, plan));
    } catch {
      release(token);
      if (generation.current !== started) return;
      setForm((current) => ({
        ...current,
        busy: null,
        notice: { kind: 'error', text: '没有保存：这次请求没有返回结果。', error: null },
      }));
      announce('没有保存：这次请求没有返回结果。');
      return;
    }
    release(token);
    if (generation.current !== started) return;
    if (result.ok) {
      settle(started, adoptMemory(base, result.value, result.value.view.facts));
      setIntent(null);
      return;
    }
    const text =
      result.error.code === 'conflict'
        ? '记忆在别处刚改过。你填的内容还在，核对后再保存。'
        : `没有保存：${errorMessage(result.error)}`;
    settle(started, failOperation(base, result.error, text));
    announce(text);
  };

  /** 打开确认框：把这一次忘记要用的全部事实一次冻住。 */
  const askForget = (fact: CompanionFact): void => {
    if (status === null) return;
    setForgetting({
      fact,
      memoryRevision: status.revision,
      targetKey,
      generation: generation.current,
      commandId: newCommandId(),
    });
  };

  /** 确认忘记：只用打开时冻结的那份意图，不改投、不重取最新 status。 */
  const confirmForget = async (): Promise<void> => {
    const frozen = forgetting;
    if (frozen === null) return;
    // 目标或表单代变了：这次意图已经不属于当前界面，直接作废。
    if (frozen.targetKey !== targetKey || frozen.generation !== generation.current) {
      setForgetting(null);
      return;
    }
    const started = generation.current;
    // 忘记用的基线来自冻结意图；但**不要**把 editingKey 改成被忘记那一行——
    // 用户可能正在编辑另一行 B，那份草稿必须留着。
    const token = claim();
    if (token === null) return;
    // 确认框**不立即关闭**：失败/未知时要能把同一份意图原样留下来重试。
    setForm(beginOperation(form, 'memory'));
    let result: Awaited<ReturnType<PersonaMemoryTransport['forgetFact']>>;
    try {
      result = await transport.forgetFact({
        commandId: frozen.commandId,
        expectedMemoryRevision: frozen.memoryRevision,
        expectedFactRevision: frozen.fact.revision,
        key: frozen.fact.key,
      });
    } catch {
      release(token);
      if (generation.current !== started) return;
      setForm((current) => ({
        ...current,
        busy: null,
        notice: { kind: 'error', text: '没有删除：这次请求没有返回结果。', error: null },
      }));
      announce('没有删除：这次请求没有返回结果。');
      return;
    }
    release(token);
    if (generation.current !== started) return;
    if (result.ok) {
      // 只清掉「被忘记的那一行」的草稿，别把正在编辑的另一行一起清掉。
      settle(
        started,
        forgetSucceeded(effective, frozen.fact.key, result.value, result.value.view.facts),
      );
      setIntent(null);
      return;
    }
    const text =
      result.error.code === 'conflict'
        ? '这一行在别处改过，没有删除。核对后再试。'
        : `没有删除：${errorMessage(result.error)}`;
    settle(started, failOperation(form, result.error, text));
    announce(text);
  };

  /**
   * 只重读人格：点人格那一侧的「读取最新版本」不应该顺手推进记忆草稿基线。
   */
  const rebaseProfile = async (): Promise<void> => {
    const token = claim();
    if (token === null) return;
    const started = generation.current;
    let result: Awaited<ReturnType<PersonaMemoryTransport['readProfile']>>;
    try {
      result = await transport.readProfile();
    } catch {
      release(token);
      if (generation.current !== started) return;
      setForm((current) => ({
        ...current,
        notice: { kind: 'error', text: '没有读到最新人格，你填的内容还在。', error: null },
      }));
      return;
    }
    release(token);
    if (generation.current !== started) return;
    setForm((current) =>
      rebaseOnLatest(current, {
        profile: result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error },
        memory: null,
      }),
    );
  };

  /** 只重读记忆。 */
  const rebaseMemory = async (): Promise<void> => {
    const token = claim();
    if (token === null) return;
    const started = generation.current;
    let result: Awaited<ReturnType<PersonaMemoryTransport['readMemory']>>;
    try {
      result = await transport.readMemory();
    } catch {
      release(token);
      if (generation.current !== started) return;
      setForm((current) => ({
        ...current,
        notice: { kind: 'error', text: '没有读到最新记忆，你填的内容还在。', error: null },
      }));
      return;
    }
    release(token);
    if (generation.current !== started) return;
    setForm((current) =>
      rebaseOnLatest(current, {
        profile: null,
        memory: result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error },
      }),
    );
  };

  const editFact = (fact: CompanionFact): void => {
    if (status === null) return;
    setForm(startEditing(effective, fact, status));
  };

  const addFact = (): void => {
    if (status === null) return;
    setForm(startAdding(effective, status));
  };

  return (
    <section className="tc-persona-memory" aria-label="人格与记忆">
      {live ? null : (
        <p className="tc-persona-memory__note" role="status">
          当前未连接服务，这里只能看不能改。
        </p>
      )}

      {form.notice === null ? null : (
        <p
          className={
            form.notice.kind === 'error'
              ? 'tc-persona-memory__notice tc-persona-memory__notice--error'
              : 'tc-persona-memory__notice'
          }
          role="status"
          data-testid="persona-memory-notice"
        >
          {form.notice.text}
        </p>
      )}

      {/* ---- 人格 ---- */}
      <div className="tc-persona-memory__block">
        <div className="tc-persona-memory__head">
          <h3 className="tc-persona-memory__title">人格</h3>
          <span className="tc-persona-memory__meta" data-testid="profile-applied">
            {profile === null
              ? '尚未读取'
              : applicationLabel(
                  // 快照里的应用事实更新更及时；没有时才退回已读正文里那份。
                  (profileApplication ?? profile.management?.application)?.appliedRevision ?? null,
                  (profileApplication ?? profile.management?.application)?.error ?? null,
                )}
          </span>
        </div>

        {profileStale || profileReadFailed ? (
          <p className="tc-persona-memory__note" role="status" data-testid="profile-stale">
            {profileReadFailed
              ? '没有读到最新的人格正文，下面显示的可能不是当前值。'
              : '这份人格是按旧版本读的，可能已经不是最新；保存前请先读取最新版本。'}
            {onRetryProfile === undefined ? null : (
              <Button
                size="small"
                variant="quiet"
                data-testid="profile-retry"
                onClick={onRetryProfile}
              >
                重新读取
              </Button>
            )}
          </p>
        ) : null}

        {supportsProfile ? null : (
          <p className="tc-persona-memory__note" role="status" data-testid="profile-unsupported">
            服务暂未提供可编辑的人格。
          </p>
        )}

        {/* 部署参数会覆盖保存值：说清是「下次启动可能覆盖」，不暗改部署。 */}
        {profile?.management?.launchOverrides.name === true ||
        profile?.management?.launchOverrides.persona === true ? (
          <p className="tc-persona-memory__note" role="status" data-testid="launch-overrides">
            启动参数正在覆盖
            {profile?.management?.launchOverrides.name === true ? '名字' : ''}
            {profile?.management?.launchOverrides.name === true &&
            profile?.management?.launchOverrides.persona === true
              ? '和'
              : ''}
            {profile?.management?.launchOverrides.persona === true ? '人格正文' : ''}
            ；这里保存的值下次启动可能被覆盖。
          </p>
        ) : null}

        {profileMoved ? (
          <p className="tc-persona-memory__note" role="alert" data-testid="profile-moved">
            人格在别处改过，你填的内容还在。
            <Button size="small" onClick={() => void rebaseProfile()} data-testid="profile-rebase">
              读取最新版本
            </Button>
          </p>
        ) : null}

        <Field label="名字" hint={`${codePointLength(effective.name)}/80`}>
          {({ inputId, describedBy }) => (
            <input
              id={inputId || nameId}
              className="pk-input"
              aria-describedby={describedBy}
              value={effective.name}
              readOnly={!supportsProfile}
              disabled={form.busy === 'profile'}
              data-testid="profile-name"
              onChange={(event) =>
                setForm({ ...effective, name: event.target.value, profileEdited: true })
              }
            />
          )}
        </Field>

        <Field label="人格正文" hint={`${codePointLength(effective.persona)}/16384`}>
          {({ inputId, describedBy }) => (
            <textarea
              id={inputId || personaId}
              className="pk-input tc-persona-memory__persona"
              aria-describedby={describedBy}
              value={effective.persona}
              readOnly={!supportsProfile}
              disabled={form.busy === 'profile'}
              rows={6}
              data-testid="profile-persona"
              onChange={(event) =>
                setForm({ ...effective, persona: event.target.value, profileEdited: true })
              }
            />
          )}
        </Field>

        <div className="tc-persona-memory__actions">
          <Button
            variant="primary"
            size="small"
            disabled={!rules.canSaveProfile || form.busy === 'profile'}
            data-testid="profile-save"
            onClick={() => void saveProfile()}
          >
            保存人格
          </Button>
          {rules.saveProfileReason === null ? null : (
            <span className="tc-persona-memory__reason" data-testid="profile-reason">
              {rules.saveProfileReason}
            </span>
          )}
        </div>
      </div>

      {/* ---- 记忆 ---- */}
      <div className="tc-persona-memory__block">
        <div className="tc-persona-memory__head">
          <h3 className="tc-persona-memory__title">当前记忆</h3>
          <span className="tc-persona-memory__meta" data-testid="memory-usage">
            {status === null
              ? '尚未读取'
              : `${status.usage.count}/${COMPANION_MEMORY_MAX_FACTS} 条 · ${status.usage.dataBytes}/${COMPANION_MEMORY_MAX_DATA_BYTES} 字节`}
          </span>
        </div>

        {supportsMemory ? null : (
          <p className="tc-persona-memory__note" role="status" data-testid="memory-unsupported">
            服务暂未提供可编辑的记忆。
          </p>
        )}

        {status === null ? null : (
          <>
            {status.application.error === null ? null : (
              <p className="tc-persona-memory__note" role="alert" data-testid="memory-apply-error">
                {applicationLabel(status.application.appliedRevision, status.application.error)}
              </p>
            )}

            {memoryMoved ? (
              <p className="tc-persona-memory__note" role="alert" data-testid="memory-moved">
                记忆在别处改过，你填的内容还在。
                <Button
                  size="small"
                  onClick={() => void rebaseMemory()}
                  data-testid="memory-rebase"
                >
                  读取最新版本
                </Button>
              </p>
            ) : null}

            <ul className="tc-persona-memory__list">
              {facts.length === 0 ? (
                <li className="tc-persona-memory__empty">还没有记下任何事。</li>
              ) : (
                facts.map((fact) => (
                  <li
                    className="tc-persona-memory__row"
                    key={fact.key}
                    data-testid="memory-row"
                    data-key={fact.key}
                  >
                    <div className="tc-persona-memory__rowmain">
                      <span className="tc-persona-memory__key">{fact.key}</span>
                      <span className="tc-persona-memory__value">{fact.value}</span>
                      <span className="tc-persona-memory__origin" data-testid="memory-origin">
                        {originLabel(fact.origin)} · 修订 {fact.revision}
                      </span>
                    </div>
                    <div className="tc-persona-memory__rowactions">
                      <Button
                        size="small"
                        disabled={!rules.canWriteMemory}
                        data-testid={`memory-edit-${fact.key}`}
                        onClick={() => editFact(fact)}
                      >
                        修改
                      </Button>
                      <Button
                        size="small"
                        variant="quiet"
                        disabled={!rules.canWriteMemory}
                        data-testid={`memory-forget-${fact.key}`}
                        onClick={() => askForget(fact)}
                      >
                        忘记
                      </Button>
                    </div>
                  </li>
                ))
              )}
            </ul>

            <Field
              label={effective.editingKey === null ? '新增一条' : '修改这一条'}
              hint={`${effective.key.length}/${COMPANION_MEMORY_MAX_KEY_UNITS}`}
              {...(keyError === null ? {} : { error: keyError })}
            >
              {({ inputId, describedBy, invalid }) => (
                <input
                  id={inputId || keyId}
                  className="pk-input"
                  aria-describedby={describedBy}
                  value={effective.key}
                  disabled={!rules.canWriteMemory || effective.editingKey !== null}
                  maxLength={COMPANION_MEMORY_MAX_KEY_UNITS}
                  placeholder="例如：常喝的茶"
                  {...(invalid ? { 'aria-invalid': true as const } : {})}
                  data-testid="memory-key"
                  onChange={(event) =>
                    setForm({
                      ...effective,
                      memoryTouched: true,
                      key: event.target.value,
                      // 起稿即捕获：已有基线就保持不变（别处后来写的不算我们的基线）。
                      memoryBaseline:
                        effective.memoryBaseline ?? (status === null ? null : status.revision),
                    })
                  }
                />
              )}
            </Field>

            <Field
              label="内容"
              hint={`${effective.value.length}/${COMPANION_MEMORY_MAX_VALUE_UNITS}`}
              {...(valueError === null ? {} : { error: valueError })}
            >
              {({ inputId, describedBy, invalid }) => (
                <textarea
                  id={inputId || valueId}
                  className="pk-input tc-persona-memory__value"
                  aria-describedby={describedBy}
                  value={effective.value}
                  disabled={!rules.canWriteMemory}
                  maxLength={COMPANION_MEMORY_MAX_VALUE_UNITS}
                  rows={2}
                  placeholder="原样保存，不会改写"
                  {...(invalid ? { 'aria-invalid': true as const } : {})}
                  data-testid="memory-value"
                  onChange={(event) =>
                    setForm({
                      ...effective,
                      memoryTouched: true,
                      value: event.target.value,
                      // 起稿即捕获；已有基线就保持不变（别处后来写的不算我们的基线）。
                      memoryBaseline:
                        effective.memoryBaseline ?? (status === null ? null : status.revision),
                    })
                  }
                />
              )}
            </Field>

            <div className="tc-persona-memory__actions">
              <Button
                variant="primary"
                size="small"
                disabled={
                  !rules.canWriteMemory ||
                  form.busy === 'memory' ||
                  keyIssue !== null ||
                  valueIssue !== null
                }
                data-testid="memory-save"
                onClick={() => void writeMemory()}
              >
                {effective.editingKey === null ? '记住' : '保存修改'}
              </Button>
              {effective.editingKey === null ? null : (
                <Button
                  size="small"
                  variant="quiet"
                  data-testid="memory-cancel"
                  onClick={() => setForm(cancelEditing(form))}
                >
                  取消
                </Button>
              )}
              {effective.editingKey === null ? null : (
                <Button
                  size="small"
                  variant="quiet"
                  data-testid="memory-add"
                  onClick={() => addFact()}
                >
                  新增一条
                </Button>
              )}
              {rules.memoryReason === null ? null : (
                <span className="tc-persona-memory__reason" data-testid="memory-reason">
                  {rules.memoryReason}
                </span>
              )}
            </div>
            {form.busy === null && row === null && effective.editingKey !== null ? (
              <p className="tc-persona-memory__note" role="status">
                这一条已经被删除了，保存会重新创建它。
              </p>
            ) : null}
          </>
        )}
      </div>

      {/* 忘记只移除当前记忆：说清保留什么，不声称不可恢复。 */}
      {forgetting === null ? null : (
        <div
          className="tc-persona-memory__confirm"
          role="group"
          aria-label={`确认忘记 ${forgetting.fact.key}`}
        >
          <p>忘记「{forgetting.fact.key}」？它会从当前记忆里移除，对话记录与日志保留。</p>
          <div className="tc-persona-memory__actions">
            <Button
              variant="danger"
              size="small"
              data-testid="forget-confirm"
              onClick={() => void confirmForget()}
            >
              忘记这一条
            </Button>
            <Button
              size="small"
              variant="quiet"
              data-testid="forget-cancel"
              onClick={() => setForgetting(null)}
            >
              取消
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

/** 供调用方判断是否要显示整块：两端都只在有 metadata 时才挂。 */
export function hasPersonaMemory(
  profile: CompanionProfileView | null,
  memory: CompanionMemoryStatus | null | undefined,
): boolean {
  return profile !== null || memory !== undefined;
}

/** 未使用的导出保持最小：只在真正需要时加。 */
export type { PersonaMemoryForm, KernelError };
