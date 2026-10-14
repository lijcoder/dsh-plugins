# @lijcoder/dsh-im-commands

## 概要

dsh 功能：在即时通讯软件里用 `/` 命令查询 dsh 状态。

与平台无关——收发都走接缝 [`@lijcoder/dsh-im`](../dsh-im)，回复走收到的那条消息（被动回复），不需要另配目标会话。命令产出中立文档，怎么排版由通道决定。

## 目录

- [使用](#使用)
- [配置](#配置)
- [了解实现](#了解实现)
- [延伸阅读](#延伸阅读)
- [已知限制与待办](#已知限制与待办)

## 使用

本包是纯库（不带 `dsh.bundle`），不能单独装；装组合包 [`@lijcoder/dsh-im-wecom-profile`](../dsh-im-wecom-profile)。

| 命令 | 作用 |
| --- | --- |
| `/list` | 按工作目录分组列出当前进程里活着的顶层会话：一个目录一张表，表里是会话与运行状态 |
| `/help` | 按注册顺序列出所有命令 |

加一条命令就是在 `registerCommands` 里注册，`/help` 会自动带上它：

```ts
router.register({ name: 'ping', summary: '看看还活着吗', run: () => ({ heading: '🏓 pong' }) })
```

用户可见的行为：不是命令的普通聊天不回复；未知命令回一条带 `/help` 的提示；命令抛错回 `⚠️ 命令 /x 执行失败` 加原因（命令台是交互面，静默失败等于「没反应」，没法排障）。

### `/list` 在企微里长什么样

标题是「总数 + 运行数」，下面一个工作目录一张表：

```
## 🖥 DSH 会话（4）· 🏃 2 个运行中

**~/work/deepseek-harness**

| 会话 | 状态 | sessionId |
| --- | --- | --- |
| 排查 loader 竞态 | 🏃 运行中 | s3 |

**~/work/dsh-plugins**

| 会话 | 状态 | sessionId |
| --- | --- | --- |
| 重构 IM 接缝 | 🏃 运行中 | s2 |
| 修复 /list 展示 | 💤 空闲 | s1 |
```

拆表而不是「一张大表 + 目录列」：目录名长短不齐，塞在列里既占宽度，又要靠「空首格 = 与上一行同组」表达分组；拆开之后每张表只剩真正会变的信息。表之间按目录名排序，同一张表里运行中的排在前面，其余保持注册顺序。

一个会话都没有时只给标题和一句 `当前没有活着的会话。`，不产出表格。声明 `tables: false` 的通道自己把它降级成「加粗目录 + 逐行引用块」：

```
## 🖥 DSH 会话（1）· 🏃 0 个运行中

**~/work/dsh-plugins**

> 会话：修复 /list 展示 · 状态：💤 空闲 · sessionId：s1
```

## 配置

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `channel` | 唯一通道时自动选中 | 用哪个通道收发（注册了多个时必填） |

## 了解实现

<details>
<summary>实现细节（维护者向）——点开</summary>

命令路由是一个 `Map<name, ImCommand>`，`run(args)` 返回 `ImDocument`；`handle()` 解析消息、执行、把文档交给 `message.reply`。

解析约定：群聊里机器人只有被 @ 才会收到回调、正文带 `@机器人` 前缀，所以匹配前先剥掉。

`/list` 的数据来自 `ctx.agents.roots()` 与会话标题投影 `ctx.sessionProjections.stateOf(…, 'title')`，两个服务都靠 `inject` 声明。

入站从 `ctx.im.onMessage` 订阅，挂载时不解析通道——理由见 [AGENTS.md](../../AGENTS.md) 的「行序不决定激活顺序」。配了 `channel` 就只收那个通道的消息，没配则全收；回复走 `message.reply` 原路返回，不存在发错地方的问题，所以这里比出站宽松。

</details>

## 延伸阅读

- 接缝契约：[`@lijcoder/dsh-im`](../dsh-im)
- 通知功能：[`@lijcoder/dsh-notify`](../dsh-notify)
- 安装与环境变量：[`@lijcoder/dsh-im-wecom-profile`](../dsh-im-wecom-profile)

## 已知限制与待办

- `/list` 只覆盖当前进程内存里的会话：没加载进内存的历史会话、其它进程（单独跑的 headless 等）看不到。
- 没有查看待审批数的命令；`/list` 只显示会话与运行状态。
- 只有被动回复，没有主动推送：命令台不在群里说话，只在被 @ 或私聊时回。
