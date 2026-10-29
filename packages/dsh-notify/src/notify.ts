import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-user-approval'
import { truncateUtf8, type ImDocument, type ImFact, type ImSection } from '@lijcoder/dsh-im'
import type { Config } from './config.js'

/**
 * 回合结束的状态在通知里的措辞与图标。
 *
 * 只用 emoji 表达状态：具体通道支不支持颜色是**通道**的事（企微那条 markdown
 * 通道就不支持 `<font color>`，写了会被原样打出来），所以这里给的是通用图标。
 */
export interface Outcome {
  readonly kind: string
  readonly label: string
  readonly emoji: string
}

const UNKNOWN: Outcome = { kind: 'unknown', label: '未知状态', emoji: '❔' }

const OUTCOMES: Record<string, Outcome> = {
  completed: { kind: 'completed', label: '成功', emoji: '✅' },
  aborted: { kind: 'aborted', label: '已中断', emoji: '⏹️' },
  blocked: { kind: 'blocked', label: '被阻断', emoji: '🚫' },
  error: { kind: 'error', label: '失败', emoji: '❌' },
  'max-tokens': { kind: 'max-tokens', label: '达到输出上限', emoji: '⚠️' },
  interrupted: { kind: 'interrupted', label: '中断（崩溃恢复）', emoji: '⚠️' },
  forked: { kind: 'forked', label: '分叉关闭', emoji: '🔀' },
}

/** 一次「任务完成」的全部素材。 */
export interface Completion extends SessionFacts {
  readonly sessionId: string
  readonly outcome: Outcome
  /** 刚结束的回合号。 */
  readonly turn?: number
  readonly startedAt?: number
  readonly endedAt?: number
  /** 这一轮的问题：回合里第一条人类消息。 */
  readonly question?: string
  /** 该回合最后一条 assistant 文本。 */
  readonly output?: string
}

/** 会话展示信息。 */
export interface SessionFacts {
  /**
   * 首条人类消息的兜底标题。真正的标题以 `session/title` 投影为准——
   * 插件可能在一个已有历史的会话中途才挂上，增量监听会漏掉早先的标题事件。
   */
  readonly title?: string
  readonly cwd?: string
}

/** 一次「需要授权」的全部素材。 */
export interface ApprovalNeeded extends SessionFacts {
  readonly sessionId: string
  /** 需要决策的工具名。 */
  readonly toolName: string
  /** 问询方给出的人话解释。 */
  readonly reason?: string
}

interface TurnEnd {
  readonly turn: number
  readonly kind: string
  readonly at: number
}

interface SessionState {
  fallbackTitle?: string
  /** 当前回合的问题（第一条人类消息），回合开始时清空。 */
  question?: string
  output?: string
  turnStartedAt?: number
  lastTurnEnd?: TurnEnd
  notifiedTurn?: number
}

/**
 * 按 session 增量记录最近一次的标题 / 问题 / 输出 / 回合边界。
 *
 * 只留最近一次，不 fold 整个会话历史；`take()` 交出一个还没通知过的已结束回合，
 * 所以 `agent/status` 反复触发 `idle` 也只会通知一次。
 */
export class CompletionCollector {
  private readonly states = new Map<string, SessionState>()

  note(sessionId: string, event: SessionEvent): void {
    const state = this.state(sessionId)
    switch (event.type) {
      case 'user/message': {
        // 只有真正的人类输入算「问题」：agent.inject() 塞进来的上下文不算。
        if (event.data.source.kind !== 'user') break
        const text = textOf(event.data.content)
        if (state.fallbackTitle === undefined) state.fallbackTitle = excerpt(text, 60)
        // 正文不在这里截断：截多少完全由 maxQuestionBytes 决定，先斩一刀会让那个预算调大也没用。
        if (state.question === undefined) state.question = flatten(text)
        break
      }
      case 'assistant/message':
        state.output = textOf(event.data.message.content).trim() || undefined
        break
      case 'turn/start':
        state.turnStartedAt = event.time
        // 问题和输出都按回合重置，本轮没有就留空，不带上一个回合的。
        state.question = undefined
        state.output = undefined
        break
      case 'turn/end':
        state.lastTurnEnd = { turn: event.data.turn, kind: event.data.reason.kind, at: event.time }
        break
      default:
        break
    }
  }

  take(session: Session): Completion | undefined {
    const state = this.states.get(session.id)
    const lastTurnEnd = state?.lastTurnEnd
    if (state === undefined || lastTurnEnd === undefined) return undefined
    if (state.notifiedTurn === lastTurnEnd.turn) return undefined
    state.notifiedTurn = lastTurnEnd.turn

    return {
      sessionId: session.id,
      ...this.peek(session),
      outcome: OUTCOMES[lastTurnEnd.kind] ?? UNKNOWN,
      turn: lastTurnEnd.turn,
      startedAt: state.turnStartedAt,
      endedAt: lastTurnEnd.at,
      question: state.question,
      output: state.output,
    }
  }

  /** 会话的展示信息：首条人类消息 + 工作目录（标题本身由投影解析，见 `titleOf`）。 */
  peek(session: Session): SessionFacts {
    const state = this.states.get(session.id)
    return {
      title: state?.fallbackTitle,
      cwd: session.header.cwd,
    }
  }

  forget(sessionId: string): void {
    this.states.delete(sessionId)
  }

  private state(sessionId: string): SessionState {
    let state = this.states.get(sessionId)
    if (state === undefined) {
      state = {}
      this.states.set(sessionId, state)
    }
    return state
  }
}

/** 顶层会话 = 不是 subagent 子会话，也不是更深的委派。 */
export function isTopLevel(session: Session): boolean {
  return session.header.origin !== 'subagent' && (session.header.delegationDepth ?? 0) === 0
}

/** 渲染「任务完成」通知需要的那几项配置（`Config` 天然满足）。 */
export interface NotificationStyle {
  readonly heading: string
  /** 是否带上这一轮的问题。 */
  readonly includeQuestion: boolean
  readonly includeOutput: boolean
  readonly maxQuestionBytes: number
  readonly maxOutputBytes: number
}

/** 渲染「需要授权」通知需要的那几项配置（`Config` 天然满足）。 */
export interface ApprovalStyle {
  readonly approvalHeading: string
}

/**
 * 取这一次发送要用的渲染口径。
 *
 * 两个字节预算都是 volatile：配置页里改完 loader 只就地更新引用、不重挂插件，
 * 所以每次发送前现读——挂载时摊平一份就会让页面上的改动等重启才生效。
 * @param config - 插件配置。
 * @returns 两类通知各自要读的那几项。
 */
export function styleOf(config: Config): NotificationStyle & ApprovalStyle {
  return {
    heading: config.heading,
    approvalHeading: config.approvalHeading,
    includeQuestion: config.includeQuestion,
    includeOutput: config.includeOutput,
    maxQuestionBytes: config.maxQuestionBytes.get(),
    maxOutputBytes: config.maxOutputBytes.get(),
  }
}

/**
 * 「任务完成」通知的内容。
 *
 * 只描述结构，不求排版：状态用 emoji 表达、元信息是键值行、问题与回复各是一段。
 * 具体怎么渲染（引用块？卡片？表格？）由通道决定。
 */
export function notificationDocument(completion: Completion, style: NotificationStyle): ImDocument {
  const facts: ImFact[] = [
    { label: '会话', value: completion.title ?? '（未命名）' },
    { label: '状态', value: completion.outcome.label },
  ]
  if (completion.cwd !== undefined) facts.push({ label: '目录', value: completion.cwd, code: true })
  const turn = turnLine(completion)
  if (turn !== '') facts.push({ label: '回合', value: turn })
  facts.push({ label: 'Session', value: completion.sessionId, code: true })

  const sections: ImSection[] = []
  if (style.includeQuestion) pushSection(sections, '问题', completion.question, style.maxQuestionBytes)
  if (style.includeOutput) pushSection(sections, '回复', completion.output, style.maxOutputBytes)

  return { heading: `${completion.outcome.emoji} ${style.heading}`, facts, sections }
}

/**
 * 「需要授权」通知的内容：告诉用户 DSH 卡在授权上，得回会话里处理。
 *
 * 原因可能挺长（比如沙箱越界的说明），所以和「问题/回复」一样放正文段落，
 * 不放引用块——引用块里塞长文本在很多客户端上会被压成一行。
 */
export function approvalDocument(approval: ApprovalNeeded, style: ApprovalStyle): ImDocument {
  const facts: ImFact[] = [{ label: '会话', value: approval.title ?? '（未命名）' }]
  if (approval.cwd !== undefined) facts.push({ label: '目录', value: approval.cwd, code: true })
  facts.push({ label: '工具', value: approval.toolName, code: true })
  facts.push({ label: 'Session', value: approval.sessionId, code: true })

  const sections: ImSection[] = []
  pushSection(sections, '原因', approval.reason, Number.MAX_SAFE_INTEGER)

  return {
    heading: `🔐 ${style.approvalHeading}`,
    facts,
    sections,
    footer: 'DSH 正在等你的授权，请回到会话里处理。',
  }
}

/** 追加一段正文；空内容整段不写，超预算按字节截断（不切断码点）。 */
function pushSection(
  sections: ImSection[],
  title: string,
  text: string | undefined,
  maxBytes: number,
): void {
  const body = text?.trim()
  if (body === undefined || body === '') return
  sections.push({ title, body: truncateUtf8(body, maxBytes) })
}

/**
 * 通知功能：现在有两类触发。
 *
 * - `agent/status` 变成 `idle`：任务完成，发一条结果通知。
 * - `approval/request`：工具需要用户授权，发一条「回来处理」的通知。
 *
 * `approval/request` 是 waterfall，我们只旁观，所以照常 `next()`
 * 把决策交给真正的回答者（Web UI / 权限策略），不参与放行与否。
 */
export function registerNotify(ctx: Context, config: Config): void {
  const collector = new CompletionCollector()

  ctx.on('session/event', (session, event) => collector.note(session.id, event))
  ctx.on('session/disposed', (session) => collector.forget(session.id))

  ctx.on('agent/status', ({ agent, status }) => {
    if (status !== 'idle') return
    const completion = collector.take(agent.session)
    if (completion === undefined) return
    if (!config.includeSubagents && !isTopLevel(agent.session)) return
    if (config.onlyCompleted && completion.outcome.kind !== 'completed') return
    send(ctx, config, notificationDocument({
      ...completion,
      title: titleOf(ctx, agent.session, completion.title),
    }, styleOf(config)))
  })

  ctx.on('approval/request', (request, next) => {
    if (config.includeApprovals) {
      const facts = collector.peek(request.agent.session)
      send(ctx, config, approvalDocument({
        sessionId: request.agent.session.id,
        ...facts,
        title: titleOf(ctx, request.agent.session, facts.title),
        toolName: request.toolName,
        reason: approvalReason(request),
      }, styleOf(config)))
    }
    return next()
  })
}

/**
 * 会话标题：以 `session-title` 注册的 `title` 投影为准，读不到再退回首条人类消息。
 *
 * 不能只靠 `session/event` 增量采集——插件可能在一个跑了很多轮的会话中途才挂上，
 * 那时 `session/title` 早就写过了。投影由注册表按已提交事件驱动（含重启后恢复的历史），
 * 读到的始终是当前值。
 */
function titleOf(ctx: Context, session: Session, fallback: string | undefined): string | undefined {
  return ctx.sessionProjections.stateOf(session, 'title') ?? fallback
}

/** 优先用中文展示文案，其次问询方的原始解释，最后退回英文。 */
function approvalReason(request: {
  reason?: string
  displayReason?: Readonly<Record<string, string>>
}): string | undefined {
  const display = request.displayReason
  return excerpt(display?.zh ?? request.reason ?? display?.en ?? '', 200)
}

/**
 * 发送一条通知：`dryRun` 只记日志，失败只告警，绝不冒泡回 agent loop。
 *
 * 目标现读 volatile 引用：用户在插件页填完，loader 只更新引用、不重挂插件，
 * 挂载时缓存一份的话这一轮改完得等重启才生效。没填目标就只记日志——那不是错误，
 * 只是还没配。
 *
 * 通道按名字**惰性解析**：功能插件可能先于通道注册就挂上（patch 里的行序不保证），
 * 所以在发送时取；配置写错通道名也只是这条通知发不出去，不应该让整轮对话炸掉。
 */
function send(ctx: Context, config: Config, document: ImDocument): void {
  const target = config.target.get()
  if (target === undefined) {
    ctx.logger.info('通知目标未配置：在 DSH Web 的「插件」页填写后再发送')
    return
  }
  if (config.dryRun) {
    ctx.logger.info('[dry-run] 未发送的通知：%o', document)
    return
  }
  let channel
  try {
    channel = ctx.im.channel(config.channel)
  } catch (error) {
    ctx.logger.warn('通知发送失败：%s', error instanceof Error ? error.message : String(error))
    return
  }
  channel.send(target, document).catch((error: unknown) => {
    ctx.logger.warn('通知发送失败：%s', error instanceof Error ? error.message : String(error))
  })
}

/** 回合一行的内容：`#3 · 耗时 2m13s · 10-13 16:23`。 */
function turnLine(completion: Completion): string {
  const parts: string[] = []
  if (completion.turn !== undefined) parts.push(`#${completion.turn}`)
  if (completion.startedAt !== undefined && completion.endedAt !== undefined) {
    parts.push(`耗时 ${formatDuration(completion.endedAt - completion.startedAt)}`)
  }
  if (completion.endedAt !== undefined) parts.push(formatTimestamp(completion.endedAt))
  return parts.join(' · ')
}

/** 取消息里的 text block 拼成纯文本；工具调用、图片等其它块跳过。 */
function textOf(content: readonly unknown[]): string {
  const parts: string[] = []
  for (const block of content) {
    const record = block as { type?: unknown; text?: unknown }
    if (record?.type === 'text' && typeof record.text === 'string') parts.push(record.text)
  }
  return parts.join('\n')
}

/** 压平空白，用于正文段落；全是空白返回 undefined。 */
function flatten(text: string): string | undefined {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat === '' ? undefined : flat
}

/** 压平空白并截断，用于标题兜底。 */
function excerpt(text: string, maxChars: number): string | undefined {
  const flat = flatten(text)
  if (flat === undefined) return undefined
  return flat.length <= maxChars ? flat : `${flat.slice(0, maxChars - 1)}…`
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '未知'
  if (ms < 1_000) return '<1s'
  const total = Math.round(ms / 1_000)
  const hours = Math.floor(total / 3_600)
  const minutes = Math.floor((total % 3_600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, '0')}m`
  if (minutes > 0) return `${minutes}m${String(seconds).padStart(2, '0')}s`
  return `${seconds}s`
}

/** `10-13 16:23` —— 只要到分，日期够用又不至于把行撑长。 */
function formatTimestamp(time: number): string {
  const at = new Date(time)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}
