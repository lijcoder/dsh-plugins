# @lijcoder/dsh-notify

## 概要

dsh 功能：任务完成、需要用户授权、或需要你回答问题时，往你在用的即时通讯软件推一条通知。

平台无关——它只依赖接缝 [`@lijcoder/dsh-im`](../dsh-im)，发到企业微信还是飞书由装了的通道包决定（企微见 [`@lijcoder/dsh-im-wecom`](../dsh-im-wecom)）。发什么内容归它，怎么排版归通道。

## 目录

- [使用](#使用)
- [配置](#配置)
- [了解实现](#了解实现)
- [延伸阅读](#延伸阅读)
- [已知限制与待办](#已知限制与待办)

## 使用

本包是纯库（不带 `dsh.bundle`），不能单独装；装组合包 [`@lijcoder/dsh-im-wecom-profile`](../dsh-im-wecom-profile)，它把本包的 `channel` 钉成 `wecom`、`target` 指向通知目标（行与覆盖语义见[组合包 README](../dsh-im-wecom-profile)）。

三类触发：

| 触发 | 时机 |
| --- | --- |
| 任务完成 | `agent/status` 变成 `idle`。`idle` 表示整个 agent（含排队中的后续回合、维护任务）真正空闲，比单个 `turn/end` 更贴近「任务完成」。同一个回合只通知一次 |
| 需要授权 | `approval/request`（waterfall）。工具要你拍板时发一条，带上工具名和原因 |
| 需要回答 | `user-questions/request`（waterfall）。工具弹出选项卡片时发一条，带上题干与选项 |

两个 `request` 都只旁观：发完通知照常 `next()`，决策 / 回答仍交给真正的回答者（Web UI / 权限策略），插件不参与裁定。它们**注册在瀑布链最前面**（`prepend`）：链在第一个返回结果的监听器处就结束，宿主的 Web UI 回答者注册得更早、拿到用户点击就直接返回，排在后面的监听器根本不会执行。

## 配置

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `channel` | 唯一通道时自动选中 | 用哪个通道发（注册了多个时必填） |
| `target` | 可缺 | 通知目标；语义由通道解释（企微：群 chatid 或用户 userid）。**volatile**：Web 插件页里填完当场生效；没填就只记一条日志，不发也不报错 |
| `heading` / `approvalHeading` / `questionHeading` | `DSH 任务通知` / `DSH 授权通知` / `DSH 提问通知` | 三类通知的标题 |
| `includeApprovals` | `true` | 需要授权时是否也发 |
| `includeQuestions` | `true` | 需要你回答问题（选项卡片）时是否也发 |
| `includeSubagents` | `false` | 是否也给 subagent 子会话发（授权通知不受此开关限制——子代理卡住同样在等你） |
| `onlyCompleted` | `false` | 只通知成功完成的回合 |
| `includeQuestion` / `includeOutput` | `true` | 是否带上这一轮的问题 / 最后一条回复 |
| `maxQuestionBytes` / `maxOutputBytes` | `400` / `2000` | 「问题」「回复」两段的 UTF-8 字节预算。**volatile**：Web 插件页里改完当场生效。中文一字约 3 字节，2000 字节 ≈ 666 字 |
| `dryRun` | `false` | 只记日志不发送，联调排障用 |

单位是 **UTF-8 字节**，不是字符。正文比预期短时按这个顺序查：先看「回复」段的 `maxOutputBytes`（默认 2000 字节），再看通道那行的 `maxContentBytes`（默认 20480，整条消息的兜底）——**两个都要放得下才发得全**，只调大前者仍会被后者截断。

## 了解实现

<details>
<summary>实现细节（维护者向）——点开</summary>

产出的是 `ImDocument`，位置和样式由通道决定：

```ts
{ heading: '✅ DSH 任务通知',
  facts: [ { label: '会话', value: '修复登录超时' },
           { label: '状态', value: '成功' },
           { label: '目录', value: '/work/demo', code: true } ],
  sections: [ { title: '问题', body: '…' }, { title: '回复', body: '…' } ] }
```

所以这里管的是「放多少内容」，整条消息放不放得下归通道：`maxQuestionBytes` / `maxOutputBytes` 是两段正文的预算，排版与最终那条的字节兜底在通道侧（企微见 [`@lijcoder/dsh-im-wecom`](../dsh-im-wecom) 的 `maxContentBytes`）。

「需要你回答」的通知是每条问题一段正文，选项是段落里的行——选项说明、题干、补充说明各自限长，全文仍在会话里：

```ts
{ heading: '❓ DSH 提问通知',
  facts: [ { label: '会话', value: '修复登录超时' }, … ],
  sections: [ { title: '问题', body: '先改哪个？\n选项：\n1. A\n2. B：更稳' } ],
  footer: 'DSH 正在等你的回答，请回到会话里处理。' }
```

行为约定：

- 旁路能力：发送失败只写一条 warn，不冒泡回 agent loop，也不影响授权结果；通道名配错同样只 warn（配置错不该让整轮对话炸掉）。
- 标题来自投影：读 `session-title` 注册的 `title` 投影（按已提交事件驱动，含重启后恢复的历史），读不到才退化为该会话首条人类消息。不能只靠增量监听——插件可能在一个跑了很多轮的会话中途才挂上，那时标题早就写过了。
- 通道惰性解析：行序不决定激活顺序（见 [AGENTS.md](../../AGENTS.md)），所以发送时才取通道；缺通道只是这条通知发不出去。
- 目标与字节预算每次现读：它们都是 volatile（Web 插件页里能改），发送前用 `styleOf()` 现取——挂着时缓存一份就会让「这一轮改完」等到重启才生效。没配目标不是错误——那只是还没配，记一条日志就跳过。

</details>

## 延伸阅读

- 接缝契约：[`@lijcoder/dsh-im`](../dsh-im)
- 安装与环境变量：[`@lijcoder/dsh-im-wecom-profile`](../dsh-im-wecom-profile)
- 仓库取向与包表：[README](../../README.md)

## 已知限制与待办

- 从 IM 直接批准或作答还没做：两者都属于「IM 消息驱动 dsh」的范畴，需要收消息链路再加一层回答（`dsh-im-commands` 已有收消息的前一半）。
- 不补发历史：插件加载前已结束的回合不会通知。
- 授权通知的「原因」仍在采集时截断在 200 字，这个上限不在配置页上——它只是提醒你回会话处理，不是要放全文。
- 提问通知的题干 / 补充说明 / 选项说明分别截断在 200 / 500 / 100 字：plan-review 这类 intent 的 `detail` 是整份计划，全量塞进通知只会淹没选项。
- 只报状态迁移，不记录审批是否被处理：授权通知发出去之后，`/list` 里看不到待审批数。
