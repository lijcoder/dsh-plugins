import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import type { Config } from './config.js'
import { provideWecom } from './wecom.js'
import { registerNotify } from './notify.js'
import { registerCommands } from './commands.js'

export { Config } from './config.js'
export { WecomConnection, provideWecom } from './wecom.js'
export type { WecomInboundMessage, WecomMessageHandler, WecomOptions } from './wecom.js'
export { WecomCommandRouter, parseCommand, registerCommands } from './commands.js'
export type { WecomCommand } from './commands.js'
export { CompletionCollector, registerNotify, renderApproval, renderNotification, isTopLevel, truncateUtf8 } from './notify.js'
export type { ApprovalNeeded, ApprovalStyle, Completion, NotificationStyle, Outcome, SessionFacts } from './notify.js'

/** Cordis 插件名，同时是诊断日志里的标识。 */
export const name = 'dsh-notify-wecom'

/**
 * 依赖的服务：`/list` 要枚举活着的 agent，标题要读 `title` 投影。
 * cordis 里访问别的插件提供的服务必须先声明 inject，否则读 `ctx.agents` 直接抛。
 * （`ctx.wecom` 是本插件自己 provide 的，同 fiber 使用，不需要也不该 inject——会自我等待。）
 */
export const inject = ['agents', 'sessionProjections']

/**
 * 插件入口。
 *
 * `provideWecom` 把 aibot 长连接注册成 `ctx.wecom`，其余功能都从它取同一条连接：
 * `registerNotify` 发通知，`registerCommands` 响应 `/` 命令。
 * 以后加「用企微消息驱动 DSH」，同样取 `ctx.wecom` 即可，不必再建连接。
 */
export function apply(ctx: Context, config: Config): void {
  provideWecom(ctx, config)
  registerNotify(ctx, config)
  if (config.includeCommands) registerCommands(ctx, config)
}
