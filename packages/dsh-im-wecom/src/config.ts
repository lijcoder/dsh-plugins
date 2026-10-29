import type { Volatile } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

/**
 * 企微通道配置：连接参数 + 渲染上限。
 *
 * **不含任何通知策略**——发什么内容由功能插件（如 `@lijcoder/dsh-notify`）决定。
 *
 * `botId` / `secret` 是 volatile：DSH Web 的插件页存完，loader 只就地更新引用、
 * **不重挂**插件，所以「凭证变了要重连」是 `channel.ts` 自己的事。
 * `secret` 另外带 `role('secret')`：它永远不随表单响应回到浏览器，页面只知道配没配。
 * `maxContentBytes` 同样 volatile，但只影响渲染：它变了不用重连，现读即可。
 */
export interface Config {
  /** 机器人 ID。不填就是没配置，通道保持空闲，等页面上填。 */
  botId: Volatile<string | undefined>
  /** 机器人 Secret。 */
  secret: Volatile<string | undefined>
  /** 透传 SDK 的场景值。 */
  scene?: number
  /** 透传 SDK 的插件版本号。 */
  plugVersion?: string
  /** 自定义长连接地址（私有化部署）。 */
  wsUrl?: string
  /** 心跳间隔（毫秒）。 */
  heartbeatInterval: number
  /** 重连基础延迟（毫秒）。 */
  reconnectInterval: number
  /** 最大重连次数，-1 为无限。 */
  maxReconnectAttempts: number
  /** 认证失败最大重试次数，-1 为无限。 */
  maxAuthFailureAttempts: number
  /** 等待消息回执的超时（毫秒）。 */
  requestTimeout: number
  /** 等待认证成功的上限（毫秒）。 */
  connectTimeoutMs: number
  /**
   * 单条内容的 UTF-8 字节预算，渲染后兜底截断。
   *
   * volatile：配置页里改完由 loader 就地更新引用、不重挂插件，所以渲染时现读
   * （见 `channel.ts` 的 capabilities）——缓存一份会让页面上的改动等重启才生效。
   */
  maxContentBytes: Volatile<number>
}

/**
 * Cordis 用它校验配置并填默认值；配置非法则插件加载失败。
 *
 * 标注 + `as`：schemastery 的 `object()` 把每个键都当**必有**（`ObjectT`），而这里的接口要
 * 如实写出「没配就没有」的可选字段（`scene?`），两者对不上。标注是为了让产物里的
 * `Config` 类型有名有姓可声明（不标时 tsc 会因为推断出的类型不可移植而报 TS2883），
 * 转换只在类型层，运行期就是那个 schema。
 */
export const Config: Schema<Config> = Schema.object({
  // 两个凭证都不写 required，也**不能**用 patch 的 disabled 闸门停用整行：
  // 停用的行在设置里根本不存在（describe 只收活的 fiber），用户就没地方填。
  // 缺凭证的代价只是通道空闲，不再有一条长连接。
  botId: Schema.string().volatile().description('企业微信智能机器人 ID，在 DSH Web 的插件页填写'),
  secret: Schema.string().role('secret').volatile().description('企业微信智能机器人 Secret'),
  scene: Schema.number().description('透传 SDK 的场景值'),
  plugVersion: Schema.string().description('透传 SDK 的插件版本号'),
  wsUrl: Schema.string().description('自定义长连接地址（私有化部署）'),
  heartbeatInterval: Schema.number().default(30_000).description('心跳间隔（毫秒）'),
  reconnectInterval: Schema.number().default(1_000).description('重连基础延迟（毫秒）'),
  maxReconnectAttempts: Schema.number().default(10).description('最大重连次数，-1 为无限'),
  maxAuthFailureAttempts: Schema.number().default(5).description('认证失败最大重试次数，-1 为无限'),
  requestTimeout: Schema.number().default(10_000).description('等待消息回执的超时（毫秒）'),
  connectTimeoutMs: Schema.number().default(15_000).description('等待认证成功的上限（毫秒）'),
  // min(4)：truncateUtf8 的省略号自己占 3 字节，预算 ≤3 时正文会被截得一个字不剩
  // （≤0 更是直接返回空串）；报错比静默发空消息便宜。
  maxContentBytes: Schema.number().min(4).volatile().default(20_480).description('单条内容 UTF-8 字节预算；在 DSH Web 的插件页填写'),
}) as Schema<Config>
