/**
 * 设置台的语音会话：只经 `window.petVoice` 这条固定桥，不碰 IPC 细节。
 *
 * 桌面与 web 的真正区别在这里，也是 C9 的要害：
 * - 每一帧都要 Main **真的收下**才算数（`pushAudio` 带序号，返回即确认）；
 * - 设备真的放开之后才 ACK（`released` → `reportCaptureReleased`），再由 Main 上传
 *   它自己持有的片段（`finishCapture`）。渲染器不复制整段音频、不自己上传、也不
 *   把 PCM 塞进 control IPC。
 * - 取消先让 Main fence 这一次，但**不阻塞**等释放；释放由采样器结算后统一 ACK。
 *
 * 消息不在这里发：调用方传入它自己那条带换代栅栏的发送函数，语音与打字共用
 * 同一份回执语义。
 *
 * 桥不存在就是真实状态：这台机器没有这条通道，返回 null，界面照实说。
 */
import {
  makeError,
  type DesktopCompanionTarget,
  type DesktopVoiceBridge,
  type Result,
  type VoiceCaptureResult,
  type VoiceTicket,
} from '@pet/contracts';

import type { VoiceSubmitOutcome, VoiceTransport } from '@pet/text-client/voice-input-ui';

function readBridge(): DesktopVoiceBridge | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as { petVoice?: DesktopVoiceBridge }).petVoice;
  return typeof candidate === 'object' && candidate !== null && candidate.version === 1
    ? candidate
    : null;
}

const unavailable = <T>(): Result<T> => ({ ok: false, error: makeError('not-ready', false) });

export function desktopVoiceAvailable(): boolean {
  return readBridge() !== null;
}

export function createDesktopVoiceTransport(
  target: DesktopCompanionTarget,
  submit: (commandId: string, text: string) => Promise<VoiceSubmitOutcome>,
): VoiceTransport | null {
  const bridge = readBridge();
  if (bridge === null) return null;
  /** Main 按序号逐帧确认：这个计数属于这一次采集，开始时归零。 */
  let sequence = 0;

  const key = (captureId: string): DesktopCompanionTarget & { captureId: string } => ({
    connectionId: target.connectionId,
    captureId,
  });

  return {
    read: () => bridge.readVoice(target),
    begin: async (input) => {
      sequence = 0;
      // 身份由 Main 补：渲染器只给渲染时捕获的选择，不在这里编 clientId/agentId。
      const result = await bridge.begin({ connectionId: target.connectionId, ...input });
      if (!result.ok) return result;
      // 票据必须属于这次要的那一次，否则界面会拿别人的票据去开设备。
      if (
        result.value.captureId !== input.captureId ||
        result.value.finishMode !== input.finishMode
      )
        return unavailable<VoiceTicket>();
      return result;
    },
    ready: (ticket, sampleRate) =>
      sampleRate === 16000
        ? bridge.captureReady({ ...key(ticket.captureId), sampleRate: 16000 })
        : Promise.resolve({ ok: false, error: makeError('audio-format', false) }),
    push: async (ticket, bytes) => {
      const result = await bridge.pushAudio(
        { ...key(ticket.captureId), sequence },
        Uint8Array.from(bytes),
      );
      if (result.ok) sequence += 1;
      return result;
    },
    // 释放已经由调用方在采样器结算后 ACK 过；这里只让 Main 上传它持有的片段。
    finish: (ticket, summary): Promise<Result<VoiceCaptureResult>> =>
      bridge.finishCapture({ ...key(ticket.captureId), frames: summary.frames }),
    // cleanup-only：即使连接已经换代，这条确认也只结算那一次旧设备，没有服务 I/O。
    released: (ticket) => bridge.reportCaptureReleased(key(ticket.captureId)),
    cancel: async (ticket) => {
      await bridge.cancelCapture(key(ticket.captureId));
    },
    recover: (ticket) =>
      bridge.readCaptureResult({
        ...key(ticket.captureId),
        clientId: ticket.clientId,
        agentId: ticket.agentId,
        serviceEpoch: ticket.serviceEpoch,
      }),
    submit,
  };
}
