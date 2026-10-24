/**
 * 桌宠原型的中文文案集中处：以后加语言只需替换这一份。
 * 所有文字都明确标注 M0 模拟，避免被误认为已实现录音、识别或对话。
 */
import type { PetState } from '@pet/contracts';

export const PET_COPY = {
  title: '桌宠 · M0 窗口原型',
  simulationNotice: 'M0 模拟原型：状态由按钮切换，不录音、不联网、不调用模型。',
  stageLabel: '桌宠角色舞台',
  avatarLabel: '桌宠角色（按住可拖动）',
  panelTitle: 'M0 状态模拟',
  panelHint: '拖拽角色移动窗口；空白处鼠标穿透到下层窗口；显示时不抢焦点。',
  previewGroupLabel: '状态模拟按钮',
  quitLabel: '退出桌宠',
  quitHint: '只有你点这个按钮才会退出，不会因为失焦或拖拽而关闭。',
  bridgeMissing: '未检测到主进程桥（window.pet），此页面需要在 Electron 桌宠窗口中打开。',
  bridgeError: '与主进程通信失败，界面仍可查看，但状态不会同步。',
  quitFailed: '退出请求没有成功，窗口仍然打开。可以再点一次，或用系统方式关闭。',
  stateLabels: {
    idle: '待机',
    listening: '倾听',
    thinking: '思考',
    replying: '回答',
    error: '出错',
  },
  stateBubbles: {
    idle: '我在这里，随时可以开始。',
    listening: '（模拟）正在听你说话……',
    thinking: '（模拟）正在组织回答……',
    replying: '（模拟）这是一段回答文字，用来检查气泡的换行与长度。',
    error: '（模拟）这一步出错了，可以先重试或查看设置。',
  },
  stateHints: {
    idle: '静止呼吸动画，最低存在感。',
    listening: '耳朵与光环更亮，表示正在收音（模拟）。',
    thinking: '头顶三点循环，表示在处理（模拟）。',
    replying: '嘴部开合与轻浮动，表示正在说（模拟）。',
    error: '整体偏红并轻微抖动，表示需要处理（模拟）。',
  },
} as const;

export const PET_STATE_ORDER: readonly PetState[] = [
  'idle',
  'listening',
  'thinking',
  'replying',
  'error',
];

export function stateLabel(state: PetState): string {
  return PET_COPY.stateLabels[state];
}

export function stateTestId(state: PetState): string {
  return `state-${state}`;
}
