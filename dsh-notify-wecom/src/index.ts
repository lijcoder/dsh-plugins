import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import type { Config } from './config.js'
import { provideWecom } from './wecom.js'
import { registerNotify } from './notify.js'

export { Config } from './config.js'
export { WecomConnection, provideWecom } from './wecom.js'
export type { WecomOptions } from './wecom.js'
export { CompletionCollector, registerNotify, renderApproval, renderNotification, isTopLevel, truncateUtf8 } from './notify.js'
export type { ApprovalNeeded, ApprovalStyle, Completion, NotificationStyle, Outcome, SessionFacts } from './notify.js'

/** Cordis 插件名，同时是诊断日志里的标识。 */
export const name = 'dsh-notify-wecom'

/** 会话标题从 `title` 投影读，所以等投影服务就绪再挂载。 */
export const inject = ['sessionProjections']

/**
 * 插件入口。
 *
 * `provideWecom` 把 aibot 长连接注册成 `ctx.wecom`，`registerNotify` 是它的第一个使用者。
 * 以后加「用企微消息驱动 DSH」，新功能照样取 `ctx.wecom` 就行，不必再建连接。
 */
export function apply(ctx: Context, config: Config): void {
  provideWecom(ctx, config)
  registerNotify(ctx, config)
}
