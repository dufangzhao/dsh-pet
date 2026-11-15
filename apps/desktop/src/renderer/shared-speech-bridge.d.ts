import type { DesktopSpeechBridge } from '@pet/contracts';
declare global {
  interface Window {
    /**
     * 共享语音输出桥（v1）。缺失就是这台机器还没有这条通道，界面据此显示真实不可用。
     * 旧的 `petSpeechOutput` 是另一份 v1 契约，不在这里强转。
     */
    readonly petSharedSpeech?: DesktopSpeechBridge;
  }
}
export {};
