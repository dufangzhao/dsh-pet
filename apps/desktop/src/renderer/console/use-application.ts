import type {
  ApplicationBridge,
  ApplicationInteraction,
  ApplicationPage,
  ApplicationPreferences,
  ApplicationSnapshot,
} from '@pet/contracts';
import { APPLICATION_DEFAULTS } from '@pet/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

import { CALL_REJECTED, COPY, PROFILE_CONFLICT, UNCERTAIN_PROFILE, describeError } from './copy.js';
import {
  EMPTY_EARLIER,
  cursorWentBack,
  mergeHistory,
  withEarlierPage,
  type EarlierHistory,
} from './history-page.js';

/*
 * ApplicationPreferences 带 JSON 索引签名，keyof 只会回 string | number，
 * 拿不到具体字段名。能单独改的项一共这十三个，与冻结的契约一一对应：
 * 少写或多写都会在 save 的 Partial<ApplicationPreferences> 上暴露出来。
 */
export type PreferenceField =
  | 'petName'
  | 'userName'
  | 'replyLanguage'
  | 'style'
  | 'personaPrompt'
  | 'figure'
  | 'palette'
  | 'size'
  | 'visible'
  | 'alwaysOnTop'
  | 'draggable'
  | 'reducedMotion'
  | 'voiceEnabled';

/** 取值为字符串的那几项：单选组只需要它们，checkbox 走另一条路。 */
export type StringPreferenceField = {
  [K in PreferenceField]: ApplicationPreferences[K] extends string ? K : never;
}[PreferenceField];

/** 一次写操作的结果。ok 只表示宿主接受了这次保存并给了新的快照。 */
export interface ApplicationOutcome {
  ok: boolean;
  error: string | null;
}

export interface ApplicationState {
  /** 新桥不存在时为 false：页面据此显示真实的不可用态，不画假数据。 */
  available: boolean;
  snapshot: ApplicationSnapshot | null;
  loading: boolean;
  /** 读取或写入没能确认成功时的一句话；页面收起数据，只留重新读取。 */
  error: string | null;
  refresh: () => void;
  /**
   * 界面显示的偏好值：宿主那一份，加上还没保存成功的草稿。
   * 还没存过偏好时是应用声明的默认值——第一次保存会新建一条记录。
   */
  values: ApplicationPreferences | null;
  /** 带着未保存草稿的项：与宿主那份比对得出，输入又改回原样就不算。 */
  edited: ReadonlySet<PreferenceField>;
  saving: boolean;
  /** 保存因为版本已被别处改动而被拒绝；草稿原样留着。 */
  conflict: boolean;
  /** 只改草稿。文本类字段靠它留住输入，不会被后台刷新抹掉。 */
  edit: <K extends PreferenceField>(field: K, value: ApplicationPreferences[K]) => void;
  /**
   * 提交一次改动：patch 里有什么就改什么，其余字段用宿主当前那份。
   * expectedRevision 用宿主刚给的 revision；没有记录时为 0，即新建第一条。
   */
  save: (patch: Partial<ApplicationPreferences>) => Promise<ApplicationOutcome>;
  /** 请应用重新播放上手引导；结果来自宿主返回的快照。 */
  startGuide: () => Promise<ApplicationOutcome>;
  /**
   * 让宿主记一次真实互动（戳、摸，以及表情画出来之后的脸红回执）。
   *
   * 走的是桌宠窗口同一条桥、同一条记录：设置台不本地演反应，也不新开一份历史。
   */
  interact: (kind: PetInteractionKind) => Promise<ApplicationOutcome>;
  /**
   * 执行外部页面自己声明的一个操作。宿主返回的结果值不猜含义：
   * 这里只说"这次调用完成了没有"，之后的状态变化靠事件与重读带回来。
   */
  runPageAction: (page: ApplicationPage, action: PageAction) => Promise<ApplicationOutcome>;
  /**
   * 时间线：宿主快照里的那一段，加上这里临时补在最前面的更早几页。
   * 只在界面上合并，不写回、也不另存一份记录。
   */
  history: readonly ApplicationInteraction[];
  /** 前面还可能读到更早的记录，而且桥真的提供 getHistory。 */
  historyEarlier: boolean;
  historyLoading: boolean;
  /** 读取更早记录没成功的一句话；已有记录保持不动。 */
  historyError: string | null;
  loadEarlierHistory: () => void;
}

/** 页面操作项由宿主在 pages[].actions 里给；这里不自定义新形状。 */
export type PageAction = NonNullable<ApplicationPage['actions']>[number];

/** 桥的 interact 认这几种；与契约里的取值一致，不在这里另起一名。 */
export type PetInteractionKind = 'poke' | 'pat' | 'drag' | 'blush' | 'happy';

const OK: ApplicationOutcome = { ok: true, error: null };
const BUSY: ApplicationOutcome = { ok: false, error: '上一个保存还没结束。' };

/** 一次补多少条更早记录：够翻两屏，又不至于把一条时间线整段搬进内存。 */
const HISTORY_PAGE_SIZE = 50;

function currentBridge(): ApplicationBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.petApplication;
}

/** patch 的键都是同一份偏好里的字段，合并结果仍然是完整偏好。 */
function merge(
  base: ApplicationPreferences,
  patch: Partial<ApplicationPreferences>,
): ApplicationPreferences {
  // Object.assign 而不是对象字面量：字面量会把可选键摊成 string 索引签名。
  return Object.assign({}, base, patch);
}

/**
 * 应用快照的唯一持有者：window.petApplication。
 *
 * 读取带序号，晚到的旧响应直接丢掉——一份旧偏好不能盖掉新的那一份。
 * onChanged 只说明"变了"，内容仍然要重读一次；静默重读不碰草稿，
 * 用户正在写的正文不该被一次后台刷新抹掉。
 * 写操作返回完整快照时直接采用，不再补一次读取。
 */
export function useApplication(): ApplicationState {
  const bridge = currentBridge();
  const [snapshot, setSnapshot] = useState<ApplicationSnapshot | null>(null);
  const [loading, setLoading] = useState(bridge !== undefined);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [drafts, setDrafts] = useState<Partial<ApplicationPreferences>>({});
  const [earlier, setEarlier] = useState<EarlierHistory>(EMPTY_EARLIER);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const alive = useRef(true);
  const issued = useRef(0);
  const inFlight = useRef(false);
  // 更早记录的读取有自己的代次：清空或刷新之后，晚到的旧页不能再贴回来。
  const earlierIssued = useRef(0);
  const earlierInFlight = useRef(false);
  // 上一次看到的 cursor，用来识别宿主把记录清空（cursor 回退）的那一次。
  const seenCursor = useRef<number | null>(null);

  const read = useCallback(async (visible: boolean) => {
    const current = currentBridge();
    if (current === undefined) {
      return;
    }
    const seq = issued.current + 1;
    issued.current = seq;
    if (visible) {
      setLoading(true);
      setError(null);
    }
    try {
      const result = await current.getSnapshot();
      if (!alive.current || seq !== issued.current) {
        return;
      }
      if (result.ok) {
        setSnapshot(result.value);
        // 现在手上的就是最新一份，上一轮的失败提示就此收起。
        setError(null);
      } else {
        // 失败无论可见与否都要说：那时不知道宿主已经变成什么样。
        setError(describeError(result.error));
      }
    } catch {
      if (alive.current) {
        setError(CALL_REJECTED);
      }
    } finally {
      // 最新完成的读取负责收起加载态，即使它是一次静默重读。
      if (alive.current && seq === issued.current) {
        setLoading(false);
      }
    }
  }, []);

  const cursor = snapshot?.cursor ?? null;
  useEffect(() => {
    if (cursor === null) {
      return;
    }
    const previous = seenCursor.current;
    seenCursor.current = cursor;
    if (!cursorWentBack(previous, cursor)) {
      return;
    }
    // 宿主清空了记录：更早那几页描述的是已经不存在的那条时间线，整块作废。
    // 在途的那次读取也一并作废，否则它回来时会把旧页重新贴到清空后的列表上。
    earlierIssued.current += 1;
    earlierInFlight.current = false;
    setEarlier(EMPTY_EARLIER);
    setHistoryLoading(false);
    setHistoryError(null);
  }, [cursor]);

  useEffect(() => {
    alive.current = true;
    void read(true);
    // 订阅只装一次；事件不带数据，一切以重读为准。
    const off = currentBridge()?.onChanged(() => {
      void read(false);
    });
    return () => {
      alive.current = false;
      off?.();
    };
  }, [read]);

  const stored = snapshot?.profile ?? null;
  const base = stored === null ? APPLICATION_DEFAULTS : stored.data;
  const values: ApplicationPreferences | null = snapshot === null ? null : merge(base, drafts);
  const edited = new Set<PreferenceField>(
    (Object.keys(drafts) as PreferenceField[]).filter((field) => drafts[field] !== base[field]),
  );

  const edit = useCallback(
    <K extends PreferenceField>(field: K, value: ApplicationPreferences[K]) => {
      setDrafts((current) => setField(current, field, value));
    },
    [],
  );

  const save = useCallback(
    async (patch: Partial<ApplicationPreferences>): Promise<ApplicationOutcome> => {
      const current = currentBridge();
      if (current === undefined) {
        return { ok: false, error: COPY.missingBridge };
      }
      if (inFlight.current) {
        return BUSY;
      }
      if (snapshot === null) {
        return { ok: false, error: '还没读到这台机器的偏好，先重新读取一次。' };
      }
      const profile = snapshot.profile;
      inFlight.current = true;
      setSaving(true);
      try {
        const result = await current.saveProfile({
          expectedRevision: profile?.revision ?? 0,
          data: merge(profile?.data ?? APPLICATION_DEFAULTS, patch),
        });
        if (!alive.current) {
          return { ok: false, error: CALL_REJECTED };
        }
        if (result.ok) {
          setSnapshot(result.value);
          setError(null);
          setConflict(false);
          // 交出去的那几项以宿主返回的为准，其余草稿继续留着。
          setDrafts((now) => dropFields(now, Object.keys(patch)));
          return OK;
        }
        if (result.error.code === 'conflict') {
          setConflict(true);
          return { ok: false, error: PROFILE_CONFLICT };
        }
        return { ok: false, error: describeError(result.error) };
      } catch {
        if (alive.current) {
          // 请求没送出去或传输断了：既不能说没写，也不能说写成了。
          setError(UNCERTAIN_PROFILE);
        }
        return { ok: false, error: UNCERTAIN_PROFILE };
      } finally {
        inFlight.current = false;
        if (alive.current) {
          setSaving(false);
        }
      }
    },
    [snapshot],
  );

  const startGuide = useCallback(async (): Promise<ApplicationOutcome> => {
    const current = currentBridge();
    if (current === undefined) {
      return { ok: false, error: COPY.missingBridge };
    }
    try {
      const result = await current.startGuide();
      if (!alive.current) {
        return { ok: false, error: CALL_REJECTED };
      }
      if (result.ok) {
        setSnapshot(result.value);
        return OK;
      }
      return { ok: false, error: describeError(result.error) };
    } catch {
      return { ok: false, error: CALL_REJECTED };
    }
  }, []);

  const interact = useCallback(
    async (kind: PetInteractionKind): Promise<ApplicationOutcome> => {
      const current = currentBridge();
      if (current === undefined) {
        return { ok: false, error: COPY.missingBridge };
      }
      try {
        const result = await current.interact({ kind, via: 'console' });
        if (!alive.current) {
          return { ok: false, error: CALL_REJECTED };
        }
        if (!result.ok) {
          return { ok: false, error: describeError(result.error) };
        }
        // 记录与状态都由宿主说话：它报变了我们再读一次，不在这里补一份。
        void read(false);
        return OK;
      } catch {
        return { ok: false, error: CALL_REJECTED };
      }
    },
    [read],
  );

  const runPageAction = useCallback(
    async (page: ApplicationPage, action: PageAction): Promise<ApplicationOutcome> => {
      const current = currentBridge();
      if (current === undefined) {
        return { ok: false, error: COPY.missingBridge };
      }
      try {
        const result = await current.runPageAction({
          owner: page.owner,
          pageId: page.id,
          panelId: action.panelId,
          method: action.method,
          data: null,
        });
        if (!alive.current) {
          return { ok: false, error: CALL_REJECTED };
        }
        if (!result.ok) {
          return { ok: false, error: describeError(result.error) };
        }
        // 页面操作可能改了配置或状态：重读一次，而不是在这里宣布结果。
        void read(false);
        return OK;
      } catch {
        return { ok: false, error: CALL_REJECTED };
      }
    },
    [read],
  );

  /**
   * 读更早的一页。
   *
   * 只在宿主说还有更早记录、且桥真的提供 getHistory 时由页面触发。
   * 失败不改变已经显示的内容：读不到更早的页，不等于已有记录不对。
   */
  const loadEarlierHistory = useCallback((): void => {
    const current = currentBridge();
    const fetchPage = current?.getHistory;
    if (current === undefined || fetchPage === undefined || snapshot === null) {
      return;
    }
    if (earlierInFlight.current) {
      return;
    }
    const before = earlier.before === undefined ? (snapshot.historyBefore ?? null) : earlier.before;
    // 宿主没给出更早的位置，就不发这次请求。
    if (before === null) {
      return;
    }
    const seq = earlierIssued.current + 1;
    earlierIssued.current = seq;
    earlierInFlight.current = true;
    setHistoryLoading(true);
    setHistoryError(null);
    void Promise.resolve()
      .then(() => fetchPage.call(current, { before, limit: HISTORY_PAGE_SIZE }))
      .then((reply) => {
        // 只让当前这一次、当前这个组件的结果落地。
        if (!alive.current || seq !== earlierIssued.current) {
          return;
        }
        if (!reply.ok) {
          setHistoryError(describeError(reply.error));
          return;
        }
        setEarlier((now) => withEarlierPage(now, reply.value));
      })
      .catch(() => {
        if (alive.current && seq === earlierIssued.current) {
          setHistoryError(CALL_REJECTED);
        }
      })
      .finally(() => {
        if (seq !== earlierIssued.current) {
          return;
        }
        earlierInFlight.current = false;
        if (alive.current) {
          setHistoryLoading(false);
        }
      });
  }, [earlier.before, snapshot]);

  const history = snapshot === null ? [] : mergeHistory(earlier.items, snapshot.history);
  const historyEarlier =
    bridge !== undefined &&
    bridge.getHistory !== undefined &&
    (earlier.before === undefined ? snapshot?.historyHasEarlier === true : earlier.more);

  return {
    available: bridge !== undefined,
    snapshot,
    loading,
    error,
    refresh: () => {
      void read(true);
    },
    values,
    edited,
    saving,
    conflict,
    edit,
    save,
    startGuide,
    interact,
    runPageAction,
    history,
    historyEarlier,
    historyLoading,
    historyError,
    loadEarlierHistory,
  };
}

/** 偏好的键是联合类型，逐项写回需要一个保持键与值对应关系的入口。 */
function setField<K extends PreferenceField>(
  target: Partial<ApplicationPreferences>,
  field: K,
  value: ApplicationPreferences[K],
): Partial<ApplicationPreferences> {
  return { ...target, [field]: value };
}

function dropFields(
  target: Partial<ApplicationPreferences>,
  savedFields: string[],
): Partial<ApplicationPreferences> {
  const saved = new Set(savedFields);
  const next: Partial<ApplicationPreferences> = {};
  for (const [field, value] of Object.entries(target)) {
    if (!saved.has(field)) {
      Object.assign(next, { [field]: value });
    }
  }
  return next;
}
