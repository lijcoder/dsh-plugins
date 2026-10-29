import type { Volatile } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

/**
 * 通知功能的配置：**只回答"发什么、给谁发"**。
 *
 * 怎么连、怎么渲染是通道的事（见 `@lijcoder/dsh-im-wecom` 的配置）：这里的两个字节预算
 * 管的是「正文放多少内容」，整条消息放不放得下由通道兜底。
 */
export interface Config {
  /** 用哪个通道发；只注册了一个通道时可以不写。 */
  channel?: string
  /**
   * 通知目标：语义由通道解释（企微里群聊填 chatid，单聊填 userid）。
   *
   * volatile + 可缺：它在 DSH Web 的插件页里填，存完由 loader 就地更新引用、不重挂插件，
   * 所以每次发送现读（{@link registerNotify}）；没填就只记一条日志，不发也不报错。
   */
  target: Volatile<string | undefined>
  /** 任务完成通知的标题。 */
  heading: string
  /** 需要授权通知的标题。 */
  approvalHeading: string
  /** 需要你回答问题时的通知标题。 */
  questionHeading: string
  /** 需要用户授权时是否也发通知。 */
  includeApprovals: boolean
  /** 需要用户回答问题（选项卡片）时是否也发通知。 */
  includeQuestions: boolean
  /** 是否也给 subagent 子会话发通知。 */
  includeSubagents: boolean
  /** 只通知成功完成的回合。 */
  onlyCompleted: boolean
  /** 是否带上这一轮的问题（第一条人类消息）。 */
  includeQuestion: boolean
  /** 是否带上最后一条 assistant 文本。 */
  includeOutput: boolean
  /**
   * 「问题」部分的 UTF-8 字节预算。
   *
   * volatile：配置页里改完由 loader 就地更新引用、不重挂插件，所以发送时现读
   * （`notify.ts` 的 `styleOf`）——挂载时摊平一份会让页面上的改动等重启才生效。
   */
  maxQuestionBytes: Volatile<number>
  /** 「回复」部分的 UTF-8 字节预算。volatile，理由同上。 */
  maxOutputBytes: Volatile<number>
  /** 只记日志不发送，联调排障用。 */
  dryRun: boolean
}

/**
 * Cordis 用它校验配置并填默认值；配置非法则插件加载失败。
 *
 * 标注 + `as`：schemastery 的 `object()` 把每个键都当**必有**（`ObjectT`），而这里的接口要
 * 如实写出「没配就没有」的可选字段（`channel?`），两者对不上。标注是为了让产物里的
 * `Config` 类型有名有姓可声明（不标时 tsc 会因为推断出的类型不可移植而报 TS2883），
 * 转换只在类型层，运行期就是那个 schema。
 */
export const Config: Schema<Config> = Schema.object({
  channel: Schema.string().description('用哪个 IM 通道发送（只注册一个时可省略）'),
  // 不写 required：缺目标时插件照常挂载（停用的行在设置里不存在，用户就没地方填）。
  target: Schema.string().volatile().description('通知目标，语义由通道解释；在 DSH Web 的插件页填写'),
  heading: Schema.string().default('DSH 任务通知').description('任务完成通知的标题'),
  approvalHeading: Schema.string().default('DSH 授权通知').description('需要授权通知的标题'),
  questionHeading: Schema.string().default('DSH 提问通知').description('需要你回答问题时的通知标题'),
  includeApprovals: Schema.boolean().default(true).description('需要用户授权时是否发通知'),
  includeQuestions: Schema.boolean().default(true).description('需要用户回答问题（选项卡片）时是否发通知'),
  includeSubagents: Schema.boolean().default(false).description('是否通知 subagent 子会话'),
  onlyCompleted: Schema.boolean().default(false).description('只通知成功完成的回合'),
  includeQuestion: Schema.boolean().default(true).description('是否带上这一轮的问题'),
  includeOutput: Schema.boolean().default(true).description('是否带上最后一条 assistant 文本'),
  // min(4)：truncateUtf8 的省略号自己占 3 字节，预算 ≤3 时那段正文会被截得一个字不剩
  // （≤0 更是直接返回空串）；报错比静默发空消息便宜。
  maxQuestionBytes: Schema.number().min(4).volatile().default(400).description('「问题」UTF-8 字节预算；在 DSH Web 的插件页填写'),
  maxOutputBytes: Schema.number().min(4).volatile().default(2_000).description('「回复」UTF-8 字节预算；在 DSH Web 的插件页填写'),
  dryRun: Schema.boolean().default(false).description('只记录日志，不真正发送'),
}) as Schema<Config>
