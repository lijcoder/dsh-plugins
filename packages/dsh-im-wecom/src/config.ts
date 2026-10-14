import Schema from '@deepseek-ai/schemastery'
import type { WecomChannelOptions } from './channel.js'

/**
 * 企微通道配置：连接参数 + 渲染上限。
 *
 * **不含任何通知策略**——发什么内容由功能插件（如 `@lijcoder/dsh-notify`）决定。
 * 每个字段都能在 profile 的 `cordis.patch.yml` 里覆盖；secret 别提交进仓库。
 */
export type Config = WecomChannelOptions

/** Cordis 用它校验配置并填默认值；配置非法则插件加载失败。 */
export const Config: Schema<Config> = Schema.object({
  botId: Schema.string().required().description('企业微信智能机器人 ID'),
  secret: Schema.string().required().description('企业微信智能机器人 Secret'),
  scene: Schema.number().description('透传 SDK 的场景值'),
  plugVersion: Schema.string().description('透传 SDK 的插件版本号'),
  wsUrl: Schema.string().description('自定义长连接地址（私有化部署）'),
  heartbeatInterval: Schema.number().default(30_000).description('心跳间隔（毫秒）'),
  reconnectInterval: Schema.number().default(1_000).description('重连基础延迟（毫秒）'),
  maxReconnectAttempts: Schema.number().default(10).description('最大重连次数，-1 为无限'),
  maxAuthFailureAttempts: Schema.number().default(5).description('认证失败最大重试次数，-1 为无限'),
  requestTimeout: Schema.number().default(10_000).description('等待消息回执的超时（毫秒）'),
  connectTimeoutMs: Schema.number().default(15_000).description('等待认证成功的上限（毫秒）'),
  maxContentBytes: Schema.number().default(20_480).description('单条内容 UTF-8 字节预算'),
})
