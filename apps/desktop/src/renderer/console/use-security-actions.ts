import type {
  ConsoleApprovalPrompt,
  ConsoleBridge,
  ConsoleBuiltinPackage,
  ConsoleSecurityChange,
  ConsoleSecurityPlugin,
  PermissionPreset,
  Result,
} from '@pet/contracts';
import { useCallback, useRef, useState } from 'react';

import { describeError } from './copy.js';
import { ownerKey } from './labels.js';
import { isConfirmedRejection, operationOutcome } from './use-plugin-actions.js';

export interface SecurityOutcome {
  /** 这次操作是否达成；没达成时 error 是可直接展示的一句话。 */
  ok: boolean;
  error: string | null;
  /** 结果未确认：请求可能已经到了宿主，也可能没有。 */
  unknown: boolean;
}

const UNCONFIRMED: SecurityOutcome = {
  ok: false,
  error: '结果未确认，请重新读取。',
  unknown: true,
};

export interface SecurityActionState {
  /**
   * 正在进行的操作。键是 ownerKey（信任、预设）、requestId（审批）
   * 或 `restore|pluginId`（恢复内置功能）：
   * 同一个插件同时只放一个安全操作，不同插件的请求互不阻塞。
   */
  pending: ReadonlySet<string>;
  setTrust: (plugin: ConsoleSecurityPlugin, approved: boolean) => Promise<SecurityOutcome>;
  setPreset: (plugin: ConsoleSecurityPlugin, preset: PermissionPreset) => Promise<SecurityOutcome>;
  answer: (prompt: ConsoleApprovalPrompt, approved: boolean) => Promise<SecurityOutcome>;
  /** 把卸载掉的内置功能装回来；恢复不等于信任，也不会自动启用。 */
  restore: (builtin: ConsoleBuiltinPackage) => Promise<SecurityOutcome>;
}

interface SecurityActionsOptions {
  /** 应用宿主返回的两份真实快照：先采用，再判断 operationError。 */
  onApply: (change: ConsoleSecurityChange) => void;
  /** 结果没能确认时调用：两份快照都可能已经过期。 */
  onUncertain: () => void;
}

type Call = (bridge: ConsoleBridge) => Promise<Result<ConsoleSecurityChange>>;

/** 恢复内置功能的 pending 键；页面用它判断某一行的按钮是否在忙。 */
export function restoreKey(pluginId: string): string {
  return `restore|${pluginId}`;
}

/**
 * 信任确认、预设切换与审批答复的唯一入口。
 *
 * 外层 ok=true 时快照是操作之后的真实状态，一律先应用；其中的 operationError
 * 说明这次没有达成（指纹对不上、请求已超时等），原因和结果在同一份快照里，
 * 所以不再补一次读取去掩盖这次的结果。
 *
 * 外层 ok=false 有两种：宿主明确拒绝（参数不合约定、实例已失效）和桥本身不可用。
 * 后者发生在请求送出前后都有可能，因此不能声称“什么都没变”：记为未确认，
 * 界面收起旧数据，等用户自己重新读取。
 */
export function useSecurityActions({
  onApply,
  onUncertain,
}: SecurityActionsOptions): SecurityActionState {
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  // 门闩与渲染状态分开：同一事件循环里的两次点击不能都通过。
  const inFlight = useRef(new Set<string>());

  const run = useCallback(
    async (key: string, call: Call): Promise<SecurityOutcome> => {
      const bridge = window.petConsole;
      if (bridge === undefined) {
        onUncertain();
        return UNCONFIRMED;
      }
      if (inFlight.current.has(key)) {
        return { ok: false, error: '上一个操作还没结束。', unknown: false };
      }
      inFlight.current.add(key);
      setPending((current) => new Set(current).add(key));
      try {
        const result = await call(bridge);
        if (!result.ok) {
          if (isConfirmedRejection(result.error.code)) {
            return { ok: false, error: describeError(result.error), unknown: false };
          }
          onUncertain();
          return UNCONFIRMED;
        }
        onApply(result.value);
        return operationOutcome(result.value);
      } catch {
        onUncertain();
        return UNCONFIRMED;
      } finally {
        inFlight.current.delete(key);
        setPending((current) => {
          if (!current.has(key)) {
            return current;
          }
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      }
    },
    [onApply, onUncertain],
  );

  return {
    pending,
    setTrust: (plugin, approved) => {
      const expectedDigest = plugin.digest;
      // 没有指纹就没有可比较的对象，确认信任无从谈起；界面已禁用这个入口。
      if (expectedDigest === null) {
        return Promise.resolve({
          ok: false,
          error: '还没有这个插件包的指纹，无法确认来源。',
          unknown: false,
        });
      }
      return run(ownerKey(plugin.owner), (bridge) =>
        bridge.setTrust({ owner: plugin.owner, expectedDigest, approved }),
      );
    },
    setPreset: (plugin, preset) =>
      run(ownerKey(plugin.owner), (bridge) =>
        bridge.setPermissionPreset({ owner: plugin.owner, preset }),
      ),
    answer: (prompt, approved) =>
      run(prompt.requestId, (bridge) =>
        bridge.answerApproval({
          requestId: prompt.requestId,
          owner: prompt.owner,
          taskId: prompt.taskId,
          permissionDigest: prompt.permissionDigest,
          approved,
        }),
      ),
    restore: (builtin) =>
      run(restoreKey(builtin.pluginId), (bridge) =>
        bridge.restoreBuiltin({
          pluginId: builtin.pluginId,
          expectedDigest: builtin.digest,
        }),
      ),
  };
}
