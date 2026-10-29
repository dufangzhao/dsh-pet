/**
 * 原创桌宠预览：饲养台板面上一只真的角色，说话、录音、日夜、菜单、拖动都还是那些真动作。
 *
 * 这里画的是本产品的控件（original-ui/kit），不是旧 PetPreview 换 class：
 * 井格里的角色、台沿、右边竖排的插销板、下面的草稿抽屉与右侧菜单抽屉，都是这套自己的形状；
 * 没有旧的那面点阵墙、那条地面、那一排胶囊工具与折角浮层。
 *
 * 行为一律复用 preview-behavior.ts 与 pet-preview.tsx 导出的判定：同一次按下要么算戳、要么算拖动，
 * 表情只有真的画进一帧可见画面才回报，焦点离开时若在途就不收草稿。角色本体仍是 pet/PetAvatar，
 * 说话走宿主既有的那一条 demo 会话，录音仍是全场唯一那位所有者——这里不开第二条，不抢麦克风，
 * 也不写历史，不碰 getUserMedia。
 */
import {
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import type { ApplicationSnapshot, PetState } from '@pet/contracts';

import { PetAvatar } from '../../pet/PetAvatar.js';
import { canSubmitDraft, draftAfterSubmit, isSubmitEnter } from '../../pet/compose-rules.js';
import { PET_COPY } from '../../pet/copy.js';
import {
  PET_PALETTES,
  pointerWasDrag,
  shouldCloseChat,
  type PetPreviewProps,
} from '../pet-preview.js';
import {
  clampDragOffset,
  focusStillInside,
  micButtonHint,
  micButtonLabel,
  sceneHoldsFocus,
  useOutsideDismiss,
  usePokeableAvatar,
} from '../preview-behavior.js';
import { Button, Field, Toggle } from './kit.js';

import './pet-preview.css';

/** 「说一句」那行下面的一句补充：回车与主操作是同一件事的两个入口。 */
const CHAT_HINT = '写完这句按回车，或点右边那颗主操作。';

export type OriginalPetPreviewProps = PetPreviewProps;

/**
 * 预览这一块：props 与旧 PetPreview 一字不差（同一批业务状态与动作），
 * 所以版式换控件不需要换接线；区域名称「桌宠预览」也照旧。
 */
export function OriginalPetPreview({
  values,
  agent,
  state = null,
  bubble = null,
  interact,
  composer,
  mic,
  onOpenVoiceSettings,
  onOpenDress,
}: OriginalPetPreviewProps): JSX.Element {
  const figure = values?.figure ?? 'minimal';
  const palette = values?.palette ?? 'morning';
  const size = values?.size ?? 'normal';
  const draggable = values?.draggable ?? true;
  const colors = PET_PALETTES[palette];
  const petState: PetState = state ?? AGENT_TO_PET[agent?.state ?? 'stopped'];

  const { expression, sceneRef, poke } = usePokeableAvatar(interact);
  const [chatting, setChatting] = useState(false);
  /** 草稿存在这一块里：收起「说一句」再打开，刚打的字还在。 */
  const [text, setText] = useState('');
  /** 这块场景的灯：只改预览的明暗，不写挡位，也不影响控制台与桌面。 */
  const [night, setNight] = useState(false);
  const [menu, setMenu] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ id: number; startX: number; startY: number; moved: number } | null>(
    null,
  );
  /** 这一次按下是否已由指针路径处理过：处理过就不让 click 再补一发。 */
  const pointerHandled = useRef(false);

  useOutsideDismiss(menu, sceneRef, () => setMenu(false));

  /*
   * 焦点离开这块场景才收起输入框；正在等宿主回执时不收——
   * 收了刚点下去的那一句就发不出去，也不会报错，只剩一个转圈的界面。
   */
  const blurScene = (event: FocusEvent<HTMLDivElement>): void => {
    const node = sceneRef.current;
    if (node === null || composer === undefined) return;
    if (shouldCloseChat(focusStillInside(node, event.relatedTarget), composer.sending)) {
      setChatting(false);
    }
  };

  const leaveScene = (): void => {
    if (composer === undefined) return;
    if (shouldCloseChat(sceneHoldsFocus(sceneRef), composer.sending)) setChatting(false);
  };

  /* 拖动只在这块格子里挪：挪完记一次 drag，同一次按下不再补一发 poke。 */
  const dragStart = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    pointerHandled.current = false;
    if (!draggable || interact === undefined) return;
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
    if (drag === null || scene === null || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    drag.moved = Math.hypot(dx, dy);
    if (!pointerWasDrag(drag.moved)) return;
    setOffset(clampDragOffset(dx, dy, scene.getBoundingClientRect().width));
  };

  const dragEnd = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag === null || drag.id !== event.pointerId) return;
    pointerHandled.current = true;
    if (pointerWasDrag(drag.moved)) {
      void interact?.('drag');
      return;
    }
    poke();
  };

  /*
   * 键盘的 Enter/Space 只发 click（且没有指针路径），「不可拖动」时指针那条路也不成立：
   * 这两种情况都交给 click 戳一下。真拖过或点过一次的那一下由 pointerup 记过，不重复记第二条。
   */
  const clickAvatar = (): void => {
    if (pointerHandled.current) {
      pointerHandled.current = false;
      return;
    }
    poke();
  };

  const canSubmit = composer === undefined ? false : canSubmitDraft(text, composer);

  const send = async (): Promise<void> => {
    if (composer === undefined || !canSubmit) return;
    const accepted = await composer.onSend(text.trim());
    // 宿主真的接受了才清空；失败原样留着，可以直接重试。
    setText((draft) => draftAfterSubmit(draft, accepted));
  };

  /* 录音那颗开关只报结论：在录就结束并识别，没在录就开始。 */
  const toggleRecording = (): void => {
    if (mic === undefined) return;
    if (mic.recording) mic.end();
    else mic.start();
  };

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
      className="pet-bench"
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
        className="pet-bench__top"
        ref={sceneRef}
        onPointerLeave={leaveScene}
        onBlur={blurScene}
        onContextMenu={(event) => {
          event.preventDefault();
          // 再按一次右键就是收起来，不用先点关闭。
          setMenu((open) => !open);
        }}
      >
        <div className="pet-bench__well">
          {bubble === null || bubble === '' ? null : <p className="pet-bench__say">{bubble}</p>}
          {interact === undefined ? (
            <div className="pet-bench__holder">{avatar}</div>
          ) : (
            <button
              type="button"
              className="pet-bench__poke"
              aria-label="戳它一下"
              title={
                draggable
                  ? '点一下戳它；按住可以在这一格里挪动它'
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
          {/* 台沿：角色站的那一道，压在台口下面，不是盖上去的一条地面。 */}
          <span className="pet-bench__ledge" aria-hidden="true" />
        </div>

        {composer === undefined && mic === undefined ? null : (
          <div className="pet-bench__rail">
            {composer === undefined ? null : (
              <Toggle
                label="对它说一句"
                hint={CHAT_HINT}
                pressed={chatting}
                data-testid="pet-chat-toggle"
                onChange={setChatting}
              />
            )}
            {mic === undefined ? null : (
              <Toggle
                label={micButtonLabel(mic)}
                hint={micButtonHint(mic)}
                pressed={mic.recording}
                disabled={!mic.canRecord && !mic.recording}
                data-testid="pet-mic-toggle"
                onChange={toggleRecording}
              />
            )}
            {mic === undefined || !mic.recording ? null : (
              <Button
                size="small"
                variant="quiet"
                data-testid="pet-mic-cancel"
                onClick={mic.cancel}
              >
                丢掉这一次
              </Button>
            )}
            <Toggle
              label="预览夜景"
              hint="只改这一格的灯，不动设置台与桌面的配色。关是白天，开是夜景。"
              pressed={night}
              data-testid="pet-light-toggle"
              onChange={setNight}
            />
          </div>
        )}

        {composer === undefined || !chatting ? null : (
          <div className="pet-bench__draft">
            <Field label={PET_COPY.sendLabel} hint={PET_COPY.sendBlocked}>
              {({ inputId }) => (
                <input
                  id={inputId}
                  className="pb-input"
                  type="text"
                  value={text}
                  placeholder={PET_COPY.sendPlaceholder}
                  disabled={!composer.canSend || composer.sending}
                  autoComplete="off"
                  spellCheck={false}
                  data-testid="pet-composer-input"
                  onChange={(event) => setText(event.target.value)}
                  onKeyDown={(event) => {
                    // 不用 form 提交：回车就是显式地点「发送」，但输入法选词的回车不是。
                    if (!isSubmitEnter(event.nativeEvent)) return;
                    event.preventDefault();
                    void send();
                  }}
                />
              )}
            </Field>
            <Button
              variant="primary"
              data-testid="pet-composer-send"
              busy={composer.sending}
              disabled={!canSubmit}
              onClick={() => void send()}
            >
              {composer.sending ? PET_COPY.sending : PET_COPY.send}
            </Button>
          </div>
        )}

        {menu ? (
          <div className="pet-bench__drawer" role="menu" aria-label="桌宠预览菜单">
            <h3 className="pet-bench__drawer-title">这一格能做的那几件事</h3>
            <Button
              variant="quiet"
              size="small"
              role="menuitem"
              disabled={composer === undefined}
              data-testid="pet-menu-chat"
              onClick={() => {
                setMenu(false);
                setChatting(true);
              }}
            >
              对它说一句
            </Button>
            {mic === undefined ? null : (
              <Button
                variant="quiet"
                size="small"
                role="menuitem"
                disabled={!mic.canRecord && !mic.recording}
                data-testid="pet-menu-mic"
                onClick={() => {
                  setMenu(false);
                  toggleRecording();
                }}
              >
                {mic.recording ? '结束录音' : '用录音说一句'}
              </Button>
            )}
            {onOpenVoiceSettings === undefined ? null : (
              <Button
                variant="quiet"
                size="small"
                role="menuitem"
                data-testid="pet-menu-voice"
                onClick={() => {
                  setMenu(false);
                  onOpenVoiceSettings();
                }}
              >
                语音设置
              </Button>
            )}
            <Button
              variant="quiet"
              size="small"
              role="menuitem"
              data-testid="pet-menu-light"
              onClick={() => {
                setMenu(false);
                setNight((now) => !now);
              }}
            >
              {night ? '预览改回白天' : '预览切成黑夜'}
            </Button>
            {onOpenDress === undefined ? null : (
              <Button
                variant="quiet"
                size="small"
                role="menuitem"
                data-testid="pet-menu-dress"
                onClick={() => {
                  setMenu(false);
                  onOpenDress();
                }}
              >
                去装扮
              </Button>
            )}
            <Button size="small" data-testid="pet-menu-close" onClick={() => setMenu(false)}>
              关闭
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** 代理只报它在不在跑；角色状态说它此刻在做什么，没报过的动作不替它编。 */
const AGENT_TO_PET: Readonly<Record<ApplicationSnapshot['agent']['state'], PetState>> = {
  starting: 'thinking',
  ready: 'idle',
  stopped: 'idle',
  error: 'error',
};
