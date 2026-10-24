/**
 * 桌宠窗口的 React 根组件。
 *
 * 交互约束（对应 qa/M0-06-bridge.md）：
 * - 窗口默认鼠标穿透，只有指针落在角色实际绘制的形状或真实按钮上才 setInteraction(true)。
 *   角色的外接矩形（更别说含气泡的容器）里有大量透明角，不能拿来当命中区。
 * - 角色按住拖动：按下 beginDrag()，松开 endDrag()；坐标完全由主进程读取，渲染器不传。
 * - 拖拽用 pointer capture，并在 pointerup/pointercancel/lostpointercapture/blur/
 *   Escape/超时六条路径上都释放，避免窗口卡在拖拽态。
 * - 空白区域恢复穿透；失焦、Esc、拖拽超时都会回到穿透态。
 */
import type { PetState } from '@pet/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { PetAvatar } from './PetAvatar.js';
import { PetBubble } from './PetBubble.js';
import { PrototypePanel } from './PrototypePanel.js';
import { PET_COPY } from './copy.js';
import { PetDragController } from './drag-controller.js';
import { avatarHitShapes, isPointInHitShapes, toHitRect, type HitShape } from './hit-regions.js';
import { readBridge, usePetBridge } from './use-pet-bridge.js';

/** 拖拽兜底：与主进程看门狗一致，避免指针事件丢失后卡在拖拽态。 */
export { RENDERER_DRAG_TIMEOUT_MS } from './drag-controller.js';

function rectToHitRect(element: Element | null) {
  if (element === null) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return toHitRect(rect);
}

export interface PetAppProps {
  /** 测试注入；正常运行时从 window.pet 读取。 */
  bridge?: unknown;
}

export function PetApp({ bridge }: PetAppProps = {}): React.JSX.Element {
  const view = usePetBridge({
    bridge: bridge === undefined ? readBridge() : readBridge({ pet: bridge }),
    missingNotice: PET_COPY.bridgeMissing,
    failureNotice: PET_COPY.bridgeError,
    quitFailureNotice: PET_COPY.quitFailed,
  });
  const { setInteraction, beginDrag, endDrag, previewState, quit } = view;

  const avatarRef = useRef<SVGSVGElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const interactiveRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  // 桥方法每帧都可能变化，用 ref 固定，避免拖拽控制器被反复重建。
  const bridgeMethods = useRef({ beginDrag, endDrag });
  bridgeMethods.current = { beginDrag, endDrag };

  const dragController = useMemo(
    () =>
      new PetDragController({
        bridge: {
          beginDrag: () => bridgeMethods.current.beginDrag(),
          endDrag: () => bridgeMethods.current.endDrag(),
        },
        onActiveChange: (active) => setDragging(active),
      }),
    [],
  );

  // 卸载时结束拖拽并释放计时器，避免窗口销毁后仍有回调。
  useEffect(() => () => dragController.dispose(), [dragController]);

  /** 收集当前窗口内真实可交互的形状：角色实际绘制面 + 面板矩形。 */
  const collectHitShapes = useCallback((): HitShape[] => {
    const shapes: HitShape[] = [];
    const avatar = avatarRef.current;
    if (avatar !== null) {
      const rect = avatar.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) shapes.push(...avatarHitShapes(rect));
    }
    const panel = rectToHitRect(panelRef.current);
    if (panel !== null) shapes.push({ kind: 'rect', ...panel });
    return shapes;
  }, []);

  /** 指针在窗口内移动时上报命中状态；离开窗口一律恢复穿透。 */
  useEffect(() => {
    // 窗口在穿透态下仍会转发鼠标消息（forward: true），
    // 因此 pointermove 与 mousemove 都可能到达，重复上报由状态比对吸收。
    const handleMove = (event: { clientX: number; clientY: number }): void => {
      if (dragController.isActive()) return;
      const inside = isPointInHitShapes({ x: event.clientX, y: event.clientY }, collectHitShapes());
      if (inside === interactiveRef.current) return;
      interactiveRef.current = inside;
      setInteraction(inside);
    };

    const handleLeave = (): void => {
      if (!interactiveRef.current) return;
      interactiveRef.current = false;
      setInteraction(false);
    };

    const handlePointerUp = (): void => {
      dragController.end('pointerup');
    };
    const handlePointerCancel = (): void => {
      dragController.cancel('pointercancel');
    };
    const handleLostCapture = (): void => {
      dragController.cancel('lostpointercapture');
    };
    const handleBlur = (): void => {
      // 窗口失焦必须同时结束渲染器侧拖拽状态，否则松手后仍在拖拽态。
      dragController.cancel('blur');
      handleLeave();
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('pointerleave', handleLeave);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    window.addEventListener('lostpointercapture', handleLostCapture);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('pointerleave', handleLeave);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      window.removeEventListener('lostpointercapture', handleLostCapture);
      window.removeEventListener('blur', handleBlur);
    };
  }, [collectHitShapes, dragController, setInteraction]);

  /** Esc 取消拖拽或退出交互，不拦截其他应用的按键。 */
  useEffect(() => {
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (dragController.isActive()) {
        dragController.cancel('escape');
        return;
      }
      if (!interactiveRef.current) return;
      interactiveRef.current = false;
      setInteraction(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [dragController, setInteraction]);

  const handleAvatarPointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>): void => {
      if (event.button !== 0) return;
      // 只在实际画出来的角色形状上开始拖拽，透明角不吞事件。
      const inside = isPointInHitShapes({ x: event.clientX, y: event.clientY }, collectHitShapes());
      if (!inside) return;
      // 确认命中后才阻止默认行为，避免误伤透明区域的下层交互。
      event.preventDefault();
      const target = event.currentTarget;
      dragController.begin(
        { button: event.button, pointerId: event.pointerId },
        typeof target.setPointerCapture === 'function' ? target : null,
      );
    },
    [collectHitShapes, dragController],
  );

  /** 元素级兜底：即使 window 上收不到，系统抢走捕获时也结束拖拽。 */
  const handleLostPointerCapture = useCallback((): void => {
    dragController.cancel('lostpointercapture');
  }, [dragController]);

  const handlePreview = useCallback(
    (next: PetState): void => {
      previewState(next);
    },
    [previewState],
  );

  const handleQuit = useCallback((): void => {
    quit();
  }, [quit]);

  return (
    <div
      className="pet-root"
      data-testid="pet-stage"
      data-dragging={dragging ? 'true' : 'false'}
      data-state={view.state}
    >
      <div className="pet-root__avatar">
        <PetAvatar
          state={view.state}
          svgRef={avatarRef}
          onPointerDown={handleAvatarPointerDown}
          onLostPointerCapture={handleLostPointerCapture}
        />
        <PetBubble state={view.state} />
      </div>

      <div className="pet-root__panel" ref={panelRef}>
        <PrototypePanel
          state={view.state}
          onPreview={handlePreview}
          onQuit={handleQuit}
          quitDisabled={!view.available}
        />
        {view.notice !== null ? (
          <p className="pet-root__notice" role="alert" data-testid="pet-notice">
            {view.notice}
          </p>
        ) : null}
      </div>
    </div>
  );
}
