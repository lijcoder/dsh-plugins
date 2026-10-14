import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

/**
 * dsh 领域夹具。
 *
 * 这些形状来自 session 事件流与会话头，任何订阅 `session/event` 的插件都用得上。
 * 只构造被测代码真正会读的字段：夹具不该比生产数据结构更聪明，否则测试会在
 * 无关字段上失真。字段不够用时按需补 here，而不是在插件测试里各造一份。
 */

/** 造一条形状够用的 session 事件。 */
export function event(type: string, data: unknown, time = 1_000): SessionEvent {
  return { type, seq: 0, time, data } as unknown as SessionEvent
}

/** 会话替身：只保证 `id` 与 `header` 可用。 */
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

/** 回合开始。 */
export function turnStartEvent(turn = 1, time = 1_000): SessionEvent {
  return event('turn/start', { turn }, time)
}

/** 回合结束；`kind` 为 `completed` / `error` / `aborted` 等。 */
export function turnEndEvent(turn = 1, kind = 'completed', time = 2_000): SessionEvent {
  return event('turn/end', { turn, reason: { kind } }, time)
}

/** 活着的 agent 替身（结构上满足 `ctx.agents.roots()` 的返回项）。 */
export interface FakeAgent {
  readonly session: Session
  readonly status: 'running' | 'idle'
}

/** 造一个活着的顶层 agent。 */
export function fakeAgent(session: Session, status: 'running' | 'idle' = 'idle'): FakeAgent {
  return { session, status }
}
