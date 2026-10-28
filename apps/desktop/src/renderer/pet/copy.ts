/**
 * 桌宠窗口的中文文案集中处：以后加语言只需替换这一份。
 *
 * 只写宿主真的给得了的内容：没连上宿主就不说有状态，演示回复必须带着「脚本演示」，
 * 出错文案都说清是哪一次调用失败。开发阶段的模拟/预览说明不属于产品界面，已移除。
 */
import type { PetState } from '@pet/contracts';

export const PET_COPY = {
  /** 角色名来自同一份 profile；没读到就不编名字，只说“桌宠角色”。 */
  avatarLabel(name: string | null): string {
    return name === null || name === '' ? '桌宠角色（按住可拖动）' : `桌宠 ${name}（按住可拖动）`;
  },
  menuLabel: '桌宠菜单',
  nameHint: '它现在的名字',
  settings: '设置',
  settingsOpening: '打开中…',
  settingsTitle: '打开设置台',
  settingsUnavailable: '设置入口不可用',
  settingsFailed: '设置窗口打开失败。',
  guide: '引导',
  guideBusy: '引导中…',
  guideTitle: '重播应用引导',
  guideUnavailable: '应用未连接，暂时不能重播引导',
  stop: '停止',
  stopping: '停止中…',
  stopTitle: '请求宿主停止这一次；不会退出桌宠',
  stopFailed: '停止请求没有被宿主接受，可以再点一次。',
  quit: '退出桌宠',
  quitHint: '只有你点这个按钮才会退出，不会因为失焦或拖拽而关闭。',
  readFailed: '读取宿主状态失败，界面保留最近一次快照。',
  /** 演示脚本给出的回复必须带着这个标签，不能让人误以为是 AI 说的。 */
  replyTag: '脚本演示｜',
  errorPrefix: '出错：',
  /** 日常文字输入走宿主既有 sendText：不新建会话，也不本地回显。 */
  send: '发送',
  sending: '发送中…',
  sendPlaceholder: '对它说……',
  sendLabel: '要说的话',
  sendFailed: '这条消息没有发出去：',
  sendBlocked: '现在还不能发送，等它空下来再试。',
  bridgeMissing: '未检测到主进程桥（window.pet），此页面需要在 Electron 桌宠窗口中打开。',
  bridgeError: '与主进程通信失败，界面仍可查看，但状态不会同步。',
  quitFailed: '退出请求没有成功，窗口仍然打开。可以再点一次，或用系统方式关闭。',
  /**
   * 应用桥（window.petApplication）的文案。
   * 冒号结尾的几句后面接宿主给出的固定错误名，说清是哪一次调用失败。
   */
  app: {
    readFailed: '读取应用状态失败：',
    answerFailed: '这一步没有生效：',
    guideFailed: '引导没有开始：',
    interactFailed: '这次触碰没有被记录：',
    snapshotError: '宿主报告的问题：',
    unknownFailure: '调用没有被宿主完成。',
    reload: '重新读取',
    reloading: '读取中…',
  },
  /** 可操作气泡：问题与选项都来自宿主的 ApplicationDialog，界面自己不加。 */
  dialog: {
    choicesLabel: '可选操作',
    busy: '正在处理这一步……',
    secretHint: '输入内容不会显示在屏幕上。',
    noChoice: '这条提示没有可选项，无法在这里完成，请在设置里继续。',
  },
  /** 气泡的兜底一行：状态来自宿主快照，这里只是把它说成人话。 */
  stateBubbles: {
    idle: '待命，等你开始。',
    listening: '正在听你说话……',
    thinking: '正在处理，稍等。',
    replying: '正在回答。',
    error: '这一步出错了。',
  },
} as const;

export function stateBubble(state: PetState): string {
  return PET_COPY.stateBubbles[state];
}
