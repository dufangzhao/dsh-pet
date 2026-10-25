import type { CapabilityMethods, PluginModule, PluginRuntimeContext } from '@pet/host-kernel';

import {
  FAST_CLEANUP_BEGIN,
  FAST_CLEANUP_END,
  FAST_EFFECT_START,
  FIXTURE_ERROR_ACTIVATION,
  PRIMARY_EFFECT_START,
  PRIMARY_EFFECT_STOP,
  PROVIDER_ACTIVATE,
  PROVIDER_DISPOSE,
  SECONDARY_EFFECT_START,
  SECONDARY_EFFECT_STOP,
  SLOW_ACTIVATE_BEGIN,
  SLOW_ACTIVATE_END,
  STUCK_CLEANUP_BEGIN,
  STUCK_CLEANUP_END,
  STUCK_EFFECT_START,
} from './markers.js';

/**
 * M1-08 首批可复用参考夹具（doc22「测试夹具接口」）。
 *
 * 约束：
 * - 只依赖 `@pet/host-kernel` 的纯类型，运行时不导入 Cordis、Electron 或任何宿主实现；
 * - 不启动子进程、不安装真实 OS 定时器、不访问网络、不落盘；
 * - 卡住的激活/清理用永不 settle 的 Promise 表达，由 `release()` 显式放行；
 * - 事件与异常只含本文件里的固定标记，不回显调用方数据。
 */

/** 夹具句柄：模块本体 + 按发生顺序追加的事件日志。 */
export interface FixtureHandle {
  readonly module: PluginModule;
  readonly events: string[];
}

/** 带显式放行开关的夹具句柄（slow / stuckCleanup）。 */
export interface ReleasingFixtureHandle extends FixtureHandle {
  /** 放行当前挂起的激活或清理；可重复调用，后续调用为空操作。 */
  release(): void;
}

/**
 * 记录型夹具：激活时登记两个 effect 并记录启动，清理时记录停止。
 * 两个 effect 让宿主测试可以验证清理是否按登记逆序执行。
 */
export function makeRecordingPlugin(): FixtureHandle {
  const events: string[] = [];
  const module: PluginModule = {
    activate(context: PluginRuntimeContext): void {
      context.effect(() => {
        events.push(PRIMARY_EFFECT_START);
        return () => {
          events.push(PRIMARY_EFFECT_STOP);
        };
      });
      context.effect(() => {
        events.push(SECONDARY_EFFECT_START);
        return () => {
          events.push(SECONDARY_EFFECT_STOP);
        };
      });
    },
  };
  return { module, events };
}

/**
 * 失败型夹具：登记两个 effect 后立刻抛出固定测试异常，用于验证宿主是否
 * 逆序收尾已登记的资源并隐藏未完成的注册。
 */
export function makeFailingPlugin(): FixtureHandle {
  const events: string[] = [];
  const module: PluginModule = {
    activate(context: PluginRuntimeContext): void {
      context.effect(() => {
        events.push(PRIMARY_EFFECT_START);
        return () => {
          events.push(PRIMARY_EFFECT_STOP);
        };
      });
      context.effect(() => {
        events.push(SECONDARY_EFFECT_START);
        return () => {
          events.push(SECONDARY_EFFECT_STOP);
        };
      });
      throw new Error(FIXTURE_ERROR_ACTIVATION);
    },
  };
  return { module, events };
}

/**
 * 慢插件：激活返回的 Promise 在 `release()` 之前不会完成，用于验证启用时限。
 * 先于激活调用 `release()` 时，激活在下一个微任务即可完成（不会永久挂起）。
 */
export function makeSlowPlugin(): ReleasingFixtureHandle {
  const events: string[] = [];
  let releaseActivation: (() => void) | undefined;
  let released = false;
  const activationGate = new Promise<void>((resolve) => {
    releaseActivation = resolve;
  });
  const release = (): void => {
    if (released) return;
    released = true;
    releaseActivation?.();
  };
  const module: PluginModule = {
    activate(context: PluginRuntimeContext): Promise<void> {
      events.push(SLOW_ACTIVATE_BEGIN);
      context.effect(() => {
        events.push(PRIMARY_EFFECT_START);
        return () => {
          events.push(PRIMARY_EFFECT_STOP);
        };
      });
      return activationGate.then(() => {
        events.push(SLOW_ACTIVATE_END);
      });
    },
  };
  return { module, events, release };
}

/**
 * 卡住清理夹具：fast effect 先登记、stuck effect 后登记，按逆序清理时先进入
 * stuck；stuck 的清理 Promise 在 `release()` 之前不会 settle，因此 fast 的清理
 * 也不会开始。整个过程不使用真实定时器，也不持有任何进程/句柄。
 */
export function makeStuckCleanupPlugin(): ReleasingFixtureHandle {
  const events: string[] = [];
  let releaseCleanup: (() => void) | undefined;
  let released = false;
  const cleanupGate = new Promise<void>((resolve) => {
    releaseCleanup = resolve;
  });
  const release = (): void => {
    if (released) return;
    released = true;
    releaseCleanup?.();
  };
  const module: PluginModule = {
    activate(context: PluginRuntimeContext): void {
      context.effect(() => {
        events.push(FAST_EFFECT_START);
        return async () => {
          events.push(FAST_CLEANUP_BEGIN);
          events.push(FAST_CLEANUP_END);
        };
      });
      context.effect(() => {
        events.push(STUCK_EFFECT_START);
        return async () => {
          events.push(STUCK_CLEANUP_BEGIN);
          await cleanupGate;
          events.push(STUCK_CLEANUP_END);
        };
      });
    },
  };
  return { module, events, release };
}

/**
 * 提供方夹具：按参数注册 providerId 与方法表，并记录提供方生命周期。
 * 方法表原样交给宿主（不复制、不冻结、不包装），宿主测试可以断言同一性。
 */
export function makeProviderPlugin(providerId: string, methods: CapabilityMethods): FixtureHandle {
  const events: string[] = [];
  const module: PluginModule = {
    activate(context: PluginRuntimeContext): void {
      context.provide(providerId, methods);
      context.effect(() => {
        events.push(PROVIDER_ACTIVATE);
        return () => {
          events.push(PROVIDER_DISPOSE);
        };
      });
    },
  };
  return { module, events };
}
