# @lijcoder/dsh-notify-wecom

DeepSeek Harness 插件（bundle）：**通过企业微信智能机器人（aibot）长连接做两件事——任务完成/需要授权时推 markdown 通知，以及响应 `/list`、`/help` 这类 `/` 命令。**

通知内容包含：会话标题、工作目录、状态/工具，以及这一轮的**问题**与**回复**（授权通知则是工具与原因）。

```
## ✅ DSH 任务完成
> **会话**：修复登录超时
> **状态**：成功
> **目录**：`~/work/ai/dsh-plugins`
> **回合**：#3 · 耗时 2m13s · 10-13 15:05
> **Session**：`sess-abc123`

**问题**
帮我把登录超时改大一点

**回复**
已把登录超时从 3s 调到 30s，并补了单测。
```

```
## 🔐 DSH 需要授权
> **会话**：修复登录超时
> **目录**：`~/work/ai/dsh-plugins`
> **工具**：`write`
> **Session**：`sess-abc123`

**原因**
允许本次操作使用 danger-full-access 权限：要在主目录创建 xxx.md，该路径超出工作区白名单。

DSH 正在等你的授权，请回到会话里处理。
```

## 代码结构

一条通道（企微长连接）+ 两个功能（通知、命令），功能都从 `ctx.wecom` 取同一条连接。

| 文件 | 职责 |
| --- | --- |
| [src/wecom.ts](src/wecom.ts) | `WecomConnection`：aibot 长连接的建立/认证等待/发送/断开 + 收到的文本消息（`onMessage`）；`provideWecom()` 把它注册成 **`ctx.wecom`** |
| [src/notify.ts](src/notify.ts) | 通知功能：`CompletionCollector` 采集会话事件（问题/回复/状态）→ 渲染 → `registerNotify()` 订阅 `agent/status`（完成）和 `approval/request`（授权）并发送；标题从 `title` 投影读 |
| [src/commands.ts](src/commands.ts) | 命令功能：`WecomCommandRouter` + `registerCommands()`，内置 `/list`、`/help`；加命令就是 `router.register({ name, summary, run })` |
| [src/config.ts](src/config.ts) | `Config` = 连接参数 + 通知/命令开关，Schemastery schema 负责校验与默认值 |
| [src/index.ts](src/index.ts) | 插件入口：`provideWecom` → `registerNotify` → `registerCommands` |

```
session/event ──► CompletionCollector（增量：问题/输出/回合边界）
agent/status=idle ──► collector.take()（同回合去重）──► renderNotification()
                                                       └─► ctx.wecom.sendMarkdown(target, content)

企微文本消息 ──► WecomConnection.onMessage ──► WecomCommandRouter
                                                ├─ /list  → ctx.agents.roots() + title 投影
                                                └─ /help  → 注册表自动生成
```

## 企微 `/` 命令

在企微里给机器人发 `/list`（两级：**一级目录、二级会话**）：

```
## 🖥 DSH 会话（3）

**`~/work/ai/dsh-plugins`**

| 会话 | 状态 | sessionId |
| --- | --- | --- |
| 修复登录超时 | 🏃 运行中 | session-1a4cd73a-b8ef-4e34-abc4-31986b2b17b8 |

**`~/work/ai/test/chat`**

| 会话 | 状态 | sessionId |
| --- | --- | --- |
| Greeting | 🏃 运行中 | session-92bfcaee-a6b7-410a-8a55-6421c7d4fcf9 |
| 随手问问 | 💤 空闲 | session-2ffacbca-9135-44d7-9195-6984f42376e2 |
```

| 命令 | 作用 |
| --- | --- |
| `/list` | 按工作目录分组列出**当前进程里活着的顶层会话**：标题（`title` 投影）+ 运行状态 |
| `/help` | 按注册顺序列出所有命令 |

展示规则：

- **一级 = 工作目录**：加粗 + 行内代码，按路径排序；home 目录缩写成 `~`；没有 cwd 的会话归到「（无工作目录）」组；
- **二级 = 该目录下的会话表格**：三列 `会话 / 状态 / sessionId`；同目录内**运行中的排在前面**，其余保持注册顺序；标题里的 `|` 和换行会转义，避免撑坏表格。

> ⚠️ 表格能不能渲染取决于企微客户端：群机器人 markdown 官方不支持表格，`markdown_v2` 才支持。我们这条 aibot 流式回复用的是 markdown 内容，如果客户端把 `| … |` 原样打出来，就换回「加粗路径 + 引用块」那种已验证的排版——告诉我一声即可。

实现要点：

- 命令回复走**收到的那条消息**（被动回复，沿用它的 `req_id`），不需要另配目标会话；
- 群聊里机器人只有被 @ 才会收到回调、正文带 `@提及` 前缀，**解析前先剥掉**；
- 不是命令的普通聊天不回复；未知命令回 `/help`；命令抛错回一条 `⚠️ … 执行失败：原因`（不静默）；
- 回复内容同样受 `maxContentBytes` 约束。

`/list` 只覆盖**当前进程内存里**的会话：没加载进内存的历史会话、其它进程（单独跑的 headless 等）看不到。

## 以后再加功能

通道已经抽出来了（`ctx.wecom`：`sendMarkdown` 发、`onMessage` 收）：

1. **加一条命令**：`registerCommands` 里 `router.register({ name, summary, run })` 就够了——`/help` 会自动带上它。
2. **做「用企微消息驱动 DSH」**（发消息即开一个会话）：新写 `src/chat.ts` 的 `registerChat(ctx, config)`，订阅 `ctx.wecom.onMessage`，把消息映射到 `ctx.agents` / `agent.followup()`，结果再 `ctx.wecom.sendMarkdown()` 回去；`index.ts` 加一行。

`ctx.wecom` 是 Cordis 服务，所以也能做成独立插件，只要 `inject: ['wecom']` 就拿到同一条连接——不会因为两个插件各建一条连接而互相踢线。

## 触发时机

两类触发，各发一条：

- **任务完成**：`agent/status` 变成 `idle`。`idle` 表示整个 agent（含排队中的后续回合、维护任务）真正空闲，比单个 `turn/end` 更贴近「任务完成」；同一个回合只通知一次，重复 `idle` 不会重复发。默认**只通知顶层会话**，subagent 子会话不发。
- **需要授权**：`approval/request`（waterfall）。工具要用户拍板时发一条，带上工具名和原因。

`approval/request` 我们**只旁观**：发完通知照常 `next()`，决策仍然交给真正的回答者（Web UI / 权限策略），插件不参与放行与否。`displayReason` 有中文就用中文，其次用问询方的 `reason`，最后退回 `en`。

> 从企微直接批准**还没做**——那属于下面「收消息」的范畴（需要先能收到消息、再映射回 `approval` 的回答链）。

## 安装

插件必须被 `dsh` 所在的 profile 加载。先在本仓库构建，再装进 profile：

```sh
cd /Users/lijie/work/ai/dsh-plugins
pnpm install
pnpm build                          # 产出各包 lib/，profile 的 main 指向 lib/index.js

# dsh 在 PATH 里时（安装版）
dsh plugin --profile web add ./packages/dsh-notify-wecom

# 从仓库源码跑时（在 deepseek-harness 仓库根目录）
pnpm dsh plugin --profile web add /Users/lijie/work/ai/dsh-plugins/packages/dsh-notify-wecom
```

发布到 npm 之后也可以按包名装：`dsh plugin --profile web add @lijcoder/dsh-notify-wecom`。

确认 bundle 层生效：

```sh
dsh --profile web --dump-config | grep -A 10 'dsh-notify-wecom'
```

> ⚠️ 光在自己 profile 的 `cordis.patch.yml` 里手写一行 `- id: dsh-notify-wecom` 是**不够的**：
> 启动器找不到对应的 bundle 会直接丢掉这行，只打一句 `patch: entry "dsh-notify-wecom" not found` 警告。
> 必须走 `dsh plugin add`，让它同时写进 `dependencies` 与 `dsh.profile.bundles`。

## 配置

三件必填：`botId`、`secret`、`target`（群 chatid 或单聊 userid）。bundle 自带的 patch 从环境变量读，**三个变量缺任意一个，这一行是停用的**，所以装完没配凭证不会让 profile 起不来：

```sh
export WECOM_NOTIFY_BOT_ID=...
export WECOM_NOTIFY_BOT_SECRET=...
export WECOM_NOTIFY_TARGET=chatid或userid
```

想写死凭证或改默认值，在 `$DSH_HOME/profiles/web/cordis.patch.yml` 里按 row id 覆盖。注意两点：

1. 补丁**整块替换 `config`**，覆盖时要写全需要的键；
2. bundle 层的 `disabled` 表达式会**继续生效**（补丁不写 `disabled` 就沿用），所以「不设环境变量、只在补丁里写凭证」时必须显式写 `disabled: false`。

```yaml
- id: dsh-notify-wecom
  disabled: false          # 不设 WECOM_NOTIFY_* 环境变量时必需
  config:
    botId: 'your-bot-id'
    secret: 'your-bot-secret'
    target: 'your-chatid'
    heading: 'DSH 任务完成'
    approvalHeading: 'DSH 需要授权'
    includeApprovals: true
    includeSubagents: false
    onlyCompleted: false
    maxOutputBytes: 2000
```

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `botId` / `secret` / `target` | 必填 | 机器人凭证与目标会话（群 chatid / 单聊 userid） |
| `scene` / `plugVersion` / `wsUrl` | 无 | 透传 SDK；`wsUrl` 用于私有化部署 |
| `heartbeatInterval` | `30000` | 心跳间隔（毫秒） |
| `reconnectInterval` | `1000` | 重连基础延迟，SDK 指数退避 |
| `maxReconnectAttempts` | `10` | `-1` 无限重连 |
| `maxAuthFailureAttempts` | `5` | `-1` 无限重试 |
| `requestTimeout` | `10000` | 等待消息回执超时（也约束卸载时的收尾等待） |
| `connectTimeoutMs` | `15000` | 等待认证成功上限，超时本条通知记失败 |
| `heading` | `DSH 任务完成` | 任务完成通知的标题 |
| `approvalHeading` | `DSH 需要授权` | 需要授权通知的标题 |
| `includeApprovals` | `true` | 需要用户授权时是否发通知 |
| `includeCommands` | `true` | 是否响应企微 `/` 命令 |
| `includeSubagents` | `false` | 是否也给 subagent 子会话发 |
| `onlyCompleted` | `false` | 只通知 `completed`，失败/中断不发 |
| `includeQuestion` | `true` | 是否带上这一轮的问题（回合里第一条人类消息） |
| `includeOutput` | `true` | 是否带上最后一条 assistant 文本 |
| `maxContentBytes` | `4096` | 整条内容 UTF-8 字节预算（企微上限） |
| `maxQuestionBytes` | `400` | 「问题」字节预算 |
| `maxOutputBytes` | `2000` | 「回复」字节预算 |
| `dryRun` | `false` | 只记日志不发送（连接照常建立），联调排障用 |

两类通知都是**旁路能力**：发送失败只写一条 warn，不会冒泡回 agent loop，也不影响授权结果。长连接是插件生命周期资源，随插件卸载 / HMR 断开；断开前会等在途发送落地（每条发送本身受 `requestTimeout` 约束），所以 `dsh headless "..."` 这类 one-shot 场景不会因为进程先退出而丢通知。

## 验证

在本仓库根目录：

```sh
pnpm check                            # 全仓 typecheck + build + test
pnpm --filter @lijcoder/dsh-notify-wecom test    # 只跑本插件
```

54 个测试分三层：

| 文件 | 覆盖 |
| --- | --- |
| [tests/notify.test.ts](tests/notify.test.ts) | 采集器、渲染、回合/状态判定（纯函数） |
| [tests/commands.test.ts](tests/commands.test.ts) | 命令解析与路由（纯函数 + 假通道） |
| [tests/plugin.test.ts](tests/plugin.test.ts) | 两类触发、去重、失败路径（处理器级，手搓 Context） |
| [tests/e2e.test.ts](tests/e2e.test.ts) | **端到端**：本地 Mock 企微长连接服务端 + 真实 cordis Context |

e2e 那层不需要真实凭证、不联外网，覆盖三件单测看不见的事：

1. 连接层协议帧——主动推送发 `aibot_send_msg` + markdown，命令用收到的 `req_id` 被动回复；
2. **整个插件挂到真实 cordis Context 上**跑通 `inject` → `apply` → `provideWecom` → 通知落地；
3. `dispose()` 之后长连接确实关掉了，以及少一个 inject 服务时插件保持 PENDING 而不是带病激活。

Mock 服务端见 [tests/mock-wecom.ts](tests/mock-wecom.ts)，实现了认证、消息/事件推送、回执、
素材三步上传与加密下载接口。

「装进 profile 能挂载」这一层用一个隔离的 `DSH_HOME` 验证（不碰你正在用的 `~/.dsh`）：

```sh
cd /Users/lijie/work/ai/dsh-plugins
export DSH_HOME="$PWD/.dsh-test"
node <deepseek-harness>/apps/cli/lib/bin.js plugin --profile notify-test add ./packages/dsh-notify-wecom
# 看 bundle 层：--dump-config；看挂载：给一个非法配置应报 schema 校验错误
```

空 `DSH_HOME` 下 `dsh` 没有模型凭证，所以这里只验证到「bundle 合成 + 插件挂载 + Config 校验」；
真实跑一个任务看通知落地，请在你自己的 profile 里做。

## 注意与限制

- **同一个机器人的长连接只能有一个**：插件在 DSH 进程里常驻 WS 连接，别让另一个进程（或另一个 profile）用同一个 botId 同时连——企微会把旧连接踢掉。e2e 里的 Mock 同样只保留最新一条连接，这是刻意的忠实模拟。
- **markdown 是这条通道的子集**：实测支持 `##` 标题、`**加粗**`、`` `行内代码` ``、`>` 引用块；**不支持** `<font color>`（会原样打出）、表格、代码块。所以状态只用 emoji 表达，元信息放引用块，内容按 4096 字节硬截断。
- **完成通知只发顶层会话**（可用 `includeSubagents` 打开）；**授权通知不受这个开关限制**——子代理卡在授权上同样在等你，所以照样发（用 `includeApprovals: false` 可整体关掉）。
- **授权通知只是提醒**：不能在企微里批准，得回会话处理。要支持从企微批准，得先做「收消息」那条链路。
- **不补发历史**：插件加载前已结束的回合不会通知；插件加载后新发生的才通知。
- **依赖的服务要 inject**：cordis 里读别的插件提供的服务（`ctx.agents`、`ctx.sessionProjections`）必须先声明 `inject`，否则直接抛 `cannot get property "…" without inject`。本插件声明了 `inject: ['agents', 'sessionProjections']`；`ctx.wecom` 是自己 provide 的，同 fiber 使用不需要 inject（注入自己会死等）。
- **标题来自投影**：`session-title` 注册的 `title` 投影（由注册表按已提交事件驱动，含重启后恢复的历史），读不到才退化为该会话首条人类消息。插件 `inject: ['sessionProjections']`，profile 里没有这个服务时它会一直等待挂载。
- **进程内无持久队列**：DSH 崩溃时正在发送的通知会丢，不做重试队列。
- 改动代码后要 `pnpm build` 并重启 profile（linked 包不会热更新 `lib/`）。
