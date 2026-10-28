/**
 * 桌宠与宿主应用桥（window.petApplication）之间唯一的通道。
 *
 * 只读宿主真的给的东西：ApplicationSnapshot 里有什么就显示什么。桥缺失时不显示
 * 任何“应用状态”，也不把本地猜测当成宿主状态；读取/提交失败一律带来源，说明是
 * 哪一次调用失败，错误名取自 @pet/contracts 的固定表。
 *
 * 生命周期：
 * - onChanged 只通知“变了”，内容仍以 getSnapshot 为准；每次读取带序号，迟到的
 *   回复（组件已卸载，或已被更新的一次读取取代）一律丢弃。
 * - 卸载时释放订阅；解除订阅本身失败不影响卸载。
 * - answer/startGuide 是一次性动作：在途期间不重复提交同一次点击。
 */
import {
  errorMessage,
  type ApplicationBridge,
  type ApplicationDialog,
  type ApplicationPreferences,
  type ApplicationSnapshot,
  type KernelError,
  type Result,
} from '@pet/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

import { PET_COPY } from './copy.js';
import type { PetGesture } from './pet-gesture.js';

/** 桌宠真的会用的方法。缺任何一个都算没连上，不能拿着半套接口显示“已连接”。 */
const REQUIRED_METHODS = ['getSnapshot', 'onChanged', 'answer', 'interact', 'startGuide'] as const;

export function isApplicationBridge(value: unknown): value is ApplicationBridge {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return REQUIRED_METHODS.every((name) => typeof candidate[name] === 'function');
}

/**
 * 不做全局 Window 类型扩展（preload 的声明由主会话维护）；读取时做一次结构校验，
 * 缺失时页面照常渲染，不伪造任何应用状态。
 */
export function readApplicationBridge(target: unknown = globalThis): ApplicationBridge | null {
  if (typeof target !== 'object' || target === null) return null;
  const candidate = (target as { petApplication?: unknown }).petApplication;
  return isApplicationBridge(candidate) ? candidate : null;
}

/** 固定错误名 + 调用来源；不猜成功，也不回显宿主以外的内容。 */
export function applicationFailureText(prefix: string, error: KernelError | null): string {
  return prefix + (error === null ? PET_COPY.app.unknownFailure : errorMessage(error));
}

/** 快照里宿主自己报的错误；没有快照或没有错误时不显示。 */
export function applicationSnapshotErrorText(snapshot: ApplicationSnapshot | null): string | null {
  const error = snapshot === null ? null : snapshot.error;
  if (error === null) return null;
  return applicationFailureText(PET_COPY.app.snapshotError, error);
}

export type ApplicationFailureSource = 'read' | 'answer' | 'guide' | 'interact';

/**
 * 会写进同一条记录的动作。
 *
 * 物理动作（戳/摸/拖动）由手势判定给出；表情只在它真的出现在屏幕上之后才记，
 * 这一点由调用方保证（见 expression.ts），不在这里替宿主编。
 */
export type ApplicationReaction = PetGesture | 'blush' | 'happy';

export interface ApplicationFailure {
  readonly source: ApplicationFailureSource;
  readonly text: string;
}

export interface UseApplicationOptions {
  /** 测试注入；正常运行时从 window.petApplication 读取。 */
  bridge?: ApplicationBridge | null;
}

export interface ApplicationView {
  available: boolean;
  snapshot: ApplicationSnapshot | null;
  /** 还没读到 profile 时为 null，界面沿用窗口原型自带的形态。 */
  profile: ApplicationPreferences | null;
  /** 当前唯一的可操作提示；宿主没给就没有，本地不自造引导步骤。 */
  dialog: ApplicationDialog | null;
  failure: ApplicationFailure | null;
  /** 本地在途：宿主回执到达前挡住同一份提示的重复提交。 */
  answerBusy: boolean;
  guideBusy: boolean;
  readBusy: boolean;
  answer(dialog: ApplicationDialog, choice: string, text?: string): void;
  startGuide(): void;
  /** 物理动作直接记；表情只在真的画到屏幕上之后记（见 expression.ts）。 */
  interact(kind: ApplicationReaction): void;
  reload(): void;
}

export function useApplication(options: UseApplicationOptions = {}): ApplicationView {
  const bridgeRef = useRef<ApplicationBridge | null>(options.bridge ?? readApplicationBridge());
  const [snapshot, setSnapshot] = useState<ApplicationSnapshot | null>(null);
  const [failure, setFailure] = useState<ApplicationFailure | null>(null);
  const [answerBusy, setAnswerBusy] = useState(false);
  const [guideBusy, setGuideBusy] = useState(false);
  const [readBusy, setReadBusy] = useState(false);
  const mounted = useRef(true);
  // 只有最新一次读取的回复能落地：onChanged、手动重读与首次读取可能交叠。
  const readSeq = useRef(0);
  // 按钮要等下一次提交才禁用，同一帧里的第二次点击只能靠这个标记挡住。
  const answerInFlight = useRef(false);
  const guideInFlight = useRef(false);

  /**
   * 统一处理“宿主可能回发新快照”的调用结果。
   * ok 分支只认 value，失败分支才读 error —— 两个分支不混用，避免把成功当成失败。
   */
  const settle = useCallback(
    (
      source: ApplicationFailureSource,
      prefix: string,
      reply: Result<ApplicationSnapshot>,
    ): void => {
      if (!mounted.current) return;
      if (reply.ok) {
        setSnapshot(reply.value);
        setFailure(null);
        return;
      }
      setFailure({ source, text: applicationFailureText(prefix, reply.error) });
    },
    [],
  );

  const fail = useCallback((source: ApplicationFailureSource, prefix: string): void => {
    if (!mounted.current) return;
    setFailure({ source, text: applicationFailureText(prefix, null) });
  }, []);

  const read = useCallback((): void => {
    const bridge = bridgeRef.current;
    if (bridge === null) return;
    const seq = (readSeq.current += 1);
    setReadBusy(true);
    void Promise.resolve()
      .then(() => bridge.getSnapshot())
      .then((reply) => {
        // 迟到的回复必须整体丢弃：它描述的是更旧的世界。
        if (!mounted.current || seq !== readSeq.current) return;
        settle('read', PET_COPY.app.readFailed, reply);
      })
      .catch(() => {
        if (!mounted.current || seq !== readSeq.current) return;
        setFailure({ source: 'read', text: applicationFailureText(PET_COPY.app.readFailed, null) });
      })
      .finally(() => {
        // 被取代的那次读取不能清掉仍在途的状态，交给最新一次收尾。
        if (mounted.current && seq === readSeq.current) setReadBusy(false);
      });
  }, [settle]);

  useEffect(() => {
    mounted.current = true;
    const bridge = bridgeRef.current;
    if (bridge === null) {
      return () => {
        mounted.current = false;
      };
    }

    let unsubscribe: (() => void) | null = null;
    try {
      const result = bridge.onChanged(read);
      unsubscribe = typeof result === 'function' ? result : null;
    } catch {
      if (mounted.current) {
        setFailure({
          source: 'read',
          text: applicationFailureText(PET_COPY.app.readFailed, null),
        });
      }
    }
    read();

    return () => {
      mounted.current = false;
      if (unsubscribe !== null) {
        try {
          unsubscribe();
        } catch {
          // 解除订阅本身失败不应影响卸载。
        }
      }
    };
  }, [read]);

  const answer = useCallback(
    (dialog: ApplicationDialog, choice: string, text?: string): void => {
      const bridge = bridgeRef.current;
      if (bridge === null || dialog.busy || answerInFlight.current) return;
      answerInFlight.current = true;
      setAnswerBusy(true);
      // 请求形状完全按冻结 DTO：id/step/choice 必带，text 只在这一步真的填了才带。
      const request: Parameters<ApplicationBridge['answer']>[0] = {
        id: dialog.id,
        step: dialog.step,
        choice,
        ...(text === undefined || text === '' ? {} : { text }),
      };
      void Promise.resolve()
        .then(() => bridge.answer(request))
        .then((reply) => settle('answer', PET_COPY.app.answerFailed, reply))
        .catch(() => fail('answer', PET_COPY.app.answerFailed))
        .finally(() => {
          answerInFlight.current = false;
          if (mounted.current) setAnswerBusy(false);
        });
    },
    [fail, settle],
  );

  const startGuide = useCallback((): void => {
    const bridge = bridgeRef.current;
    if (bridge === null || guideInFlight.current) return;
    guideInFlight.current = true;
    setGuideBusy(true);
    void Promise.resolve()
      .then(() => bridge.startGuide())
      .then((reply) => settle('guide', PET_COPY.app.guideFailed, reply))
      .catch(() => fail('guide', PET_COPY.app.guideFailed))
      .finally(() => {
        guideInFlight.current = false;
        if (mounted.current) setGuideBusy(false);
      });
  }, [fail, settle]);

  const interact = useCallback(
    (kind: ApplicationReaction): void => {
      const bridge = bridgeRef.current;
      if (bridge === null) return;
      // interact 只回执 null：事件本身要等宿主通过 onChanged 推回来的快照。
      // 这里不本地插一条时间线，也不因为“调用没报错”就宣称已经记上。
      void Promise.resolve()
        .then(() => bridge.interact({ kind, via: 'bubble' }))
        .then((reply) => {
          if (!mounted.current || reply.ok) return;
          setFailure({
            source: 'interact',
            text: applicationFailureText(PET_COPY.app.interactFailed, reply.error),
          });
        })
        .catch(() => fail('interact', PET_COPY.app.interactFailed));
    },
    [fail],
  );

  return {
    available: bridgeRef.current !== null,
    snapshot,
    profile: snapshot?.profile?.data ?? null,
    dialog: snapshot?.dialog ?? null,
    failure,
    answerBusy,
    guideBusy,
    readBusy,
    answer,
    startGuide,
    interact,
    reload: read,
  };
}
