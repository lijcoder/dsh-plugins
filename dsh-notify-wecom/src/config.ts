import Schema from '@deepseek-ai/schemastery'
import type { WecomOptions } from './wecom.js'

/**
 * 插件配置 = 企微连接参数 + 通知策略。
 *
 * 每个字段都能在 profile 的 `cordis.patch.yml` 里覆盖；secret 别提交进仓库。
 */
export interface Config extends WecomOptions {
  /** 通知目标：群聊填群 chatid，单聊填用户 userid。 */
  target: string
  /** 任务完成通知的标题。 */
  heading: string
  /** 需要授权通知的标题。 */
  approvalHeading: string
  /** 需要用户授权时是否也发通知。 */
  includeApprovals: boolean
  /** 是否响应企微 `/` 命令（`/list`、`/help`）。 */
  includeCommands: boolean
  /** 是否也给 subagent 子会话发通知。 */
  includeSubagents: boolean
  /** 只通知成功完成的回合。 */
  onlyCompleted: boolean
  /** 是否带上这一轮的问题（第一位人类消息）。 */
  includeQuestion: boolean
  /** 是否带上最后一条 assistant 文本。 */
  includeOutput: boolean
  /** 整条内容的 UTF-8 字节预算（企微 markdown 上限 4096）。 */
  maxContentBytes: number
  /** 「问题」部分的 UTF-8 字节预算。 */
  maxQuestionBytes: number
  /** 「回复」部分的 UTF-8 字节预算。 */
  maxOutputBytes: number
  /** 只记日志不发送（连接照常建立），联调排障用。 */
  dryRun: boolean
}

/** Cordis 用它校验配置并填默认值；配置非法则插件加载失败。 */
export const Config: Schema<Config> = Schema.object({
  botId: Schema.string().required().description('企业微信智能机器人 ID'),
  secret: Schema.string().required().description('企业微信智能机器人 Secret'),
  target: Schema.string().required().description('通知目标：群 chatid 或用户 userid'),
  scene: Schema.number().description('透传 SDK 的场景值'),
  plugVersion: Schema.string().description('透传 SDK 的插件版本号'),
  wsUrl: Schema.string().description('自定义长连接地址（私有化部署）'),
  heartbeatInterval: Schema.number().default(30_000).description('心跳间隔（毫秒）'),
  reconnectInterval: Schema.number().default(1_000).description('重连基础延迟（毫秒）'),
  maxReconnectAttempts: Schema.number().default(10).description('最大重连次数，-1 为无限'),
  maxAuthFailureAttempts: Schema.number().default(5).description('认证失败最大重试次数，-1 为无限'),
  requestTimeout: Schema.number().default(10_000).description('等待消息回执的超时（毫秒）'),
  connectTimeoutMs: Schema.number().default(15_000).description('等待认证成功的上限（毫秒）'),
  heading: Schema.string().default('DSH 任务通知').description('任务完成通知的标题'),
  approvalHeading: Schema.string().default('DSH 授权通知').description('需要授权通知的标题'),
  includeApprovals: Schema.boolean().default(true).description('需要用户授权时是否发通知'),
  includeCommands: Schema.boolean().default(true).description('是否响应企微 / 命令'),
  includeSubagents: Schema.boolean().default(false).description('是否通知 subagent 子会话'),
  onlyCompleted: Schema.boolean().default(false).description('只通知成功完成的回合'),
  includeQuestion: Schema.boolean().default(true).description('是否带上这一轮的问题'),
  includeOutput: Schema.boolean().default(true).description('是否带上最后一条 assistant 文本'),
  maxContentBytes: Schema.number().default(4_096).description('通知内容 UTF-8 字节预算'),
  maxQuestionBytes: Schema.number().default(400).description('「问题」UTF-8 字节预算'),
  maxOutputBytes: Schema.number().default(2_000).description('「回复」UTF-8 字节预算'),
  dryRun: Schema.boolean().default(false).description('只记录日志，不真正发送（连接照常建立）'),
})
