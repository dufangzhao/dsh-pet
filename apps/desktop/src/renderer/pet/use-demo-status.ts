import {
  errorMessage,
  type DemoBridge,
  type DemoRecordingAction,
  type DemoSnapshot,
} from '@pet/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

import { PET_COPY } from './copy.js';
import {
  demoBubbleEvent,
  describeDemo,
  type DemoStatus,
  type PetBubbleEvent,
} from './demo-status.js';

export function isDemoBridge(value: unknown): value is DemoBridge {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['version'] === 1 &&
    ['getSnapshot', 'onChanged', 'cancel', 'sendText', 'requestRecording'].every(
      (name) => typeof candidate[name] === 'function',
    )
  );
}

export function readDemoBridge(target: unknown = globalThis): DemoBridge | null {
  if (typeof target !== 'object' || target === null) return null;
  const candidate = (target as { petDemo?: unknown }).petDemo;
  return isDemoBridge(candidate) ? candidate : null;
}

export interface PetDemoView extends DemoStatus {
  available: boolean;
  snapshot: DemoSnapshot | null;
  event: PetBubbleEvent | null;
  notice: string | null;
  stopping: boolean;
  sending: boolean;
  recordingPending: boolean;
  recording: boolean;
  canRecord: boolean;
  stop(): void;
  requestRecording(action: DemoRecordingAction): Promise<void>;
  send(text: string): Promise<boolean>;
}

/** The pet requests capture from the existing console owner; it never opens a device. */
export function useDemoStatus(): PetDemoView {
  const bridgeRef = useRef(readDemoBridge());
  const latest = useRef<DemoSnapshot | null>(null);
  const [snapshot, setSnapshot] = useState<DemoSnapshot | null>(null);
  const [event, setEvent] = useState<PetBubbleEvent | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [sending, setSending] = useState(false);
  const [recordingPending, setRecordingPending] = useState(false);
  const mounted = useRef(false);
  const readSeq = useRef(0);
  const sendBusy = useRef(false);
  const recordBusy = useRef(false);
  const stopBusy = useRef(false);

  const accept = useCallback((next: DemoSnapshot): void => {
    const incoming = demoBubbleEvent(latest.current, next);
    latest.current = next;
    setSnapshot(next);
    setEvent((current) => incoming ?? (current?.kind === 'reply' ? current : null));
  }, []);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    const bridge = bridgeRef.current;
    const read = (): void => {
      if (!bridge) return;
      const seq = ++readSeq.current;
      void bridge
        .getSnapshot()
        .then((reply) => {
          if (!active || seq !== readSeq.current) return;
          if (reply.ok) {
            accept(reply.value);
            setNotice(null);
          } else setNotice(PET_COPY.readFailed + errorMessage(reply.error));
        })
        .catch(() => {
          if (active && seq === readSeq.current) setNotice(PET_COPY.readFailed);
        });
    };
    const detach = bridge?.onChanged(read);
    read();
    return () => {
      active = false;
      mounted.current = false;
      detach?.();
    };
  }, [accept]);

  const requestRecording = useCallback(async (action: DemoRecordingAction): Promise<void> => {
    const bridge = bridgeRef.current;
    if (!bridge || recordBusy.current) return;
    recordBusy.current = true;
    setRecordingPending(true);
    setNotice(null);
    try {
      const reply = await bridge.requestRecording({ action });
      if (mounted.current && !reply.ok) setNotice('语音请求未完成：' + errorMessage(reply.error));
    } catch {
      if (mounted.current) setNotice('语音请求未完成，请重试。');
    } finally {
      recordBusy.current = false;
      if (mounted.current) setRecordingPending(false);
    }
  }, []);

  const stop = useCallback((): void => {
    const bridge = bridgeRef.current;
    if (!bridge || stopBusy.current) return;
    if (latest.current?.phase === 'recording' || latest.current?.phase === 'arming') {
      void requestRecording('cancel');
      return;
    }
    stopBusy.current = true;
    setStopping(true);
    setNotice(null);
    void bridge
      .cancel()
      .then((reply) => {
        if (!mounted.current) return;
        if (reply.ok) {
          ++readSeq.current;
          accept(reply.value);
        } else setNotice(PET_COPY.stopFailed + errorMessage(reply.error));
      })
      .catch(() => {
        if (mounted.current) setNotice(PET_COPY.stopFailed);
      })
      .finally(() => {
        stopBusy.current = false;
        if (mounted.current) setStopping(false);
      });
  }, [accept, requestRecording]);

  const send = useCallback(async (text: string): Promise<boolean> => {
    const bridge = bridgeRef.current;
    if (!bridge || sendBusy.current || text.trim() === '') return false;
    sendBusy.current = true;
    setSending(true);
    setNotice(null);
    try {
      const reply = await bridge.sendText({ text: text.trim() });
      if (!mounted.current) return false;
      if (!reply.ok) setNotice(PET_COPY.sendFailed + errorMessage(reply.error));
      return reply.ok;
    } catch {
      if (mounted.current) setNotice(PET_COPY.sendFailed + PET_COPY.app.unknownFailure);
      return false;
    } finally {
      sendBusy.current = false;
      if (mounted.current) setSending(false);
    }
  }, []);

  return {
    ...describeDemo(snapshot),
    available: bridgeRef.current !== null,
    snapshot,
    event,
    notice,
    stopping,
    sending,
    recordingPending,
    recording: snapshot?.phase === 'recording' || snapshot?.phase === 'arming',
    canRecord: snapshot?.canRecord ?? false,
    stop,
    requestRecording,
    send,
  };
}
