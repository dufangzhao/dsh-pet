/**
 * 设置台的共享语音输出 owner：一条连接上的真实 source 状态、provider 表单与停止。
 *
 * 三个数据源各自有明确角色，不能互相冒充：
 * - `DesktopSpeechState.source` 是**本机**可选 source 是否就绪；
 * - `SpeechView.feature.source` 是**远端**准备 source 的状态，不能拿来表示本机已启用；
 * - 本机启用/停用走既有的 console 插件页 `runPluginAction`，这里不再存一份开关。
 *
 * provider 表单用自己的 CAS 基线，不与 ASR 的草稿或 revision 混用。
 *
 * 表单归**一个捕获的 owner** `(connectionId, providerRef)` 所有：owner 换代就换表单，
 * 旧 owner 的 dirty 草稿不会被悄悄搬到新目标上写入。每个 await 之后都按
 * `(owner, operation generation)` 对账，旧 completion 不借最新 refs、也不清新 busy。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SPEECH_PRESET_VOICES,
  isSpeechTtsSettings,
  type DesktopSpeechState,
  type SpeechCatalog,
  type SpeechProviderCommand,
  type SpeechProviderView,
  type SpeechTtsSettings,
  type SpeechView,
} from '@pet/contracts';

import { CALL_REJECTED, describeError } from '../copy.js';
import type { CompanionView } from '../../shared/use-companion.js';

export interface SpeechProviderDraft {
  baseUrl: string;
  modelRef: string;
  authMode: SpeechTtsSettings['authMode'];
  voice: SpeechTtsSettings['voice'];
}

interface Seed {
  revision: number;
  draft: SpeechProviderDraft;
}

/** 一份表单属于哪条连接上的哪个远端 provider；两者任一变化就是另一个 owner。 */
interface FormOwner {
  connectionId: string;
  providerRef: string;
}

const sameOwner = (a: FormOwner | null, b: FormOwner | null): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.connectionId === b.connectionId &&
    a.providerRef === b.providerRef);

interface FormState {
  owner: FormOwner | null;
  speech: SpeechView | null;
  state: DesktopSpeechState | null;
  catalog: SpeechCatalog | null;
  seed: Seed | null;
  draft: SpeechProviderDraft | null;
  loading: boolean;
  readError: string | null;
  failure: string | null;
  notice: string | null;
  conflict: boolean;
  saving: boolean;
  stopping: boolean;
  readingCatalog: boolean;
}

export interface SharedSpeechForm extends FormState {
  available: boolean;
  dirty: boolean;
  voices: readonly string[];
  provider: SpeechProviderView | null;
  edit(patch: Partial<SpeechProviderDraft>): void;
  save(): Promise<void>;
  readCatalog(): Promise<void>;
  stop(): Promise<void>;
  reload(): void;
}

const EMPTY: FormState = {
  owner: null,
  speech: null,
  state: null,
  catalog: null,
  seed: null,
  draft: null,
  loading: true,
  readError: null,
  failure: null,
  notice: null,
  conflict: false,
  saving: false,
  stopping: false,
  readingCatalog: false,
};

const draftOf = (settings: SpeechTtsSettings): SpeechProviderDraft => ({
  baseUrl: settings.baseUrl,
  modelRef: settings.modelRef,
  authMode: settings.authMode,
  voice: settings.voice,
});

const sameDraft = (a: SpeechProviderDraft | null, b: SpeechProviderDraft | null): boolean =>
  a === null || b === null
    ? a === b
    : a.baseUrl === b.baseUrl &&
      a.modelRef === b.modelRef &&
      a.authMode === b.authMode &&
      a.voice === b.voice;

/** 表单只在 provider 真正存在时成立；其余情况如实显示原因。 */
function providerOf(speech: SpeechView | null): SpeechProviderView | null {
  if (speech === null) return null;
  return speech.providers.find((item) => item.providerRef === speech.feature.providerRef) ?? null;
}

export function useSharedSpeech(companion: CompanionView): SharedSpeechForm {
  const [state, setState] = useState<FormState>(EMPTY);
  const alive = useRef(false);
  /** 每次 refresh 递增：旧读取结果不能覆盖新一次读取。 */
  const readSequence = useRef(0);
  /**
   * 配置目标（companion 的 connectionId）的世代。目标一变就同步递增，
   * 所有 captured 旧目标的操作在下一个 await 前后都能立刻判定自己已过期。
   */
  const targetEpoch = useRef(0);
  /** 当前生效的目标，渲染时同步更新；await 前后都拿它比。 */
  const targetRef = useRef<string | null>(null);
  /**
   * 在途操作：一个 token 同时表达"这类操作在跑"和"跑在哪个目标上"。
   *
   * 远端配置的 save 与 catalog 互斥（改的是同一份表单视图）；stop 独立成域，
   * 不参与配置互斥——一次卡住的保存不能挡住停止声音。
   */
  const inflight = useRef({
    config: null as { readonly token: symbol; readonly target: string | null } | null,
    stop: null as { readonly token: symbol; readonly target: string } | null,
  });
  /**
   * 当前生效的 owner，在**每次渲染时同步**更新：completion 到达时要和此刻真正生效的
   * owner 比，晚一帧就会把旧 owner 的结果落到新目标上。
   */
  const ownerRef = useRef<FormOwner | null>(null);
  ownerRef.current = state.owner;
  /**
   * 配置目标以**companion 当前渲染的连接**为准，不是本机 DesktopSpeechState.connectionId：
   * 后者可能还没建立（default off 时甚至没有），却拦住了"连上就能先配置 TTS"。
   */
  const connectionId = companion.state?.connectionId ?? null;
  if (targetRef.current !== connectionId) {
    // 目标在渲染期就换掉：立刻作废所有旧目标的操作，不等任何 await。
    targetRef.current = connectionId;
    targetEpoch.current += 1;
    readSequence.current += 1;
    // 目标换代：上一份 remote form 的在途锁一并作废（stop 域独立保留）。
    inflight.current.config = null;
  }
  const available = typeof window !== 'undefined' && window.petSharedSpeech !== undefined;

  /**
   * 本次渲染捕获的目标世代。旧 render 的闭包拿着旧世代，
   * 即使此刻 ref 已经指向新目标，它也不会把自己当成"当前"去发请求。
   */
  const renderEpoch = targetEpoch.current;
  const renderTarget = connectionId;

  /** 这次操作捕获的目标现在还算不算数。 */
  const stillTarget = (epoch: number, target: string | null): boolean =>
    alive.current && epoch === targetEpoch.current && targetRef.current === target;

  /**
   * 这份表单是否真的属于 `target`。
   *
   * 只证明"渲染是新的"不够：B 已渲染但 B 的配置还没读回来时，手上的 owner
   * 仍是 A 的，这时保存就会把 A 的配置写到 B。所以还要核 owner 的 connectionId。
   */
  const formBelongsTo = (owner: FormOwner | null, target: string | null): boolean =>
    owner !== null && target !== null && owner.connectionId === target;

  /** 这次渲染是否仍是最新目标（旧 render 的动作直接拒绝，零 IPC）。 */
  const currentRender = (): boolean =>
    alive.current && renderEpoch === targetEpoch.current && renderTarget === targetRef.current;

  /** 只更新本机播放事实；不触发远端配置读取。 */
  const acceptLocal = useCallback((local: DesktopSpeechState): void => {
    setState((current) => ({
      ...current,
      state: local,
      // stopping 是对**实际 speech owner** 的投影，不是全局忙态：
      // 本机播放目标换成 B 后，只有仍在途的 B stop 才让按钮忙，A 的不能。
      stopping: inflight.current.stop?.target === local.connectionId,
    }));
  }, []);

  /**
   * 读取远端配置。`target` 由调用方捕获，缺省用当前渲染的连接。
   * 只有显式动作或 target 变化才该调用它——不跟着播放进度轮询。
   */
  const readRemote = useCallback(async (target: string, resetDraft: boolean): Promise<void> => {
    const bridge = typeof window === 'undefined' ? undefined : window.petSharedSpeech;
    if (!bridge) return;
    const epoch = targetEpoch.current;
    const sequence = ++readSequence.current;
    if (resetDraft) setState((current) => ({ ...current, loading: true, readError: null }));
    try {
      const remote = await bridge.readSpeech({ connectionId: target });
      // 目标换代或读取代次已变：旧结果既不落地、也不清掉新状态。
      if (!stillTarget(epoch, target) || sequence !== readSequence.current) return;
      if (!remote.ok) {
        setState((current) => ({
          ...current,
          speech: null,
          loading: false,
          readError: describeError(remote.error),
        }));
        return;
      }
      const speech = remote.value;
      const provider = providerOf(speech);
      const nextOwner: FormOwner | null = provider
        ? { connectionId: target, providerRef: provider.providerRef }
        : null;
      setState((current) => {
        // owner 换代：旧草稿一律不迁移，直接换成新 owner 的表单。
        const replaced = !sameOwner(current.owner, nextOwner);
        const draft = provider === null ? null : draftOf(provider.settings);
        const reseed =
          provider !== null &&
          (replaced ||
            resetDraft ||
            current.seed === null ||
            (!current.conflict && !current.saving && sameDraft(current.draft, current.seed.draft)));
        return {
          ...current,
          owner: nextOwner,
          speech,
          loading: false,
          readError: null,
          ...(replaced ? { conflict: false, failure: null, notice: null } : {}),
          ...(reseed && provider !== null
            ? {
                seed: { revision: provider.configRevision, draft: draft as SpeechProviderDraft },
                draft,
                ...(replaced || resetDraft || current.seed === null
                  ? { conflict: false, failure: null }
                  : {}),
                ...(replaced || resetDraft ? { notice: null } : {}),
              }
            : {}),
        };
      });
    } catch {
      if (stillTarget(epoch, target) && sequence === readSequence.current)
        setState((current) => ({ ...current, loading: false, readError: CALL_REJECTED }));
    }
  }, []);

  /** 本地播放状态 + 当前目标上的远端配置（仅在目标变化或显式重读时）。 */
  const refresh = useCallback(
    async (resetDraft = false): Promise<void> => {
      const bridge = typeof window === 'undefined' ? undefined : window.petSharedSpeech;
      if (!bridge) {
        setState((current) => ({ ...current, loading: false, readError: CALL_REJECTED }));
        return;
      }
      const epoch = targetEpoch.current;
      const target = connectionId;
      if (resetDraft) setState((current) => ({ ...current, loading: true, readError: null }));
      try {
        const result = await bridge.getState();
        // 等本地状态期间目标已经换代：这次重读整体作废，不再去读旧目标。
        if (!stillTarget(epoch, target)) return;
        if (!result.ok) {
          setState((current) => ({
            ...current,
            loading: false,
            readError: describeError(result.error),
          }));
          return;
        }
        acceptLocal(result.value);
      } catch {
        if (stillTarget(epoch, target))
          setState((current) => ({ ...current, loading: false, readError: CALL_REJECTED }));
        return;
      }
      if (!stillTarget(epoch, target)) return;
      if (target === null) {
        setState((current) => ({
          ...current,
          speech: null,
          owner: null,
          loading: false,
          readError: '还没有连接服务，暂时读不到语音设置。',
        }));
        return;
      }
      await readRemote(target, resetDraft);
    },
    [acceptLocal, connectionId, readRemote],
  );

  useEffect(() => {
    alive.current = true;
    const bridge = window.petSharedSpeech;
    const readLocal = (): void => {
      void bridge?.getState().then(
        (result) => {
          if (alive.current && result.ok) acceptLocal(result.value);
        },
        () => undefined,
      );
    };
    // 播放进度会推 changed：这里只更新本机播放事实，不重读远端配置。
    const detach = bridge?.onChanged(readLocal);
    // 挂载时也要读一次本机播放事实——否则停止入口没有真实 owner 可指。
    readLocal();
    return () => {
      alive.current = false;
      readSequence.current += 1;
      detach?.();
    };
  }, [acceptLocal]);

  /**
   * 目标换代：把**整个 remote 表单域**一次重置干净。
   *
   * 逐点清字段总会漏——旧目标在途的 saving/readingCatalog/conflict/failure
   * 若留下来，新目标的按钮就继承了上一份表单的忙态。
   * stop 属另一个域，不在这里清。
   */
  useEffect(() => {
    setState((current) => ({
      ...current,
      owner: null,
      speech: null,
      seed: null,
      draft: null,
      catalog: null,
      saving: false,
      readingCatalog: false,
      conflict: false,
      failure: null,
      notice: null,
      loading: connectionId !== null,
      readError: null,
    }));
  }, [connectionId]);

  // 连接换代才重读配置；同一连接不重复拉远端。
  useEffect(() => {
    if (connectionId === null) {
      setState((current) => ({
        ...current,
        owner: null,
        speech: null,
        seed: null,
        draft: null,
        loading: false,
        readError: '还没有连接服务，暂时读不到语音设置。',
      }));
      return;
    }
    void readRemote(connectionId, false);
  }, [connectionId, readRemote]);

  const edit = useCallback((patch: Partial<SpeechProviderDraft>): void => {
    // 只有**本目标**正在保存时才挡编辑；别的目标在途不关这份表单的事。
    if (inflight.current.config?.target === targetRef.current) return;
    setState((current) =>
      current.draft === null
        ? current
        : { ...current, draft: { ...current.draft, ...patch }, failure: null, notice: null },
    );
  }, []);

  const save = async (): Promise<void> => {
    const bridge = window.petSharedSpeech;
    const owner = state.owner;
    if (
      !bridge ||
      owner === null ||
      state.seed === null ||
      state.draft === null ||
      state.loading ||
      state.conflict ||
      state.readError !== null ||
      // 同一目标上的远端配置写操作互斥；换目标就是另一份表单，互不阻塞。
      (inflight.current.config !== null && inflight.current.config.target === targetRef.current) ||
      sameDraft(state.draft, state.seed.draft)
    )
      return;
    // 表单必须真的属于这次渲染的目标：B 已渲染但 B 的 read 还没回来时，
    // 手上仍是 A 的 form，不能拿它去写。
    if (!formBelongsTo(owner, renderTarget)) return;
    const settings = {
      baseUrl: state.draft.baseUrl.trim(),
      modelRef: state.draft.modelRef.trim(),
      authMode: state.draft.authMode,
      protocol: 'mimo-native-pcm16-sse' as const,
      voice: state.draft.voice,
    };
    if (!isSpeechTtsSettings(settings)) {
      setState((current) => ({ ...current, failure: '请检查网关地址、模型与音色。' }));
      return;
    }
    // 命令用**捕获的** owner 与 revision，不读 latest refs。
    const command: SpeechProviderCommand = {
      providerRef: owner.providerRef,
      expectedRevision: state.seed.revision,
      settings,
    };
    if (!currentRender()) return;
    const epoch = renderEpoch;
    const target = renderTarget;
    const token = Symbol('save');
    inflight.current.config = { token, target };
    setState((current) => ({ ...current, saving: true, failure: null, notice: null }));
    const live = (): boolean =>
      stillTarget(epoch, target) && formBelongsTo(ownerRef.current, target);
    try {
      const result = await bridge.saveTtsProvider({
        connectionId: owner.connectionId,
        command,
      });
      if (!live()) return;
      if (!result.ok) {
        setState((current) => ({
          ...current,
          conflict: result.error.code === 'conflict',
          failure: result.error.code === 'conflict' ? null : describeError(result.error),
        }));
        return;
      }
      const speech = result.value;
      const provider = providerOf(speech);
      const draft = provider === null ? null : draftOf(provider.settings);
      setState((current) => ({
        ...current,
        speech,
        draft,
        seed:
          provider === null
            ? null
            : { revision: provider.configRevision, draft: draft as SpeechProviderDraft },
        conflict: false,
        failure: null,
        notice: '已保存语音提供者。',
      }));
    } catch {
      if (live()) setState((current) => ({ ...current, failure: CALL_REJECTED }));
    } finally {
      // 只释放**自己**那把锁；旧目标的 completion 不许清掉新目标的忙态。
      if (inflight.current.config?.token === token) inflight.current.config = null;
      if (stillTarget(epoch, target)) setState((current) => ({ ...current, saving: false }));
    }
  };

  const readCatalog = async (): Promise<void> => {
    const bridge = window.petSharedSpeech;
    const owner = state.owner;
    const provider = providerOf(state.speech);
    if (
      !bridge ||
      owner === null ||
      provider === null ||
      provider.bindingId === null ||
      (inflight.current.config !== null && inflight.current.config.target === targetRef.current)
    )
      return;
    if (!formBelongsTo(owner, renderTarget)) return;
    if (!currentRender()) return;
    const epoch = renderEpoch;
    const target = renderTarget;
    const token = Symbol('catalog');
    inflight.current.config = { token, target };
    setState((current) => ({ ...current, readingCatalog: true, failure: null, notice: null }));
    const live = (): boolean =>
      stillTarget(epoch, target) && formBelongsTo(ownerRef.current, target);
    try {
      const result = await bridge.readTtsCatalog({
        connectionId: owner.connectionId,
        providerRef: owner.providerRef,
        bindingId: provider.bindingId,
      });
      if (!live()) return;
      setState((current) =>
        result.ok
          ? { ...current, catalog: result.value }
          : { ...current, failure: describeError(result.error) },
      );
    } catch {
      if (live()) setState((current) => ({ ...current, failure: CALL_REJECTED }));
    } finally {
      if (inflight.current.config?.token === token) inflight.current.config = null;
      if (stillTarget(epoch, target))
        setState((current) => ({ ...current, readingCatalog: false }));
    }
  };

  const stop = async (): Promise<void> => {
    const bridge = window.petSharedSpeech;
    // 停的是**实际在播**的那条连接，不是配置目标。
    const target = state.state?.connectionId ?? null;
    if (!bridge || target === null) return;
    // stop 域独立：一次卡住的保存不挡停止；但同一目标不重复发。
    if (inflight.current.stop !== null && inflight.current.stop.target === target) return;
    const token = Symbol('stop');
    const before = state.state?.revision ?? null;
    inflight.current.stop = { token, target };
    setState((current) => ({ ...current, stopping: true, failure: null, notice: null }));
    try {
      const result = await bridge.stop({ connectionId: target });
      if (!alive.current || inflight.current.stop?.token !== token) return;
      if (!result.ok) {
        setState((current) => ({ ...current, failure: describeError(result.error) }));
        return;
      }
      setState((current) => {
        // 旧结果不能回滚更新的本机状态：只接受不比当前更旧的 revision，
        // 且目标必须仍是同一个实际 speech owner。
        const currentRevision = current.state?.revision ?? null;
        const currentTarget = current.state?.connectionId ?? null;
        if (currentTarget !== target) return current;
        if (currentRevision !== null && before !== null && currentRevision > before)
          return { ...current, notice: '已停止当前朗读。' };
        return { ...current, state: result.value, notice: '已停止当前朗读。' };
      });
    } catch {
      if (alive.current && inflight.current.stop?.token === token)
        setState((current) => ({ ...current, failure: CALL_REJECTED }));
    } finally {
      // 只有**自己仍是当前**那次 stop 时才清锁与 busy：B 的按钮不继承 A 的忙态。
      if (inflight.current.stop?.token === token) {
        inflight.current.stop = null;
        if (alive.current) setState((current) => ({ ...current, stopping: false }));
      }
    }
  };

  return {
    ...state,
    available,
    voices: SPEECH_PRESET_VOICES,
    provider: providerOf(state.speech),
    dirty: state.seed !== null && !sameDraft(state.draft, state.seed.draft),
    edit,
    save,
    readCatalog,
    stop,
    reload: (): void => {
      void refresh(true);
    },
  };
}
