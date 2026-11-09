/**
 * 两个窗口共用的服务连接视图：唯一的快照所有者是 Main，这里只读它、只发动作。
 *
 * 三条约束来自上一阶段的实际教训：
 * - 读取带 revision：晚到的旧读不能盖掉新的一份；动作返回的 Result 永远不写进快照。
 * - 动作按 connectionId 换代：返回时目标已经换了，就丢掉这次结果，不清任何草稿、不报成功。
 * - 命令结果只有「已受理」才允许调用方清草稿；未知/被拒/过期都保留原文，重试复用同一 commandId。
 *
 * 换代判定只认一个来源：`latest` —— 已采用的最高 revision 状态。
 * 确认读取失败、返回 null、或返回更旧的 revision 时，`latest` 原样不动，
 * 因此旧动作的结果不会因为「没读到」而被当成仍然有效。
 *
 * 桥缺失是真实状态（这台机器没有这条通道），不画假数据，也不本地造一个连接。
 */
import type {
  CompanionModelSaveCommand,
  CompanionModelTestCommand,
  CompanionModelView,
  CompanionMemoryForgetCommand,
  CompanionMemoryMutationResult,
  CompanionMemoryUpsertCommand,
  CompanionMemoryView,
  CompanionProfileSaveCommand,
  CompanionProfileView,
  CompanionTask,
  DesktopArtifactSave,
  DesktopCompanionBridge,
  DesktopCompanionState,
  Result,
} from '@pet/contracts';
import { makeError } from '@pet/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

import { errorText, settleTarget, type TargetSettlement } from './companion-state.js';

/** 一次动作的真实结论；只有 accepted 允许清草稿。 */
export type CompanionOutcome = 'accepted' | 'uncertain' | 'failed' | 'stale';

export interface CompanionResult {
  readonly outcome: CompanionOutcome;
  readonly error: string | null;
}

/**
 * connect 的返回值多带一个事实：这次写入真正落下的 Config 版本。
 *
 * 表单用它推进自己的 CAS 基线——不能猜「旧版本+1」，也不能拿随便一份最新
 * 视图去抹掉别人同时做的更新。它只服务这一个表单，不写进全局快照。
 */
export interface ConnectResult extends CompanionResult {
  readonly configRevision: number | null;
}

const OK: CompanionResult = { outcome: 'accepted', error: null };
const STALE: CompanionResult = { outcome: 'stale', error: null };

/** 「请求可能已经被处理」才算未知；服务端明确拒绝不能假装未知。 */
export function isUnknownOutcome(code: string): boolean {
  return ['network', 'timeout', 'unavailable', 'internal'].includes(code);
}

function readBridge(): DesktopCompanionBridge | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as { petCompanion?: DesktopCompanionBridge }).petCompanion;
  return typeof candidate === 'object' && candidate !== null && candidate.version === 1
    ? candidate
    : null;
}

export interface CompanionView {
  /** 桥存在时为 true；false 就是这台机器没有连接通道。 */
  available: boolean;
  /** 最近一次成功读取的状态；读取失败时保留上一份。 */
  state: DesktopCompanionState | null;
  loading: boolean;
  /** 读取失败的一句话；与连接自己的 error 不是同一件事。 */
  readError: string | null;
  /** 最近一次动作的一句话回执。 */
  notice: string | null;
  refresh(): void;
  /** 期望版本由调用方从它读到的草稿基线给出，不是这里取最新的一份。 */
  connect(input: {
    baseUrl: string;
    token: string;
    expectedRevision: number;
  }): Promise<ConnectResult>;
  reconnect(): Promise<CompanionResult>;
  disconnect(): Promise<CompanionResult>;
  send(commandId: string, text: string): Promise<CompanionResult>;
  stopTask(commandId: string, taskId: string): Promise<CompanionResult>;
  stopForeground(): Promise<CompanionResult>;
  readProfile(): Promise<Result<CompanionProfileView>>;
  readMemory(): Promise<Result<CompanionMemoryView>>;
  saveProfile(command: CompanionProfileSaveCommand): Promise<Result<CompanionProfileView>>;
  upsertFact(command: CompanionMemoryUpsertCommand): Promise<Result<CompanionMemoryMutationResult>>;
  forgetFact(command: CompanionMemoryForgetCommand): Promise<Result<CompanionMemoryMutationResult>>;
  readTask(taskId: string): Promise<Result<CompanionTask>>;
  saveArtifact(artifactId: string): Promise<Result<DesktopArtifactSave>>;
  saveModel(command: CompanionModelSaveCommand): Promise<Result<CompanionModelView>>;
  testModel(command: CompanionModelTestCommand): Promise<Result<CompanionModelView>>;
  /** 清掉当前回执；页面切换时用。 */
  clearNotice(): void;
}

export function useCompanion(): CompanionView {
  const bridgeRef = useRef<DesktopCompanionBridge | null>(readBridge());
  const [state, setState] = useState<DesktopCompanionState | null>(null);
  const [loading, setLoading] = useState(bridgeRef.current !== null);
  const [readError, setReadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const alive = useRef(true);
  /** 已采用的最高 revision；更小的读一律丢弃。 */
  const adopted = useRef(-1);
  /**
   * 唯一权威的最新状态：换代判定与动作的目标都读它，不读渲染闭包里的 state。
   * 它只在 accept 真的采纳了新快照时前进。
   */
  const latest = useRef<DesktopCompanionState | null>(null);

  const accept = useCallback((next: DesktopCompanionState): boolean => {
    if (next.revision <= adopted.current) return false;
    adopted.current = next.revision;
    latest.current = next;
    setState(next);
    setReadError(null);
    return true;
  }, []);

  const read = useCallback(
    async (visible: boolean): Promise<void> => {
      const bridge = bridgeRef.current;
      if (bridge === null) return;
      if (visible) {
        setLoading(true);
        setReadError(null);
      }
      try {
        const result = await bridge.getState();
        if (!alive.current) return;
        if (result.ok) accept(result.value);
        else setReadError(errorText(result.error) ?? '读取连接状态失败。');
      } catch {
        if (alive.current) setReadError('读取连接状态失败。');
      } finally {
        if (alive.current && visible) setLoading(false);
      }
    },
    [accept],
  );

  useEffect(() => {
    alive.current = true;
    const bridge = bridgeRef.current;
    if (bridge === null) {
      setLoading(false);
      return;
    }
    const off = bridge.onChanged(() => void read(false));
    void read(true);
    return () => {
      alive.current = false;
      off();
    };
  }, [read]);

  /**
   * 一次动作之后的对账：先试着采纳一次确认读取，再用 `latest` 判定结果还算不算数。
   *
   * 确认读取只是**顺手**更新缓存；它失败或返回更旧的一份，都不改变 `latest`。
   * 栅栏只按已采纳状态判定，所以「没读到」既不会放行旧目标，也不会把
   * 确知受理的提交改判成「可能没送达」。
   */
  const settle = useCallback(
    async (bridge: DesktopCompanionBridge, target: string | null): Promise<TargetSettlement> => {
      const confirmation = await bridge.getState().catch(() => null);
      if (confirmation !== null && confirmation.ok) accept(confirmation.value);
      return settleTarget(latest.current, target);
    },
    [accept],
  );

  const run = useCallback(
    async <T>(
      call: (bridge: DesktopCompanionBridge) => Promise<Result<T>>,
      target: string | null,
    ): Promise<{ result: CompanionResult; value: T | null }> => {
      const bridge = bridgeRef.current;
      if (bridge === null)
        return { result: { outcome: 'failed', error: '这台机器没有连接通道。' }, value: null };
      // 派发前就比一次：这一帧的意图属于 A，而缓存已经前进到 B，
      // 就什么都不发。绝不把 A 的动作改投到 B 上——那会让旧按钮操作错连接。
      if (settleTarget(latest.current, target) === 'stale') return { result: STALE, value: null };
      let reply: Result<T>;
      try {
        reply = await call(bridge);
      } catch {
        // 抛出的那次也要过同一道栅栏：旧目标的错误不能落到新目标上。
        const settlement = await settle(bridge, target);
        if (settlement === 'stale') return { result: STALE, value: null };
        return {
          result: { outcome: 'uncertain', error: '这次调用没有返回结果。' },
          value: null,
        };
      }
      if ((await settle(bridge, target)) === 'stale') return { result: STALE, value: null };
      if (reply.ok) return { result: OK, value: reply.value };
      return {
        result: isUnknownOutcome(reply.error.code)
          ? { outcome: 'uncertain', error: errorText(reply.error) }
          : { outcome: 'failed', error: errorText(reply.error) },
        value: null,
      };
    },
    [settle],
  );

  const connect = useCallback(
    async (input: {
      baseUrl: string;
      token: string;
      expectedRevision: number;
    }): Promise<ConnectResult> => {
      const bridge = bridgeRef.current;
      if (bridge === null || state === null)
        return { outcome: 'failed', error: '这台机器没有连接通道。', configRevision: null };
      setNotice(null);
      // 期望版本是草稿读入时那一份 Config 的 CAS 版本，不是 Main 的投影序，
      // 也不是「现在最新」的那一份——否则别处的改动会被静默覆盖。
      const { result, value } = await run(
        (target) =>
          target.connect({
            expectedRevision: input.expectedRevision,
            baseUrl: input.baseUrl,
            token: input.token,
          }),
        null,
      );
      await read(false);
      if (result.outcome !== 'accepted') setNotice(result.error);
      // 只把这次 connect 真正写下的 Config 版本交给表单做 CAS 基线。
      // 不猜 rev+1，也不拿随便一份最新视图抹掉别处的更新。
      return { ...result, configRevision: value?.configRevision ?? null };
    },
    [read, run, state],
  );

  const reconnect = useCallback(async (): Promise<CompanionResult> => {
    // 用这一帧渲染出来的连接：latest 可能已经前进，但界面上的按钮属于旧视图。
    const current = state;
    if (current === null || current.connectionId === null)
      return { outcome: 'failed', error: '没有可重新连接的连接。' };
    const target = current.connectionId;
    setNotice(null);
    const { result } = await run((bridge) => bridge.reconnect({ connectionId: target }), target);
    await read(false);
    if (result.outcome !== 'accepted') setNotice(result.error);
    return result;
  }, [read, run, state]);

  const disconnect = useCallback(async (): Promise<CompanionResult> => {
    const current = state;
    if (current === null || current.connectionId === null)
      return { outcome: 'failed', error: '当前没有连接。' };
    const target = current.connectionId;
    setNotice(null);
    const { result } = await run((bridge) => bridge.disconnect({ connectionId: target }), target);
    await read(false);
    if (result.outcome !== 'accepted') setNotice(result.error);
    return result;
  }, [read, run, state]);

  const send = useCallback(
    async (commandId: string, text: string): Promise<CompanionResult> => {
      const current = state;
      if (current === null || current.connectionId === null)
        return { outcome: 'failed', error: '连接断开时不能发送。' };
      const target = current.connectionId;
      setNotice(null);
      const { result } = await run(
        (bridge) => bridge.sendMessage({ connectionId: target, commandId, text }),
        target,
      );
      if (result.outcome === 'uncertain')
        setNotice('发送结果未知。重试会复用同一次提交，不会重复发送。');
      else if (result.outcome === 'failed')
        setNotice(`这条消息没有发出去：${result.error ?? '未知原因'}`);
      else if (result.outcome === 'stale')
        setNotice('连接已经切换，这次发送的结果不再计入当前连接。');
      return result;
    },
    [run, state],
  );

  const stopTask = useCallback(
    async (commandId: string, taskId: string): Promise<CompanionResult> => {
      const current = state;
      if (current === null || current.connectionId === null)
        return { outcome: 'failed', error: '连接断开时不能停止任务。' };
      const target = current.connectionId;
      setNotice(null);
      const { result } = await run(
        (bridge) => bridge.stopTask({ connectionId: target, commandId, taskId }),
        target,
      );
      if (result.outcome === 'uncertain') setNotice('停止请求结果未知。任务实际状态以服务端为准。');
      else if (result.outcome === 'failed')
        setNotice(`停止请求没有送达：${result.error ?? '未知原因'}`);
      return result;
    },
    [run, state],
  );

  const stopForeground = useCallback(async (): Promise<CompanionResult> => {
    const current = state;
    if (current === null || current.connectionId === null)
      return { outcome: 'failed', error: '连接断开时不能停止回应。' };
    const target = current.connectionId;
    setNotice(null);
    const { result } = await run(
      (bridge) => bridge.stopForeground({ connectionId: target }),
      target,
    );
    if (result.outcome === 'uncertain')
      setNotice('停止回应的结果未知；它没有持久回执，不能保证重复点击只生效一次。');
    return result;
  }, [run, state]);

  /**
   * 读取类动作：结果只对发起时那个 connectionId 成立。
   * 返回前同样过栅栏；换代的旧读取一律变成 stale-owner，界面据此不采纳旧正文。
   */
  const readWith = useCallback(
    async <T>(
      call: (bridge: DesktopCompanionBridge, connectionId: string) => Promise<Result<T>>,
    ): Promise<Result<T>> => {
      const bridge = bridgeRef.current;
      const current = state;
      if (bridge === null || current === null || current.connectionId === null)
        return { ok: false, error: makeError('not-ready', false) };
      const target = current.connectionId;
      // 派发前先比一次：这一帧属于 A，而缓存已前进到 B，就一个请求都不发。
      if (settleTarget(latest.current, target) === 'stale')
        return { ok: false, error: makeError('stale-owner', false) };
      const result = await call(bridge, target);
      if ((await settle(bridge, target)) === 'stale')
        return { ok: false, error: makeError('stale-owner', false) };
      return result;
    },
    [settle, state],
  );

  const readProfile = useCallback(
    () => readWith((bridge, connectionId) => bridge.readProfile({ connectionId })),
    [readWith, state],
  );
  const readMemory = useCallback(
    () => readWith((bridge, connectionId) => bridge.readMemory({ connectionId })),
    [readWith, state],
  );
  const saveProfile = useCallback(
    (command: CompanionProfileSaveCommand) =>
      readWith((bridge, connectionId) => bridge.saveProfile({ connectionId, command })),
    [readWith, state],
  );
  const upsertFact = useCallback(
    (command: CompanionMemoryUpsertCommand) =>
      readWith((bridge, connectionId) => bridge.upsertFact({ connectionId, command })),
    [readWith, state],
  );
  const forgetFact = useCallback(
    (command: CompanionMemoryForgetCommand) =>
      readWith((bridge, connectionId) => bridge.forgetFact({ connectionId, command })),
    [readWith, state],
  );
  const readTask = useCallback(
    (taskId: string) =>
      readWith((bridge, connectionId) => bridge.readTask({ connectionId, taskId })),
    [readWith, state],
  );
  const saveArtifact = useCallback(
    (artifactId: string) =>
      readWith((bridge, connectionId) => bridge.saveArtifact({ connectionId, artifactId })),
    [readWith, state],
  );
  const saveModel = useCallback(
    (command: CompanionModelSaveCommand) =>
      readWith((bridge, connectionId) => bridge.saveModel({ connectionId, command })),
    [readWith, state],
  );
  const testModel = useCallback(
    (command: CompanionModelTestCommand) =>
      readWith((bridge, connectionId) => bridge.testModel({ connectionId, command })),
    [readWith, state],
  );

  const refresh = useCallback(() => void read(true), [read]);
  const clearNotice = useCallback(() => setNotice(null), []);

  return {
    available: bridgeRef.current !== null,
    state,
    loading,
    readError,
    notice,
    refresh,
    connect,
    reconnect,
    disconnect,
    send,
    stopTask,
    stopForeground,
    readProfile,
    readMemory,
    saveProfile,
    upsertFact,
    forgetFact,
    readTask,
    saveArtifact,
    saveModel,
    testModel,
    clearNotice,
  };
}
