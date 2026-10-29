import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-user-approval'

/**
 * 按 dsh 真实的派发方式触发事件。
 *
 * 分发模式不能随便挑：`approval/request` 在 dsh 里是 waterfall（要串起下游决策），
 * `session/event` / `agent/status` 是同步 emit。用错模式会让被测插件的回调拿到
 * 与生产环境不同的参数或返回语义，测试就失去意义了。
 */

/** 触发 `session/event`（同步，与 dsh-session 内部一致）。 */
export function emitSessionEvent(ctx: Context, session: Session, event: SessionEvent): void {
  ctx.emit('session/event', session, event)
}

/** 触发 `agent/status`。 */
export function emitAgentStatus(ctx: Context, agent: unknown, status: 'idle' | 'running'): void {
  // agent 在测试里通常是结构替身，这里收回事件载荷要求的真实 Agent 类型。
  ctx.emit('agent/status', { agent: agent as Agent, status })
}

/**
 * 触发 `approval/request` waterfall，并给出下游决策。
 *
 * @param ctx - 被测插件所在的 Context。
 * @param request - 授权请求载荷；测试里通常只填被测插件会读的字段。
 * @param decide - 模拟「下游（真正的 UI/策略）如何裁决」；不调用即代表监听器否决。
 *   注意瀑布链在第一个返回值的监听器处结束——只有前面的监听器都调了 `next()`，`decide` 才会执行。
 * @returns 最外层监听器的返回值，即最终决策。
 */
export function requestApproval(
  ctx: Context,
  request: unknown,
  decide: () => unknown,
): Promise<unknown> {
  // 载荷与决策都是测试自己造的松动形状，这里收回 waterfall 的静态签名。
  const waterfall = ctx.waterfall as unknown as (
    name: string,
    request: unknown,
    decide: () => unknown,
  ) => Promise<unknown>
  return waterfall('approval/request', request, decide)
}

/**
 * 触发 `user-questions/request` waterfall，并给出下游回答。
 *
 * 与 {@link requestApproval} 同形：链同样在第一个返回值的监听器处结束，第三个参数
 * 只有前面都调了 `next()` 才会执行。
 *
 * @param ctx - 被测插件所在的 Context。
 * @param request - 提问载荷；测试里通常只填被测插件会读的字段。
 * @param answer - 模拟「下游（真正的 UI）如何作答」。
 * @returns 最外层监听器的返回值，即最终回答。
 */
export function requestUserQuestions(
  ctx: Context,
  request: unknown,
  answer: () => unknown,
): Promise<unknown> {
  const waterfall = ctx.waterfall as unknown as (
    name: string,
    request: unknown,
    answer: () => unknown,
  ) => Promise<unknown>
  return waterfall('user-questions/request', request, answer)
}
