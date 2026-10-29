import type { Context } from '@deepseek-ai/cordis'
import type {} from '@lijcoder/dsh-im'
import type { Config } from './config.js'
import { registerNotify } from './notify.js'

export { Config } from './config.js'
export {
  approvalDocument,
  CompletionCollector,
  isTopLevel,
  notificationDocument,
  registerNotify,
  styleOf,
} from './notify.js'
export type {
  ApprovalNeeded,
  ApprovalStyle,
  Completion,
  NotificationStyle,
  Outcome,
  SessionFacts,
} from './notify.js'

/** Cordis 插件名，同时是诊断日志里的标识。 */
export const name = 'dsh-notify'

/**
 * 依赖：
 * - `im`：往哪个通道发（本插件是**消费方**，不关心通道是企业微信还是飞书）；
 * - `agents`：读 `agent/status` 上的会话并枚举活着的会话；
 * - `sessionProjections`：读 `title` 投影拿真正的会话标题。
 */
export const inject = ['im', 'agents', 'sessionProjections']

/** 插件入口。 */
export function apply(ctx: Context, config: Config): void {
  registerNotify(ctx, config)
}
