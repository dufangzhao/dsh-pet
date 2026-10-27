import type {
  ConsolePlugin,
  ConsolePluginAction,
  ConsolePluginChange,
  ConsoleSnapshot,
  KernelErrorCode,
} from '@pet/contracts';
import { useCallback, useRef, useState } from 'react';

import { describeError } from './copy.js';
import { ownerKey } from './labels.js';

export interface PluginActionOutcome {
  /** 这次动作是否达成；没达成时 error 是可直接展示的一句话。 */
  ok: boolean;
  error: string | null;
  /**
   * 结果未确认：请求没能送到宿主，或者传输断了。
   * 此时既不能说成功，也不能说已经回滚——状态只有刷新才知道。
   */
  unknown: boolean;
}

export interface PluginActionState {
  /** 正在进行的动作，键是 ownerKey；多实例互不阻塞。 */
  pending: ReadonlyMap<string, ConsolePluginAction>;
  /** 按插件当前状态发起启用/停用/卸载，返回真实结果。 */
  run: (plugin: ConsolePlugin, action: ConsolePluginAction) => Promise<PluginActionOutcome>;
}

/**
 * 这些拒绝发生在动作之前，可以断言"没有发生"。
 * 其余错误（unavailable、timeout、internal 等）结果未知，不在此列。
 */
const CONFIRMED_REJECTIONS: ReadonlySet<KernelErrorCode> = new Set([
  'permission-denied',
  'invalid-input',
  'stale-owner',
  'not-ready',
]);

/** 外层 ok=false 时，这个错误码能否断言动作没有发生。 */
export function isConfirmedRejection(code: KernelErrorCode): boolean {
  return CONFIRMED_REJECTIONS.has(code);
}

const UNCONFIRMED: PluginActionOutcome = {
  ok: false,
  error: '结果未确认，请刷新状态。',
  unknown: true,
};

const LABELS: Readonly<Record<ConsolePluginAction, string>> = {
  enable: '启用',
  disable: '停用',
  uninstall: '卸载',
};

export function actionLabel(action: ConsolePluginAction): string {
  return LABELS[action];
}

interface PluginActionsOptions {
  /** 应用宿主返回的完整快照：必须直接采用，不做本地合并。 */
  applySnapshot: (snapshot: ConsoleSnapshot) => void;
  /** 结果没能确认时调用：旧快照不再代表真实状态。 */
  markUncertain: () => void;
}

/**
 * 插件写操作的唯一入口：window.petConsole.runPluginAction。
 *
 * 外层 ok=true 时快照是操作之后的真实状态，一律先应用；其中的 operationError
 * 说明这次没有达成（未信任、落到待重启等），失败后的世代号与原因也在同一份快照里，
 * 所以不再补一次读取去掩盖这次的结果。
 *
 * 外层 ok=false 有两种：宿主明确拒绝（如参数不合约定）和桥本身不可用。
 * 后者发生在请求送出前后都有可能，因此不能声称"什么都没变"：结果记为未确认，
 * 界面提示用户刷新状态，并且不自动重试。
 *
 * 同一插件同时只放一个动作：后端按插件拒绝并发，这里先挡住重复点击。
 */
export function usePluginActions({
  applySnapshot,
  markUncertain,
}: PluginActionsOptions): PluginActionState {
  const [pending, setPending] = useState<ReadonlyMap<string, ConsolePluginAction>>(new Map());
  // 门闩与渲染状态分开：同一事件循环里的两次点击不能都通过。
  const inFlight = useRef(new Set<string>());

  const run = useCallback(
    async (plugin: ConsolePlugin, action: ConsolePluginAction): Promise<PluginActionOutcome> => {
      const bridge = window.petConsole;
      if (bridge === undefined) {
        markUncertain();
        return UNCONFIRMED;
      }
      const key = ownerKey(plugin.owner);
      if (inFlight.current.has(key)) {
        return { ok: false, error: '上一个操作还没结束。', unknown: false };
      }
      inFlight.current.add(key);
      setPending((current) => new Map(current).set(key, action));
      try {
        const result = await bridge.runPluginAction({ owner: plugin.owner, action });
        if (!result.ok) {
          /*
           * 宿主拒绝分两种：permission-denied / invalid-input / stale-owner 这类
           * 是请求被挡在动作之前，可以照实说；unavailable 与超时类说明桥或宿主
           * 当时不可达，动作可能已经发生，只能记为未确认。
           */
          if (isConfirmedRejection(result.error.code)) {
            return { ok: false, error: describeError(result.error), unknown: false };
          }
          markUncertain();
          return UNCONFIRMED;
        }
        applySnapshot(result.value.snapshot);
        return pluginActionOutcome(result.value);
      } catch {
        markUncertain();
        return UNCONFIRMED;
      } finally {
        inFlight.current.delete(key);
        setPending((current) => {
          if (!current.has(key)) {
            return current;
          }
          const next = new Map(current);
          next.delete(key);
          return next;
        });
      }
    },
    [applySnapshot, markUncertain],
  );

  return { pending, run };
}

/**
 * operationError 非空就是没达成，哪怕快照里的状态已经变了。
 * 这是宿主明确报告的结果，所以不算"未确认"。
 * 单独导出是为了能直接验证这条规则，不必搭 DOM。
 */
export function pluginActionOutcome(change: ConsolePluginChange): PluginActionOutcome {
  return change.operationError === null
    ? { ok: true, error: null, unknown: false }
    : { ok: false, error: describeError(change.operationError), unknown: false };
}
