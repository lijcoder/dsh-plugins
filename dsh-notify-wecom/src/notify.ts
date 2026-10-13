import { homedir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from './wecom.js'
import type { Config } from './config.js'

/**
 * 回合结束的状态在通知里的措辞与图标。
 *
 * 只用 emoji 表达状态：智能机器人这条 markdown 通道**不支持** `<font color>`，
 * 写了会被原样打出来（实测），所以颜色信息只能靠图标。
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
        if (state.question === undefined) state.question = excerpt(text, 500)
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

/** 渲染「需要授权」需要的那几项样式配置（`Config` 天然满足）。 */
export interface ApprovalStyle {
  readonly approvalHeading: string
  readonly maxContentBytes: number
}

/** 渲染「任务完成」需要的那几项样式配置（`Config` 天然满足）。 */
export interface NotificationStyle {
  readonly heading: string
  /** 是否带上这一轮的问题。 */
  readonly includeQuestion: boolean
  readonly includeOutput: boolean
  readonly maxContentBytes: number
  readonly maxQuestionBytes: number
  readonly maxOutputBytes: number
}

/**
 * 渲染企微 markdown。
 *
 * 实测这条通道支持：`##` 标题、`**加粗**`、`` `行内代码` ``、`>` 引用块；
 * **不支持** `<font color>`（会原样打出）、表格、代码块。所以状态只用 emoji 表达，
 * 元信息放进引用块，问题与回复各占一段，并按字节预算截断。
 */
export function renderNotification(completion: Completion, config: NotificationStyle): string {
  const lines = [`## ${completion.outcome.emoji} ${config.heading}`]
  lines.push(`> **会话**：${completion.title ?? '（未命名）'}`)
  lines.push(`> **状态**：${completion.outcome.label}`)
  if (completion.cwd !== undefined) lines.push(`> **目录**：\`${shortenCwd(completion.cwd)}\``)
  const turn = turnLine(completion)
  if (turn !== '') lines.push(`> **回合**：${turn}`)
  lines.push(`> **Session**：\`${completion.sessionId}\``)

  let content = lines.join('\n')
  content = appendSection(content, '问题',
    config.includeQuestion ? completion.question : undefined,
    config.maxQuestionBytes, config.maxContentBytes)
  content = appendSection(content, '回复',
    config.includeOutput ? completion.output : undefined,
    config.maxOutputBytes, config.maxContentBytes)
  return truncateUtf8(content, config.maxContentBytes)
}

/**
 * 追加一段 `**标题**` + 正文，正文按本节预算和整条剩余预算取小。
 * 放不下就整段不写，而不是挤掉后面更重要的内容。
 */
function appendSection(
  content: string,
  label: string,
  text: string | undefined,
  sectionBytes: number,
  totalBytes: number,
): string {
  const body = text?.trim()
  if (body === undefined || body === '') return content
  const prefix = `\n\n**${label}**\n`
  const budget = Math.min(sectionBytes, totalBytes - utf8Length(content) - utf8Length(prefix))
  if (budget <= 0) return content
  return `${content}${prefix}${truncateUtf8(body, budget)}`
}

/**
 * 渲染「需要授权」通知：告诉用户 DSH 卡在授权上，得回会话里处理。
 */
export function renderApproval(approval: ApprovalNeeded, config: ApprovalStyle): string {
  const lines = [`## 🔐 ${config.approvalHeading}`]
  lines.push(`> **会话**：${approval.title ?? '（未命名）'}`)
  if (approval.cwd !== undefined) lines.push(`> **目录**：\`${shortenCwd(approval.cwd)}\``)
  lines.push(`> **工具**：\`${approval.toolName}\``)
  lines.push(`> **Session**：\`${approval.sessionId}\``)

  // 原因可能挺长（比如沙箱越界的说明），所以和「问题/回复」一样放到正文段落里。
  const content = appendSection(
    lines.join('\n'), '原因', approval.reason, config.maxContentBytes, config.maxContentBytes,
  )
  return truncateUtf8(`${content}\n\nDSH 正在等你的授权，请回到会话里处理。`, config.maxContentBytes)
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
    send(ctx, config, renderNotification({
      ...completion,
      title: titleOf(ctx, agent.session, completion.title),
    }, config))
  })

  ctx.on('approval/request', (request, next) => {
    if (config.includeApprovals) {
      const facts = collector.peek(request.agent.session)
      send(ctx, config, renderApproval({
        sessionId: request.agent.session.id,
        ...facts,
        title: titleOf(ctx, request.agent.session, facts.title),
        toolName: request.toolName,
        reason: approvalReason(request),
      }, config))
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

/** 发送一条通知：`dryRun` 只记日志，失败只告警，绝不冒泡回 agent loop。 */
function send(ctx: Context, config: Config, content: string): void {
  if (config.dryRun) {
    ctx.logger.info('[dry-run] 未发送的通知：\n%s', content)
    return
  }
  ctx.wecom.sendMarkdown(config.target, content).catch((error: unknown) => {
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

/** 把 home 目录缩成 `~`，路径短一点更好读。 */
export function shortenCwd(cwd: string, home: string = homedir()): string {
  if (home === '') return cwd
  if (cwd === home) return '~'
  return cwd.startsWith(`${home}/`) ? `~${cwd.slice(home.length)}` : cwd
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

/** 压平空白并截断，用于标题兜底。 */
function excerpt(text: string, maxChars: number): string | undefined {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat === '') return undefined
  return flat.length <= maxChars ? flat : `${flat.slice(0, maxChars - 1)}…`
}

/** UTF-8 字节长度：企微的 4096 限制是字节，不是字符。 */
export function utf8Length(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

/** 按 UTF-8 字节预算截断，不切断码点；截断时补省略号，结果长度永远 ≤ 预算。 */
export function truncateUtf8(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return ''
  if (utf8Length(text) <= maxBytes) return text
  const budget = maxBytes - utf8Length('…')
  if (budget <= 0) return ''
  let used = 0
  let out = ''
  for (const char of text) {
    const bytes = utf8Length(char)
    if (used + bytes > budget) break
    out += char
    used += bytes
  }
  return `${out}…`
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
