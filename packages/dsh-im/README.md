# @lijcoder/dsh-im

## 概要

即时通讯通道的接缝：功能只说「说什么」，通道决定「怎么说」与「怎么送」。

Context key 是单数 `ctx.im`，形状照 dsh 自己的多实现能力（`ctx.llm` / `ctx.browserUse`），区别是这里允许注册多个通道——企微做通知、飞书做别的，是真实需求。加一个平台 = 新增一个通道包，功能代码一行不改。

## 目录

- [使用](#使用)
- [了解实现](#了解实现)
- [延伸阅读](#延伸阅读)
- [已知限制与待办](#已知限制与待办)

## 使用

包本身不含任何通道，也不含任何功能。

### 通道实现方

实现 `ImChannel` 并注册：如实声明 `capabilities`、把 `ImDocument` 渲染成自己平台的形态、维护自己的连接生命周期。

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { ImChannel } from '@lijcoder/dsh-im'

export const inject = ['im']

export function apply(ctx: Context): void {
  const channel: ImChannel = {
    capabilities: { richText: true, tables: true, maxContentBytes: 20480, proactive: true },
    async send(target, document) { /* 渲染后送出 */ },
    onMessage(handler) { /* 收到消息时调用 handler */ return () => {} },
  }
  ctx.im.registerChannel('wecom', channel)
}
```

### 功能消费方

```ts
export const inject = ['im']

export function apply(ctx: Context, config: Config): void {
  // 入站：订阅接缝，不要求此刻已有通道
  ctx.im.onMessage((message) => {
    if (message.channel !== config.channel) return
    void message.reply({ heading: '收到', footer: `来自 ${message.sender.id}` })
  })
  // 出站：发送时才取通道，唯一通道时可以省略名字
  ctx.on('agent/status', async ({ status }) => {
    if (status !== 'idle') return
    await ctx.im.channel(config.channel).send(config.target, { heading: '✅ 任务完成' })
  })
}
```

入站走 `ctx.im.onMessage` 而不是在挂载期解析通道，理由见 [AGENTS.md](../../AGENTS.md) 的「行序不决定激活顺序」。注册了多个通道时必须显式指名，否则 `channel()` 抛错。

## 了解实现

<details>
<summary>实现细节（维护者向）——点开</summary>

```
功能（与平台无关）        ctx.im（本包）           通道实现（每平台一个包）
dsh-notify            ──► ImRegistry          ◄── dsh-im-wecom
dsh-im-commands          registerChannel()         dsh-im-feishu
                         channel()
                         onMessage()
```

`registerChannel(name, channel)` 时注册表自己订阅该通道的 `onMessage`，转发给功能级订阅者并补上 `channel: name`。所以通道上报的类型是 `ImInbound`（`ImMessage` 去掉 `channel`）：通道名只有注册名一个来源，通道自报一份早晚会对不上。

两条边界：

| 归功能 | 归通道 |
| --- | --- |
| 放哪些字段、标题文案、截断多少内容 | 键值放引用块还是卡片字段、能不能用表格、字节上限 |

所以「这个平台支不支持表格」是声明而不是猜测：通道通过 `ImCapabilities` 说明能力，不支持的形态由通道自己降级；功能侧不要写 `if (platform === 'wecom')`。

`ImDocument` 只有 heading / facts / sections / tables / footer。表格是复数（`tables: ImTable[]`）且每张可以带 `title`：分组维度（工作目录、批次……）写成表标题，而不是在一列里塞分组标记——后者每个消费方都得照抄那条约定，还白占一列宽度。图片、按钮、卡片动作等有真实需求再加。

</details>

## 延伸阅读

- 通道实现：[`@lijcoder/dsh-im-wecom`](../dsh-im-wecom)
- 功能：[`@lijcoder/dsh-notify`](../dsh-notify)、[`@lijcoder/dsh-im-commands`](../dsh-im-commands)
- 仓库约定与文档分层：[AGENTS.md](../../AGENTS.md)

## 已知限制与待办

- 同一进程内同名通道只能注册一个；需要同一平台的两套配置用 cordis 的 `isolate`。
- 不带重试与投递保证：发送失败由功能侧决定记日志还是重试。
- 只有企微一个通道实现，接缝的分层（`ctx.im` + 具名注册表）尚未被第二个平台验证。
