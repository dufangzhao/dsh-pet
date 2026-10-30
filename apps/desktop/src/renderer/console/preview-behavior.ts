/**
 * 预览台的互动行为：表情与可见性回报、戳/拖判定、菜单收合、录音按钮上那句话。
 *
 * 从 console/pet-preview.tsx 里抽出来放在这里：旧预览与 original-ui 的原创预览共用同一份行为，
 * 换一套板面不会带出第二套「blush 只在真的画出来之后才记」的规则。
 * 这里不写存储、不开第二条会话、不抢麦克风——动作全部走调用方给的那一位所有者。
 */
import { useEffect, useRef, useState, type RefObject } from 'react';

import { ExpressionTimeline, type PetExpression } from '../pet/expression.js';

/** 这一栏会用到的互动种类，取值与桥一致，不在这里另起一名。 */
export type PreviewInteraction = 'poke' | 'blush' | 'drag';

/** 宿主那条互动记录的写入者。 */
export type InteractionWriter = (kind: PreviewInteraction) => Promise<{ ok: boolean }>;

/** 场景块的容器：可见性判断与「焦点还在不在里面」都读这一块。 */
export type SceneRef = RefObject<HTMLDivElement | null>;

/**
 * 表情（neutral/blush）、这一块在不在视口里，以及戳一下这条动作。
 *
 * 两条硬约束照原样留着：blush 只有在真的画进一帧可见画面之后才回报宿主，窗口藏起来或这块
 * 滑出视口就不记；每次戳带自己的序号，晚到的旧结果不能替新的一次记事件。
 */
export function usePokeableAvatar(interact: InteractionWriter | undefined): {
  readonly expression: PetExpression;
  readonly sceneRef: SceneRef;
  poke(): void;
} {
  const [expression, setExpression] = useState<PetExpression>('neutral');
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const timeline = useRef<ExpressionTimeline | null>(null);
  const inView = useRef(true);
  /** 表情回报走当前这一次的写入者；卸载后不会再发。 */
  const writer = useRef(interact);
  writer.current = interact;

  useEffect(() => {
    timeline.current = new ExpressionTimeline({
      onApply: setExpression,
      onVisible: () => {
        void writer.current?.('blush');
      },
      isVisible: () =>
        typeof document !== 'undefined' && document.visibilityState === 'visible' && inView.current,
    });
    const node = sceneRef.current;
    const observer =
      typeof IntersectionObserver === 'undefined' || node === null
        ? null
        : new IntersectionObserver(
            (entries) => {
              inView.current = entries.some((entry) => entry.isIntersecting);
            },
            { threshold: 0.25 },
          );
    if (node !== null) observer?.observe(node);
    return () => {
      timeline.current?.dispose();
      timeline.current = null;
      observer?.disconnect();
    };
  }, []);

  const poke = (): void => {
    const write = interact;
    if (write === undefined) return;
    void write('poke').then((accepted) => {
      if (accepted.ok) timeline.current?.blush();
    });
  };

  return { expression, sceneRef, poke };
}

/** 角色能在这格子里挪多远：左右各一半减去身位，上下只许抬起来一点。 */
export const DRAG_LIFT_PX = 48;
const AVATAR_HALF_PX = 90;

/** 位移夹在这块场景里：预览是设置台的一格，不是桌面窗口。 */
export function clampDragOffset(
  dx: number,
  dy: number,
  sceneWidth: number,
): { readonly x: number; readonly y: number } {
  const limit = Math.max(0, sceneWidth / 2 - AVATAR_HALF_PX);
  return {
    x: Math.max(-limit, Math.min(limit, dx)),
    y: Math.max(-DRAG_LIFT_PX, Math.min(0, dy)),
  };
}

/** blur 触发时浏览器还没把焦点交给下一个元素，只信事件带过来的 relatedTarget。 */
export function focusStillInside(node: HTMLElement, target: EventTarget | null): boolean {
  return target instanceof Node && node.contains(target);
}

/** pointerleave 时焦点已经落定，这时才读真的 activeElement。 */
export function sceneHoldsFocus(scene: SceneRef): boolean {
  return scene.current !== null && scene.current.contains(document.activeElement);
}

/**
 * 浮层菜单：Escape 或这一点之外的任何按下都收起来，
 * 不然右键一次就要按「关闭」才能继续用这一格。
 */
export function useOutsideDismiss(
  open: boolean,
  sceneRef: SceneRef,
  onClose: () => void,
  interactionRef?: SceneRef,
): void {
  // 关掉它这件事存进 ref：菜单开着的每一次渲染都别重新挂一遍监听。
  const dismiss = useRef(onClose);
  dismiss.current = onClose;

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent | MouseEvent): void => {
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') dismiss.current();
        return;
      }
      const scene = sceneRef.current;
      if (
        scene !== null &&
        event.target instanceof Node &&
        !scene.contains(event.target) &&
        !interactionRef?.current?.contains(event.target)
      ) {
        dismiss.current();
      }
    };
    document.addEventListener('keydown', close);
    document.addEventListener('mousedown', close);
    return () => {
      document.removeEventListener('keydown', close);
      document.removeEventListener('mousedown', close);
    };
  }, [open, sceneRef, interactionRef]);
}

/** 录音入口的样子：状态与动作都由调用方给，用的是全场那一个录音所有者。 */
export interface PetPreviewMic {
  canRecord: boolean;
  recording: boolean;
  /** 宿主报出的剩余秒数；没报就不编一个数。 */
  secondsLeft: number | null;
  /** 还没准备好时的一句话：按钮上不装能按。 */
  unavailable: string | null;
  /** 这一次能说多长；由调用方给报出来的上限，没报就不写秒数。 */
  secondsLimit: number | null;
  start(): void;
  end(): void;
  cancel(): void;
}

/** 说话入口：能不能发、有没有在途、发出去那句话，都由调用方交给既有的那一条会话。 */
export interface PetPreviewComposer {
  canSend: boolean;
  sending: boolean;
  onSend(text: string): Promise<boolean>;
}

/** 按钮上那几个字：在录就报剩多久，没报秒数就只说「正在录音」。 */
export function micButtonLabel(mic: PetPreviewMic): string {
  if (!mic.recording) return '录音';
  return mic.secondsLeft === null ? '正在录音' : '剩 ' + mic.secondsLeft + ' 秒';
}

/**
 * 按钮下面的那句提示，优先级是「为什么不能按」→「正在发生什么」→「能说多长」。
 * 上限没报就不编一个秒数出来。
 */
export function micButtonHint(mic: PetPreviewMic): string {
  if (mic.unavailable !== null) return mic.unavailable;
  if (mic.recording) return '正在录音，点此结束并识别';
  return mic.secondsLimit === null
    ? '用语音对它说一句'
    : '用语音对它说一句，最长 ' + mic.secondsLimit + ' 秒';
}
