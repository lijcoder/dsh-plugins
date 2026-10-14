import Schema from '@deepseek-ai/schemastery'

/**
 * 通知功能的配置：**只回答"发什么、给谁发"**。
 *
 * 怎么连、怎么渲染是通道的事（见 `@lijcoder/dsh-im-wecom` 的配置），
 * 这里一个字节上限都没有——那是通道的能力，不是功能的。
 */
export interface Config {
  /** 用哪个通道发；只注册了一个通道时可以不写。 */
  channel?: string
  /** 通知目标：语义由通道解释（企微里群聊填 chatid，单聊填 userid）。 */
  target: string
  /** 任务完成通知的标题。 */
  heading: string
  /** 需要授权通知的标题。 */
  approvalHeading: string
  /** 需要用户授权时是否也发通知。 */
  includeApprovals: boolean
  /** 是否也给 subagent 子会话发通知。 */
  includeSubagents: boolean
  /** 只通知成功完成的回合。 */
  onlyCompleted: boolean
  /** 是否带上这一轮的问题（第一条人类消息）。 */
  includeQuestion: boolean
  /** 是否带上最后一条 assistant 文本。 */
  includeOutput: boolean
  /** 「问题」部分的 UTF-8 字节预算。 */
  maxQuestionBytes: number
  /** 「回复」部分的 UTF-8 字节预算。 */
  maxOutputBytes: number
  /** 只记日志不发送，联调排障用。 */
  dryRun: boolean
}

/** Cordis 用它校验配置并填默认值；配置非法则插件加载失败。 */
export const Config: Schema<Config> = Schema.object({
  channel: Schema.string().description('用哪个 IM 通道发送（只注册一个时可省略）'),
  target: Schema.string().required().description('通知目标，语义由通道解释'),
  heading: Schema.string().default('DSH 任务通知').description('任务完成通知的标题'),
  approvalHeading: Schema.string().default('DSH 授权通知').description('需要授权通知的标题'),
  includeApprovals: Schema.boolean().default(true).description('需要用户授权时是否发通知'),
  includeSubagents: Schema.boolean().default(false).description('是否通知 subagent 子会话'),
  onlyCompleted: Schema.boolean().default(false).description('只通知成功完成的回合'),
  includeQuestion: Schema.boolean().default(true).description('是否带上这一轮的问题'),
  includeOutput: Schema.boolean().default(true).description('是否带上最后一条 assistant 文本'),
  maxQuestionBytes: Schema.number().default(400).description('「问题」UTF-8 字节预算'),
  maxOutputBytes: Schema.number().default(2_000).description('「回复」UTF-8 字节预算'),
  dryRun: Schema.boolean().default(false).description('只记录日志，不真正发送'),
})
