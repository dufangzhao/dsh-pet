/**
 * 设置台里的桌宠预览：角色、气泡、说话与录音入口、日夜、菜单、拖动都在这一块场景里。
 *
 * 画的是 pet/PetAvatar.tsx 那个组件本身；场景照桌面那一只的样子：墙上点阵，底下一条地面，
 * 角色站在地面上。名字、形态、配色、大小不在这里再念一遍——那些值就在装扮页的行上。
 *
 * 所有对外部世界的动作都从 props 进来：戳与拖动写宿主那条统一记录，说话走既有的那一条
 * demo 会话，录音用全场唯一的录音所有者。预览不新开一份历史、不自己抢麦克风，
 * 也不改控制台的主题挡位——这里的「夜」只是这块场景的灯。
 */
import {
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import type { ApplicationPreferences, ApplicationSnapshot, PetState } from '@pet/contracts';

import { PetAvatar } from '../pet/PetAvatar.js';
import { PetComposer } from '../pet/PetComposer.js';
import { ActivityIcon, MessageIcon } from './icons.js';
import {
  clampDragOffset,
  focusStillInside,
  micButtonHint,
  micButtonLabel,
  sceneHoldsFocus,
  useOutsideDismiss,
  usePokeableAvatar,
  type InteractionWriter,
  type PetPreviewComposer,
  type PetPreviewMic,
} from './preview-behavior.js';
import './pet-preview.css';

/**
 * 四个配色就是「配色」这项设置本身，取值与桌宠窗口 pet.css 逐格一致：
 * 预览的外壳、装扮页的小色块都读这一张表，不在别处再写一遍。
 */
export const PET_PALETTES: Readonly<
  Record<
    ApplicationPreferences['palette'],
    { top: string; bottom: string; face: string; halo: string }
  >
> = {
  morning: { top: '#eef4ff', bottom: '#b9cdf2', face: '#f9fcff', halo: '#7fa8ff' },
  lavender: { top: '#f3efff', bottom: '#c8baf0', face: '#faf7ff', halo: '#a48fe6' },
  pine: { top: '#e2f1e9', bottom: '#9cc3b0', face: '#f4fbf7', halo: '#5f9d81' },
  orange: { top: '#fff1e2', bottom: '#f4c49a', face: '#fff8f1', halo: '#e8944f' },
};

/** 代理只报它在不在跑；角色状态说它此刻在做什么，没报过的动作不替它编。 */
const AGENT_TO_PET: Readonly<Record<ApplicationSnapshot['agent']['state'], PetState>> = {
  starting: 'thinking',
  ready: 'idle',
  stopped: 'idle',
  error: 'error',
};

/**
 * 互动种类、说话与录音入口的形状住在 preview-behavior.ts——旧预览与 original-ui 的原创预览
 * 共用那一份行为，这里只接着导出名字，不给同一件事起第二个名。
 */
export type { PreviewInteraction, PetPreviewComposer, PetPreviewMic } from './preview-behavior.js';

export interface PetPreviewProps {
  /** 界面上正在显示的偏好值（含还没保存的草稿）：编辑什么就预览什么。 */
  values: ApplicationPreferences | null;
  /** 代理的真实状态；用来定角色状态与读屏名称。 */
  agent: ApplicationSnapshot['agent'] | null;
  /** 宿主报出的录音/回复阶段对应的角色状态；比代理状态更具体，优先用它。 */
  state?: PetState | null;
  /** 宿主此刻真的要说的那句话；没有就不画气泡。 */
  bubble?: string | null;
  /** 宿主那条互动记录的写入者；给定了角色才可以被戳，挪完才可以记一次拖动。 */
  interact?: InteractionWriter | undefined;
  composer?: PetPreviewComposer | undefined;
  mic?: PetPreviewMic | undefined;
  /** 「语音输入」那一页的入口：菜单里那条设置项要的跳转。 */
  onOpenVoiceSettings?: (() => void) | undefined;
  /** 「装扮」那一页的入口。 */
  onOpenDress?: (() => void) | undefined;
}

/**
 * 焦点离开这块场景才收起输入框；正在等宿主回执时不收——
 * 收了刚点下去的那一句就发不出去，也不会报错，只剩一个转圈的界面。
 */
export function shouldCloseChat(focusRemaining: boolean, sending: boolean): boolean {
  return !focusRemaining && !sending;
}

/** 挪过位置与戳一下是同一次按下开始的：只有超过阈值的位移算拖动，不重复记一条。 */
export const DRAG_THRESHOLD_PX = 6;

export function pointerWasDrag(movedDistance: number): boolean {
  return movedDistance > DRAG_THRESHOLD_PX;
}

export function PetPreview({
  values,
  agent,
  state = null,
  bubble = null,
  interact,
  composer,
  mic,
  onOpenVoiceSettings,
  onOpenDress,
}: PetPreviewProps): JSX.Element {
  const figure = values?.figure ?? 'minimal';
  const palette = values?.palette ?? 'morning';
  const size = values?.size ?? 'normal';
  const draggable = values?.draggable ?? true;
  const colors = PET_PALETTES[palette];
  const petState: PetState = state ?? AGENT_TO_PET[agent?.state ?? 'stopped'];
  const { expression, sceneRef, poke } = usePokeableAvatar(interact);
  const [chatting, setChatting] = useState(false);
  /** 这块场景的灯：只改预览的明暗，不写挡位，也不影响控制台与桌面。 */
  const [night, setNight] = useState(false);
  const [menu, setMenu] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ id: number; startX: number; startY: number; moved: number } | null>(
    null,
  );

  // 菜单是就地浮层：Escape 或这一点之外的按下都该关掉它。
  useOutsideDismiss(menu, sceneRef, () => setMenu(false));

  /** 这一次按下是否已由指针路径处理过：处理过就不让 click 再补一发。 */
  const pointerHandled = useRef(false);

  /*
   * 收不收输入框只看一件事：焦点还在不在这一块里。
   *
   * blur 触发时浏览器还没把焦点交给下一个元素，读 document.activeElement 只会短暂拿到 body——
   * 那样输入框在「点发送」的路上就被拆掉，宿主根本收不到这句话（首轮 native 实测就是这个）。
   * 所以 blur 只信事件带过来的 relatedTarget；pointerleave 时焦点已经落定，才用真的 contains。
   */

  const blurScene = (event: FocusEvent<HTMLDivElement>): void => {
    const node = sceneRef.current;
    if (node === null || composer === undefined) {
      return;
    }
    if (shouldCloseChat(focusStillInside(node, event.relatedTarget), composer.sending)) {
      setChatting(false);
    }
  };

  const leaveScene = (): void => {
    if (composer === undefined) {
      return;
    }
    if (shouldCloseChat(sceneHoldsFocus(sceneRef), composer.sending)) {
      setChatting(false);
    }
  };

  /*
   * 拖动只在这块场景里挪：预览是设置台里的一格，不是桌面窗口，所以位移夹在格子内，
   * 并遵守「可拖动」这项偏好。挪完记一次 drag，同一次按下不再补一发 poke。
   */
  const dragStart = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    // 每一次按下重新起算：上一次指针处理过不等于这一次也不用管。
    pointerHandled.current = false;
    if (!draggable || interact === undefined) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: 0,
    };
  };

  const dragMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current;
    const scene = sceneRef.current;
    if (drag === null || scene === null || drag.id !== event.pointerId) {
      return;
    }
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    drag.moved = Math.hypot(dx, dy);
    if (!pointerWasDrag(drag.moved)) {
      return;
    }
    // 挪过位置只在这块格子里：预览不是桌面窗口，位移夹在场景内。
    setOffset(clampDragOffset(dx, dy, scene.getBoundingClientRect().width));
  };

  const dragEnd = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag === null || drag.id !== event.pointerId) {
      return;
    }
    pointerHandled.current = true;
    if (pointerWasDrag(drag.moved)) {
      void interact?.('drag');
      return;
    }
    void poke();
  };

  /*
   * 键盘的 Enter/Space 只发 click（且没有指针路径），"不可拖动"时指针那条路也不成立：
   * 这两种情况都交给 click 戳一下。真的拖过或点过一次的那一下由 pointerup 记过，
   * 这里认那个标记、不重复记第二条。
   */
  const clickAvatar = (): void => {
    if (pointerHandled.current) {
      pointerHandled.current = false;
      return;
    }
    void poke();
  };

  const micLabel = mic === undefined ? '' : micButtonLabel(mic);
  const micHint = mic === undefined ? '' : micButtonHint(mic);

  const avatar = (
    <PetAvatar
      state={petState}
      expression={expression}
      figure={figure}
      name={values?.petName ?? null}
    />
  );

  return (
    <section
      className="pet-preview"
      aria-label="桌宠预览"
      data-size={size}
      data-figure={figure}
      data-light={night ? 'night' : 'day'}
      style={
        {
          '--pet-body-top': colors.top,
          '--pet-body-bottom': colors.bottom,
          '--pet-face': colors.face,
          '--pet-halo': colors.halo,
        } as CSSProperties
      }
    >
      <div
        className="pet-preview__scene"
        ref={sceneRef}
        onPointerLeave={leaveScene}
        onBlur={blurScene}
        onContextMenu={(event) => {
          event.preventDefault();
          // 再按一次右键就是收起来，不用先点关闭。
          setMenu((open) => !open);
        }}
      >
        <div className="pet-preview__wall">
          {bubble === null || bubble === '' ? null : (
            <p className="pet-preview__bubble">{bubble}</p>
          )}
          {interact === undefined ? (
            <div className="pet-preview__holder">{avatar}</div>
          ) : (
            // 同一次按下：没挪位置就是戳一下，挪过就只记一次拖动。
            <button
              type="button"
              className="pet-preview__poke"
              aria-label="戳它一下"
              title={
                draggable
                  ? '点一下戳它；按住可以在这格子里挪动它'
                  : '点一下戳它（桌宠当前不可拖动）'
              }
              data-testid="pet-poke"
              style={{ transform: 'translate(' + offset.x + 'px, ' + offset.y + 'px)' }}
              onPointerDown={dragStart}
              onPointerMove={dragMove}
              onPointerUp={dragEnd}
              onClick={clickAvatar}
              onPointerCancel={() => {
                dragRef.current = null;
              }}
              onKeyDown={(event) => {
                // 键盘也要够得到这个菜单：上下文键或 Shift+F10。
                if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                  event.preventDefault();
                  setMenu(true);
                }
              }}
            >
              {avatar}
            </button>
          )}

          {composer === undefined && mic === undefined ? null : (
            <div className="pet-preview__tools">
              {composer === undefined ? null : (
                <button
                  type="button"
                  className={chatting ? 'pet-preview__tool is-on' : 'pet-preview__tool'}
                  aria-pressed={chatting}
                  aria-expanded={chatting}
                  title="对它说一句"
                  data-testid="pet-chat-toggle"
                  onClick={() => setChatting((open) => !open)}
                >
                  <MessageIcon className="pet-preview__tool-icon" />
                  <span className="pet-preview__tool-text">说一句</span>
                </button>
              )}
              {mic === undefined ? null : (
                <button
                  type="button"
                  className={mic.recording ? 'pet-preview__tool is-on' : 'pet-preview__tool'}
                  disabled={!mic.canRecord && !mic.recording}
                  title={micHint}
                  data-testid="pet-mic-toggle"
                  onClick={() => {
                    if (mic.recording) {
                      mic.end();
                      return;
                    }
                    mic.start();
                  }}
                >
                  <ActivityIcon className="pet-preview__tool-icon" />
                  <span className="pet-preview__tool-text">{micLabel}</span>
                </button>
              )}
              {mic === undefined || !mic.recording ? null : (
                <button
                  type="button"
                  className="pet-preview__tool"
                  title="这一次不发送，直接丢掉"
                  data-testid="pet-mic-cancel"
                  onClick={mic.cancel}
                >
                  取消
                </button>
              )}
              <button
                type="button"
                className="pet-preview__tool"
                aria-pressed={night}
                title="切换预览日夜"
                data-testid="pet-light-toggle"
                onClick={() => setNight((now) => !now)}
              >
                <span className="pet-preview__tool-glyph" aria-hidden="true">
                  {night ? '◐' : '☀'}
                </span>
                <span className="pet-preview__tool-text">{night ? '预览黑夜' : '预览白天'}</span>
              </button>
            </div>
          )}

          {composer === undefined || !chatting ? null : (
            <PetComposer
              canSend={composer.canSend}
              sending={composer.sending}
              onSend={composer.onSend}
            />
          )}
        </div>
        {/* 地面是角色站的那一条，画在角色下面而不是盖上去。 */}
        <div className="pet-preview__floor" />

        {menu ? (
          <div className="pet-preview__menu" role="menu" aria-label="桌宠预览菜单">
            <button
              type="button"
              role="menuitem"
              disabled={composer === undefined}
              data-testid="pet-menu-chat"
              onClick={() => {
                setMenu(false);
                setChatting(true);
              }}
            >
              对它说一句
            </button>
            {mic === undefined ? null : (
              <button
                type="button"
                role="menuitem"
                disabled={!mic.canRecord && !mic.recording}
                data-testid="pet-menu-mic"
                onClick={() => {
                  setMenu(false);
                  if (mic.recording) {
                    mic.end();
                  } else {
                    mic.start();
                  }
                }}
              >
                {mic.recording ? '结束录音' : '用录音说一句'}
              </button>
            )}
            {onOpenVoiceSettings === undefined ? null : (
              <button
                type="button"
                role="menuitem"
                data-testid="pet-menu-voice"
                onClick={() => {
                  setMenu(false);
                  onOpenVoiceSettings();
                }}
              >
                语音设置
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              data-testid="pet-menu-light"
              onClick={() => {
                setMenu(false);
                setNight((now) => !now);
              }}
            >
              {night ? '预览改回白天' : '预览切成黑夜'}
            </button>
            {onOpenDress === undefined ? null : (
              <button
                type="button"
                role="menuitem"
                data-testid="pet-menu-dress"
                onClick={() => {
                  setMenu(false);
                  onOpenDress();
                }}
              >
                去装扮
              </button>
            )}
            <button
              type="button"
              className="pet-preview__menu-close"
              data-testid="pet-menu-close"
              onClick={() => setMenu(false)}
            >
              关闭
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
