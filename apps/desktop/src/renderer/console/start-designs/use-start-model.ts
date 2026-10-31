/**
 * Start 的唯一状态与动作：模型目录、正在输入的草稿、三条回执、桌宠可见性与预览接线。
 *
 * 这一份不画任何东西，也不认样式：版式与控件都从这里取状态、发指令。所有者（use-model-connection、
 * use-application、use-demo、theme.ts）一个都不复制——这里只把它们给的状态与动作摆成控件能直接用的形状。
 *
 * 草稿住在这一处而不是版式内部：换版式的时候组件重绘、这一份状态不动，正在输入的模型名与 Key 不丢；
 * Key 只在内存里，不写存储、不进日志，保存动作发出后即清空。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { describeError } from '../copy.js';

import type { ModelService, ModelReasoningEffort } from '@pet/contracts';

import type { AppView } from '../app-views.js';
import type { ApplicationState } from '../use-application.js';
import type { DemoState } from '../use-demo.js';
import type { ModelConnectionState, ModelSaveResult } from '../use-model-connection.js';
import type { PetPreviewComposer, PetPreviewMic, PetPreviewProps } from '../pet-preview.js';
import { demoBubbleText, phaseToPetState } from '../../pet/demo-status.js';

import type { ProviderRow, SaveReceipt, TestReceipt } from './behavior.js';
import {
  canSave,
  canSignIn,
  desktopPresence,
  failureLine,
  keyBlockReason,
  keySavedFor,
  micBlockReason,
  providerMark,
  providerRowsOf,
  resolvePicked,
  saveBlockReason,
  draftDiffers,
  saveReceiptOf,
  searchRows,
  sectionPhase,
  siblingOf,
  signInBlockReason,
  signInLine,
  testReceiptOf,
} from './behavior.js';

/** 组装这一份状态需要的所有者：由 pages/start.tsx 从设置台传下来。 */
export interface StartOwners {
  readonly app: ApplicationState;
  readonly demo: DemoState;
  readonly models: ModelConnectionState;
  readonly notify: (message: string, tone: 'ok' | 'danger') => void;
  readonly goToView: (view: AppView) => void;
  /** 「管理模型扩展」：目录由扩展提供，这一句只跳真实的扩展入口。 */
  readonly onOpenPlugins: () => void;
}

/** 正在输入的这一家：换端点时从那一家的应有值重新起稿，别家改动不影响它。 */
interface FieldDraft {
  readonly id: string;
  readonly model: string;
  readonly key: string;
  readonly reasoningEffort: ModelReasoningEffort;
}

/** 目录里的一行连同它此刻的含义：控件只读这些结论，不再自己判断。 */
export interface ProviderChoice {
  readonly service: ModelService;
  readonly row: ProviderRow;
  /** 这一行是不是当前详情给的那一家（同厂商两块平台各自算）。 */
  readonly current: boolean;
  readonly mark: ReturnType<typeof providerMark>;
  readonly keySaved: boolean;
  /** 当前那一家的草稿与本机存的那份不同：注记才有资格说"这次改动还没保存"。 */
  readonly dirty: boolean;
}

export interface StartModel {
  /* ---- 读取与整体状态 ---- */
  available: boolean;
  loading: boolean;
  error: string | null;
  /** 宿主本轮带回来的一句话（暂停、被别处改动之类），原样呈现。 */
  notice: string | null;
  phase: ReturnType<typeof sectionPhase>;
  paused: boolean;
  /** 在用的那一家与它的模型名；没在用就是 null，控件据此说「还没有在用连接」。 */
  snapshotLabel: string | null;
  /** 此刻这台机器在用的端点 id；没有在用就是 null。 */
  activeId: string | null;
  /** 回执板要说"在用的是谁"时用的名字；没有在用就不编。 */
  activeLabel: string | null;
  /** 最近一次真的写进本机的那一家；没有写过是 null。回执的「现在在用」看这一条。 */
  saveTargetId: string | null;

  /* ---- 目录 ---- */
  rows: readonly ProviderRow[];
  /** 搜索后的目录行；查询为空时就是整份目录。 */
  choices: readonly ProviderChoice[];
  query: string;
  setQuery(value: string): void;

  /* ---- 详情这一家与草稿 ---- */
  picked: ModelService | undefined;
  /** 用户点过的那一家；没点过时为 null，此时详情跟着在用的走。 */
  pickedId: string | null;
  inUse: boolean;
  mark: ReturnType<typeof providerMark> | null;
  keySaved: boolean;
  /** 当前这一家的输入内容与本机存的那份不同：注记与表头据此说"这次改动还没保存"。 */
  dirty: boolean;
  sibling: ModelService | undefined;
  model: string;
  key: string;
  reasoningEffort: ModelReasoningEffort;
  setReasoningEffort(value: ModelReasoningEffort): void;
  setModel(value: string): void;
  setKey(value: string): void;
  modelList: {
    fetching: boolean;
    options: readonly string[];
    error: string | null;
    notice: string | null;
    allowed: boolean;
  };
  getModels(): void;

  /* ---- 判断：正着说能不能，渲染处取反给 disabled ---- */
  can: { save: boolean; test: boolean; signIn: boolean };
  reasons: { save: string | null; test: string | null; signIn: string | null };
  /** Key 这一栏用不了的真实原因；null 表示可以正常输入。 */
  keyBlock: string | null;
  busy: {
    saving: boolean;
    testing: boolean;
    signingIn: boolean;
    sending: boolean;
    visibility: boolean;
    pausing: boolean;
  };

  /* ---- 回执：三条事实分开，不合成一句话 ---- */
  saved: SaveReceipt | null;
  tested: TestReceipt | null;
  signing: string | null;

  /* ---- 动作 ---- */
  pick(id: string): void;
  save(): void;
  test(): void;
  signIn(): void;
  cancelSignIn(): void;
  openKeyPage(): void;
  switchRegion(): void;
  togglePaused(next: boolean): void;
  refresh(): void;
  openPlugins(): void;

  /* ---- 桌宠 ---- */
  appAvailable: boolean;
  desktopAvailable: boolean;
  desktopShown: boolean;
  desktop: ReturnType<typeof desktopPresence>;
  pet: PetPreviewProps;
  setDesktopVisible(next: boolean): void;
  goToView(view: AppView): void;
}

export function useStartModel(owners: StartOwners): StartModel {
  const { app, demo, models, notify } = owners;
  const snapshot = models.snapshot;
  const services = useMemo(() => snapshot?.services ?? [], [snapshot]);
  const rows = useMemo(() => providerRowsOf(services), [services]);
  const active = snapshot?.active ?? null;

  const [pickedId, setPickedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [fields, setFields] = useState<FieldDraft | null>(null);
  const [saved, setSaved] = useState<SaveReceipt | null>(null);
  const [saveTargetId, setSaveTargetId] = useState<string | null>(null);
  const [tested, setTested] = useState<TestReceipt | null>(null);
  const [sending, setSending] = useState(false);
  const [visibility, setVisibility] = useState(false);
  const catalogSequence = useRef(0);
  const testSequence = useRef(0);
  const clearTest = useCallback(() => {
    testSequence.current += 1;
    setTested(null);
  }, []);
  const [catalog, setCatalog] = useState<{
    id: string;
    fetching: boolean;
    options: readonly string[];
    error: string | null;
    notice: string | null;
  } | null>(null);
  const clearCatalog = useCallback(() => {
    catalogSequence.current += 1;
    setCatalog(null);
  }, []);
  useEffect(
    () => () => {
      catalogSequence.current += 1;
      testSequence.current += 1;
    },
    [],
  );

  const picked = useMemo(
    () => resolvePicked(rows, pickedId, active?.id ?? null),
    [rows, pickedId, active],
  );
  const inUse = picked !== undefined && active !== null && active.id === picked.id;
  const keySaved = keySavedFor(snapshot, picked?.id);
  useEffect(() => {
    clearCatalog();
    clearTest();
  }, [picked?.id, clearCatalog, clearTest]);

  /**
   * 草稿的归属看端点 id：换了一家才从那一家的应有值重新起稿。
   * 两秒一次的后台重读不改这个 id，所以不会抹掉正在输入的内容；也不需要在渲染里写状态。
   */
  const seed =
    inUse && active !== null && active.model !== '' ? active.model : (picked?.defaultModel ?? '');
  const draft =
    fields !== null && fields.id === picked?.id
      ? fields
      : {
          id: picked?.id ?? '',
          model: seed,
          key: '',
          reasoningEffort:
            snapshot?.endpoints.find((e) => e.id === picked?.id)?.reasoningEffort ?? 'default',
        };
  const model = draft.model;
  const key = draft.key;
  const reasoningEffort = draft.reasoningEffort;

  const currentCatalog = catalog?.id === picked?.id ? catalog : null;
  const catalogAllowed =
    models.available &&
    picked?.available === true &&
    snapshot?.credentialStorageAvailable === true &&
    !models.saving &&
    !models.signingIn &&
    (key.trim().length > 0 || keySaved);
  const getModels = useCallback(async () => {
    if (!catalogAllowed || picked === undefined || currentCatalog?.fetching) return;
    const id = picked.id,
      sequence = ++catalogSequence.current;
    setCatalog({ id, fetching: true, options: [], error: null, notice: null });
    const result = await models.getModels({ id, ...(key.trim() ? { key: key.trim() } : {}) });
    if (catalogSequence.current !== sequence) return;
    if (result.ok && result.value.id === id) {
      const options = result.value.models;
      setCatalog({
        id,
        fetching: false,
        options,
        error: null,
        notice: options.length
          ? `已获取 ${options.length} 个模型。`
          : '服务商没有返回可用模型，可以手动填写模型名。',
      });
    } else {
      setCatalog({
        id,
        fetching: false,
        options: [],
        notice: null,
        error: result.ok ? '模型列表与所选服务商不匹配。' : describeError(result.error),
      });
    }
  }, [catalogAllowed, picked, currentCatalog?.fetching, models, key]);

  const choices = useMemo<ProviderChoice[]>(() => {
    const visible = searchRows(rows, query);
    return visible.map((row) => {
      const current =
        picked !== undefined && (row.main.id === picked.id || row.alt?.id === picked.id);
      const service = current ? picked : row.main;
      // 有默认配置记录不等于有凭据：Key 只认宿主报的 keyConfigured。
      const stored = snapshot?.endpoints.find((item) => item.id === service.id) ?? null;
      const keySaved = keySavedFor(snapshot, service.id);
      return {
        service,
        row,
        current,
        mark: providerMark({
          available: service.available,
          inUse: active !== null && active.id === service.id,
          current,
          keySaved,
        }),
        keySaved,
        // 只有当前那一家有"草稿"可言：其余行的注记讲它自己的真信息。
        dirty:
          current &&
          (draftDiffers(stored, model, key) ||
            (stored?.reasoningEffort ?? 'default') !== reasoningEffort),
      };
    });
  }, [rows, query, picked, active, snapshot, model, key, reasoningEffort]);

  const reasons = {
    save: saveBlockReason({ saving: models.saving, picked, model, key, inUse, keySaved }),
    test: models.testing
      ? '正在测试连接。'
      : !picked
        ? '先选择服务商。'
        : !model.trim()
          ? '先填写模型名。'
          : !catalogAllowed
            ? '填入 Key 或使用已保存的凭据后再测试。'
            : null,
    signIn: signInBlockReason({
      signingIn: models.signingIn,
      available: picked?.available === true,
    }),
    key: keyBlockReason(snapshot),
  };

  /**
   * 一次写入或一次登录带回结论：回执分三条事实存着，Key 交出去就不留在输入框里。
   * 没写成功时一个字都不动——那是用户下一步要改的东西。
   */
  const applySave = useCallback(
    (
      result: ModelSaveResult,
      id: string,
      modelKept: string,
      effortKept: ModelReasoningEffort,
    ): void => {
      setSaved(saveReceiptOf(result, id));
      if (result.saved) {
        // 回执板"现在在用"要能指着这一次真正写进去的那一家。
        setSaveTargetId(id);
        setFields({ id, model: modelKept, key: '', reasoningEffort: effortKept });
      }
    },
    [],
  );

  const save = useCallback(async (): Promise<void> => {
    if (picked === undefined) {
      return;
    }
    const trimmed = key.trim();
    if (trimmed === '' && !inUse && !keySaved) {
      return;
    }
    const outcome = await models.saveAndStart({
      id: picked.id,
      model: model.trim(),
      reasoningEffort,
      ...(trimmed === '' ? {} : { key: trimmed }),
    });
    applySave(outcome, picked.id, model.trim(), reasoningEffort);
  }, [picked, key, inUse, keySaved, model, reasoningEffort, models, applySave]);

  const test = useCallback(async (): Promise<void> => {
    if (!catalogAllowed || !picked || !model.trim() || models.testing) return;
    const sequence = ++testSequence.current;
    const result = await models.testSelected({
      id: picked.id,
      model: model.trim(),
      reasoningEffort,
      ...(key.trim() ? { key: key.trim() } : {}),
    });
    if (sequence === testSequence.current) setTested(testReceiptOf(result));
  }, [catalogAllowed, picked, model, reasoningEffort, key, models]);

  const signIn = useCallback(async (): Promise<void> => {
    if (picked === undefined) {
      return;
    }
    // 登录完成后保存同一份模型与思考强度草稿。
    applySave(
      await models.signInAndStart(picked, reasoningEffort, model.trim()),
      picked.id,
      model.trim(),
      reasoningEffort,
    );
  }, [picked, model, reasoningEffort, models, applySave]);

  const openKeyPage = useCallback(async (): Promise<void> => {
    if (picked === undefined) {
      return;
    }
    const outcome = await models.openServicePage(picked.id);
    if (!outcome.ok) {
      notify(failureLine('打不开那家服务的页面：' + (outcome.error ?? '未知原因')), 'danger');
    }
  }, [picked, models, notify]);

  const setVisible = useCallback(
    async (next: boolean): Promise<void> => {
      setVisibility(true);
      const outcome = await app.save({ visible: next });
      setVisibility(false);
      if (!outcome.ok) {
        notify(failureLine(outcome.error ?? '未知原因'), 'danger');
      }
    },
    [app, notify],
  );

  const sendText = useCallback(
    async (text: string): Promise<boolean> => {
      setSending(true);
      const outcome = await demo.sendText(text);
      setSending(false);
      if (!outcome.ok) {
        notify(failureLine(outcome.error ?? '未知原因'), 'danger');
      }
      return outcome.ok;
    },
    [demo, notify],
  );

  const togglePaused = useCallback(
    async (next: boolean): Promise<void> => {
      const outcome = await models.setPaused(next);
      if (!outcome.ok) {
        notify(failureLine(outcome.error ?? '未知原因'), 'danger');
      }
    },
    [models, notify],
  );

  const desktop = desktopPresence(app.snapshot?.desktop ?? null);

  const mic: PetPreviewMic | undefined = demo.available
    ? {
        canRecord: demo.snapshot?.canRecord === true,
        recording: demo.recording !== null,
        secondsLeft: demo.left,
        secondsLimit: demo.snapshot?.maxRecordingSeconds ?? null,
        unavailable: micBlockReason(demo.snapshot),
        start: () => {
          void demo.startRecording();
        },
        end: () => {
          void demo.endRecording();
        },
        cancel: () => {
          void demo.cancelRecording();
        },
      }
    : undefined;

  const composer: PetPreviewComposer | undefined = demo.available
    ? { canSend: demo.snapshot?.canSend === true, sending, onSend: sendText }
    : undefined;

  const pet: PetPreviewProps = {
    values: app.values,
    agent: app.snapshot?.agent ?? null,
    state: demo.snapshot === null ? null : phaseToPetState(demo.snapshot.phase),
    bubble: demo.snapshot === null ? null : demoBubbleText(demo.snapshot),
    interact: app.interact,
    mic,
    composer,
    onOpenVoiceSettings: () => owners.goToView('voice'),
    onOpenDress: () => owners.goToView('appearance'),
  };

  return {
    available: models.available,
    loading: models.loading,
    error: models.error,
    notice: snapshot?.notice ?? null,
    phase: sectionPhase(models.available, snapshot, models.loading, models.error),
    paused: snapshot?.paused ?? false,
    activeId: active?.id ?? null,
    activeLabel: active?.label ?? null,
    saveTargetId,
    snapshotLabel:
      active === null ? null : active.label + (active.model === '' ? '' : ' · ' + active.model),

    rows,
    choices,
    query,
    setQuery,

    picked,
    pickedId,
    inUse,
    mark:
      picked === undefined
        ? null
        : providerMark({ available: picked.available, inUse, current: true, keySaved }),
    keySaved,
    dirty: draftDiffers(
      snapshot?.endpoints.find((item) => item.id === picked?.id) ?? null,
      model,
      key,
    ),
    sibling: siblingOf(services, picked),
    model,
    key,
    reasoningEffort,
    setReasoningEffort: (value) => {
      clearTest();
      setFields({ ...draft, reasoningEffort: value });
    },
    setModel: (value) => {
      clearTest();
      setFields({ ...draft, model: value });
    },
    setKey: (value) => {
      clearCatalog();
      clearTest();
      setFields({ ...draft, key: value });
    },
    modelList: {
      fetching: currentCatalog?.fetching === true,
      options: currentCatalog?.options ?? picked?.models ?? [],
      error: currentCatalog?.error ?? null,
      notice:
        currentCatalog?.notice ??
        (!catalogAllowed
          ? picked?.auth === 'browser'
            ? '先登录此服务商，再获取模型列表。'
            : '填入 Key 或使用已保存的凭据后，可获取此服务商的模型。'
          : null),
      allowed: catalogAllowed,
    },
    getModels: () => {
      void getModels();
    },

    can: {
      save: canSave({ saving: models.saving, picked, model, key, inUse, keySaved }),
      test: reasons.test === null,
      signIn: canSignIn({ signingIn: models.signingIn, available: picked?.available === true }),
    },
    reasons: {
      save: reasons.save,
      test: reasons.test,
      signIn: reasons.signIn,
    },
    keyBlock: reasons.key,
    busy: {
      saving: models.saving,
      testing: models.testing,
      signingIn: models.signingIn,
      sending,
      visibility,
      pausing: models.pausing,
    },

    saved,
    tested,
    signing: signInLine(models.signIn?.phase, models.signIn?.signedIn === true),

    pick: (id) => {
      clearCatalog();
      clearTest();
      setPickedId(id);
    },
    save: () => {
      void save();
    },
    test: () => {
      void test();
    },
    signIn: () => {
      void signIn();
    },
    cancelSignIn: () => {
      void models.cancelSignIn();
    },
    openKeyPage: () => {
      void openKeyPage();
    },
    switchRegion: () => {
      const sibling = siblingOf(services, picked);
      if (sibling !== undefined) {
        clearCatalog();
        clearTest();
        setPickedId(sibling.id);
      }
    },
    togglePaused: (next) => {
      void togglePaused(next);
    },
    refresh: models.refresh,
    openPlugins: owners.onOpenPlugins,

    appAvailable: app.available,
    desktopAvailable: app.snapshot?.desktop?.available === true,
    desktopShown: desktop.mark === 'on',
    desktop,
    pet,
    setDesktopVisible: (next) => {
      void setVisible(next);
    },
    goToView: owners.goToView,
  };
}

/** 版式与插槽唯一的入口：所有者 + 这一份状态。 */
export interface StartScene {
  readonly owners: StartOwners;
  readonly model: StartModel;
}
