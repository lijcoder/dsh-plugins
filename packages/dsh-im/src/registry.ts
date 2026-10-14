import { Context, Service } from '@deepseek-ai/cordis'
import type { ImChannel, ImMessage } from './types.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    im: ImRegistry
  }
}

/**
 * 即时通讯通道的命名注册表。
 *
 * 形状照 dsh 自己的多实现能力（`ctx.llm` / `ctx.browserUse`）：单数 Context key +
 * 命名注册。区别是这里**允许注册多个通道**——企微做通知、飞书做别的，是真实需求，
 * 没必要等到那时再改设计。
 *
 * 两个方向在这里汇合：
 * - **出站**：`channel(name)` 取通道后 `send`；
 * - **入站**：`onMessage(handler)` 订阅**所有**通道的消息，不必先知道哪个通道存在。
 *
 * 入站为什么要经过注册表：loader 是「先 `await import` 模块、再创建 fiber，且不等激活」，
 * 所以**行序不决定激活顺序**。功能若在挂载时就去解析某个具体通道，早晚会撞上
 * 「通道还没注册」的竞态——那时功能直接挂载失败。把入站收进接缝后，功能的挂载
 * 不再依赖任何通道的时机。
 */
export class ImRegistry extends Service {
  private readonly channels = new Map<string, ImChannel>()
  private readonly handlers = new Set<(message: ImMessage) => void>()

  constructor(ctx: Context) {
    super(ctx, 'im')
  }

  /**
   * 注册一个通道，随当前 fiber 卸载而注销。
   *
   * 注册表会订阅该通道的入站消息，转发给 {@link onMessage} 的订阅者，
   * 并按**注册名**填写 `message.channel`（通道自报的 channel 不作数——
   * 两个来源早晚会对不上）。
   *
   * @param name - 通道名，消费方在配置里用这个名字指定通道（如 `wecom`）。
   * @param channel - 通道实现。
   * @returns 注销该注册的 disposer。
   * @throws 同名通道已注册时。
   */
  registerChannel(name: string, channel: ImChannel): () => Promise<void> {
    if (this.channels.has(name)) {
      throw new Error(`IM 通道 "${name}" 已注册`)
    }
    return this.ctx.effect(() => {
      this.channels.set(name, channel)
      const off = channel.onMessage((message) => {
        for (const handler of this.handlers) handler({ ...message, channel: name })
      })
      return () => {
        off()
        this.channels.delete(name)
      }
    }, 'im.registerChannel()')
  }

  /**
   * 订阅所有通道的入站消息，随当前 fiber 卸载而注销。
   *
   * 挂载即可订阅，**不要求此刻已经有通道**——通道后到也能收到它的消息。
   * 订阅者按 `message.channel` 自己判断要不要处理。
   *
   * @param handler - 收到消息时调用。
   * @returns 取消订阅函数。
   */
  onMessage(handler: (message: ImMessage) => void): () => void {
    return this.ctx.effect(() => {
      this.handlers.add(handler)
      return () => {
        this.handlers.delete(handler)
      }
    }, 'im.onMessage()')
  }

  /**
   * 取一个通道。
   *
   * 不指名时只在「恰好注册了一个」的情况下返回它——多个通道共存时要求显式选择，
   * 否则消息发错地方是静默的。
   *
   * @param name - 通道名；省略则取唯一的那个通道。
   * @returns 该通道。
   * @throws 指名但不存在、或未指名而通道数不为 1 时。
   */
  channel(name?: string): ImChannel {
    if (name === undefined) {
      if (this.channels.size === 1) return this.channels.values().next().value!
      if (this.channels.size === 0) throw new Error('还没有注册任何 IM 通道')
      throw new Error(`注册了多个 IM 通道，配置里必须显式指定 channel：${this.list().join('、')}`)
    }
    const found = this.channels.get(name)
    if (!found) {
      throw new Error(`没有名为 "${name}" 的 IM 通道；已注册：${this.list().join('、') || '（无）'}`)
    }
    return found
  }

  /** 已注册的通道名。 */
  list(): readonly string[] {
    return [...this.channels.keys()]
  }
}

export default ImRegistry
