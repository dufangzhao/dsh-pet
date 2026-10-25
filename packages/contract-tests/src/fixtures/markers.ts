/**
 * M1-08 首批参考夹具的固定公开标记。
 *
 * 这些字面量是夹具对宿主测试暴露的唯一可观察契约：测试可以直接按字面量断言，
 * 夹具也不会把任何调用方数据（配置、方法表、用户内容）拼进事件或异常。
 */

/** `makeFailingPlugin` 激活时抛出的固定异常消息，不含任何用户内容。 */
export const FIXTURE_ERROR_ACTIVATION = 'contract-tests fixture: activation failure';

/** 记录型/失败型/慢插件的主 effect 事件。 */
export const PRIMARY_EFFECT_START = 'effect:primary:start';
export const PRIMARY_EFFECT_STOP = 'effect:primary:stop';

/** 记录型/失败型的次 effect 事件，用于验证清理是否按登记逆序执行。 */
export const SECONDARY_EFFECT_START = 'effect:secondary:start';
export const SECONDARY_EFFECT_STOP = 'effect:secondary:stop';

/** `makeSlowPlugin` 的激活进度事件；`release()` 之前激活不结束。 */
export const SLOW_ACTIVATE_BEGIN = 'activate:begin';
export const SLOW_ACTIVATE_END = 'activate:end';

/**
 * `makeStuckCleanupPlugin` 的事件。
 *
 * 登记顺序是 fast → stuck，因此按逆序清理时先进入 stuck：stuck 清理在
 * `release()` 之前不会结束，fast 清理也就不会被触发。
 */
export const FAST_EFFECT_START = 'effect:fast:start';
export const FAST_CLEANUP_BEGIN = 'cleanup:fast:begin';
export const FAST_CLEANUP_END = 'cleanup:fast:end';
export const STUCK_EFFECT_START = 'effect:stuck:start';
export const STUCK_CLEANUP_BEGIN = 'cleanup:stuck:begin';
export const STUCK_CLEANUP_END = 'cleanup:stuck:end';

/** `makeProviderPlugin` 的提供方生命周期事件。 */
export const PROVIDER_ACTIVATE = 'provider:activate';
export const PROVIDER_DISPOSE = 'provider:dispose';
