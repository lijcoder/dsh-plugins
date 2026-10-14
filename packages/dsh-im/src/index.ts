/**
 * DeepSeek Harness 能力接缝：即时通讯通道。
 *
 * 消费方只依赖这里的中立模型，不依赖任何具体平台：
 *
 * ```ts
 * export const inject = ['im']
 *
 * export function apply(ctx: Context, config: Config) {
 *   // 出站：取通道发出去（通道可以后到，所以是发送时才解析）
 *   ctx.im.channel(config.channel).send(config.target, { heading: '任务完成' })
 *   // 入站：挂载即可订阅，不要求此刻已经有通道
 *   ctx.im.onMessage((message) => { … })
 * }
 * ```
 *
 * 加一个平台 = 新增一个通道包（`@lijcoder/dsh-im-<平台>`）实现 {@link ImChannel}
 * 并 `ctx.im.registerChannel(...)`，功能侧零改动。
 *
 * @module @lijcoder/dsh-im
 */

export { ImRegistry } from './registry.js'
export { shortenCwd, truncateUtf8, utf8Length } from './text.js'
export type {
  ImCapabilities,
  ImChannel,
  ImConversation,
  ImDocument,
  ImFact,
  ImInbound,
  ImMessage,
  ImSection,
  ImSender,
  ImTable,
} from './types.js'
export { default } from './registry.js'
