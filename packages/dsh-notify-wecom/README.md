# @lijcoder/dsh-notify-wecom

**组合包**：装一次就得到「企业微信通道 + 任务完成/授权通知 + 企微内 `/` 命令」。

它自己不含任何代码——只是一个 `cordis.patch.yml`，往 profile 里插四行：

```yaml
- id: im            → @lijcoder/dsh-im            能力接缝（通道注册表）
- id: im-wecom      → @lijcoder/dsh-im-wecom      企微 aibot 长连接
- id: notify        → @lijcoder/dsh-notify        完成/授权通知
- id: im-commands   → @lijcoder/dsh-im-commands   /list、/help
```

行序有语义：命令功能在挂载时就要在通道上订阅消息，所以通道那行必须排在它前面。

想只装一半，就别用这个组合包，按需单独装上面四个包（见各包 README）。

## 安装

```sh
dsh plugin --profile web add @lijcoder/dsh-notify-wecom
```

装完**重启该 profile 的进程**——插件模块代码不参与热重载。本地 checkout 用：

```sh
pnpm --dir <dsh-plugins> build
dsh plugin --profile web add <dsh-plugins>/packages/dsh-notify-wecom
```

> ⚠️ 光在自己 profile 的 `cordis.patch.yml` 里手写这几行是**不够的**：
> 启动器找不到对应的 bundle 会直接丢掉该行，只打一句警告。必须走 `dsh plugin add`。
> 也不能对着正在运行的 profile 跑 `--dump-config`——它会重写该 profile 的 `cordis.yml`。

## 配置

四行共用**同一个启用开关**：三个环境变量齐了才启用，缺任意一个整条链路一起停用，
所以装完没配好不会让 profile 起不来。

```sh
export WECOM_NOTIFY_BOT_ID=...
export WECOM_NOTIFY_BOT_SECRET=...
export WECOM_NOTIFY_TARGET=chatid或userid
```

想写死凭证或改默认值，在自己 profile 的 `cordis.patch.yml` 里按 id 覆盖。两点注意：

1. 补丁**整块替换 `config`**，覆盖时要写全该行需要的键；
2. bundle 层的 `disabled` 会**继续生效**（补丁不写 `disabled` 就沿用），
   所以不靠环境变量启用时，**三行都要显式写 `disabled: false`**（`im` 接缝行不需要）。

```yaml
- id: im-wecom
  disabled: false
  config:
    botId: 'your-bot-id'
    secret: 'your-bot-secret'
- id: notify
  disabled: false
  config:
    channel: wecom
    target: 'your-chatid'
    heading: 'DSH 任务完成'
    includeSubagents: false
- id: im-commands
  disabled: false
  config:
    channel: wecom
```

各行的全部字段见对应包的 README。

## 你会收到什么

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

在企微里发 `/list`（一级目录、二级会话）：

```
## 🖥 DSH 会话（3）

**`~/work/ai/dsh-plugins`**
> 会话：修复登录超时 · 状态：🏃 运行中 · sessionId：session-1a4cd73a-…

**`~/work/ai/test/chat`**
> 会话：Greeting · 状态：🏃 运行中 · sessionId：session-92bfcaee-…
> 会话：随手问问 · 状态：💤 空闲 · sessionId：session-2ffacbca-…
```

`/help` 列出所有命令；不是命令的普通聊天不回复；未知命令回一条带 `/help` 的提示。

> 表格是被**降级**后的样子：企微这条 markdown 通道不支持表格，通道自己把表格渲染成
> 「加粗首列 + 引用块」。换成支持表格的通道（如飞书）会渲染成真表格，功能代码一行不改。

## 验证

```sh
pnpm --filter @lijcoder/dsh-notify-wecom test
```

4 个**组合端到端**用例：四个包挂在同一个真实 cordis Context 上，对着本地 Mock 企微
长连接服务端跑，断言用户真正看到的帧——通知的 markdown、`/list` 的分组清单、`/help`、
普通聊天不回复、dispose 后长连接确实关掉。

单包测试各自绿不代表组合起来能跑通，这一层是唯一验证组合的地方。

## 注意与限制

- **同一个 botId 的长连接只能有一个**：企微会把旧连接踢掉。别让第二个进程或第二个
  profile 用同一个 `botId`。
- **授权通知只是提醒**：不能在企微里批准，得回会话处理。要支持从企微批准，得先做
  「IM 消息驱动 dsh」那条链路。
- **markdown 是这条通道的子集**：支持 `##`、`**加粗**`、`` `行内代码` ``、`>` 引用块；
  不支持 `<font color>`（会原样打出）、表格、代码块。
- **不补发历史**：插件加载前已结束的回合不会通知。
- **进程内无持久队列**：dsh 崩溃时正在发送的通知会丢，不做重试队列。
- **`/list` 只覆盖当前进程内存里的会话**：没加载进内存的历史会话、其它进程看不到。
