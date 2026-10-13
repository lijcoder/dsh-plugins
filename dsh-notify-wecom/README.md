# dsh-notify-wecom

DeepSeek Harness 插件（bundle）：**任务完成、或卡在等你授权时，通过企业微信智能机器人（aibot）长连接推一条 markdown 通知。**

通知内容包含：会话标题、工作目录、状态/工具，以及这一轮的**问题**与**回复**（授权通知则是工具与原因）。

```
## ✅ DSH 任务完成
> **会话**：修复登录超时
> **状态**：成功完成
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

分两层：**通道**（企微连接）和**功能**（用通道做的事）。现在只有一个功能——通知，两类触发。

| 文件 | 职责 |
| --- | --- |
| [src/wecom.ts](src/wecom.ts) | `WecomConnection`：aibot 长连接的建立/认证等待/发送/断开；`provideWecom()` 把它注册成 **`ctx.wecom`** |
| [src/notify.ts](src/notify.ts) | 通知功能：`CompletionCollector` 采集会话事件（问题/回复/状态）→ 渲染 → `registerNotify()` 订阅 `agent/status`（完成）和 `approval/request`（授权）并发送；标题从 `title` 投影读 |
| [src/config.ts](src/config.ts) | `Config` = 连接参数 + 通知策略，Schemastery schema 负责校验与默认值 |
| [src/index.ts](src/index.ts) | 插件入口，两行：`provideWecom(ctx, config)` + `registerNotify(ctx, config)` |

```
session/event ──► CompletionCollector（增量：标题/输出/回合边界）
agent/status=idle ──► collector.take()（同回合去重）──► renderNotification()
                                                       └─► ctx.wecom.sendMarkdown(target, content)
```

## 以后加「用企微消息驱动 DSH」

通道已经抽出来了，加收消息不用碰通知那块：

1. `WecomConnection.start()` 里加 `client.on('message.text', ...)`，把消息交给一个订阅接口（例如 `onMessage(handler)`）——SDK 的连接、认证、重连、超时都在这个类里，业务侧不碰 SDK。
2. 新写一个 `src/chat.ts`：`registerChat(ctx, config)`，订阅 `ctx.wecom` 收到的消息，映射到 harness 的 `agent.followup()` / `ctx.agents`，把结果再 `ctx.wecom.sendMarkdown()` 回去。
3. `index.ts` 里加一行 `registerChat(ctx, config)`；配置新字段加进 `Config`。

通道是 Cordis 服务（`ctx.wecom`），所以也可以做成独立插件，只要 `inject: ['wecom']` 就能拿到同一条连接——不会因为两个插件各建一条连接而互相踢线。

## 触发时机

两类触发，各发一条：

- **任务完成**：`agent/status` 变成 `idle`。`idle` 表示整个 agent（含排队中的后续回合、维护任务）真正空闲，比单个 `turn/end` 更贴近「任务完成」；同一个回合只通知一次，重复 `idle` 不会重复发。默认**只通知顶层会话**，subagent 子会话不发。
- **需要授权**：`approval/request`（waterfall）。工具要用户拍板时发一条，带上工具名和原因。

`approval/request` 我们**只旁观**：发完通知照常 `next()`，决策仍然交给真正的回答者（Web UI / 权限策略），插件不参与放行与否。`displayReason` 有中文就用中文，其次用问询方的 `reason`，最后退回 `en`。

> 从企微直接批准**还没做**——那属于下面「收消息」的范畴（需要先能收到消息、再映射回 `approval` 的回答链）。

## 安装

插件必须被 `dsh` 所在的 profile 加载。先构建，再装进 profile：

```sh
cd /Users/lijie/work/ai/dsh-plugins/dsh-notify-wecom
npm install
npm run build                       # 产出 lib/，profile 的 main 指向 lib/index.js

# dsh 在 PATH 里时（安装版）
dsh plugin --profile web add /Users/lijie/work/ai/dsh-plugins/dsh-notify-wecom

# 从仓库源码跑时（在 deepseek-harness 仓库根目录）
pnpm dsh plugin --profile web add /Users/lijie/work/ai/dsh-plugins/dsh-notify-wecom
```

确认 bundle 层生效：

```sh
dsh --profile web --dump-config | grep -A 10 'dsh-notify-wecom'
```

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

```sh
npm run typecheck                     # tsc --noEmit
npm test                              # 26 个离线单测：采集器 / 渲染 / 两类触发接线
```

WeCom 链路用 `tmps/` 里的本地 Mock 企微长连接服务端做端到端验证（不需要真实凭证）：

```sh
cd /Users/lijie/work/ai/dsh-plugins/tmps
npm run test:notify                   # 断言真的发出 aibot_send_msg + markdown 载荷
```

「装进 profile 能挂载」这一层用一个隔离的 `DSH_HOME` 验证过（不碰你正在用的 `~/.dsh`）：

```sh
cd /Users/lijie/work/ai/dsh-plugins
export DSH_HOME="$PWD/.dsh-test"
node <deepseek-harness>/apps/cli/lib/bin.js plugin --profile notify-test add ./dsh-notify-wecom
# 看 bundle 层：--dump-config；看挂载：给一个非法配置应报 schema 校验错误
```

空 `DSH_HOME` 下 `dsh` 没有模型凭证，所以这里只验证到「bundle 合成 + 插件挂载 + Config 校验」；真实跑一个任务看通知落地，请在你自己的 profile 里做。

## 注意与限制

- **同一个机器人的长连接只能有一个**：插件在 DSH 进程里常驻 WS 连接，别让 `tmps` 或另一个进程用同一个 botId 同时连（企微会把旧连接踢掉）。
- **markdown 是这条通道的子集**：实测支持 `##` 标题、`**加粗**`、`` `行内代码` ``、`>` 引用块；**不支持** `<font color>`（会原样打出）、表格、代码块。所以状态只用 emoji 表达，元信息放引用块，内容按 4096 字节硬截断。
- **完成通知只发顶层会话**（可用 `includeSubagents` 打开）；**授权通知不受这个开关限制**——子代理卡在授权上同样在等你，所以照样发（用 `includeApprovals: false` 可整体关掉）。
- **授权通知只是提醒**：不能在企微里批准，得回会话处理。要支持从企微批准，得先做「收消息」那条链路。
- **不补发历史**：插件加载前已结束的回合不会通知；插件加载后新发生的才通知。
- **标题来自投影**：`session-title` 注册的 `title` 投影（由注册表按已提交事件驱动，含重启后恢复的历史），读不到才退化为该会话首条人类消息。插件 `inject: ['sessionProjections']`，profile 里没有这个服务时它会一直等待挂载。
- **进程内无持久队列**：DSH 崩溃时正在发送的通知会丢，不做重试队列。
- 改动代码后要 `npm run build` 并重启 profile（linked 包不会热更新 `lib/`）。
