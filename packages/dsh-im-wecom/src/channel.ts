import type { Context } from '@deepseek-ai/cordis'
import type { ImCapabilities, ImDocument, ImInbound } from '@lijcoder/dsh-im'
import { renderDocument } from './render.js'
import type { Config } from './config.js'
import { WecomConnection, type WecomInboundMessage, type WecomOptions } from './wecom.js'

/** 本通道在注册表里的名字，消费方在配置里用它指定 `channel`。 */
export const WECOM = 'wecom'

/** 正在跑的那条连接：记住它是用哪份凭证连的，好判断要不要重连。 */
interface Live {
  readonly botId: string
  readonly secret: string
  /** 注销通道注册并断开长连接。 */
  dispose(): Promise<void>
}

/**
 * 把企微长连接接进 `ctx.im`，并跟着 **volatile 字段的变化**重连或重读。
 *
 * 凭证是 volatile：在插件页存完，loader 只就地更新引用、不重挂插件，所以
 * 「用户刚填好凭证」这件事只会以 `loader/volatile-update` 的形式到达——开、关、换连接
 * 都得自己对着当前值做。`maxContentBytes` 也是 volatile，但它只影响渲染，刷一下即可。
 *
 * 没凭证时插件照常挂载，只是不注册通道、不建连（`registerChannel` 用通道名做唯一键，
 * 一条连不上的通道注册进去只会让功能在发送时才炸）。插件页里的表单要的正是这个状态：
 * 行是活的，namespace 才会被服务给浏览器。
 */
export function provideWecomChannel(ctx: Context, config: Config): void {
  // 这份对象与注册表里的 capabilities 是同一份引用：预算能在插件页改，所以不能快照一次，
  // sync() 每次把它刷成当前值，renderDocument 读的也是它（见 send / reply）。
  const capabilities = {
    richText: true,
    // 智能机器人这条 markdown 通道支持标准 markdown 表格。
    // 降级分支仍留在 renderDocument 里——那是声明 `tables: false` 的通道才走的路径。
    tables: true,
    maxContentBytes: config.maxContentBytes.get(),
    proactive: true,
  }
  const logger = ctx.logger('dsh-im-wecom')
  let live: Live | undefined
  /** 串行化「先断后连」：两次快速改动不会留下两条长连接。 */
  let queue: Promise<void> = Promise.resolve()
  /** 卸载后不再启停：晚到的那次同步会在已经停用的 context 上注册通道（effect 建不出来，只会抛）。 */
  let closed = false

  const stop = async (): Promise<void> => {
    const current = live
    live = undefined
    if (current !== undefined) await current.dispose()
  }

  const start = (botId: string, secret: string): void => {
    const connection = new WecomConnection({ ...options(config, botId, secret) }, logger)
    const unregister = ctx.im.registerChannel(WECOM, {
      capabilities,
      async send(target: string, document: ImDocument): Promise<void> {
        await connection.sendMarkdown(target, renderDocument(document, capabilities))
      },
      onMessage(handler) {
        return connection.onMessage((inbound) => handler(toImMessage(inbound, capabilities)))
      },
    })
    connection.start()
    live = {
      botId,
      secret,
      dispose: async () => {
        await unregister()
        await connection.stop()
      },
    }
    logger.info('企微通道已连接：botId=%s', botId)
  }

  const sync = (): void => {
    // 预算只影响渲染：先跟着引用刷成当前值，再判要不要重连。
    capabilities.maxContentBytes = config.maxContentBytes.get()
    const botId = config.botId.get()
    const secret = config.secret.get()
    if (live !== undefined && live.botId === botId && live.secret === secret) return
    queue = queue.then(async () => {
      // 排到队首时值可能又被改过、插件也可能已经被卸载，两种情况都重新判一次。
      if (closed) return
      if (live !== undefined && live.botId === botId && live.secret === secret) return
      await stop()
      if (botId === undefined || secret === undefined) {
        logger.info('企微通道未配置：在 DSH Web 的「插件」页填入机器人 ID 与 Secret 后会自动连接')
        return
      }
      start(botId, secret)
    })
  }

  ctx.on('loader/volatile-update', sync)
  ctx.effect(() => () => {
    // 卸载要「完全停稳」：先等在途的启停跑完，再断开当前这条。
    closed = true
    queue = queue.then(stop)
    return queue
  }, 'dsh-im-wecom: connection')

  sync()
}

/** 把插件配置摊成一条连接的参数；凭证单独传，因为它是 volatile 引用。 */
function options(config: Config, botId: string, secret: string): WecomOptions {
  return {
    botId,
    secret,
    scene: config.scene,
    plugVersion: config.plugVersion,
    wsUrl: config.wsUrl,
    heartbeatInterval: config.heartbeatInterval,
    reconnectInterval: config.reconnectInterval,
    maxReconnectAttempts: config.maxReconnectAttempts,
    maxAuthFailureAttempts: config.maxAuthFailureAttempts,
    requestTimeout: config.requestTimeout,
    connectTimeoutMs: config.connectTimeoutMs,
  }
}

/**
 * 企微的入站消息 → 中立消息。会话 id 在群里是 chatid、单聊是 userid。
 *
 * 不带 `channel`：通道名由注册表按注册名填写（`ctx.im.registerChannel(WECOM, …)`），
 * 两个来源早晚会对不上。
 */
function toImMessage(inbound: WecomInboundMessage, capabilities: ImCapabilities): ImInbound {
  return {
    conversation: inbound.chatId === undefined
      ? { id: inbound.userId, kind: 'direct' }
      : { id: inbound.chatId, kind: 'group' },
    sender: { id: inbound.userId },
    text: inbound.text,
    reply: (document) => inbound.reply(renderDocument(document, capabilities)),
  }
}
