# @lijcoder/dsh-im

DeepSeek Harness 能力接缝：**即时通讯通道**。

让「通过 IM 控制 dsh」这件事的平台相关部分收敛到一个可替换的边界里：功能只描述
*说什么*，通道决定 *怎么说* 和 *怎么送*。

## 形状

```
功能（与平台无关）        ctx.im（本包）           通道实现（每平台一个包）
@lijcoder/dsh-notify  ──► ImRegistry          ◄── @lijcoder/dsh-im-wecom
@lijcoder/dsh-im-commands  registerChannel()      @lijcoder/dsh-im-feishu
                           channel()
```

Context key 是单数 `ctx.im`，形状照 dsh 自己的多实现能力（`ctx.llm` / `ctx.browserUse`）。
区别是这里**允许注册多个通道**：企微做通知、飞书做别的，是真实需求。

## 用法

通道实现方：

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { ImChannel } from '@lijcoder/dsh-im'

export const inject = ['im']

export function apply(ctx: Context): void {
  const channel: ImChannel = {
    capabilities: { richText: true, tables: false, maxContentBytes: 4096, proactive: true },
    async send(target, document) { /* 把 document 渲染成自己平台的形态后送出 */ },
    onMessage(handler) { /* 收到消息时调用 handler */ return () => {} },
  }
  ctx.im.registerChannel('wecom', channel)
}
```

消费方：

```ts
export const inject = ['im']

export function apply(ctx: Context, config: Config): void {
  const channel = ctx.im.channel(config.channel)   // 'wecom' / 'feishu'；唯一通道时可省略
  ctx.on('agent/status', async ({ agent, status }) => {
    if (status !== 'idle') return
    await channel.send(config.target, { heading: '✅ 任务完成', facts: [{ label: '会话', value: '…' }] })
  })
}
```

## 两条边界

**渲染归通道，内容归功能。**

| 归功能 | 归通道 |
| --- | --- |
| 放哪些字段、标题文案、截断多少内容 | 键值放引用块还是卡片字段、能不能用表格、字节上限 |

所以加一个平台 = 新增一个通道包，功能代码一行不改。也让「这个平台支不支持表格」从
猜测变成声明：通道通过 {@link ImCapabilities} 说明能力，不支持的形态由通道自己降级。

**`ImDocument` 刻意保持最小**：只有 heading / facts / sections / table / footer。
图片、按钮、卡片动作等有真实需求再加——过早定义富媒体模型，改起来比加还贵。

## 已知限制

- 只注册一个通道时可以省略 `channel`；注册了多个则**必须**显式指定，否则抛错。
  这是刻意的：多个通道共存时静默选错，消息会发到错的地方。
- 同一进程内同名通道只能注册一个；需要同一平台的两套配置，用 cordis 的 `isolate`。
- 不带重试与投递保证：发送失败由功能侧决定记日志还是重试。
