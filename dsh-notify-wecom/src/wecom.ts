import { WSClient } from '@wecom/aibot-node-sdk'
import type { Logger, WSClientOptions } from '@wecom/aibot-node-sdk'
import type { Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 企微 aibot 长连接通道。现在只用来发通知，以后收消息也走这里。 */
    wecom: WecomConnection
  }
}

/** aibot 连接参数（`Config` 的连接部分）。 */
export interface WecomOptions {
  /** 机器人 ID。 */
  botId: string
  /** 机器人 Secret。 */
  secret: string
  /** 透传 SDK 的场景值。 */
  scene?: number
  /** 透传 SDK 的插件版本号。 */
  plugVersion?: string
  /** 自定义长连接地址（私有化部署用）。 */
  wsUrl?: string
  /** 心跳间隔（毫秒）。 */
  heartbeatInterval: number
  /** 重连基础延迟（毫秒），SDK 按指数退避递增。 */
  reconnectInterval: number
  /** 最大重连次数，-1 表示无限。 */
  maxReconnectAttempts: number
  /** 认证失败最大重试次数，-1 表示无限。 */
  maxAuthFailureAttempts: number
  /** 单条消息等待回执的超时（毫秒）。 */
  requestTimeout: number
  /** 等待认证成功的上限（毫秒）。 */
  connectTimeoutMs: number
}

/**
 * 企业微信智能机器人长连接。
 *
 * 现在只有「发」：认证后往指定会话推 markdown。
 *
 * 以后要「收」——用企微消息驱动 DSH——在 {@link start} 里加一行
 * `client.on('message.text', ...)`，把消息交给自己的业务处理即可：
 * 连接、认证、重连、超时、发送回执都由本类兜住，业务侧不碰 SDK。
 */
export class WecomConnection {
  private client: WSClient | undefined
  private readonly authenticated = deferred()
  private readonly inflight = new Set<Promise<unknown>>()

  constructor(
    private readonly options: WecomOptions,
    private readonly logger: Logger,
  ) {}

  start(): void {
    const client = new WSClient(this.sdkOptions())
    this.client = client
    client.on('authenticated', () => this.authenticated.resolve())
    client.connect()
  }

  /** 发一条 markdown。未认证时先等认证，超时抛错。 */
  async sendMarkdown(chatId: string, content: string): Promise<void> {
    const client = this.client
    if (client === undefined) throw new Error('企微连接尚未启动')
    await withTimeout(this.authenticated.promise, this.options.connectTimeoutMs, '等待企微认证超时')

    // 只把真正在网上的那一段记进 inflight，卸载时的等待才受 requestTimeout 约束。
    const pending = client.sendMessage(chatId, { msgtype: 'markdown', markdown: { content } })
    this.inflight.add(pending)
    try {
      await pending
    } catch (error) {
      throw sendFailure(error)
    } finally {
      this.inflight.delete(pending)
    }
  }

  /** 断开连接。先等在途发送结束——每条发送本身受 `requestTimeout` 约束。 */
  async stop(): Promise<void> {
    await Promise.allSettled([...this.inflight])
    this.client?.disconnect()
    this.client = undefined
  }

  private sdkOptions(): WSClientOptions {
    return {
      botId: this.options.botId,
      secret: this.options.secret,
      scene: this.options.scene,
      plug_version: this.options.plugVersion,
      wsUrl: this.options.wsUrl,
      heartbeatInterval: this.options.heartbeatInterval,
      reconnectInterval: this.options.reconnectInterval,
      maxReconnectAttempts: this.options.maxReconnectAttempts,
      maxAuthFailureAttempts: this.options.maxAuthFailureAttempts,
      requestTimeout: this.options.requestTimeout,
      logger: this.logger,
    }
  }
}

/** 把连接注册成 `ctx.wecom`：随插件加载建立，随插件卸载断开。 */
export function provideWecom(ctx: Context, options: WecomOptions): WecomConnection {
  const connection = new WecomConnection(options, ctx.logger('dsh-notify-wecom'))
  connection.start()
  ctx.provide('wecom', connection)
  ctx.effect(() => () => connection.stop())
  return connection
}

/** SDK 在 errcode 非 0 时用回执帧（不是 Error）reject，这里转成能读的 Error。 */
function sendFailure(error: unknown): Error {
  if (error instanceof Error) return error
  const frame = error as { errcode?: number; errmsg?: string }
  return new Error(`企微发送被拒绝：errcode=${frame.errcode} errmsg=${frame.errmsg ?? ''}`)
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function withTimeout(promise: Promise<void>, ms: number, message: string): Promise<void> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
    timer.unref()
  })
  try {
    await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}
