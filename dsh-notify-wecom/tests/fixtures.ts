import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { Config } from '../src/config.js'
import type { WecomConnection } from '../src/wecom.js'

/** 造一条形状够用的 session 事件；测试只关心采集器真正读取的字段。 */
export function event(type: string, data: unknown, time = 1_000): SessionEvent {
  return { type, seq: 0, time, data } as unknown as SessionEvent
}

/** 会话替身：采集器只读 `id` 和 `header`。 */
export function session(id = 'sess-1', header: Record<string, unknown> = {}): Session {
  return { id, header } as unknown as Session
}

/** 顶层会话。 */
export function topLevel(id = 'sess-1', cwd = '/work/demo'): Session {
  return session(id, { cwd })
}

/** subagent 子会话。 */
export function subagent(id = 'child-1'): Session {
  return session(id, { origin: 'subagent', delegationDepth: 1 })
}

/** `session/title` 事件（由可选的 dsh-session-title 插件合并声明，这里按结构造）。 */
export function titleEvent(title: string, time = 900): SessionEvent {
  return event('session/title', { title, messageSeqs: [], source: { kind: 'provider', provider: 'test' } }, time)
}

/** 人类 user 消息。 */
export function userMessageEvent(text: string, time = 950): SessionEvent {
  return event('user/message', { content: [{ type: 'text', text }], source: { kind: 'user' } }, time)
}

/** `agent.inject()` 之类的非人类 user 消息。 */
export function injectedMessageEvent(text: string, time = 960): SessionEvent {
  return event('user/message', { content: [{ type: 'text', text }], source: { kind: 'skill' } }, time)
}

/** 一条 assistant 文本。 */
export function assistantMessageEvent(text: string, time = 1_200, turn = 1): SessionEvent {
  return event('assistant/message', {
    turn,
    step: 1,
    message: { id: 'msg-1', role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model' } },
    stream: [],
  }, time)
}

export function turnStartEvent(turn = 1, time = 1_000): SessionEvent {
  return event('turn/start', { turn }, time)
}

export function turnEndEvent(turn = 1, kind = 'completed', time = 2_000): SessionEvent {
  return event('turn/end', { turn, reason: { kind } }, time)
}

/** 记录日志的假 logger；把 printf 风格的参数拼成一行便于断言。 */
export class FakeLogger {
  readonly lines: string[] = []

  debug(...args: unknown[]): void {
    this.push(args)
  }

  info(...args: unknown[]): void {
    this.push(args)
  }

  warn(...args: unknown[]): void {
    this.push(args)
  }

  error(...args: unknown[]): void {
    this.push(args)
  }

  has(needle: string): boolean {
    return this.lines.some((line) => line.includes(needle))
  }

  private push(args: unknown[]): void {
    this.lines.push(args.map((arg) => (typeof arg === 'string' ? arg : String(arg))).join(' '))
  }
}

/** 假企微通道：记录主动发送，并支持模拟收到消息后收集回复。 */
export class FakeWecom {
  readonly sent: Array<{ chatId: string; content: string }> = []
  failWith: Error | undefined
  private readonly handlers = new Set<(message: any) => void>()

  async sendMarkdown(chatId: string, content: string): Promise<void> {
    if (this.failWith !== undefined) throw this.failWith
    this.sent.push({ chatId, content })
  }

  onMessage(handler: (message: any) => void): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  /** 模拟收到一条文本消息，返回命令处理完后给出的回复。 */
  async receive(text: string, from = 'tester'): Promise<string[]> {
    const replies: string[] = []
    const message = { userId: from, chatId: 'chat-1', text, reply: async (markdown: string) => { replies.push(markdown) } }
    for (const handler of this.handlers) handler(message)
    await new Promise((resolve) => setImmediate(resolve))
    return replies
  }
}

/** 一个活着的顶层 agent 替身（`/list` 用）。 */
export interface FakeAgent {
  readonly session: Session
  readonly status: 'running' | 'idle'
}

export interface FakeContextOptions {
  readonly wecom?: FakeWecom
  /** 标题投影；返回 `undefined`/`null` 时标题走「首条人类消息」兜底。 */
  readonly titleOf?: (session: Session) => string | null | undefined
  /** 活着的顶层 agent，`ctx.agents.roots()` 返回它们。 */
  readonly agents?: readonly FakeAgent[]
}

/** 最小的 plugin Context 替身：捕获监听器，并挂上假的 logger、ctx.wecom、标题投影与 agent 注册表。 */
export function fakeContext(options: FakeContextOptions = {}) {
  const wecom = options.wecom ?? new FakeWecom()
  const handlers = new Map<string, (...args: any[]) => unknown>()
  const logger = new FakeLogger()
  const agents = options.agents ?? []
  const ctx = {
    logger,
    wecom: wecom as unknown as WecomConnection,
    sessionProjections: { stateOf: (session: Session) => options.titleOf?.(session) },
    agents: { roots: () => [...agents] },
    on: (name: string, handler: (...args: any[]) => unknown): void => {
      handlers.set(name, handler)
    },
  }
  return { ctx: ctx as unknown as Context, handlers, logger, wecom }
}

/** 一份合法的插件配置。 */
export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    botId: 'bot',
    secret: 'secret',
    target: 'chat-1',
    scene: undefined,
    plugVersion: undefined,
    wsUrl: undefined,
    heartbeatInterval: 30_000,
    reconnectInterval: 1_000,
    maxReconnectAttempts: 10,
    maxAuthFailureAttempts: 5,
    requestTimeout: 10_000,
    connectTimeoutMs: 15_000,
    heading: 'DSH 任务完成',
    approvalHeading: 'DSH 需要授权',
    includeApprovals: true,
    includeCommands: true,
    includeSubagents: false,
    onlyCompleted: false,
    includeQuestion: true,
    includeOutput: true,
    maxContentBytes: 4_096,
    maxQuestionBytes: 400,
    maxOutputBytes: 2_000,
    dryRun: false,
    ...overrides,
  }
}
