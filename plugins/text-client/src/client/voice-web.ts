/**
 * Web 的语音会话：同源 HTTP，浏览器自己持有这一小段音频。
 *
 * web 没有 Main，也没有第二个进程替它保存片段：所以帧在这里按票据上限攒成一段
 * f32le，结束时一次上传。桌面走 Main，不经过这个文件。
 *
 * 每个请求都带发起时捕获的目标；`CompanionClient` 在派发前后各校验一次，
 * 换连接后的旧结果只会变成 skipped，不会落到新目标上。
 */
import {
  VOICE_MAX_PCM_BYTES,
  makeError,
  type Result,
  type VoiceBegin,
  type VoiceCaptureResult,
  type VoiceSubmitTarget,
  type VoiceTicket,
  type VoiceView,
} from '@pet/contracts';

import type { CompanionClient } from './client.js';
import type { VoiceSubmitOutcome, VoiceTransport } from './voice-transport.js';

export function createWebVoiceTransport(
  client: CompanionClient,
  target: VoiceSubmitTarget,
): VoiceTransport {
  /** 这一次采集的音频；finish 之后就丢掉，不做任何持久化。 */
  let clip: Uint8Array[] = [];
  let bytes = 0;

  const reset = (): void => {
    clip = [];
    bytes = 0;
  };

  return {
    read: (): Promise<Result<VoiceView>> => client.readVoice(target),
    begin: (input): Promise<Result<VoiceTicket>> => {
      reset();
      const command: VoiceBegin = {
        ...input,
        clientId: target.clientId,
        agentId: target.agentId,
      };
      return client.beginVoiceCapture(command);
    },
    // 浏览器没有第二个进程要就绪：票据本身就是这次采集的授权。
    ready: async (): Promise<Result<null>> => ({ ok: true, value: null }),
    push: async (_ticket: VoiceTicket, frame: Uint8Array): Promise<Result<null>> => {
      if (bytes + frame.byteLength > VOICE_MAX_PCM_BYTES)
        return { ok: false, error: makeError('quota-exceeded', false) };
      clip.push(frame);
      bytes += frame.byteLength;
      return { ok: true, value: null };
    },
    finish: async (
      ticket: VoiceTicket,
      summary: { readonly frames: number; readonly samples: number },
    ): Promise<Result<VoiceCaptureResult>> => {
      const pcm = new Uint8Array(bytes);
      let offset = 0;
      for (const frame of clip) {
        pcm.set(frame, offset);
        offset += frame.byteLength;
      }
      reset();
      return client.uploadVoiceCapture(ticket, summary.samples, pcm);
    },
    // 浏览器自己就是设备 owner：释放已在采样器里结算完，这里没有第二个确认方。
    released: async (): Promise<Result<null>> => ({ ok: true, value: null }),
    cancel: async (ticket: VoiceTicket): Promise<void> => {
      reset();
      await client.cancelVoiceCapture({
        captureId: ticket.captureId,
        clientId: ticket.clientId,
        agentId: ticket.agentId,
        serviceEpoch: ticket.serviceEpoch,
      });
    },
    // 响应丢了只读同一个票据，不重传、不重录；transcribing 就是「还在转写」。
    recover: (ticket: VoiceTicket): Promise<Result<VoiceCaptureResult>> =>
      client.readVoiceCapture({
        captureId: ticket.captureId,
        clientId: ticket.clientId,
        agentId: ticket.agentId,
        serviceEpoch: ticket.serviceEpoch,
      }),
    submit: (commandId: string, text: string): Promise<VoiceSubmitOutcome> =>
      client.submitIntent({ commandId, text }, target),
  };
}
