/**
 * 风格家族的桌宠预览适配器：只给状态与动作，不画任何东西。
 *
 * 家族自己决定这格长什么样（Precision 的分栏、Hearth 的圆角卡、Folio 的文字条目、Prism 的浮层），
 * 但角色仍是 pet/PetAvatar，行为仍是 preview-behavior.ts 那一份：
 * 同一次按下要么算戳、要么算拖动；blush 只有真的画进一帧可见画面才回报；焦点离开时若在途不收草稿。
 * 说话、录音、可见性一律走 model 里那一位所有者——这里不开第二条会话、不抢麦克风、不写历史。
 *
 * 角色本体那一叠 --pet-* 颜色由 PET_PALETTES 给（装扮页那一项设置本身），家族只需要把
 * figure.vars 贴在自己那个角色容器上，再引一次 ../style-families/character.css。
 */
import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import type { PetState } from '@pet/contracts';

import type { PetFigure } from '../../pet/hit-regions.js';
import type { PetExpression } from '../../pet/expression.js';
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
  type SceneRef,
} from '../preview-behavior.js';

import type { StartModel } from '../start-designs/use-start-model.js';

/** 给 <PetAvatar> 的那四个值：与桌面窗读同一份快照，预览即桌面。 */
export interface FamilyFigure {
  readonly state: PetState;
  readonly expression: PetExpression;
  readonly figure: PetFigure;
  readonly name: string | null;
  /** --pet-body-top/--pet-body-bottom/--pet-face/--pet-halo：贴到角色容器上。 */
  readonly vars: CSSProperties;
}

/** 承载角色的那一格：戳与拖动都挂在它身上（家族决定它是按钮、卡片还是浮层触发器）。 */
export interface FamilyAvatarHost {
  readonly style: CSSProperties;
  readonly 'data-testid': string;
  readonly 'aria-label': string;
  readonly title: string;
  onPointerDown(event: ReactPointerEvent<HTMLElement>): void;
  onPointerMove(event: ReactPointerEvent<HTMLElement>): void;
  onPointerUp(event: ReactPointerEvent<HTMLElement>): void;
  onPointerCancel(): void;
  onClick(): void;
  onKeyDown(event: ReactKeyboardEvent<HTMLElement>): void;
}

/** 预览场景的外壳：视口判断、焦点收起、右键/菜单键开这一家自己的那层菜单。 */
export interface FamilyStage {
  readonly ref: SceneRef;
  readonly 'data-testid': string;
  readonly 'data-light': 'day' | 'night';
  readonly 'aria-label': string;
  onPointerLeave(): void;
  onBlur(event: FocusEvent<HTMLElement>): void;
  onContextMenu(event: ReactMouseEvent<HTMLElement>): void;
}

export interface FamilyMic {
  readonly present: boolean;
  readonly pressed: boolean;
  readonly disabled: boolean;
  /** 在录就报剩多久；没报秒数就只说「正在录音」。 */
  readonly label: string;
  /** 为什么不能按 → 正在发生什么 → 能说多长，就这一句。 */
  readonly hint: string;
  toggle(): void;
  cancel(): void;
}

export interface FamilyComposer {
  readonly present: boolean;
  readonly open: boolean;
  setOpen(next: boolean): void;
  readonly text: string;
  setText(next: string): void;
  readonly canSubmit: boolean;
  readonly sending: boolean;
  readonly canSend: boolean;
  readonly label: string;
  readonly placeholder: string;
  readonly hint: string;
  /** 输入法选词的回车不算发送。 */
  onKeyDown(event: ReactKeyboardEvent<HTMLElement>): void;
  send(): void;
}

export interface FamilyPreview {
  /** 这一台机器读不读得到桌宠；读不到时家族要画自己那句说明，不画一只假角色。 */
  readonly available: boolean;
  readonly figure: FamilyFigure;
  readonly stage: FamilyStage;
  readonly avatar: FamilyAvatarHost;
  readonly mic: FamilyMic;
  readonly composer: FamilyComposer;
  /** 宿主此刻真的要说的那句话；没有就是 null，不画气泡。 */
  readonly bubble: string | null;
  /** 只有预览这一格的灯：不写挡位，也不影响控制台与桌面。 */
  readonly night: boolean;
  setNight(next: boolean): void;
  /** 这一家自己的那层菜单/浮层：开合与「点外面收起」都在这里。 */
  readonly menu: {
    readonly ref: SceneRef;
    readonly open: boolean;
    toggle(): void;
    close(): void;
    show(): void;
  };
  /** 菜单里那两条跳转：语音设置与装扮，走的是全场唯一的路由动作。 */
  readonly entries: { readonly voice?: () => void; readonly dress?: () => void };
  /** 不可用（离线、没接到会话）时家族该收起哪些控件，由 present 决定，不画成能按的样子。 */
  readonly draggable: boolean;
}

/** 家族 DOM 各不一样，locator 名字不能各写各的：QA 按这一组找。 */
export const FAMILY_PREVIEW_TESTIDS = {
  stage: 'pet-stage',
  avatar: 'pet-poke',
  chat: 'pet-chat-toggle',
  composer: 'pet-composer-input',
  send: 'pet-composer-send',
  mic: 'pet-mic-toggle',
  micCancel: 'pet-mic-cancel',
  light: 'pet-light-toggle',
  menu: 'pet-menu',
} as const;

/** 代理只报它在不在跑；角色状态说它此刻在做什么，没报过的动作不替它编。 */
const AGENT_TO_PET: Readonly<Record<NonNullable<PetPreviewProps['agent']>['state'], PetState>> = {
  starting: 'thinking',
  ready: 'idle',
  stopped: 'idle',
  error: 'error',
};

/** 没报、报 null、报空串，都是「此刻没有话要说」：不画气泡。 */
export function previewBubble(bubble: string | null | undefined): string | null {
  return bubble === undefined || bubble === null || bubble === '' ? null : bubble;
}

export function useFamilyPreview(model: StartModel): FamilyPreview {
  const pet: PetPreviewProps = model.pet;
  const values = pet.values;
  const figure: PetFigure = values?.figure ?? 'minimal';
  const palette = values?.palette ?? 'morning';
  const draggable = values?.draggable ?? true;
  const colors = PET_PALETTES[palette] ?? PET_PALETTES.morning;
  const state: PetState = pet.state ?? AGENT_TO_PET[pet.agent?.state ?? 'stopped'] ?? 'idle';

  const { expression, sceneRef, poke } = usePokeableAvatar(pet.interact);
  const [night, setNight] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // 菜单可以排在场景外；它的点击边界不改变角色的可见性与拖动几何。
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [chatting, setChatting] = useState(false);
  /** 草稿住在这里：收起再说一句，刚打的字还在。 */
  const [text, setText] = useState('');
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ id: number; startX: number; startY: number; moved: number } | null>(
    null,
  );
  /** 这一次按下已由指针路径处理过就不再让 click 补一发。 */
  const pointerHandled = useRef(false);

  useOutsideDismiss(menuOpen, sceneRef, () => setMenuOpen(false), menuRef);

  const blurScene = (event: FocusEvent<HTMLElement>): void => {
    const node = sceneRef.current;
    const composer = pet.composer;
    if (node === null || composer === undefined) return;
    if (shouldCloseChat(focusStillInside(node, event.relatedTarget), composer.sending)) {
      setChatting(false);
    }
  };

  const leaveScene = (): void => {
    const composer = pet.composer;
    if (composer === undefined) return;
    if (shouldCloseChat(sceneHoldsFocus(sceneRef), composer.sending)) setChatting(false);
  };

  const dragStart = (event: ReactPointerEvent<HTMLElement>): void => {
    pointerHandled.current = false;
    if (!draggable || pet.interact === undefined) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: 0,
    };
  };

  const dragMove = (event: ReactPointerEvent<HTMLElement>): void => {
    const drag = dragRef.current;
    const scene = sceneRef.current;
    if (drag === null || scene === null || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    drag.moved = Math.hypot(dx, dy);
    if (!pointerWasDrag(drag.moved)) return;
    setOffset(clampDragOffset(dx, dy, scene.getBoundingClientRect().width));
  };

  const dragEnd = (event: ReactPointerEvent<HTMLElement>): void => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag === null || drag.id !== event.pointerId) return;
    pointerHandled.current = true;
    const interact = pet.interact;
    if (interact === undefined) return;
    if (pointerWasDrag(drag.moved)) {
      void interact('drag');
      return;
    }
    poke();
  };

  /** 键盘的 Enter/Space 只发 click，「不可拖动」时指针那条路也不成立：这两种情况都算戳一下。 */
  const clickAvatar = (): void => {
    if (pointerHandled.current) {
      pointerHandled.current = false;
      return;
    }
    poke();
  };

  const composerState = pet.composer;
  const canSubmit = composerState === undefined ? false : canSubmitDraft(text, composerState);

  const send = useCallback((): void => {
    const composer = pet.composer;
    if (composer === undefined || !canSubmitDraft(text, composer)) return;
    void composer.onSend(text.trim()).then((accepted) => {
      // 宿主真的接受了才清空；失败原样留着，可以直接重试。
      setText((draft) => draftAfterSubmit(draft, accepted));
    });
  }, [pet.composer, text]);

  const micState = pet.mic;
  const toggleRecording = (): void => {
    const mic = pet.mic;
    if (mic === undefined) return;
    if (mic.recording) mic.end();
    else mic.start();
  };

  return {
    available: model.appAvailable,
    figure: {
      state,
      expression,
      figure,
      name: values?.petName ?? null,
      vars: {
        '--pet-body-top': colors.top,
        '--pet-body-bottom': colors.bottom,
        '--pet-face': colors.face,
        '--pet-halo': colors.halo,
      } as CSSProperties,
    },
    stage: {
      ref: sceneRef,
      'data-testid': FAMILY_PREVIEW_TESTIDS.stage,
      'data-light': night ? 'night' : 'day',
      'aria-label': '桌宠预览',
      onPointerLeave: leaveScene,
      onBlur: blurScene,
      onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
        event.preventDefault();
        // 再按一次右键就是收起来，不必先点关闭。
        setMenuOpen((open) => !open);
      },
    },
    avatar: {
      style: { transform: 'translate(' + offset.x + 'px, ' + offset.y + 'px)' } as CSSProperties,
      'data-testid': FAMILY_PREVIEW_TESTIDS.avatar,
      'aria-label': '戳它一下',
      title: draggable ? '点一下戳它；按住可以在这一格里挪动它' : '点一下戳它（桌宠当前不可拖动）',
      onPointerDown: dragStart,
      onPointerMove: dragMove,
      onPointerUp: dragEnd,
      onPointerCancel: () => {
        dragRef.current = null;
      },
      onClick: clickAvatar,
      onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault();
          setMenuOpen(true);
        }
      },
    },
    mic: {
      present: micState !== undefined,
      pressed: micState?.recording === true,
      disabled: micState === undefined || (!micState.canRecord && !micState.recording),
      label: micState === undefined ? PET_COPY.send : micButtonLabel(micState),
      hint: micState === undefined ? '' : micButtonHint(micState),
      toggle: toggleRecording,
      cancel: () => {
        pet.mic?.cancel();
      },
    },
    composer: {
      present: composerState !== undefined,
      open: chatting,
      setOpen: setChatting,
      text,
      setText,
      canSubmit,
      sending: composerState?.sending === true,
      canSend: composerState?.canSend === true,
      label: PET_COPY.sendLabel,
      placeholder: PET_COPY.sendPlaceholder,
      hint: composerState === undefined ? '' : PET_COPY.sendBlocked,
      onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
        // 不用 form 提交：回车就是显式点发送，但输入法选词的回车不是。
        if (!isSubmitEnter(event.nativeEvent)) return;
        event.preventDefault();
        send();
      },
      send,
    },
    bubble: previewBubble(pet.bubble),
    night,
    setNight,
    menu: {
      ref: menuRef,
      open: menuOpen,
      toggle: () => setMenuOpen((open) => !open),
      close: () => setMenuOpen(false),
      show: () => setMenuOpen(true),
    },
    entries: {
      ...(pet.onOpenVoiceSettings === undefined
        ? {}
        : { voice: () => pet.onOpenVoiceSettings?.() }),
      ...(pet.onOpenDress === undefined ? {} : { dress: () => pet.onOpenDress?.() }),
    },
    draggable: draggable && pet.interact !== undefined,
  };
}
