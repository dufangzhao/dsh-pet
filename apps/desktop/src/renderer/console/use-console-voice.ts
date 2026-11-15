/**
 * 设置台的语音 owner：挂在外壳上，页面只拿视图。
 *
 * 为什么在 ConsoleApp 而不是对话页：换页不该打断录音。设备、intent 和逐帧确认
 * 都在这里；页面卸载只是不画了，采集还归这一个 owner。
 *
 * 两条硬约束：
 * - 会话按当前 connectionId 建，换连接就换会话，旧采集的结果不落到新目标上；
 * - 消息复用 `useCompanion.send` 的同一条连接栅栏：stale 就是零 HTTP 的「没发出去」，
 *   不是未知。
 */
import { useEffect, useMemo, useRef } from 'react';
import {
  createVoiceSampler,
  useVoiceInput,
  type VoiceController,
} from '@pet/text-client/voice-input-ui';
import workletUrl from '@pet/audio-capture/capture-worklet?worker&url';

import { createDesktopVoiceTransport, desktopVoiceAvailable } from './voice-desktop.js';
import type { CompanionView } from '../shared/use-companion.js';

export interface ConsoleVoice {
  readonly controller: VoiceController;
  /** 这台机器有没有那条固定桥；没有就是真实状态，不是未配置。 */
  readonly available: boolean;
  readonly connectionId: string | null;
}

/** 桌面的语音会话与 owner。桥缺失时 controller 仍可渲染（只说原因，不造连接）。 */
export function useConsoleVoice(
  companion: Pick<CompanionView, 'send'> & {
    state: Pick<NonNullable<CompanionView['state']>, 'connectionId' | 'phase'> | null;
  },
): ConsoleVoice {
  const connectionId = companion.state?.connectionId ?? null;
  const available = useMemo(() => desktopVoiceAvailable(), []);

  // 连接内保留同一个适配器；旧发送闭包只能被自身栅栏拒绝，不能借最新闭包改投新连接。
  const binding = useRef<{
    connectionId: string | null;
    transport: ReturnType<typeof createDesktopVoiceTransport>;
  } | null>(null);
  if (binding.current === null || binding.current.connectionId !== connectionId) {
    const send = companion.send;
    binding.current = {
      connectionId,
      transport:
        connectionId === null
          ? null
          : createDesktopVoiceTransport({ connectionId }, (commandId, text) =>
              send(commandId, text).then((result) =>
                result.outcome === 'accepted'
                  ? 'accepted'
                  : result.outcome === 'uncertain'
                    ? 'uncertain'
                    : result.outcome === 'stale'
                      ? 'skipped'
                      : 'failed',
              ),
            ),
    };
  }
  const transport = binding.current.transport;

  const sampler = useMemo(() => createVoiceSampler(), []);
  const controller = useVoiceInput({
    transport,
    sampler,
    workletUrl,
    live: companion.state?.phase === 'live' && available,
    targetKey: connectionId ?? 'none',
  });

  const controllerRef = useRef(controller);
  controllerRef.current = controller;
  useEffect(() => {
    const bridge = window.petVoice;
    if (!available || connectionId === null || bridge === undefined) return;
    let disposed = false;
    let read = 0;
    let cancelledCaptureId: string | null = null;
    const refresh = (): void => {
      const request = ++read;
      void bridge.getState().then(
        (result) => {
          if (disposed || request !== read || !result.ok) return;
          const value = result.value;
          const current = controllerRef.current;
          if (
            value.phase === 'retiring' &&
            value.connectionId === connectionId &&
            value.captureId !== null &&
            value.captureId === current.state.intent?.captureId &&
            ['arming', 'recording', 'finishing', 'transcribing'].includes(current.state.phase) &&
            value.captureId !== cancelledCaptureId
          ) {
            cancelledCaptureId = value.captureId;
            current.cancel();
          }
        },
        () => undefined,
      );
    };
    const unsubscribe = bridge.onChanged(refresh);
    refresh();
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [available, connectionId]);

  return { controller, available, connectionId };
}
