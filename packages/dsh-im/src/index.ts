/**
 * DeepSeek Harness 能力接缝：即时通讯通道。
 *
 * 消费方只依赖这里的中立模型，不依赖任何具体平台：
 *
 * ```ts
 * export const inject = ['im']
 * export function apply(ctx: Context, config: Config) {
 *   const channel = ctx.im.channel(config.channel)   // 配置里指定 'wecom' / 'feishu'
 *   await channel.send(config.target, { heading: '任务完成', facts: [...] })
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
  ImMessage,
  ImSection,
  ImSender,
  ImTable,
} from './types.js'
export { default } from './registry.js'
