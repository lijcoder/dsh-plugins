import type { Context } from '@deepseek-ai/cordis'
import type {} from '@lijcoder/dsh-im'
// 只为 `loader/volatile-update` 的事件声明：凭证是 volatile，改完由 loader 就地更新引用。
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { provideWecomChannel } from './channel.js'
import type { Config } from './config.js'

export { Config } from './config.js'
export { WECOM, provideWecomChannel } from './channel.js'
export { WecomConnection } from './wecom.js'
export type { WecomInboundMessage, WecomMessageHandler, WecomOptions } from './wecom.js'
export { renderDocument, shortenCwd, truncateUtf8, utf8Length } from './render.js'

/** Cordis 插件名，同时是诊断日志里的标识。 */
export const name = 'dsh-im-wecom'

/**
 * 依赖接缝：本插件是通道**实现方**，往 `ctx.im` 注册 `wecom`。
 * 消费方（通知、命令等功能）注入的也是 `im`，从注册表里按名字取。
 */
export const inject = ['im']

/**
 * 插件入口：按当前凭证建连并注册通道。
 *
 * 凭证缺失不是错误——那是「还没配」：插件照常挂载（否则设置里的表单根本不会出现），
 * 通道保持空闲，等插件页里填好凭证后再连。
 */
export function apply(ctx: Context, config: Config): void {
  provideWecomChannel(ctx, config)
}
