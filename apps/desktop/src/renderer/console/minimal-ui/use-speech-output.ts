import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isSpeechOutputSaveSettings,
  type SpeechOutputSettings,
  type SpeechOutputSnapshot,
  type SpeechOutputSaveSettings,
} from '@pet/contracts';
import { CALL_REJECTED, COPY, describeError } from '../copy.js';

export interface SpeechOutputDraft {
  enabled: boolean;
  provider: SpeechOutputSettings['provider'];
  voice: string;
  rate: number;
  volume: number;
}
interface Seed {
  revision: number;
  draft: SpeechOutputDraft;
}
interface FormState {
  snapshot: SpeechOutputSnapshot | null;
  seed: Seed | null;
  draft: SpeechOutputDraft | null;
  loading: boolean;
  readError: string | null;
  failure: string | null;
  notice: string | null;
  conflict: boolean;
  saving: boolean;
  auditioning: boolean;
  stopping: boolean;
}
const draftFrom = (settings: SpeechOutputSettings): SpeechOutputDraft => ({
  enabled: settings.enabled,
  provider: settings.provider ? { ...settings.provider } : null,
  voice: settings.voice ?? '',
  rate: settings.rate,
  volume: settings.volume,
});
const equalDraft = (a: SpeechOutputDraft | null, b: SpeechOutputDraft | null): boolean => {
  if (!a || !b) return a === b;
  const sameProvider =
    a.provider === null || b.provider === null
      ? a.provider === b.provider
      : a.provider.pluginId === b.provider.pluginId &&
        a.provider.instanceId === b.provider.instanceId &&
        a.provider.providerId === b.provider.providerId;
  return (
    sameProvider &&
    a.enabled === b.enabled &&
    a.voice === b.voice &&
    a.rate === b.rate &&
    a.volume === b.volume
  );
};
export interface SpeechOutputForm extends FormState {
  available: boolean;
  dirty: boolean;
  edit(patch: Partial<SpeechOutputDraft>): void;
  save(): Promise<void>;
  audition(text: string): Promise<void>;
  stop(): Promise<void>;
  reload(): void;
}

/** Live status may advance while the draft keeps the exact revision it was seeded from. */
export function useSpeechOutput(): SpeechOutputForm {
  const [state, setState] = useState<FormState>({
    snapshot: null,
    seed: null,
    draft: null,
    loading: true,
    readError: null,
    failure: null,
    notice: null,
    conflict: false,
    saving: false,
    auditioning: false,
    stopping: false,
  });
  const alive = useRef(false);
  const readSequence = useRef(0);
  const pending = useRef(new Set<'save' | 'audition' | 'stop'>());
  const available = typeof window !== 'undefined' && window.petSpeechOutput !== undefined;
  const refresh = useCallback(async (resetDraft = false): Promise<void> => {
    const sequence = ++readSequence.current;
    const bridge = typeof window === 'undefined' ? undefined : window.petSpeechOutput;
    if (!bridge) {
      setState((current) => ({ ...current, loading: false, readError: COPY.missingBridge }));
      return;
    }
    if (resetDraft) setState((current) => ({ ...current, loading: true, readError: null }));
    try {
      const result = await bridge.getSnapshot();
      if (!alive.current || sequence !== readSequence.current) return;
      if (!result.ok) {
        setState((current) => ({
          ...current,
          snapshot: null,
          loading: false,
          readError: describeError(result.error),
        }));
        return;
      }
      const snapshot = result.value;
      setState((current) => {
        const reseed =
          !!snapshot.owner &&
          (resetDraft ||
            !current.seed ||
            (!current.conflict &&
              !current.saving &&
              equalDraft(current.draft, current.seed.draft)));
        const draft = draftFrom(snapshot.settings);
        return {
          ...current,
          snapshot,
          loading: false,
          readError: snapshot.owner ? null : '暂时无法读取语音偏好，请重新读取。',
          ...(reseed
            ? {
                seed: { revision: snapshot.revision, draft },
                draft,
                ...(resetDraft || !current.seed ? { conflict: false, failure: null } : {}),
                ...(resetDraft ? { notice: null } : {}),
              }
            : {}),
        };
      });
    } catch {
      if (alive.current && sequence === readSequence.current)
        setState((current) => ({
          ...current,
          snapshot: null,
          loading: false,
          readError: CALL_REJECTED,
        }));
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    const detach = window.petSpeechOutput?.onChanged(() => {
      void refresh();
    });
    void refresh();
    return () => {
      alive.current = false;
      readSequence.current++;
      detach?.();
    };
  }, [refresh]);
  const edit = useCallback((patch: Partial<SpeechOutputDraft>): void => {
    if (pending.current.has('save')) return;
    setState((current) =>
      current.draft
        ? {
            ...current,
            draft: { ...current.draft, ...patch },
            failure: null,
            notice: null,
          }
        : current,
    );
  }, []);
  const save = async (): Promise<void> => {
    const bridge = window.petSpeechOutput;
    if (
      !bridge ||
      !state.seed ||
      !state.draft ||
      !state.snapshot?.owner ||
      state.loading ||
      state.conflict ||
      state.readError ||
      pending.current.has('save')
    )
      return;
    const request: SpeechOutputSaveSettings = {
      ...state.draft,
      voice: state.draft.voice.trim() || null,
      expectedRevision: state.seed.revision,
    };
    if (!isSpeechOutputSaveSettings(request)) {
      setState((current) => ({ ...current, failure: '请检查语音名称、语速和音量。' }));
      return;
    }
    pending.current.add('save');
    setState((current) => ({ ...current, saving: true, failure: null, notice: null }));
    try {
      const result = await bridge.saveSettings(request);
      if (!alive.current) return;
      if (result.ok) {
        readSequence.current++;
        if (!result.value.owner) {
          setState((current) => ({
            ...current,
            snapshot: result.value,
            loading: false,
            readError: '语音设置已保存，请重新读取当前状态。',
          }));
          return;
        }
        const draft = draftFrom(result.value.settings);
        setState((current) => ({
          ...current,
          snapshot: result.value,
          draft,
          seed: { revision: result.value.revision, draft },
          loading: false,
          readError: null,
          conflict: false,
          failure: null,
          notice: '已保存语音设置。',
        }));
      } else
        setState((current) => ({
          ...current,
          conflict: result.error.code === 'conflict',
          failure: result.error.code === 'conflict' ? null : describeError(result.error),
        }));
    } catch {
      if (alive.current) setState((current) => ({ ...current, failure: CALL_REJECTED }));
    } finally {
      pending.current.delete('save');
      if (alive.current) setState((current) => ({ ...current, saving: false }));
    }
  };
  const audition = async (text: string): Promise<void> => {
    const bridge = window.petSpeechOutput;
    if (
      !bridge ||
      pending.current.has('audition') ||
      pending.current.has('save') ||
      state.readError ||
      state.conflict ||
      !state.seed ||
      !state.draft ||
      !state.snapshot?.settings.enabled ||
      !equalDraft(state.draft, state.seed.draft) ||
      !text.trim()
    )
      return;
    pending.current.add('audition');
    setState((current) => ({ ...current, auditioning: true, failure: null, notice: null }));
    try {
      const result = await bridge.speak({
        text: text.trim(),
        utteranceId: 'speech-audition-' + crypto.randomUUID(),
      });
      if (!alive.current) return;
      setState((current) => ({
        ...current,
        failure: result.ok ? null : describeError(result.error),
        notice: result.ok ? '试听已提交，将从桌宠窗口播放。' : null,
      }));
      void refresh();
    } catch {
      if (alive.current) setState((current) => ({ ...current, failure: CALL_REJECTED }));
    } finally {
      pending.current.delete('audition');
      if (alive.current) setState((current) => ({ ...current, auditioning: false }));
    }
  };
  const stop = async (): Promise<void> => {
    const bridge = window.petSpeechOutput;
    if (!bridge || pending.current.has('stop')) return;
    pending.current.add('stop');
    setState((current) => ({ ...current, stopping: true, failure: null, notice: null }));
    try {
      const result = await bridge.stop();
      if (!alive.current) return;
      if (result.ok) {
        readSequence.current++;
        setState((current) => ({
          ...current,
          snapshot: result.value,
          loading: false,
          readError: result.value.owner ? null : '暂时无法读取语音偏好，请重新读取。',
          notice: '已停止播放并清空语音队列。',
        }));
      } else setState((current) => ({ ...current, failure: describeError(result.error) }));
    } catch {
      if (alive.current) setState((current) => ({ ...current, failure: CALL_REJECTED }));
    } finally {
      pending.current.delete('stop');
      if (alive.current) setState((current) => ({ ...current, stopping: false }));
    }
  };
  return {
    ...state,
    available,
    dirty: !!state.seed && !equalDraft(state.draft, state.seed.draft),
    edit,
    save,
    audition,
    stop,
    reload: (): void => {
      void refresh(true);
    },
  };
}
