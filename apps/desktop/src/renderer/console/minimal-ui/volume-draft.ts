/**
 * 本机音量草稿的状态机：外部更新不得抹掉用户没保存的输入。
 *
 * 这不是薄封装——它拥有真实的判定规则：
 * - 用户动过滑杆才有草稿；没动过就一直跟随已存值。
 * - 草稿绑定它读到的 revision；外部保存把 revision 推进后，草稿**保留**，
 *   并要求用户显式采用最新值才放弃。
 * - 保存用捕获的 revision 提交，绝不借最新 revision 覆盖别处的更新。
 */

export interface VolumeState {
  /** 用户动过滑杆才有值；null 表示"跟随已存值"。 */
  readonly editing: { readonly revision: number; readonly draft: number } | null;
}

export interface VolumeFacts {
  /** 现在显示的数值。 */
  readonly value: number;
  /** 有未保存改动。 */
  readonly dirty: boolean;
  /** 已存值被别处改过，而用户手上还有一份不同草稿。 */
  readonly externalChange: boolean;
  /** 保存时必须用的基线；没有草稿时为 null。 */
  readonly expectedRevision: number | null;
}

export const EMPTY_VOLUME: VolumeState = { editing: null };

export function volumeFacts(
  state: VolumeState,
  stored: number,
  revision: number | null,
): VolumeFacts {
  const value = state.editing?.draft ?? stored;
  const dirty = state.editing !== null && value !== stored;
  const externalChange =
    state.editing !== null && revision !== null && state.editing.revision !== revision && dirty;
  return {
    value,
    dirty,
    externalChange,
    expectedRevision: state.editing?.revision ?? null,
  };
}

/**
 * 用户移动滑杆。
 *
 * 基线只在**首次**编辑时捕获：继续拖动不能把基线换成最新 revision，
 * 否则外部已经存过一版之后，拖一下就把别人的更新悄悄覆盖了。
 * 换基线只有两条路：显式采用最新值，或这次保存成功。
 */
export function editVolume(
  state: VolumeState,
  revision: number | null,
  draft: number,
): VolumeState {
  return {
    editing: { revision: state.editing?.revision ?? revision ?? 0, draft },
  };
}

/** 保存成功：回到"跟随已存值"。 */
export function commitVolume(): VolumeState {
  return EMPTY_VOLUME;
}

/** 显式采用最新值：放弃草稿。 */
export function adoptVolume(): VolumeState {
  return EMPTY_VOLUME;
}
