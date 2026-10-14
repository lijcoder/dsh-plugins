import type { Context } from '@deepseek-ai/cordis'
import type { ImCapabilities, ImChannel, ImDocument, ImInbound } from '@lijcoder/dsh-im'
import { renderDocument } from './render.js'
import { WecomConnection, type WecomInboundMessage, type WecomOptions } from './wecom.js'

/** 本通道在注册表里的名字，消费方在配置里用它指定 `channel`。 */
export const WECOM = 'wecom'

/** 通道配置 = 连接参数 + 通道自己的渲染上限。 */
export interface WecomChannelOptions extends WecomOptions {
  /** 单条内容的 UTF-8 字节预算（`replyStream` 的文档上限是 20480 字节）。 */
  maxContentBytes: number
}

/**
 * 把企微长连接接进 `ctx.im`：随插件加载建连并注册通道，随插件卸载断开。
 *
 * 这里只做"翻译"——把中立的 `ImDocument` 渲染成企微 markdown、把企微的帧归一化成
 * `ImMessage`。连接、认证、重连、超时、回执都由 {@link WecomConnection} 兜住。
 */
export function provideWecomChannel(ctx: Context, options: WecomChannelOptions): ImChannel {
  const capabilities: ImCapabilities = {
    richText: true,
    // 智能机器人这条 markdown 通道支持标准 markdown 表格。
    // 降级分支仍留在 renderDocument 里——那是声明 `tables: false` 的通道才走的路径。
    tables: true,
    maxContentBytes: options.maxContentBytes,
    proactive: true,
  }
  const connection = new WecomConnection(options, ctx.logger('dsh-im-wecom'))
  const channel: ImChannel = {
    capabilities,
    async send(target: string, document: ImDocument): Promise<void> {
      await connection.sendMarkdown(target, renderDocument(document, capabilities))
    },
    onMessage(handler) {
      return connection.onMessage((inbound) => handler(toImMessage(inbound, capabilities)))
    },
  }

  connection.start()
  ctx.im.registerChannel(WECOM, channel)
  ctx.effect(() => () => connection.stop())
  return channel
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
