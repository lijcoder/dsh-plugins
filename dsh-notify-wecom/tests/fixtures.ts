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

/** 记录发送内容的假企微通道。 */
export class FakeWecom {
  readonly sent: Array<{ chatId: string; content: string }> = []
  failWith: Error | undefined

  async sendMarkdown(chatId: string, content: string): Promise<void> {
    if (this.failWith !== undefined) throw this.failWith
    this.sent.push({ chatId, content })
  }
}

/**
 * 最小的 plugin Context 替身：捕获监听器，并挂上假的 logger、ctx.wecom 与标题投影。
 * `projectedTitle` 为 `undefined` 时，标题走「首条人类消息」兜底。
 */
export function fakeContext(wecom = new FakeWecom(), projectedTitle?: string | null) {
  const handlers = new Map<string, (...args: any[]) => unknown>()
  const logger = new FakeLogger()
  const ctx = {
    logger,
    wecom: wecom as unknown as WecomConnection,
    sessionProjections: { stateOf: () => projectedTitle },
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
