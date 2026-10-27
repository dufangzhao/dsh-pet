import type { ConfigApplyMode, ConfigInspection, OwnerRef } from '@pet/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ConfigNode } from './config-schema.js';
import { buildConfigForm } from './config-schema.js';
import {
  addItem,
  buildCandidate,
  type ConfigErrors,
  type Draft,
  type DraftPath,
  draftKey,
  initialDraft,
  removeItem,
  replaceAt,
  setPresence,
} from './config-draft.js';
import { CALL_REJECTED, describeError } from './copy.js';

/** 保存结果只报一条事实：这次改动的生效方式，或内容没有变化。 */
const SAVED = {
  immediate: '已保存。生效方式：立即。',
  reload: '已保存，需要重载插件后生效。',
  restart: '已保存，需要重启后生效。',
  unchanged: '已保存，内容没有变化。',
} as const;

function savedText(mode: ConfigApplyMode | null): string {
  return mode === null ? SAVED.unchanged : SAVED[mode];
}

export interface ConfigState {
  available: boolean;
  loading: boolean;
  /** 读取失败的一句话；此时不渲染表单。 */
  error: string | null;
  inspection: ConfigInspection | null;
  root: ConfigNode | null;
  draft: Draft | null;
  /** 字段级校验错误，键是界面路径。 */
  errors: ConfigErrors;
  /** 保存失败的一句话（与字段无关）。 */
  failure: string | null;
  /** 草稿与最近一次读取/保存的结果不同。 */
  dirty: boolean;
  saving: boolean;
  /** 保存时发现记录已被别人改过：必须显式重新读取，不自动覆盖。 */
  conflict: boolean;
  /** 保存成功后的提示；下一次编辑即清空。 */
  notice: string | null;
  reload: () => void;
  update: (path: DraftPath, next: Draft) => void;
  presence: (path: DraftPath, node: ConfigNode, present: boolean) => void;
  addItem: (path: DraftPath) => void;
  removeItem: (path: DraftPath, index: number) => void;
  save: () => Promise<void>;
}

/**
 * 单个插件配置的读取与保存。
 *
 * 只有一份草稿：编辑改草稿，保存成功才把草稿提为新的基线。
 * 保存失败保留草稿；冲突只置标记，等用户自己重新读取。
 */
export function usePluginConfig(owner: OwnerRef): ConfigState {
  const [inspection, setInspection] = useState<ConfigInspection | null>(null);
  const [root, setRoot] = useState<ConfigNode | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseline, setBaseline] = useState<string | null>(null);
  const [errors, setErrors] = useState<ConfigErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const alive = useRef(true);
  /** 保存门闩：同一事件循环里重复触发也只走一次。 */
  const inFlight = useRef(false);
  const available = typeof window !== 'undefined' && window.petConsole !== undefined;

  const clearForm = useCallback(() => {
    setInspection(null);
    setRoot(null);
    setDraft(null);
    setBaseline(null);
    setErrors({});
    setFailure(null);
    setConflict(false);
    setNotice(null);
  }, []);

  const apply = useCallback((next: ConfigInspection) => {
    const tree = buildConfigForm(next.definition);
    const start = initialDraft(tree, next.snapshot?.data ?? null, next.definition.defaults);
    setInspection(next);
    setRoot(tree);
    setDraft(start);
    setBaseline(draftKey(start));
    setErrors({});
    setFailure(null);
    setConflict(false);
  }, []);

  const load = useCallback(async () => {
    const bridge = window.petConsole;
    if (bridge === undefined) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const result = await bridge.inspectConfig(owner);
      if (!alive.current) {
        return;
      }
      if (result.ok) {
        apply(result.value);
      } else {
        // 读取失败就不保留旧表单：拿着过期的 revision 去保存只会得到冲突。
        clearForm();
        setError(describeError(result.error));
      }
    } catch {
      if (alive.current) {
        clearForm();
        setError(CALL_REJECTED);
      }
    } finally {
      if (alive.current) {
        setLoading(false);
      }
    }
  }, [apply, clearForm, owner]);

  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  /** 一编辑就收起上一次的错误与提示：它们描述的是上一份草稿。 */
  const edit = useCallback((next: (current: Draft) => Draft) => {
    setDraft((current) => (current === null ? current : next(current)));
    setErrors({});
    setNotice(null);
    setFailure(null);
  }, []);

  const update = useCallback(
    (path: DraftPath, next: Draft) => {
      edit((current) => replaceAt(current, path, next));
    },
    [edit],
  );

  const presence = useCallback(
    (path: DraftPath, node: ConfigNode, present: boolean) => {
      edit((current) => setPresence(current, path, node, present));
    },
    [edit],
  );

  const appendItem = useCallback(
    (path: DraftPath) => {
      if (root !== null) {
        edit((current) => addItem(root, current, path));
      }
    },
    [edit, root],
  );

  const dropItem = useCallback(
    (path: DraftPath, index: number) => {
      edit((current) => removeItem(current, path, index));
    },
    [edit],
  );

  const save = useCallback(async () => {
    const bridge = window.petConsole;
    if (bridge === undefined || root === null || draft === null || conflict || inFlight.current) {
      return;
    }
    const candidate = buildCandidate(root, draft);
    if (!candidate.ok) {
      setErrors(candidate.errors);
      setFailure(null);
      setNotice(null);
      return;
    }
    inFlight.current = true;
    setErrors({});
    setFailure(null);
    setSaving(true);
    setNotice(null);
    try {
      const result = await bridge.saveConfig({
        owner,
        expectedRevision: inspection?.snapshot?.revision ?? 0,
        data: candidate.value,
      });
      if (!alive.current) {
        return;
      }
      if (result.ok) {
        setInspection((current) =>
          current === null ? current : { ...current, snapshot: result.value.snapshot },
        );
        setBaseline(draftKey(draft));
        setNotice(savedText(result.value.changeMode));
      } else if (result.error.code === 'conflict') {
        // 冲突不自动合并：草稿原样留着，由用户自己决定重新读取。
        setConflict(true);
      } else {
        setFailure(describeError(result.error));
      }
    } catch {
      if (alive.current) {
        setFailure(CALL_REJECTED);
      }
    } finally {
      inFlight.current = false;
      if (alive.current) {
        setSaving(false);
      }
    }
  }, [conflict, draft, inspection, owner, root]);

  return {
    available,
    loading,
    error,
    inspection,
    root,
    draft,
    errors,
    failure,
    dirty: draft !== null && baseline !== null && draftKey(draft) !== baseline,
    saving,
    conflict,
    notice,
    reload: () => {
      void load();
    },
    update,
    presence,
    addItem: appendItem,
    removeItem: dropItem,
    save,
  };
}
