/**
 * 日常输入框与提示输入框共用的三条规则（纯函数，便于直接测）。
 *
 * 它们守的是同一件事：界面只在宿主真的接受了这一句之后，才让草稿消失；
 * 而回车是否等于“发送”，取决于它是不是在输入法选词。
 */

/** 能点发送：宿主说能发、没有在途、且不是空白。 */
export function canSubmitDraft(
  draft: string,
  state: { canSend: boolean; sending: boolean },
): boolean {
  return state.canSend && !state.sending && draft.trim() !== '';
}

/** 发送之后留下什么：宿主接受了才清空，失败原样保留，让用户能直接重试。 */
export function draftAfterSubmit(draft: string, accepted: boolean): string {
  return accepted ? '' : draft;
}

/**
 * 这个回车是不是“发送”。
 *
 * 输入法组词时的回车只是选词，提交它就等于把半句话发出去；
 * 组词阶段浏览器给的 keyCode 是 229，isComposing 也同时为真，两者都要认。
 */
export function isSubmitEnter(event: {
  key: string;
  isComposing?: boolean;
  keyCode?: number;
}): boolean {
  return event.key === 'Enter' && event.isComposing !== true && event.keyCode !== 229;
}
