import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { LogRecorder } from '@lijcoder/dsh-plugin-testkit'
import type { Config } from '../src/config.js'
import type { WecomConnection } from '../src/wecom.js'

/**
 * 只放本插件私有的测试替身。
 *
 * 通用夹具（会话/事件/agent 构造、日志记录）在 @lijcoder/dsh-plugin-testkit，从那里引入即可。
 * 留在这里的东西必须真的只跟企微通知有关，否则又会多出一份会各自漂移的夹具。
 */

/** 假企微通道：记录主动发送，并支持模拟收到消息后收集回复。 */
export class FakeWecom {
  readonly sent: Array<{ chatId: string; content: string }> = []
  failWith: Error | undefined
  private readonly handlers = new Set<(message: unknown) => void>()

  async sendMarkdown(chatId: string, content: string): Promise<void> {
    if (this.failWith !== undefined) throw this.failWith
    this.sent.push({ chatId, content })
  }

  onMessage(handler: (message: never) => void): () => void {
    const listener = handler as (message: unknown) => void
    this.handlers.add(listener)
    return () => this.handlers.delete(listener)
  }

  /** 模拟收到一条文本消息，返回命令处理完后给出的回复。 */
  async receive(text: string, from = 'tester'): Promise<string[]> {
    const replies: string[] = []
    const message = {
      userId: from,
      chatId: 'chat-1',
      text,
      reply: async (markdown: string) => {
        replies.push(markdown)
      },
    }
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

/**
 * 最小的 plugin Context 替身：捕获监听器，并挂上假的 logger、ctx.wecom、标题投影与 agent 注册表。
 *
 * 用于「直接戳某个事件处理器」这类细粒度单测：快、断言精确。
 * 但它绕过了 cordis 的注入与分发——**验证 inject、服务提供、effect 清理的测试必须用
 * testkit 的真实 Context**（见 e2e.test.ts），否则「插件少声明 inject」这类缺陷在测试里看不见。
 */
export function fakeContext(options: FakeContextOptions = {}) {
  const wecom = options.wecom ?? new FakeWecom()
  const handlers = new Map<string, (...args: any[]) => unknown>()
  const logger = new LogRecorder()
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
