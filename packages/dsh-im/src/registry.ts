import { Context, Service } from '@deepseek-ai/cordis'
import type { ImChannel } from './types.js'

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
 * 通道实现方 `inject: ['im']` 后调用 {@link registerChannel}；消费方（通知、命令等功能）
 * 同样 `inject: ['im']` 后调用 {@link channel} 取用。
 */
export class ImRegistry extends Service {
  private readonly channels = new Map<string, ImChannel>()

  constructor(ctx: Context) {
    super(ctx, 'im')
  }

  /**
   * 注册一个通道，随当前 fiber 卸载而注销。
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
      return () => {
        this.channels.delete(name)
      }
    }, 'im.registerChannel()')
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
