/**
 * 桌宠窗口的 React 根组件。
 *
 * 交互约束（对应 qa/M0-06-bridge.md）：
 * - 窗口默认鼠标穿透，只有指针落在角色实际绘制的形状或真实按钮上才 setInteraction(true)。
 *   角色的外接矩形（更别说含气泡的容器）里有大量透明角，不能拿来当命中区。
 * - 角色按住拖动：按下 beginDrag()，松开 endDrag()；坐标完全由主进程读取，渲染器不传。
 * - 拖拽用 pointer capture，并在 pointerup/pointercancel/lostpointercapture/blur/
 *   Escape/超时六条路径上都释放，避免窗口卡在拖拽态。
 * - 空白区域、指针离开、失焦、Esc 立即恢复穿透；拖拽超时只结束拖拽，
 *   hover 意图由最后一次真实指针位置决定，不再由主进程定时清空。
 *
 * hover 意图的缓存（HoverTracker）必须与主进程的权威快照保持一致：
 * 主进程可能在失焦/隐藏/故障时单方面释放交互，此时本地不能继续声称“可交互”，
 * 否则再也不会重新上报，窗口要么永久挡住下层，要么永久点不动。因此：
 * - 拖拽结束先用最近一次指针位置重算意图，再 endDrag（主进程据此决定穿透）；
 * - 每次权威快照都做一次对账，发现分叉立即自愈（只清缓存或主动释放，不重复加锁）。
 */
import type { PetSnapshot, PetState } from '@pet/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

import { PetAvatar } from './PetAvatar.js';
import { PetBubble } from './PetBubble.js';
import { PrototypePanel } from './PrototypePanel.js';
import { PET_COPY } from './copy.js';
import {
  PetDragController,
  type DragEndReason,
  type PointerCaptureTarget,
} from './drag-controller.js';
import {
  avatarHitShapes,
  isPointInHitShapes,
  toHitRect,
  type HitShape,
  type PointLike,
} from './hit-regions.js';
import { readBridge, usePetBridge } from './use-pet-bridge.js';

/** 拖拽兜底：与主进程看门狗一致，避免指针事件丢失后卡在拖拽态。 */
export { RENDERER_DRAG_TIMEOUT_MS } from './drag-controller.js';

function rectToHitRect(element: Element | null) {
  if (element === null) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return toHitRect(rect);
}

/**
 * hover 意图缓存：记录“最近一次指针位置”和“上次上报的命中状态”。
 *
 * 去重是必要的（pointermove 与 mousemove 会重复到达），但去重键只能是
 * 本地缓存；一旦主进程单方面释放，就必须靠 resync/forget 把缓存拉回真实状态。
 */
export class HoverTracker {
  /**
   * 上次上报给主进程的命中状态（去重键），只在真正上报时更新。
   *
   * 它同时承担“主进程此刻是否还挡着”的近似：本地每上报一次，主进程就会
   * 跟着进入对应状态。因此 forget() 必须把它清掉，让下一次移动重新上报。
   */
  private reported = false;
  /**
   * 由最近一次真实指针位置推导出的命中结果；null 表示“不知道”
   * （从未收到指针、指针已离开窗口、或权威快照显示主进程已释放）。
   *
   * 与 reported 分开存放是必要的：forget() 把 reported 清成 false 只代表
   * “去重缓存作废”，绝不能拿来断言“指针此刻在命中区之外”——后者会驱动
   * 一次相反的 release 请求，把仍停在角色上的窗口放回穿透。
   */
  private derived: boolean | null = null;
  private point: PointLike | null = null;

  /** 上次上报给主进程的命中状态（拖拽中不随指针移动更新）。 */
  get interactive(): boolean {
    return this.reported;
  }

  /**
   * 按最后一次真实位置推导的命中结果；null 表示“没有依据”。
   *
   * 对账必须用它，而不是 interactive：后者只是去重缓存，可能是 false
   * 而指针其实还停在角色上（刚 forget / 刚从拖拽态恢复）。
   */
  get hit(): boolean | null {
    return this.derived;
  }

  get lastPoint(): PointLike | null {
    return this.point;
  }

  /** 只记录位置，不改变命中状态（拖拽中指针位置仍要更新，松手后才有依据）。 */
  track(point: PointLike): void {
    this.point = { x: point.x, y: point.y };
  }

  /** 记录一次指针移动；返回 true 表示命中状态变化、需要上报主进程。 */
  move(point: PointLike, shapes: readonly HitShape[]): boolean {
    this.track(point);
    return this.derive(isPointInHitShapes(point, shapes));
  }

  /** 指针离开窗口：必须回到穿透，并丢弃位置（否则松手后会用过期坐标重算）。 */
  leave(): boolean {
    this.point = null;
    this.derived = false;
    return this.apply(false);
  }

  /**
   * 用最近一次指针位置重算命中状态；返回 true 表示需要上报。
   *
   * 位置未知时只清去重缓存、不推导命中：宁可让下一次真实移动重新上报，
   * 也不能凭“没有位置”就断定指针在外面。
   */
  resync(shapes: readonly HitShape[]): boolean {
    const point = this.point;
    if (point === null) {
      this.derived = null;
      return false;
    }
    return this.derive(isPointInHitShapes(point, shapes));
  }

  /**
   * 权威快照显示主进程已经释放交互：清掉去重缓存并作废推导结果。
   *
   * 只清 reported 会让本地继续声称“可交互”，窗口再也点不动；
   * 顺手把 derived 也清掉，则避免用“缓存 false”冒充“指针在外面”。
   * 最后一次指针位置保留，下一次移动/松手仍能据它重算真实意图。
   */
  forget(): void {
    this.reported = false;
    this.derived = null;
  }

  private derive(next: boolean): boolean {
    this.derived = next;
    return this.apply(next);
  }

  private apply(next: boolean): boolean {
    if (next === this.reported) return false;
    this.reported = next;
    return true;
  }
}

export type HoverReconcile = 'none' | 'forget' | 'release';

/**
 * 权威快照与本地缓存对账。
 *
 * - 主进程说“已穿透”，本地却以为可交互：只清缓存（主进程已经放行，无需再发请求），
 *   下一次指针移动会重新上报 true。
 * - 主进程仍挡着，而本地缓存却说“已穿透”：**不能**据此释放。
 *   缓存 false 只说明“没上报过/已作废”，不说明指针真的在外面；
 *   只有按最后真实位置算出的 hit === false 才是释放依据。
 * - 拖拽中不干预：拖拽期间穿透由主进程统一在 stopDrag 处理。
 *
 * 已知边界（本次修复）：主进程的快照可能比本地事件旧。若先收到一条
 * clickThrough=true 的快照触发 forget，随后又收到它自己对 setInteraction(true)
 * 的回执（clickThrough=false），拿“缓存 false”去对账就会反手发一次 release，
 * 把仍停在命中区的窗口重新放回穿透。因此第三参数必须传 hit，而不是 interactive。
 */
export function reconcileHover(
  snapshot: Pick<PetSnapshot, 'clickThrough' | 'dragging'> | null,
  inside: boolean,
  hit: boolean | null = inside,
): HoverReconcile {
  if (snapshot === null || snapshot.dragging) return 'none';
  // 主进程已穿透：本地还声称可交互才需要清缓存（否则本来就一致）。
  if (snapshot.clickThrough) return inside ? 'forget' : 'none';
  // 主进程仍挡着：只有“最后真实位置确实不在命中区”才主动释放。
  // hit === true（指针还在角色上）或 null（位置未知）都不能释放——释放是
  // 一个会立刻改变窗口行为的外部请求，不能建立在“没有证据”之上。
  return hit === false ? 'release' : 'none';
}

export interface PetInteractionSessionOptions {
  beginDrag(): void;
  endDrag(): void;
  collectHitShapes(): HitShape[];
  setInteraction(interactive: boolean): void;
  onDraggingChange(active: boolean): void;
  /** 会话已被 cleanup/卸载：此时既不能 setState，也不能再申请交互。 */
  isUnmounting(): boolean;
  /** 覆盖拖拽超时，仅供测试。 */
  timeoutMs?: number;
}

/**
 * 一次交互会话的全部可变状态。
 *
 * 放在一个对象里，是为了让“创建 / 销毁”成为原子操作：React 每次重新
 * setup 都得到全新的一套，cleanup 后旧对象整体作废，不会出现
 * “控制器已 dispose、tracker 还在用”的半死状态。
 */
export interface PetInteractionSession {
  tracker: HoverTracker;
  isActive(): boolean;
  begin(event: { button: number; pointerId: number }, target: PointerCaptureTarget | null): boolean;
  end(reason?: DragEndReason): void;
  cancel(reason: DragEndReason): void;
  /** 结束拖拽并让本会话永久失效；重复调用安全。 */
  dispose(): void;
}

/**
 * 创建一个可独立销毁的交互会话。
 *
 * 之所以是工厂而不是模块级单例：React StrictMode 会把 effect 跑成
 * setup → cleanup → setup。cleanup 必须 dispose，否则拖拽计时器和指针捕获
 * 会泄漏；而 dispose 之后的对象按契约不可再用，所以第二次 setup 必须能
 * 拿到一套全新的状态（控制器 + hover 缓存），否则拖拽会永久失灵。
 */
export function createPetInteractionSession(
  options: PetInteractionSessionOptions,
): PetInteractionSession {
  const tracker = new HoverTracker();
  let disposed = false;
  const controller = new PetDragController({
    bridge: {
      beginDrag: () => options.beginDrag(),
      endDrag: () => options.endDrag(),
    },
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    onActiveChange: (active) => {
      // dispose 也会走 active=false。卸载路径上不能再向主进程申请交互，
      // 否则窗口会在渲染器已经消失后仍被锁在非穿透态。
      if (!active && !options.isUnmounting()) {
        // 松手：先用最近一次指针位置重算真实 hover 意图，再让 PetDragController
        // 调用 endDrag。顺序不能反——主进程 stopDrag 只按 interactive 决定穿透，
        // 若此时意图还是旧值，光标停在角色上也会被判定为“已离开”而穿透。
        //
        // 这里必须“重述”意图而不是只在变化时上报：主进程可能已经单方面释放
        // （失焦/隐藏/故障），本地缓存却仍是 true，不重述就会永久点不动。
        tracker.resync(options.collectHitShapes());
        if (tracker.interactive) options.setInteraction(true);
      }
      if (!options.isUnmounting()) options.onDraggingChange(active);
    },
  });

  return {
    tracker,
    isActive: () => !disposed && controller.isActive(),
    begin: (event, target) => (disposed ? false : controller.begin(event, target)),
    end: (reason) => {
      if (!disposed) controller.end(reason);
    },
    cancel: (reason) => {
      if (!disposed) controller.cancel(reason);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      controller.dispose();
    },
  };
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
  const unmounting = useRef(false);
  const [dragging, setDragging] = useState(false);

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

  // 桥方法每帧都可能变化，用 ref 固定，避免拖拽控制器被反复重建。
  const bridgeMethods = useRef({ beginDrag, endDrag });
  bridgeMethods.current = { beginDrag, endDrag };

  /**
   * 会话工厂：每次调用都得到一套全新的控制器 + hover 缓存。
   *
   * 不能放进 useMemo —— StrictMode 下 cleanup 会 dispose，而复用同一个
   * 已 dispose 的控制器会让后续拖拽永久失灵。
   */
  const createSession = useCallback(
    (): PetInteractionSession =>
      createPetInteractionSession({
        beginDrag: () => bridgeMethods.current.beginDrag(),
        endDrag: () => bridgeMethods.current.endDrag(),
        collectHitShapes,
        setInteraction,
        onDraggingChange: setDragging,
        isUnmounting: () => unmounting.current,
      }),
    [collectHitShapes, setInteraction],
  );

  const sessionRef = useRef<PetInteractionSession | null>(null);

  /**
   * 会话的创建/销毁与 effect 生命周期严格绑定。
   *
   * - setup 里新建：StrictMode 的第二次 setup 拿到的是全新会话，拖拽照常可用；
   * - cleanup 里先置 unmounting 再 dispose：dispose 会同步回调 active=false，
   *   那一步不能再申请交互或 setState（React 会警告/泄漏）；
   * - dispose 之后立刻清空引用：残留事件读不到会话就空转，不会半开一次拖拽。
   */
  useEffect(() => {
    // StrictMode 会 setup → cleanup → setup：第二次 setup 必须复位这个标记，
    // 否则第一次 cleanup 把它永久置 true，后续所有回调都被当成“已卸载”。
    unmounting.current = false;
    const session = createSession();
    sessionRef.current = session;
    return () => {
      unmounting.current = true;
      if (sessionRef.current === session) sessionRef.current = null;
      session.dispose();
    };
  }, [createSession]);

  /**
   * 与主进程的权威快照对账，避免“没有事件就永久挡/透”。
   *
   * 主进程会在失焦、隐藏、看门狗、渲染故障时单方面释放交互；若渲染器继续
   * 认为“可交互”，它的移动去重会永远跳过上报，窗口就再也点不动。
   * 反过来，主进程仍挡着而指针已不在命中区时，也要主动释放，不能一直挡住下层。
   */
  useEffect(() => {
    const session = sessionRef.current;
    if (session === null) return;
    const tracker = session.tracker;
    // 第三个参数是“按最后真实位置推导的命中”，不是去重缓存：缓存 false
    // 可能只是刚被 forget 清掉，拿它当“指针在外”会发出相反的 release。
    const action = reconcileHover(view.snapshot, tracker.interactive, tracker.hit);
    if (action === 'forget') {
      tracker.forget();
    } else if (action === 'release') {
      tracker.forget();
      setInteraction(false);
    }
  }, [view.snapshot, setInteraction]);

  /** 指针在窗口内移动时上报命中状态；离开窗口一律恢复穿透。 */
  useEffect(() => {
    // 窗口在穿透态下仍会转发鼠标消息（forward: true），
    // 因此 pointermove 与 mousemove 都可能到达，重复上报由状态比对吸收。
    const handleMove = (event: { clientX: number; clientY: number }): void => {
      // 会话可能已经 dispose（StrictMode 的 cleanup 或卸载）：读不到就空转，
      // 绝不能在失效的控制器上重新开始一次拖拽。
      const session = sessionRef.current;
      if (session === null) return;
      const point = { x: event.clientX, y: event.clientY };
      const tracker = session.tracker;
      // 拖拽中只记录位置：此时不能切换穿透（会丢输入），松手后要用它重算意图。
      if (session.isActive()) {
        tracker.track(point);
        return;
      }
      if (tracker.move(point, collectHitShapes())) {
        setInteraction(tracker.interactive);
      }
    };

    const handleLeave = (): void => {
      const session = sessionRef.current;
      if (session === null) return;
      if (session.tracker.leave()) setInteraction(false);
    };

    const handlePointerUp = (): void => {
      sessionRef.current?.end('pointerup');
    };
    const handlePointerCancel = (): void => {
      sessionRef.current?.cancel('pointercancel');
    };
    const handleLostCapture = (): void => {
      sessionRef.current?.cancel('lostpointercapture');
    };
    const handleBlur = (): void => {
      // 先清 hover 意图再结束拖拽：失焦时主进程已经释放交互，若反过来先
      // cancel（会按指针位置重述 true），窗口会被短暂重新锁回非穿透态。
      handleLeave();
      // 窗口失焦必须同时结束渲染器侧拖拽状态，否则松手后仍在拖拽态。
      sessionRef.current?.cancel('blur');
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
  }, [collectHitShapes, setInteraction]);

  /** Esc 取消拖拽或退出交互，不拦截其他应用的按键。 */
  useEffect(() => {
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      const session = sessionRef.current;
      if (session === null) return;
      if (session.isActive()) {
        session.cancel('escape');
        return;
      }
      if (!session.tracker.interactive) return;
      session.tracker.forget();
      setInteraction(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [setInteraction]);

  const handleAvatarPointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>): void => {
      if (event.button !== 0) return;
      const session = sessionRef.current;
      // 会话已 dispose（StrictMode 的 cleanup 或卸载）时不再接受新的拖拽。
      if (session === null) return;
      // 只在实际画出来的角色形状上开始拖拽，透明角不吞事件。
      const inside = isPointInHitShapes({ x: event.clientX, y: event.clientY }, collectHitShapes());
      if (!inside) return;
      // 确认命中后才阻止默认行为，避免误伤透明区域的下层交互。
      event.preventDefault();
      // 按下前先把真实 hover 意图重述给主进程：若上一次权威快照已经释放交互
      // （失焦/隐藏/故障），这里必须先重新关闭穿透，否则 beginDrag 之后
      // 指针事件仍然到不了渲染器，拖拽会半途失效。setInteraction(true) 是幂等的。
      session.tracker.track({ x: event.clientX, y: event.clientY });
      session.tracker.resync(collectHitShapes());
      setInteraction(session.tracker.interactive);
      const target = event.currentTarget;
      session.begin(
        { button: event.button, pointerId: event.pointerId },
        typeof target.setPointerCapture === 'function' ? target : null,
      );
    },
    [collectHitShapes, setInteraction],
  );

  /** 元素级兜底：即使 window 上收不到，系统抢走捕获时也结束拖拽。 */
  const handleLostPointerCapture = useCallback((): void => {
    sessionRef.current?.cancel('lostpointercapture');
  }, []);

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
