import type { Context } from '@deepseek-ai/cordis'
import type {} from '@lijcoder/dsh-im'
import { provideWecomChannel } from './channel.js'
import type { Config } from './config.js'

export { Config } from './config.js'
export { WECOM, provideWecomChannel } from './channel.js'
export type { WecomChannelOptions } from './channel.js'
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

/** 插件入口：建连并注册通道。 */
export function apply(ctx: Context, config: Config): void {
  provideWecomChannel(ctx, config)
}
