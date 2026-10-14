import Schema from '@deepseek-ai/schemastery'

/** 命令功能的配置：只回答"回复发到哪个通道"。 */
export interface Config {
  /** 用哪个通道收发；只注册了一个通道时可以不写。 */
  channel?: string
}

/** Cordis 用它校验配置并填默认值；配置非法则插件加载失败。 */
export const Config: Schema<Config> = Schema.object({
  channel: Schema.string().description('用哪个 IM 通道收发（只注册一个时可省略）'),
})
