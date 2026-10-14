/**
 * 本地 Mock 企业微信长连接服务端。
 *
 * 实现了 SDK 依赖的最小协议：aibot_subscribe 认证、aibot_msg_callback 消息推送、
 * aibot_event_callback 事件推送、aibot_respond_* / aibot_send_msg 回执、临时素材三步上传，
 * 以及一个用于验证 downloadFile 解密的加密下载接口。
 *
 * 用途：不依赖真实企微环境，端到端验证机器人的消息处理与回复链路。
 */
import { createCipheriv, randomBytes } from 'node:crypto'
import http from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'

export interface RecordedFrame {
  cmd?: string
  headers: { req_id: string; [key: string]: unknown }
  body?: any
  errcode?: number
  errmsg?: string
}

interface Waiter {
  predicate: (frame: RecordedFrame) => boolean
  resolve: (frame: RecordedFrame) => void
  timer: NodeJS.Timeout
}

export interface MockServerInfo {
  port: number
  wsUrl: string
  httpUrl: string
}

export interface WaitForOptions {
  timeoutMs?: number
  /** 从该下标开始匹配已记录帧（默认只匹配调用之后新到的帧） */
  since?: number
}

export class MockWecomServer {
  /** 收到的全部客户端帧 */
  readonly received: RecordedFrame[] = []
  authenticated = false

  /**
   * 当前是否还有已连接的客户端。
   *
   * 真实企微对同一个 botId 只保留最新一条长连接（新连接会把旧的顶掉），
   * 所以这里同样只跟踪最新一条 socket——这是刻意的忠实模拟，不是简化。
   */
  get connected(): boolean {
    return this.socket !== null
  }

  private readonly httpServer: http.Server
  private readonly wss: WebSocketServer
  private readonly waiters = new Set<Waiter>()
  private readonly downloads = new Map<string, { data: Buffer; filename: string }>()
  private socket: WebSocket | null = null
  private info: MockServerInfo | null = null
  private seq = 0
  private uploadSeq = 0

  constructor() {
    this.httpServer = http.createServer((req, res) => this.handleHttp(req, res))
    this.wss = new WebSocketServer({ server: this.httpServer })
    this.wss.on('connection', (socket) => this.handleConnection(socket))
  }

  async start(): Promise<MockServerInfo> {
    await new Promise<void>((resolve, reject) => {
      this.httpServer.once('error', reject)
      this.httpServer.listen(0, '127.0.0.1', () => resolve())
    })
    const address = this.httpServer.address()
    if (address === null || typeof address === 'string') throw new Error('mock server 启动失败：无法获取端口')
    this.info = {
      port: address.port,
      wsUrl: `ws://127.0.0.1:${address.port}`,
      httpUrl: `http://127.0.0.1:${address.port}`,
    }
    return this.info
  }

  async close(): Promise<void> {
    for (const waiter of this.waiters) clearTimeout(waiter.timer)
    this.waiters.clear()
    this.socket?.close()
    this.socket = null
    await new Promise<void>((resolve) => this.wss.close(() => resolve()))
    await new Promise<void>((resolve) => this.httpServer.close(() => resolve()))
  }

  /** 等待第一个满足条件的客户端帧 */
  waitFor(predicate: (frame: RecordedFrame) => boolean, options: WaitForOptions = {}): Promise<RecordedFrame> {
    const { timeoutMs = 5000, since } = options
    const from = since ?? this.received.length
    for (let index = from; index < this.received.length; index += 1) {
      const frame = this.received[index]
      if (frame && predicate(frame)) return Promise.resolve(frame)
    }
    return new Promise<RecordedFrame>((resolve, reject) => {
      const waiter: Waiter = {
        predicate,
        resolve,
        timer: setTimeout(() => {
          this.waiters.delete(waiter)
          reject(new Error(`等待客户端帧超时（${timeoutMs}ms），已收到 ${this.received.length} 帧：${JSON.stringify(this.received.map((f) => f.cmd ?? '(ack)'))}`))
        }, timeoutMs),
      }
      this.waiters.add(waiter)
    })
  }

  /** 推送一条文本消息，返回本次回调的 req_id */
  sendTextMessage(content: string, overrides: Record<string, unknown> = {}): string {
    const reqId = `mock_msg_${(this.seq += 1)}`
    this.push({
      cmd: 'aibot_msg_callback',
      headers: { req_id: reqId },
      body: {
        msgid: reqId,
        aibotid: 'mock-bot',
        chattype: 'single',
        from: { userid: 'tester' },
        create_time: Date.now(),
        msgtype: 'text',
        text: { content },
        ...overrides,
      },
    })
    return reqId
  }

  /** 推送一条事件回调，返回本次回调的 req_id */
  sendEvent(eventtype: string, extra: Record<string, unknown> = {}): string {
    const reqId = `mock_evt_${(this.seq += 1)}`
    this.push({
      cmd: 'aibot_event_callback',
      headers: { req_id: reqId },
      body: {
        msgid: reqId,
        aibotid: 'mock-bot',
        chattype: 'single',
        from: { userid: 'tester' },
        create_time: Date.now(),
        msgtype: 'event',
        event: { eventtype, ...extra },
      },
    })
    return reqId
  }

  /** 注册一个「加密文件」下载地址，返回 url 与对应 aesKey（与企微协议一致） */
  registerEncryptedDownload(name: string, plain: Buffer, filename: string): { url: string; aesKey: string } {
    if (!this.info) throw new Error('mock server 尚未启动')
    const key = randomBytes(32)
    const padLen = 32 - (plain.length % 32)
    const padded = Buffer.concat([plain, Buffer.alloc(padLen, padLen)])
    const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16))
    cipher.setAutoPadding(false)
    const data = Buffer.concat([cipher.update(padded), cipher.final()])
    this.downloads.set(name, { data, filename })
    return { url: `${this.info.httpUrl}/download/${name}`, aesKey: key.toString('base64') }
  }

  private push(frame: RecordedFrame): void {
    if (!this.socket) throw new Error('没有已连接的客户端')
    this.socket.send(JSON.stringify(frame))
  }

  private ack(reqId: string, body?: unknown): void {
    const frame: RecordedFrame = { headers: { req_id: reqId }, errcode: 0, errmsg: 'ok' }
    if (body !== undefined) frame.body = body
    this.socket?.send(JSON.stringify(frame))
  }

  private handleConnection(socket: WebSocket): void {
    this.socket = socket
    socket.on('message', (raw) => {
      let frame: RecordedFrame
      try {
        frame = JSON.parse(raw.toString()) as RecordedFrame
      } catch {
        return
      }
      this.received.push(frame)
      this.notifyWaiters(frame)
      this.respond(frame)
    })
    socket.on('close', () => {
      if (this.socket === socket) this.socket = null
    })
  }

  private notifyWaiters(frame: RecordedFrame): void {
    for (const waiter of [...this.waiters]) {
      if (!waiter.predicate(frame)) continue
      clearTimeout(waiter.timer)
      this.waiters.delete(waiter)
      waiter.resolve(frame)
    }
  }

  /** 按 cmd 给出协议回执 */
  private respond(frame: RecordedFrame): void {
    const reqId = frame.headers.req_id
    switch (frame.cmd) {
      case 'aibot_subscribe':
        this.authenticated = true
        this.ack(reqId)
        return
      case 'aibot_upload_media_init':
        this.uploadSeq += 1
        this.ack(reqId, { upload_id: `mock_upload_${this.uploadSeq}` })
        return
      case 'aibot_upload_media_finish':
        this.ack(reqId, {
          media_id: `mock_media_${this.uploadSeq}`,
          type: frame.body?.type ?? 'file',
          created_at: new Date().toISOString(),
        })
        return
      default:
        // aibot_respond_msg / aibot_respond_welcome_msg / aibot_respond_update_msg
        // aibot_send_msg / aibot_upload_media_chunk / ping
        this.ack(reqId)
    }
  }

  private handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const match = /^\/download\/([\w.-]+)$/.exec(url.pathname)
    if (!match || !match[1]) {
      res.writeHead(404).end('not found')
      return
    }
    const payload = this.downloads.get(match[1])
    if (!payload) {
      res.writeHead(404).end('unknown download')
      return
    }
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': payload.data.length,
      'Content-Disposition': `attachment; filename="${payload.filename}"`,
    })
    res.end(payload.data)
  }
}
