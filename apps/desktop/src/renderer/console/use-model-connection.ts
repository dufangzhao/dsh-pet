/**
 * 模型连接：这台机器上的服务目录、在用的端点、保存并开始、测试、暂停与浏览器登录。
 *
 * 桥只给 Result，不给事件：所以读要带序号——晚到的旧快照不能盖掉新的那一份。
 * 写成功后直接采用宿主返回的那份快照，不再补一次读取；写失败或传输断了就照实说，
 * 不在界面上假装"已经连上"。测试连接只对正在用的端点有意义，
 * 草稿里的模型与 Key 没有测过就是没有测过。
 */
import type {
  ModelConnectionBridge,
  ModelConnectionOutcome,
  ModelCatalogResult,
  ModelConnectionDraft,
  ModelReasoningEffort,
  ModelConnectionSnapshot,
  ModelService,
  ModelSignInStatus,
  Result,
} from '@pet/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { makeError } from '@pet/contracts';

import { CALL_REJECTED, describeError } from './copy.js';

/** 一次操作的回执：ok 只说明宿主接受了它，结果内容在快照里。 */
export interface ModelOutcome {
  ok: boolean;
  error: string | null;
}

/**
 * 「保存并开始」的回执。宿主接受了写入与那次真实测试是两件事：
 * saved 说配置进没进这台机器，ok 说测试通没通过，test 带着宿主原话的原因。
 * 桥返回 ok 不代表探测成功——把这两件事合成一个布尔就会说假话。
 */
export interface ModelSaveResult {
  saved: boolean;
  ok: boolean;
  error: string | null;
  test: ModelTestResult | null;
  /** 写完之后这台机器真正在用的端点；不是它就只能说"保存了"，不能说"连上了"。 */
  activeId: string | null;
}

/**
 * 「保存并开始」后给用户的那一句。三种结果分开说：
 * 真的在用且测过了、写进去了但探测没过、压根没写进去。
 */
export function saveMessage(result: ModelSaveResult, id: string): string {
  if (!result.saved) {
    return `连接没有成功：${result.error ?? '未知原因'}`;
  }
  if (result.ok && result.activeId === id) {
    return '已连接，桌宠开始接话。';
  }
  if (result.ok) {
    return '配置已保存，但这台机器在用的还是另一个端点。';
  }
  return `${describeTest(result.test ?? { ok: false, elapsedMs: null })}（Key 与模型已经留在这台机器上。）`;
}

/** 测试连接的回执：耗时与失败原因都取宿主报上来的原话，没报的项不替它编。 */
export interface ModelTestResult {
  readonly ok: boolean;
  readonly elapsedMs: number | null;
  readonly model?: string;
  readonly reason?: string;
}

export interface ModelConnectionState {
  /** 桥不存在时为 false：这一栏报"这台机器还没有模型连接通道"，不画假目录。 */
  available: boolean;
  snapshot: ModelConnectionSnapshot | null;
  loading: boolean;
  error: string | null;
  saving: boolean;
  testing: boolean;
  pausing: boolean;
  /** 浏览器登录的进行中状态；null 表示这台机器还没有报过登录结果。 */
  signIn: ModelSignInStatus | null;
  signingIn: boolean;
  refresh: () => void;
  saveAndStart: (input: ModelConnectionDraft) => Promise<ModelSaveResult>;
  testActive: () => Promise<ModelTestResult>;
  testSelected: (input: ModelConnectionDraft) => Promise<ModelTestResult>;
  getModels: (input: { id: string; key?: string }) => Promise<Result<ModelCatalogResult>>;
  setPaused: (paused: boolean) => Promise<ModelOutcome>;
  openServicePage: (id: string) => Promise<ModelOutcome>;
  /** 打开系统浏览器登录，每秒读一次状态，直到成功、失败或这次会话结束。 */
  signInAndStart: (
    service: ModelService,
    reasoningEffort?: ModelReasoningEffort,
    model?: string,
  ) => Promise<ModelSaveResult>;
  cancelSignIn: () => Promise<ModelOutcome>;
}

const OK: ModelOutcome = { ok: true, error: null };
/** 快照每两秒读一次：登录、暂停、别的窗口改了配置，这里跟着走，不靠用户手动刷新。 */
const READ_INTERVAL_MS = 2000;
/** 浏览器登录的轮询间隔：宿主说 waiting 就一秒后再问一次，不自己算进度。 */
const SIGN_IN_POLL_MS = 1000;

function currentBridge(): ModelConnectionBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.petModels;
}

/** 桥没给结果时那是"没有测到"，不能说成一次失败的测试。 */
export function testResultOf(result: Result<ModelConnectionOutcome>): ModelTestResult {
  if (!result.ok) {
    return { ok: false, elapsedMs: null, reason: describeError(result.error) };
  }
  return result.value.test;
}

/** 测试结果的一句话：通过就报耗时（宿主没给就不编），失败就报原因。 */
export function describeTest(test: ModelTestResult): string {
  if (test.ok) {
    return test.elapsedMs === null ? '连接正常。' : `连接正常，耗时 ${test.elapsedMs} ms。`;
  }
  return test.reason === undefined || test.reason === ''
    ? '连接失败，没有给出原因。'
    : `连接失败：${test.reason}`;
}

/** 登录回执：只有宿主说 signedIn 才算接上，phase 只说明它走到哪一步。 */
export function signInOutcome(
  status: ModelSignInStatus | null,
  error: string | null,
): ModelOutcome {
  if (error !== null) {
    return { ok: false, error };
  }
  if (status === null) {
    return { ok: false, error: CALL_REJECTED };
  }
  if (status.signedIn) {
    return OK;
  }
  if (status.phase === 'failed') {
    return { ok: false, error: status.reason ?? '登录没有完成。' };
  }
  return { ok: false, error: '登录还没有完成。' };
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * 模型连接的唯一持有者：window.petModels。
 *
 * 读带序号，写直接采用返回的快照；一个时刻只有一次保存与一次测试在飞。
 */
export function useModelConnection(): ModelConnectionState {
  const bridge = currentBridge();
  const [snapshot, setSnapshot] = useState<ModelConnectionSnapshot | null>(null);
  const [loading, setLoading] = useState(bridge !== undefined);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [signIn, setSignIn] = useState<ModelSignInStatus | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const alive = useRef(true);
  const issued = useRef(0);

  const read = useCallback(async (visible: boolean): Promise<void> => {
    const current = currentBridge();
    if (current === undefined) {
      return;
    }
    const seq = issued.current + 1;
    issued.current = seq;
    if (visible) {
      setLoading(true);
    }
    try {
      const result = await current.getSnapshot();
      if (!alive.current || seq !== issued.current) {
        return;
      }
      if (result.ok) {
        setSnapshot(result.value);
        setError(null);
      } else {
        setError(describeError(result.error));
      }
    } catch {
      if (alive.current && seq === issued.current) {
        setError(CALL_REJECTED);
      }
    } finally {
      if (alive.current && seq === issued.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void read(true);
    const timer = setInterval(() => {
      void read(false);
    }, READ_INTERVAL_MS);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [read]);

  const getModels = useCallback(
    async (input: { id: string; key?: string }): Promise<Result<ModelCatalogResult>> => {
      const current = currentBridge();
      if (current === undefined) return { ok: false, error: makeError('unavailable') };
      try {
        return await current.getModels(input);
      } catch {
        return { ok: false, error: makeError('unavailable') };
      }
    },
    [],
  );

  const saveAndStart = useCallback(
    async (input: ModelConnectionDraft): Promise<ModelSaveResult> => {
      const current = currentBridge();
      const notSaved = (error: string | null): ModelSaveResult => ({
        saved: false,
        ok: false,
        error,
        test: null,
        activeId: null,
      });
      if (current === undefined) {
        return notSaved(CALL_REJECTED);
      }
      if (snapshot === null) {
        return notSaved('还没读到这台机器的模型配置，先重新读取一次。');
      }
      if (saving) {
        return notSaved('上一个保存还没结束。');
      }
      setSaving(true);
      try {
        const result = await current.saveAndStart({
          id: input.id,
          model: input.model,
          expectedRevision: snapshot.revision,
          ...(input.key === undefined || input.key === '' ? {} : { key: input.key }),
          ...(input.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: input.reasoningEffort }),
        });
        if (!alive.current) {
          return notSaved(CALL_REJECTED);
        }
        if (!result.ok) {
          // 桥拒绝了这次写入：配置没变，原因照宿主的话说。
          return notSaved(describeError(result.error));
        }
        // 写进去了，但那次真实探测可能没通过：Key 仍然留着，原因仍然要说。
        setSnapshot(result.value.snapshot);
        setError(null);
        const test = result.value.test;
        return {
          saved: true,
          ok: test.ok,
          error: test.ok ? null : describeTest(test),
          test,
          activeId: result.value.snapshot.active?.id ?? null,
        };
      } catch {
        if (alive.current) {
          setError(CALL_REJECTED);
        }
        return notSaved(CALL_REJECTED);
      } finally {
        if (alive.current) {
          setSaving(false);
        }
      }
    },
    [saving, snapshot],
  );

  const testActive = useCallback(async (): Promise<ModelTestResult> => {
    const current = currentBridge();
    if (current === undefined) {
      return { ok: false, elapsedMs: null, reason: CALL_REJECTED };
    }
    setTesting(true);
    try {
      return testResultOf(await current.testConnection());
    } catch {
      return { ok: false, elapsedMs: null, reason: CALL_REJECTED };
    } finally {
      if (alive.current) {
        setTesting(false);
      }
    }
  }, []);

  const testSelected = useCallback(
    async (input: ModelConnectionDraft): Promise<ModelTestResult> => {
      const current = currentBridge();
      if (current === undefined) return { ok: false, elapsedMs: null, reason: CALL_REJECTED };
      setTesting(true);
      try {
        const result = await current.testSelected(input);
        if (!result.ok) return { ok: false, elapsedMs: null, reason: describeError(result.error) };
        if (result.value.id !== input.id || result.value.model !== input.model)
          return { ok: false, elapsedMs: null, reason: '测试结果与当前配置不匹配。' };
        return result.value.test;
      } catch {
        return { ok: false, elapsedMs: null, reason: CALL_REJECTED };
      } finally {
        if (alive.current) setTesting(false);
      }
    },
    [],
  );

  const setPaused = useCallback(
    async (paused: boolean): Promise<ModelOutcome> => {
      const current = currentBridge();
      if (current === undefined) {
        return { ok: false, error: CALL_REJECTED };
      }
      if (pausing) {
        return { ok: false, error: '上一个暂停或继续还没结束。' };
      }
      setPausing(true);
      try {
        const result = await current.setPaused({ paused });
        if (!alive.current) {
          return { ok: false, error: CALL_REJECTED };
        }
        if (!result.ok) {
          return { ok: false, error: describeError(result.error) };
        }
        setSnapshot(result.value);
        return OK;
      } catch {
        return { ok: false, error: CALL_REJECTED };
      } finally {
        if (alive.current) {
          setPausing(false);
        }
      }
    },
    [pausing],
  );

  const openServicePage = useCallback(async (id: string): Promise<ModelOutcome> => {
    const current = currentBridge();
    if (current === undefined) {
      return { ok: false, error: CALL_REJECTED };
    }
    try {
      const result = await current.openServicePage({ id });
      return result.ok ? OK : { ok: false, error: describeError(result.error) };
    } catch {
      return { ok: false, error: CALL_REJECTED };
    }
  }, []);

  const pollSignIn = useCallback(async (): Promise<ModelSignInStatus | null> => {
    const current = currentBridge();
    if (current === undefined) {
      return null;
    }
    for (;;) {
      await wait(SIGN_IN_POLL_MS);
      if (!alive.current) {
        return null;
      }
      const result = await current.getSignInState();
      if (!alive.current) {
        return null;
      }
      if (!result.ok) {
        return null;
      }
      setSignIn(result.value);
      if (result.value.phase !== 'waiting') {
        return result.value;
      }
    }
  }, []);

  const signInAndStart = useCallback(
    async (
      service: ModelService,
      reasoningEffort?: ModelReasoningEffort,
      selectedModel = service.defaultModel,
    ): Promise<ModelSaveResult> => {
      const current = currentBridge();
      const stopped = (error: string | null): ModelSaveResult => ({
        saved: false,
        ok: false,
        error,
        test: null,
        activeId: null,
      });
      if (current === undefined) {
        return stopped(CALL_REJECTED);
      }
      if (signingIn || snapshot === null) {
        return stopped('上一个登录还没结束。');
      }
      setSigningIn(true);
      try {
        const started = await current.startSignIn();
        if (!started.ok) {
          return stopped(describeError(started.error));
        }
        setSignIn(started.value);
        if (started.value.phase === 'waiting') {
          const settled = signInOutcome(await pollSignIn(), null);
          if (!settled.ok) {
            return stopped(settled.error);
          }
        } else if (!started.value.signedIn) {
          return stopped(started.value.reason ?? '登录没有完成。');
        }
        // 登录成功不等于接上了：接下来这一次保存与探测才是。
        return await saveAndStart({
          id: service.id,
          model: selectedModel,
          ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
        });
      } catch {
        return stopped(CALL_REJECTED);
      } finally {
        if (alive.current) {
          setSigningIn(false);
        }
      }
    },
    [pollSignIn, saveAndStart, signingIn, snapshot],
  );

  const cancelSignIn = useCallback(async (): Promise<ModelOutcome> => {
    const current = currentBridge();
    if (current === undefined) {
      return { ok: false, error: CALL_REJECTED };
    }
    try {
      const result = await current.cancelSignIn();
      if (result.ok) {
        setSignIn(result.value);
        return OK;
      }
      return { ok: false, error: describeError(result.error) };
    } catch {
      return { ok: false, error: CALL_REJECTED };
    }
  }, []);

  return {
    available: bridge !== undefined,
    snapshot,
    loading,
    error,
    saving,
    testing,
    pausing,
    signIn,
    signingIn,
    refresh: () => {
      void read(true);
    },
    saveAndStart,
    testActive,
    testSelected,
    getModels,
    setPaused,
    openServicePage,
    signInAndStart,
    cancelSignIn,
  };
}
