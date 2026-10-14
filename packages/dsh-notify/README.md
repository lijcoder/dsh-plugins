# @lijcoder/dsh-notify

DeepSeek Harness 功能：**任务完成或需要授权时，往你在用的即时通讯软件推一条通知。**

与平台无关——它只依赖接缝 [`@lijcoder/dsh-im`](../dsh-im)，具体发给企业微信还是飞书，
由装了哪个通道包决定（见 [组合包](../dsh-notify-wecom)）。

## 两类触发

| 触发 | 时机 |
| --- | --- |
| **任务完成** | `agent/status` 变成 `idle`。`idle` 表示整个 agent（含排队中的后续回合、维护任务）真正空闲，比单个 `turn/end` 更贴近「任务完成」。同一个回合只通知一次 |
| **需要授权** | `approval/request`（waterfall）。工具要你拍板时发一条，带上工具名和原因 |

`approval/request` **只旁观**：发完通知照常 `next()`，决策仍交给真正的回答者
（Web UI / 权限策略），插件不参与放行与否。

> 从 IM 直接批准**还没做**——那属于「IM 消息驱动 dsh」的范畴，需要
> `@lijcoder/dsh-im-commands` 那样的收消息链路再加一层审批回答。

## 只描述内容，不决定排版

插件产出的是 `ImDocument`，位置和样式由通道决定：

```ts
{ heading: '✅ DSH 任务完成',
  facts: [ { label: '会话', value: '修复登录超时' },
           { label: '状态', value: '成功' },
           { label: '目录', value: '/work/demo', code: true } ],
  sections: [ { title: '问题', body: '…' }, { title: '回复', body: '…' } ] }
```

所以这里**一个字节上限都没有**（那是通道的能力）：`maxQuestionBytes` / `maxOutputBytes`
管的是「放多少内容」，怎么排版、整条能不能放下归通道。

## 配置

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `channel` | 唯一通道时自动选中 | 用哪个通道发（注册了多个时必填） |
| `target` | 必填 | 通知目标；语义由通道解释（企微：群 chatid 或用户 userid） |
| `heading` / `approvalHeading` | `DSH 任务通知` / `DSH 授权通知` | 两类通知的标题 |
| `includeApprovals` | `true` | 需要授权时是否也发 |
| `includeSubagents` | `false` | 是否也给 subagent 子会话发（授权通知不受此开关限制——子代理卡住同样在等你） |
| `onlyCompleted` | `false` | 只通知成功完成的回合 |
| `includeQuestion` / `includeOutput` | `true` | 是否带上这一轮的问题 / 最后一条回复 |
| `maxQuestionBytes` / `maxOutputBytes` | `400` / `2000` | 这两段的字节预算 |
| `dryRun` | `false` | 只记日志不发送，联调排障用 |

## 行为约定

- **旁路能力**：发送失败只写一条 warn，不冒泡回 agent loop，也不影响授权结果；
  通道名配错同样只 warn（配置错不该让整轮对话炸掉）。
- **标题来自投影**：读 `session-title` 注册的 `title` 投影（按已提交事件驱动，含重启后恢复的
  历史），读不到才退化为该会话首条人类消息。不能只靠增量监听——插件可能在一个跑了很多轮的
  会话中途才挂上，那时标题早就写过了。
- **不补发历史**：插件加载前已结束的回合不会通知。
- **通道惰性解析**：patch 里的行序不保证，所以发送时才取通道；缺通道只是这条通知发不出去。

## 验证

```sh
pnpm --filter @lijcoder/dsh-notify test
```

19 个用例：文档结构（键值/段落/code 标记/字节预算）、注入与事件分发、两类触发、
同回合去重、subagent 跳过、dryRun、发送失败与通道名写错只 warn、
授权请求照常放行下游、`displayReason` 语言优先级、`session/disposed` 释放状态。
