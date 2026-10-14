/**
 * 平台中立的文档模型。
 *
 * 功能层只描述**结构**（"说什么"），排版由通道决定（"怎么说"）。
 * 这样加一个即时通讯平台只需要新增一个通道包，功能代码一行不改。
 *
 * 刻意保持最小：只有通知类消息真正用得到的节点。图片、按钮、卡片动作等
 * 等有真实需求再加——过早定义富媒体模型，改起来比加还贵。
 */

/** 通道能力声明：功能据此决定产出什么，通道据此决定如何降级。 */
export interface ImCapabilities {
  /** 能否渲染富文本（标题、加粗、行内代码）；为 false 时通道退化为纯文本。 */
  readonly richText: boolean
  /** 能否渲染表格；为 false 时通道把表格降级为分组列表。 */
  readonly tables: boolean
  /** 单条内容的字节上限，由通道负责兜底截断。 */
  readonly maxContentBytes: number
  /** 能否主动推送到指定会话；为 false 的通道只能被动回复。 */
  readonly proactive: boolean
}

/** 引用块里的一个键值行，例如「会话：修复登录超时」。 */
export interface ImFact {
  readonly label: string
  /** 为 true 时按等宽/行内代码渲染（路径、id 这类）。 */
  readonly code?: boolean
  readonly value: string
}

/** 带小标题的正文段落，例如「问题」「回复」「原因」。 */
export interface ImSection {
  readonly body: string
  readonly title: string
}

/**
 * 表格节点。通道不支持表格时会降级，功能侧无需关心。
 *
 * `title` 是分组维度上的名字（目录、批次……）。**不用空首格表达「与上一行同组」**：
 * 一个分组一张表，标题写在表上，比在一列里塞分组标记更省地方，也不用每个消费方
 * 都照抄那条约定。
 */
export interface ImTable {
  readonly columns: readonly string[]
  readonly rows: readonly (readonly string[])[]
  /** 表格上方的小标题，例如工作目录；可省。 */
  readonly title?: string
}

/** 一条与平台无关的消息。 */
export interface ImDocument {
  /** 引用块里的键值行。 */
  readonly facts?: readonly ImFact[]
  /** 结尾的一句提示，例如「DSH 正在等你的授权」。 */
  readonly footer?: string
  /** 标题行，通常自带 emoji；通道不支持富文本时按纯文本渲染。 */
  readonly heading?: string
  /** 正文段落。 */
  readonly sections?: readonly ImSection[]
  /** 表格，**可以有多个**：一个分组一张（例如工作目录）。 */
  readonly tables?: readonly ImTable[]
}

/** 收到的消息所属会话。 */
export interface ImConversation {
  readonly id: string
  readonly kind: 'direct' | 'group'
}

/** 发消息的人。 */
export interface ImSender {
  readonly id: string
  readonly name?: string
}

/** 一条收到的消息。 */
export interface ImMessage {
  readonly channel: string
  readonly conversation: ImConversation
  readonly sender: ImSender
  /** 归一化后的纯文本；附件、语音转写等由通道决定怎么塞进来。 */
  readonly text: string
  /**
   * 被动回复这条消息。
   *
   * 通道自己决定怎么送达：企微沿用收到的 `req_id`，飞书走 API。
   * 有的通道有回复时限，超时会抛。
   */
  reply(document: ImDocument): Promise<void>
}

/**
 * 通道上报的入站消息——就 {@link ImMessage}，但**不带 `channel`**。
 *
 * 通道名由注册表按注册名填（通道自报一份就会有两个来源，早晚对不上）。
 */
export type ImInbound = Omit<ImMessage, 'channel'>

/**
 * 一个即时通讯通道。
 *
 * 实现方负责三件事：如实声明 {@link ImCapabilities}、把 {@link ImDocument} 渲染成
 * 自己平台的形态、维护自己的连接生命周期。
 */
export interface ImChannel {
  readonly capabilities: ImCapabilities
  /** 主动推送到某个会话；`target` 的语义（群 id / 用户 id）由通道解释。 */
  send(target: string, document: ImDocument): Promise<void>
  /**
   * 上报收到的消息，返回取消订阅函数。
   *
   * 通常**不该由功能直接调用**：{@link ImRegistry.onMessage} 会订阅它并转发给
   * 功能级订阅者，这样功能挂载时不必先等到通道就位。
   */
  onMessage(handler: (message: ImInbound) => void): () => void
}
