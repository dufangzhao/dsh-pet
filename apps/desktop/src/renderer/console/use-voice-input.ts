import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ERROR_MESSAGES,
  type Result,
  type VoiceInputBridge,
  type VoiceInputSettings,
  type VoiceInputSnapshot,
} from '@pet/contracts';
export interface VoiceInputOutcome {
  readonly ok: boolean;
  readonly error: string | null;
}
export interface VoiceInputState {
  readonly available: boolean;
  readonly snapshot: VoiceInputSnapshot | null;
  readonly loading: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly microphones: readonly { id: string; label: string }[];
  readonly microphoneError: string | null;
  refresh(): void;
  refreshMicrophones(): Promise<void>;
  saveSettings(data: VoiceInputSettings, expectedRevision: number): Promise<VoiceInputOutcome>;
  saveApiKey(value: string): Promise<VoiceInputOutcome>;
  start(): Promise<VoiceInputOutcome>;
  stop(): Promise<VoiceInputOutcome>;
  installModel(modelId: string): Promise<VoiceInputOutcome>;
}
const bridge = (): VoiceInputBridge | undefined =>
  typeof window === 'undefined' ? undefined : window.petVoiceInput;
export function useVoiceInput(): VoiceInputState {
  const available = bridge() !== undefined;
  const [snapshot, setSnapshot] = useState<VoiceInputSnapshot | null>(null),
    [loading, setLoading] = useState(available),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [microphones, setMicrophones] = useState<readonly { id: string; label: string }[]>([]),
    [microphoneError, setMicrophoneError] = useState<string | null>(null);
  const alive = useRef(true),
    sequence = useRef(0),
    writing = useRef(0),
    microphoneSequence = useRef(0);
  const read = useCallback(async (visible: boolean) => {
    const current = bridge();
    if (!current) return;
    const issued = ++sequence.current;
    if (visible) setLoading(true);
    try {
      const result = await current.getSnapshot();
      if (!alive.current || sequence.current !== issued) return;
      if (result.ok) {
        setSnapshot(result.value);
        setError(null);
      } else {
        setSnapshot(null);
        setError(ERROR_MESSAGES[result.error.code]);
      }
    } catch {
      if (alive.current && sequence.current === issued) {
        setSnapshot(null);
        setError('无法读取语音输入设置');
      }
    } finally {
      if (alive.current && sequence.current === issued) setLoading(false);
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    void read(true);
    const off = bridge()?.onChanged(() => {
      void read(false);
    });
    return () => {
      alive.current = false;
      off?.();
    };
  }, [read]);
  const run = useCallback(
    async (
      operation: (api: VoiceInputBridge) => Promise<Result<VoiceInputSnapshot>>,
      interrupt = false,
    ): Promise<VoiceInputOutcome> => {
      const current = bridge();
      if (!current) return { ok: false, error: '语音输入服务不可用' };
      if (writing.current > 0 && !interrupt) return { ok: false, error: '上一个操作还没结束' };
      writing.current++;
      setBusy(true);
      try {
        const result = await operation(current);
        if (!result.ok) {
          const message = ERROR_MESSAGES[result.error.code];
          if (alive.current && result.error.code !== 'cancelled') setError(message);
          return { ok: false, error: message };
        }
        if (alive.current) {
          ++sequence.current;
          setSnapshot(result.value);
          setError(null);
          setLoading(false);
        }
        return { ok: true, error: null };
      } catch {
        const message = '操作结果未确认，请重新读取语音输入设置';
        if (alive.current) setError(message);
        return { ok: false, error: message };
      } finally {
        writing.current--;
        if (alive.current) setBusy(writing.current > 0);
      }
    },
    [],
  );
  const refreshMicrophones = useCallback(async () => {
    const issued = ++microphoneSequence.current;
    if (!navigator.mediaDevices?.enumerateDevices) {
      setMicrophoneError('当前环境无法枚举麦克风');
      return;
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (!alive.current || issued !== microphoneSequence.current) return;
      setMicrophones(
        devices
          .filter((device) => device.kind === 'audioinput' && device.deviceId.length > 0)
          .map((device, i) => ({
            id: device.deviceId,
            label: device.label || '麦克风 ' + (i + 1),
          })),
      );
      setMicrophoneError(null);
    } catch {
      if (alive.current && issued === microphoneSequence.current) {
        setMicrophones([]);
        setMicrophoneError('无法读取麦克风设备');
      }
    }
  }, []);
  useEffect(() => {
    void refreshMicrophones();
    navigator.mediaDevices?.addEventListener('devicechange', refreshMicrophones);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', refreshMicrophones);
  }, [refreshMicrophones]);
  return {
    available,
    snapshot,
    loading,
    busy,
    error,
    microphones,
    microphoneError,
    refresh: () => {
      void read(true);
    },
    refreshMicrophones,
    saveSettings: (data, expectedRevision) =>
      run((api) => api.saveSettings({ expectedRevision, data })),
    saveApiKey: (value) => run((api) => api.saveApiKey({ value })),
    start: () => run((api) => api.start()),
    stop: () => run((api) => api.stop(), true),
    installModel: (modelId) => run((api) => api.installModel({ modelId })),
  };
}
