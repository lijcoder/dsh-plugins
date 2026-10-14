import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-title'
import { shortenCwd, type ImDocument, type ImFact, type ImMessage } from '@lijcoder/dsh-im'
import type { Config } from './config.js'

/** 一条 IM 命令。`run` 返回要回复的文档，怎么渲染由通道决定。 */
export interface ImCommand {
  /** 命令名，不带斜杠，例如 `list`。 */
  readonly name: string
  /** `/help` 里的一行说明。 */
  readonly summary: string
  readonly run: (args: string) => ImDocument | Promise<ImDocument>
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
 * IM 命令路由器。
 *
 * 加一条命令就是 `register({ name, summary, run })`；`/help` 按注册顺序自动生成。
 * 命令的回复走收到的那条消息（被动回复），不需要另配目标会话。
 */
export class CommandRouter {
  private readonly commands = new Map<string, ImCommand>()

  /**
   * @param onError 命令抛错时的回调（用于记日志）。抛错照样会回一条 ⚠️，
   *   因为命令台是交互面——静默失败等于「没反应」，没法排障。
   */
  constructor(private readonly onError?: (error: unknown, command: string) => void) {}

  register(command: ImCommand): void {
    this.commands.set(command.name, command)
  }

  /** 识别并执行一条消息；不是命令就什么都不做。 */
  async handle(message: Pick<ImMessage, 'text' | 'reply'>): Promise<void> {
    const parsed = parseCommand(message.text)
    if (parsed === undefined) return

    const command = this.commands.get(parsed.name)
    let document: ImDocument
    if (command === undefined) {
      document = {
        heading: `❓ 未知命令 \`/${parsed.name}\``,
        facts: this.helpFacts(),
        footer: '发送 `/help` 查看全部命令。',
      }
    } else {
      try {
        document = await command.run(parsed.args)
      } catch (error) {
        this.onError?.(error, command.name)
        document = {
          heading: `⚠️ 命令 \`/${command.name}\` 执行失败`,
          sections: [{ title: '原因', body: error instanceof Error ? error.message : String(error) }],
        }
      }
    }
    await message.reply(document)
  }

  /** `/help` 的键值行：按注册顺序列出所有命令。 */
  helpFacts(): ImFact[] {
    return [...this.commands.values()].map((command) => ({
      label: `/${command.name}`,
      value: command.summary,
    }))
  }

  /** `/help` 文档。 */
  helpDocument(): ImDocument {
    return { heading: '🤖 DSH 命令', facts: this.helpFacts() }
  }
}

/**
 * 挂上命令路由：现在有 `/list` 和 `/help`。
 *
 * 通道在挂载时**立即解析**（不像通知功能那样惰性取）：被动回复必须先在通道上订阅
 * `onMessage`，订阅不到就收不到任何命令。所以缺通道是启动期错误——报清楚，
 * 别让它变成一个"发了命令没反应"的哑巴。
 */
export function registerCommands(ctx: Context, config: Config): void {
  const router = new CommandRouter((error, name) => {
    ctx.logger.warn('命令 /%s 执行失败：%s', name, error instanceof Error ? error.message : String(error))
  })

  router.register({
    name: 'list',
    summary: '列出当前活着的会话',
    run: () => sessionListDocument(ctx),
  })
  router.register({
    name: 'help',
    summary: '列出所有命令',
    run: () => router.helpDocument(),
  })

  let channel
  try {
    channel = ctx.im.channel(config.channel)
  } catch (error) {
    throw new Error(
      `命令功能需要先有可用的 IM 通道：${error instanceof Error ? error.message : String(error)}`
      + '（确认通道 provider 的行排在功能行之前）',
    )
  }

  channel.onMessage((message) => {
    void router.handle(message).catch((error: unknown) => {
      ctx.logger.warn('命令处理失败：%s', error instanceof Error ? error.message : String(error))
    })
  })
}

/** 没有工作目录的会话归到这一组。 */
const NO_CWD = '（无工作目录）'

/**
 * `/list` 文档：一张表，首列是工作目录、空首列表示与上一行同目录。
 *
 * 这是刻意的「一级目录、二级会话」表达：通道渲染成带空首格的真表格
 * （企微支持标准 markdown 表格）；声明 `tables: false` 的通道自己降级成
 * 「加粗路径 + 引用块」，两边都不难看。
 *
 * 只覆盖本进程内存里的会话——没被加载的历史会话、其它进程（headless 等）看不到。
 */
function sessionListDocument(ctx: Context): ImDocument {
  const agents = ctx.agents.roots()
  if (agents.length === 0) {
    return { heading: '🖥 DSH 会话', footer: '当前没有活着的会话。' }
  }

  // 运行中的排在前面；同一状态下保持注册顺序（sort 是稳定的）。
  const ordered = [...agents].sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running'))

  const byCwd = new Map<string, string[][]>()
  for (const agent of ordered) {
    const cwd = agent.session.header.cwd ?? NO_CWD
    const title = ctx.sessionProjections.stateOf(agent.session, 'title') ?? '（未命名）'
    const status = agent.status === 'running' ? '🏃 运行中' : '💤 空闲'
    const row = [title, status, agent.session.id]
    const group = byCwd.get(cwd)
    if (group === undefined) byCwd.set(cwd, [row])
    else group.push(row)
  }

  const rows: string[][] = []
  for (const [cwd, group] of [...byCwd].sort(([a], [b]) => a.localeCompare(b))) {
    const label = cwd === NO_CWD ? cwd : shortenCwd(cwd)
    group.forEach((row, index) => {
      // 首行打目录，同目录的后续行首列留空（见 ImTable 的分组约定）。
      rows.push(index === 0 ? [label, ...row] : ['', ...row])
    })
  }

  return {
    heading: `🖥 DSH 会话（${agents.length}）`,
    table: { columns: ['目录', '会话', '状态', 'sessionId'], rows },
  }
}
