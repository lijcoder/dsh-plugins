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
 * 入站从**接缝**订阅（`ctx.im.onMessage`），不直接解析某个通道——loader 是
 * 「先 await import 模块、再创建 fiber，且不等激活」，所以**行序不决定激活顺序**。
 * 在挂载时要求通道已就位会撞上竞态：本仓库踩过一次，`/list` 直接让 profile 起不来。
 * 订阅接缝之后，命令功能挂载得比通道早也照样收得到消息。
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

  ctx.im.onMessage((message) => {
    // 配了通道名就只收那个通道的；没配则全收——回复走 message.reply 原路返回，
    // 不存在"发错地方"的问题，所以这里比出站宽松。
    if (config.channel !== undefined && message.channel !== config.channel) return
    void router.handle(message).catch((error: unknown) => {
      ctx.logger.warn('命令处理失败：%s', error instanceof Error ? error.message : String(error))
    })
  })
}

/** 没有工作目录的会话归到这一组。 */
const NO_CWD = '（无工作目录）'

/**
 * `/list` 文档：标题是「🖥 DSH 会话（总数）· 🏃 N 个运行中」，
 * 下面**一个工作目录一张表**，目录名当表标题，表里是这个目录下的会话与状态。
 *
 * 拆表而不是「一张大表 + 目录列」：目录名长短不齐，塞在列里既占宽度又要靠空首格
 * 表达分组；一个目录一张表之后每张表都只剩真正会变的信息（会话、状态、id）。
 *
 * 括号后那截是给「打开企微第一眼」用的：总数说明规模，运行数说明现在有没有事在跑。
 *
 * 表格由通道渲染成标准 markdown 表格（企微支持）；声明 `tables: false` 的通道
 * 自己降级成「加粗目录 + 逐行引用块」，功能侧不用改。
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
  const running = ordered.filter((agent) => agent.status === 'running').length

  // 先按目录归组：组内已经是「运行中在前」，所以插入顺序就是表里的行序。
  const byCwd = new Map<string, string[][]>()
  for (const agent of ordered) {
    const cwd = agent.session.header.cwd ?? NO_CWD
    const row = [
      ctx.sessionProjections.stateOf(agent.session, 'title') ?? '（未命名）',
      agent.status === 'running' ? '🏃 运行中' : '💤 空闲',
      agent.session.id,
    ]
    const group = byCwd.get(cwd)
    if (group === undefined) byCwd.set(cwd, [row])
    else group.push(row)
  }

  return {
    heading: `🖥 DSH 会话（${agents.length}）· 🏃 ${running} 个运行中`,
    tables: [...byCwd]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cwd, rows]) => ({
        title: cwd === NO_CWD ? cwd : shortenCwd(cwd),
        columns: ['会话', '状态', 'sessionId'],
        rows,
      })),
  }
}
