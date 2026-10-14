# @lijcoder/dsh-im-wecom

## 概要

[`@lijcoder/dsh-im`](../dsh-im) 的通道实现：企业微信智能机器人（aibot）长连接。

只做三件事：建连、把中立的 `ImDocument` 渲染成企微 markdown、把收到的帧归一化成 `ImInbound`（注册表补上 `channel` 后才是 `ImMessage`）。认证、重连、超时、回执、心跳由内部 SDK 兜住，消费方不碰。

## 目录

- [使用](#使用)
- [配置](#配置)
- [了解实现](#了解实现)
- [延伸阅读](#延伸阅读)
- [已知限制与待办](#已知限制与待办)

## 使用

本包是纯库（不带 `dsh.bundle`），不能单独装；装组合包 [`@lijcoder/dsh-im-wecom-profile`](../dsh-im-wecom-profile)：

```sh
dsh plugin --profile web add @lijcoder/dsh-im-wecom-profile
```

组合包按「接缝 → 通道 → 功能」插好四行，并把本包设为依赖。它给本包插的行长什么样、怎么按 `id: im-wecom` 覆盖，见[组合包 README](../dsh-im-wecom-profile)。

凭证从环境变量读，缺则那一行停用，不会让 profile 起不来：

```sh
export WECOM_BOT_ID=...
export WECOM_BOT_SECRET=...
```

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
| `maxContentBytes` | `20480` | 单条内容字节预算，渲染后兜底截断 |

这里没有任何通知策略（发什么、给谁发、什么时候发）——那些属于功能插件，通道配置只回答「怎么连、怎么渲染」。

## 了解实现

<details>
<summary>实现细节（维护者向）——点开</summary>

```
ctx.im.registerChannel('wecom', channel)
        │
        ├─ send(target, document)  ──► renderDocument() ──► aibot_send_msg（主动推送）
        └─ onMessage(handler)      ◄── aibot_msg_callback ──► ImInbound
                                                             └─ reply(document) → aibot_respond_msg
```

### 能力声明

```ts
{ richText: true, tables: true, maxContentBytes: 20480, proactive: true }
```

`capabilities` 是渲染层的输入参数，不是装饰性声明——`renderDocument` 按它决定排版：

| 能力 | 渲染器据此做什么 |
| --- | --- |
| `richText` | 是否加 `##` / `**` / `` ` `` / `>` 标记；为 false 时输出无标记纯文本 |
| `tables` | 表格走标准 markdown 表格，还是降级成「加粗表标题 + 逐行引用块」 |
| `maxContentBytes` | 渲染完成后兜底截断整条内容 |

aibot 的 markdown 通道支持标准 markdown 表格。已知不支持的只有 `<font color>`（会被原样打出），所以状态只用 emoji 表达。`ImTable.title`（例如工作目录）在支持表格时单独占一行加粗，在降级通道上当引用块上方的小标题。

功能插件只管说「要几张几列表、每张叫什么」，怎么摆由这里决定，所以换一个声明 `tables: false` 的通道（纯文本 webhook 之类）时功能代码一行不用改。

### 字节预算的依据

`20480` 是 SDK 文档给的 `replyStream` 上限（「回复内容最长不超过 20480 个字节」），被动回复（`/list`、`/help`）走的就是它，这个值是准的。主动推送（通知）走 `sendMessage`，SDK 和文档都没写上限；如果哪天通知因为内容过长被拒（日志里一条 warn），把这个值调小即可。截断只影响长文，不影响投递。

</details>

## 延伸阅读

- 接缝契约：[`@lijcoder/dsh-im`](../dsh-im)
- 安装与配置这四行：[`@lijcoder/dsh-im-wecom-profile`](../dsh-im-wecom-profile)
- 跨包端到端用例与 Mock 企微服务端：[`tests/`](tests/)

## 已知限制与待办

- 同一个 botId 的长连接只能有一个：新连接会把旧的顶掉（企微行为）。别让第二个进程或第二个 profile 用同一个 `botId`。
- `send` / `reply` 失败直接抛给调用方，不重试、不排队；重试策略由功能侧决定。
- 渲染只按 `capabilities` 决定形态，不因为「这条消息是表格」报错——降级比丢失好。
- 表格与 20480 字节在真实企微客户端的表现未经人工核对，只有 Mock 服务端上的帧断言。
