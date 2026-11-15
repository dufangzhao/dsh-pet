/**
 * 语音输入的宿主接缝：web 走同源 HTTP，桌面走 Main 的固定桥。
 *
 * 两个宿主在契约上是同一件事——票据、就绪、逐帧确认、结束、取消、恢复——差别只在
 * 「帧和整段音频走哪条路」。所以这里只声明这条窄接口，两个适配器各自实现：
 *
 * - web：浏览器自己攒这一小段音频，结束时上传（`voice-web.ts`）；
 * - 桌面：帧经 `petVoice.pushAudio` 逐帧确认，结束时 Main 释放设备再上传它自己
 *   持有的片段（`renderer/console/voice-desktop.ts`）。渲染器不复制整段音频。
 *
 * 三条与 C9/C10 直接相关的规则写在这里，而不是散在组件里：
 * 1. `begin` 只带**渲染时捕获的选择**（revision/provider/binding/mode），不取最新；
 * 2. 结束与取消都要等设备**真的释放**再 ACK（`released`），否则 Main 会一直等；
 * 3. ASR 响应丢失是「结果未知」，用 `recover` 读同一个票据，**不重传、不重录**。
 */
import type {
  Result,
  VoiceBeginSelection,
  VoiceCaptureResult,
  VoiceTicket,
  VoiceView,
} from '@pet/contracts';

export type VoiceSubmitOutcome = 'accepted' | 'uncertain' | 'failed' | 'skipped';

/** begin 的输入就是共享契约里那份选择；不在这里另立一份 schema。 */
export type VoiceBeginInput = VoiceBeginSelection;

export interface VoiceTransport {
  /** 当前语音视图；读不到时返回失败，界面据此说清原因而不是猜。 */
  read(): Promise<Result<VoiceView>>;
  /** 固定一次采集的票据。调用前不碰设备。 */
  begin(input: VoiceBeginInput): Promise<Result<VoiceTicket>>;
  /** 设备已按票据采样率就绪；桌面在这里换 Main 的录音态，web 无事可做。 */
  ready(ticket: VoiceTicket, sampleRate: number): Promise<Result<null>>;
  /** 一帧 f32le 字节；返回即表示宿主真的收下了（桌面是 Main 的序号确认）。 */
  push(ticket: VoiceTicket, bytes: Uint8Array): Promise<Result<null>>;
  /** 设备与尾巴都已结算后提交整段音频；成功即拿到最终结果。 */
  finish(
    ticket: VoiceTicket,
    summary: { readonly frames: number; readonly samples: number },
  ): Promise<Result<VoiceCaptureResult>>;
  /**
   * 设备**真的**放开之后的确认。桌面上它结算 Main 的麦克风任务；web 上是空操作。
   * 正常结束、取消、换目标、卸载都要走到它。
   */
  released(ticket: VoiceTicket): Promise<Result<null>>;
  /** 取消这一次；不提交、不等待转写。 */
  cancel(ticket: VoiceTicket): Promise<void>;
  /**
   * ASR 响应丢失后的**一次**状态读取：同一个 capture/client/agent/epoch。
   * 它不会重新上传、不会重新录音，也不是消息回执的「未知」。
   */
  recover(ticket: VoiceTicket): Promise<Result<VoiceCaptureResult>>;
  /** 用冻结的 commandId 发一条普通消息；绝不改写别的草稿或队列。 */
  submit(commandId: string, text: string): Promise<VoiceSubmitOutcome>;
}
