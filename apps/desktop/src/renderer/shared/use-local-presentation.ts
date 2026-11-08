/**
 * 本地外观与音频偏好：唯一来源是 window.petLocalPresentation，服务人格不经过这里。
 *
 * 保存用 expectedRevision 做 CAS，只提交白名单里的键；被别处改过时保留草稿并说明，
 * 不静默覆盖。写进去的字段与桌面窗读到的是同一份记录，所以改完桌面那只就跟着变。
 */
import type {
  DesktopPresentationBridge,
  DesktopPresentationPreferences,
  DesktopPresentationSnapshot,
} from '@pet/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

import { errorText } from './companion-state.js';

function readBridge(): DesktopPresentationBridge | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as { petLocalPresentation?: DesktopPresentationBridge })
    .petLocalPresentation;
  return typeof candidate === 'object' && candidate !== null && candidate.version === 1
    ? candidate
    : null;
}

export interface LocalPresentationView {
  available: boolean;
  snapshot: DesktopPresentationSnapshot | null;
  loading: boolean;
  error: string | null;
  /** 最近一次保存的结论；成功不弹，失败说原因。 */
  notice: string | null;
  saving: boolean;
  save(patch: Partial<DesktopPresentationPreferences>): Promise<boolean>;
  refresh(): void;
}

export function useLocalPresentation(): LocalPresentationView {
  const bridgeRef = useRef<DesktopPresentationBridge | null>(readBridge());
  const [snapshot, setSnapshot] = useState<DesktopPresentationSnapshot | null>(null);
  const [loading, setLoading] = useState(bridgeRef.current !== null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const alive = useRef(true);
  const adopted = useRef(-1);

  const accept = useCallback((next: DesktopPresentationSnapshot): void => {
    if (next.revision < adopted.current) return;
    adopted.current = next.revision;
    setSnapshot(next);
  }, []);

  const read = useCallback(
    async (visible: boolean): Promise<void> => {
      const bridge = bridgeRef.current;
      if (bridge === null) return;
      if (visible) setLoading(true);
      try {
        const result = await bridge.getSnapshot();
        if (!alive.current) return;
        if (result.ok) {
          accept(result.value);
          setError(null);
        } else setError(errorText(result.error) ?? '读取外观设置失败。');
      } catch {
        if (alive.current) setError('读取外观设置失败。');
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

  const save = useCallback(
    async (patch: Partial<DesktopPresentationPreferences>): Promise<boolean> => {
      const bridge = bridgeRef.current;
      const current = snapshot;
      if (bridge === null || current === null) {
        setNotice('外观设置暂时不可用。');
        return false;
      }
      if (Object.keys(patch).length === 0) return true;
      setSaving(true);
      setNotice(null);
      try {
        const result = await bridge.save({ expectedRevision: current.revision, patch });
        if (!alive.current) return false;
        if (result.ok) {
          accept(result.value);
          return true;
        }
        setNotice(
          result.error.code === 'conflict'
            ? '这份设置已被别处改过，这次没有写入；重新读取后再保存一次。'
            : `这个选择没有写进去：${errorText(result.error) ?? '未知原因'}`,
        );
        return false;
      } catch {
        if (alive.current) setNotice('这个选择没有写进去：调用没有返回结果。');
        return false;
      } finally {
        if (alive.current) setSaving(false);
      }
    },
    [accept, snapshot],
  );

  return {
    available: bridgeRef.current !== null,
    snapshot,
    loading,
    error,
    notice,
    saving,
    save,
    refresh: () => void read(true),
  };
}
