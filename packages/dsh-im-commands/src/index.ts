import type { Context } from '@deepseek-ai/cordis'
import type {} from '@lijcoder/dsh-im'
import type { Config } from './config.js'
import { registerCommands } from './commands.js'

export { Config } from './config.js'
export { CommandRouter, parseCommand, registerCommands } from './commands.js'
export type { ImCommand } from './commands.js'

/** Cordis 插件名，同时是诊断日志里的标识。 */
export const name = 'dsh-im-commands'

/**
 * 依赖：
 * - `im`：收发都走通道（本插件是**消费方**，不关心通道是企业微信还是飞书）；
 * - `agents`、`sessionProjections`：`/list` 要枚举活着的会话并读 `title` 投影。
 */
export const inject = ['im', 'agents', 'sessionProjections']

/** 插件入口。 */
export function apply(ctx: Context, config: Config): void {
  registerCommands(ctx, config)
}
