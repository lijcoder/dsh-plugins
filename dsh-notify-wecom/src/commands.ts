import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from './wecom.js'
import type { Config } from './config.js'
import { shortenCwd, truncateUtf8 } from './notify.js'

/** 一条企微 `/` 命令。`run` 返回要回复的 markdown。 */
export interface WecomCommand {
  /** 命令名，不带斜杠，例如 `list`。 */
  readonly name: string
  /** `/help` 里的一行说明。 */
  readonly summary: string
  readonly run: (args: string) => string | Promise<string>
}

/** 解析结果：命令名 + 原样参数。 */
interface ParsedCommand {
  readonly name: string
  readonly args: string
}

const COMMAND_PATTERN = /^\/([a-z][\w-]*)\s*([\s\S]*)$/i

/**
 * 群聊里机器人只有被 @ 才会收到回调，正文会带 `@机器人` 前缀，所以先剥掉再匹配命令。
 */
export function parseCommand(text: string): ParsedCommand | undefined {
  const match = COMMAND_PATTERN.exec(text.trim().replace(/^@\S+\s*/, ''))
  if (match === null) return undefined
  return { name: match[1]!.toLowerCase(), args: match[2]!.trim() }
}

/**
 * 企微 `/` 命令路由器。
 *
 * 加一条命令就是 `register({ name, summary, run })`；`/help` 按注册顺序自动生成。
 * 命令的回复走收到的那条消息（被动回复），不需要另配目标会话。
 */
export class WecomCommandRouter {
  private readonly commands = new Map<string, WecomCommand>()

  /**
   * @param onError 命令抛错时的回调（用于记日志）。抛错照样会回一条 ⚠️，
   *   因为命令台是交互面——静默失败等于「没反应」，没法排障。
   */
  constructor(private readonly onError?: (error: unknown, command: string) => void) {}

  register(command: WecomCommand): void {
    this.commands.set(command.name, command)
  }

  /** 识别并执行一条消息；不是命令就什么都不做。 */
  async handle(
    message: { text: string; reply(markdown: string): Promise<void> },
    maxContentBytes: number,
  ): Promise<void> {
    const parsed = parseCommand(message.text)
    if (parsed === undefined) return

    const command = this.commands.get(parsed.name)
    let reply: string
    if (command === undefined) {
      reply = `❓ 未知命令 \`/${parsed.name}\`\n\n${this.help()}`
    } else {
      try {
        reply = await command.run(parsed.args)
      } catch (error) {
        this.onError?.(error, command.name)
        const reason = error instanceof Error ? error.message : String(error)
        reply = `⚠️ 命令 \`/${command.name}\` 执行失败：${reason}`
      }
    }
    await message.reply(truncateUtf8(reply, maxContentBytes))
  }

  /** `/help` 正文：按注册顺序列出所有命令。 */
  help(): string {
    const lines = ['## 🤖 DSH 命令']
    for (const command of this.commands.values()) {
      lines.push(`> \`/${command.name}\` ${command.summary}`)
    }
    return lines.join('\n')
  }
}

/** 挂上命令路由：现在有 `/list` 和 `/help`。 */
export function registerCommands(ctx: Context, config: Config): void {
  const router = new WecomCommandRouter((error, name) => {
    ctx.logger.warn('dsh-notify-wecom: 命令 /%s 执行失败：%s', name, error instanceof Error ? error.message : String(error))
  })

  router.register({
    name: 'list',
    summary: '列出当前活着的会话',
    run: () => renderSessionList(ctx, config),
  })
  router.register({
    name: 'help',
    summary: '列出所有命令',
    run: () => router.help(),
  })

  ctx.wecom.onMessage((message) => {
    void router.handle(message, config.maxContentBytes).catch((error: unknown) => {
      ctx.logger.warn('dsh-notify-wecom: 命令处理失败：%s', error instanceof Error ? error.message : String(error))
    })
  })
}

/** 没有工作目录的会话归到这一组。 */
const NO_CWD = '（无工作目录）'

/** 表格单元格：标题来自用户文本，可能带竖线或换行，会撑坏表格。 */
function cell(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim()
}

/**
 * `/list` 正文：**一个工作目录一行，下面跟一张会话表格**（会话 / 状态 / sessionId）。
 *
 * 只覆盖本进程内存里的会话——没被加载的历史会话、其它进程（headless 等）看不到。
 */
function renderSessionList(ctx: Context, config: Config): string {
  const agents = ctx.agents.roots()
  if (agents.length === 0) return '## 🖥 DSH 会话\n> 当前没有活着的会话。'

  // 运行中的排在前面；同一状态下保持注册顺序（sort 是稳定的）。
  const ordered = [...agents].sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running'))

  const groups = new Map<string, string[]>()
  for (const agent of ordered) {
    const cwd = agent.session.header.cwd ?? NO_CWD
    const title = ctx.sessionProjections.stateOf(agent.session, 'title') ?? '（未命名）'
    const status = agent.status === 'running' ? '🏃 运行中' : '💤 空闲'
    const row = `| ${cell(title)} | ${status} | ${cell(agent.session.id)} |`
    const group = groups.get(cwd)
    if (group === undefined) groups.set(cwd, [row])
    else group.push(row)
  }

  const lines = [`## 🖥 DSH 会话（${agents.length}）`]
  for (const [cwd, rows] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(
      '',
      `**${cwd === NO_CWD ? cwd : `\`${shortenCwd(cwd)}\``}**`,
      '',
      '| 会话 | 状态 | sessionId |',
      '| --- | --- | --- |',
      ...rows,
    )
  }
  return truncateUtf8(lines.join('\n'), config.maxContentBytes)
}
