# 企微全家桶（profile 组合包）

**这是唯一的安装入口**——企业微信通道 + 任务完成/授权通知 + `/` 命令，一条命令装齐：

```sh
dsh plugin --profile web add @lijcoder/dsh-im-wecom-profile
```

它自己**不含任何代码**：运行时内容就是那份 [`cordis.patch.yml`](cordis.patch.yml)，
`src/index.ts` 只有一行 `export {}`（与 dsh 自己的 `agent-team-profile` 同形）。

## 为什么成员包不能单独装

四个成员包——[`dsh-im`](../dsh-im)、[`dsh-im-wecom`](../dsh-im-wecom)、
[`dsh-notify`](../dsh-notify)、[`dsh-im-commands`](../dsh-im-commands)——是**纯库**，
不带 `dsh.bundle`。

cordis 里「激活」的单位是 **bundle 的 patch**，不是包：`dsh plugin add 某个纯库` 只会把它
作为普通依赖装进 profile，打一句 `declares no dsh.bundle` 的警告，**不激活任何行**。
所以这套东西只能从本组合包装起。

这么设计是为了**从根上排除一种静默故障**：如果成员包各自也带 patch，那么
「组合包 + 成员包」同时装就会让同一个 row id 被插两次——而 cordis 的 `insert` 是
无条件追加、不按 id 去重（[`applyEntryPatches`](https://github.com/deepseek-ai/deepseek-harness/blob/main/vendor/include/src/index.ts)
就是 `data.push(...insert)`），结果是插件**挂载两次**：通知发两遍、企微两条长连接互相踢线。
成员不带 patch，这个组合就不存在。

dsh 自己也是这么做的：`agent-team-profile` 插的三行，对应三个都是纯库的包。

代价是**加平台 = 加一个组合包**，而不是加一个可单独安装的插件。以后接飞书时，
`dsh-im-feishu` 是纯库，再由一个「企微 + 飞书」的组合包把五行一次插进去——
profile 组合包表达的是「一套配置」，本来就是这个粒度。

## 它插哪四行

| row id | 包 | 作用 |
| --- | --- | --- |
| `im` | `@lijcoder/dsh-im` | 接缝：`ctx.im` 通道注册表 |
| `im-wecom` | `@lijcoder/dsh-im-wecom` | 企微 aibot 长连接 |
| `notify` | `@lijcoder/dsh-notify` | 完成 / 授权通知（`channel` 钉成 `wecom`） |
| `im-commands` | `@lijcoder/dsh-im-commands` | `/list`、`/help` |

行序**不**决定激活顺序（loader 先 await import 模块再创建 fiber，且不等激活）；这里按「接缝 → 通道 → 功能」排只是读起来清楚——功能都从接缝取入站消息，不要求通道先就位。

## 配置

缺少配置时**四行一起停用**（一个开关管整条链路），所以装完没配好不会让 profile 起不来：

```sh
export WECOM_BOT_ID=...
export WECOM_BOT_SECRET=...
export IM_NOTIFY_TARGET=chatid或userid
```

> ⚠️ 变量名**不能以 `DSH_` 开头**。启动器把 `DSH_` / `XDG_` / `DYLD_` / `BASH_FUNC_`
> 保留给引导变量，写进 `.env` 文件会让 dsh **直接报错退出**（不是忽略）。
> 这三个名字同时也能写进 `<启动目录>/.env` 或 `$DSH_HOME/.env`，两者都会生效。

想写死凭证或改默认值，在自己 profile 的 `cordis.patch.yml` 里按 id 覆盖：

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
- id: im-commands
  disabled: false
```

两点注意：

1. 补丁**整块替换 `config`**，覆盖时要写全该行需要的键；
2. bundle 层的 `disabled` 会**继续生效**（补丁不写 `disabled` 就沿用），
   所以不靠环境变量启用时，**三行都要显式写 `disabled: false`**（`im` 接缝行不需要）。

## 你会收到什么

```
## ✅ DSH 任务通知

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
## 🔐 DSH 授权通知
> **会话**：修复登录超时
> **工具**：`write`
> **Session**：`sess-abc123`

**原因**
允许本次操作使用 danger-full-access 权限：要在主目录创建 xxx.md，该路径超出工作区白名单。

DSH 正在等你的授权，请回到会话里处理。
```

在企微里发 `/list`（标题括号后是运行数；一级目录、二级会话，空首格表示与上一行同目录）：

```
## 🖥 DSH 会话（3）· 🏃 2 个运行中

| 目录 | 会话 | 状态 | sessionId |
| --- | --- | --- | --- |
| ~/work/ai/dsh-plugins | 修复登录超时 | 🏃 运行中 | session-1a4cd73a-… |
|  | 随手问问 | 💤 空闲 | session-2ffacbca-… |
| ~/work/ai/test/chat | Greeting | 🏃 运行中 | session-92bfcaee-… |
```

`/help` 列出所有命令；不是命令的普通聊天不回复；未知命令回一条带 `/help` 的提示。

## 验证

```sh
pnpm --filter @lijcoder/dsh-im-wecom-profile test
```

用例把 patch 当**结构**断言（row id、每行的完整包名、`disabled` 读哪几个环境变量），
并额外断言**四个成员包确实没有各自的 patch**——那是这套设计成立的前提，
不该只靠人记得。真正的跨包端到端（四个包挂在同一个 Context 上对着 Mock 企微服务端跑）
在 [`dsh-im-wecom/tests/e2e.test.ts`](../dsh-im-wecom/tests/e2e.test.ts)。

## 注意与限制

- **同一个 botId 的长连接只能有一个**：企微会把旧连接踢掉。别让第二个进程或第二个
  profile 用同一个 `botId`。
- **授权通知只是提醒**：不能在企微里批准，得回会话处理。
- **markdown 是这条通道的子集**：支持 `##`、`**加粗**`、`` `行内代码` ``、`>` 引用块、
  标准 markdown 表格；**不支持** `<font color>`（会原样打出，所以状态只用 emoji 表达）。
- **不补发历史**：插件加载前已结束的回合不会通知。
- **`/list` 只覆盖当前进程内存里的会话**：没加载进内存的历史会话、其它进程看不到。
