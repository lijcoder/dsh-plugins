# @lijcoder/dsh-im-wecom

[`@lijcoder/dsh-im`](../dsh-im) 的通道实现：**企业微信智能机器人（aibot）长连接**。

只做三件事：建连、把中立的 `ImDocument` 渲染成企微 markdown、把收到的帧归一化成 `ImMessage`。
连接、认证、重连、超时、回执都由内部 SDK 兜住，消费方不碰。

```
ctx.im.registerChannel('wecom', channel)
        │
        ├─ send(target, document)  ──► renderDocument() ──► aibot_send_msg（主动推送）
        └─ onMessage(handler)      ◄── aibot_msg_callback ──► ImMessage
                                                             └─ reply(document) → aibot_respond_msg
```

## 用法

通道是**实现方**，自己不发通知；装上它，再装一个功能插件（如
[`@lijcoder/dsh-notify`](../dsh-notify)）。或者直接装组合包
[`@lijcoder/dsh-notify-wecom`](../dsh-notify-wecom)，一次配齐。

```yaml
- id: im-wecom
  name: '@lijcoder/dsh-im-wecom'
  config:
    botId: ...
    secret: ...
```

## 能力声明

```ts
{ richText: true, tables: false, maxContentBytes: 4096, proactive: true }
```

`tables: false` 是实测结论：智能机器人这条 markdown 通道**不支持表格**
（`<font color>` 也会被原样打出）。所以表格会被降级成「加粗首列 + 引用块」，
而不是把 `| … |` 原样吐给用户。这个降级是**渲染层自己完成的**，功能插件只管说
「要一张三列表」——加飞书那种能渲染真表格的通道时，功能代码一行不用改。

## 配置

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `botId` / `secret` | 必填 | 机器人凭证 |
| `scene` / `plugVersion` / `wsUrl` | 无 | 透传 SDK；`wsUrl` 用于私有化部署 |
| `heartbeatInterval` | `30000` | 心跳间隔（毫秒） |
| `reconnectInterval` | `1000` | 重连基础延迟，SDK 指数退避 |
| `maxReconnectAttempts` | `10` | `-1` 无限重连 |
| `maxAuthFailureAttempts` | `5` | `-1` 无限重试 |
| `requestTimeout` | `10000` | 等待消息回执超时（也约束卸载时的收尾等待） |
| `connectTimeoutMs` | `15000` | 等待认证成功上限，超时本条发送记失败 |
| `maxContentBytes` | `4096` | 单条内容字节预算，渲染后兜底截断 |

**这里没有任何通知策略**（发什么、给谁发、什么时候发）。那些属于功能插件——
通道配置只回答「怎么连、怎么渲染」。

## 验证

```sh
pnpm --filter @lijcoder/dsh-im-wecom test
```

12 个用例覆盖渲染层：标题/键值/段落排版、`<font>` 不使用、`code` 值缩写 home、
**表格降级与真表格两条分支**、单元格转义、纯文本降级、字节预算截断。

Mock 企微服务端驱动的连接层与组装层用例见 `dsh-im-wecom` 的后续提交
（`tests/e2e.test.ts`）。

## 已知限制

- **同一个 botId 只能有一条长连接**：新连接会把旧的顶掉（企微行为）。别让第二个进程
  或第二个 profile 用同一个 `botId`。
- 发送**不做重试与投递保证**：失败抛给调用方，由功能侧决定记日志还是重试。
- 文档里声明了但本通道不支持的形态（表格）会被降级，**不会报错**——降级比丢失好。
