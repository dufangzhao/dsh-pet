import type { DemoReplyMode, JsonObject, OwnerRef } from '@pet/contracts';
import { useCallback, useRef, useState } from 'react';

import { CALL_REJECTED, COPY, describeError } from './copy.js';

/** Demo 的两条本机配置：各自的 owner 与 revision 都来自宿主快照。 */
export type DemoSetting = 'asr' | 'voice';

export interface SettingOutcome {
  ok: boolean;
  error: string | null;
}

export interface DemoSettingsState {
  pending: ReadonlySet<DemoSetting>;
  /** asr 配置 { model: 所选 id }；用户没选时传 null，宿主按未选处理。 */
  saveAsrModel: (
    owner: OwnerRef | null,
    expectedRevision: number,
    modelId: string | null,
  ) => Promise<SettingOutcome>;
  /** voice 配置 { mode, autoSend }：一次写整个对象，不留半个状态。 */
  saveVoice: (
    owner: OwnerRef | null,
    expectedRevision: number,
    mode: DemoReplyMode,
    autoSend: boolean,
  ) => Promise<SettingOutcome>;
}

function failure(error: string): SettingOutcome {
  return { ok: false, error };
}

/**
 * 用现有的 inspectConfig/saveConfig 写 Demo 配置，不新造一条配置通路。
 *
 * expectedRevision 用宿主刚给的那份：记录被别人改过就是 conflict，这里只报事实，
 * 不自动重读覆盖，也不假装保存成功。
 */
export function useDemoSettings(): DemoSettingsState {
  const [pending, setPending] = useState<ReadonlySet<DemoSetting>>(new Set());
  const inFlight = useRef(new Set<DemoSetting>());

  const save = useCallback(
    async (
      setting: DemoSetting,
      owner: OwnerRef | null,
      expectedRevision: number,
      data: JsonObject,
    ): Promise<SettingOutcome> => {
      const bridge = window.petConsole;
      if (bridge === undefined) {
        return failure(COPY.missingBridge);
      }
      if (owner === null) {
        return failure('本机没有这个插件，配置没处可写。');
      }
      if (inFlight.current.has(setting)) {
        return failure(BUSY_TEXT);
      }
      inFlight.current.add(setting);
      setPending((current) => new Set(current).add(setting));
      try {
        const inspected = await bridge.inspectConfig(owner);
        if (!inspected.ok) return failure(describeError(inspected.error));
        if ((inspected.value.snapshot?.revision ?? 0) !== expectedRevision)
          return failure(CONFLICT_TEXT);
        const candidate = {
          ...(inspected.value.snapshot?.data ?? inspected.value.definition.defaults),
          ...data,
        };
        const result = await bridge.saveConfig({ owner, expectedRevision, data: candidate });
        if (!result.ok) {
          return result.error.code === 'conflict'
            ? failure(CONFLICT_TEXT)
            : failure(describeError(result.error));
        }
        // 这两份配置都是立即生效的，成功没有额外要说的：选项本身就是回执。
        return { ok: true, error: null };
      } catch {
        return failure(CALL_REJECTED);
      } finally {
        inFlight.current.delete(setting);
        setPending((current) => {
          if (!current.has(setting)) {
            return current;
          }
          const next = new Set(current);
          next.delete(setting);
          return next;
        });
      }
    },
    [],
  );

  return {
    pending,
    saveAsrModel: (owner, expectedRevision, modelId) =>
      save('asr', owner, expectedRevision, { model: modelId }),
    saveVoice: (owner, expectedRevision, mode, autoSend) =>
      save('voice', owner, expectedRevision, { mode, autoSend }),
  };
}

const BUSY_TEXT = '上一个保存还没结束。';
const CONFLICT_TEXT = '这条配置已被别处改过，保存被拒绝；刷新后重新选一次。';
