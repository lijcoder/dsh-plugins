# @lijcoder/dsh-im-wecom-profile

## 概要

企微全家桶：企业微信通道 + 任务完成/授权通知 + `/` 命令，一条命令装齐 [`dsh-im`](../dsh-im)、[`dsh-im-wecom`](../dsh-im-wecom)、[`dsh-notify`](../dsh-notify)、[`dsh-im-commands`](../dsh-im-commands) 四个包。

这是本仓库唯一的安装入口。它自己不含任何代码：运行时内容就是那份 [`cordis.patch.yml`](cordis.patch.yml)，`src/index.ts` 只有一行 `export {}`（与 dsh 自己的 `agent-team-profile` 同形）。

## 目录

- [使用](#使用)
- [配置](#配置)
- [了解实现](#了解实现)
- [延伸阅读](#延伸阅读)
- [已知限制与待办](#已知限制与待办)

## 使用

### 装进 profile

```sh
dsh plugin --profile web add @lijcoder/dsh-im-wecom-profile
dsh plugin --profile web remove @lijcoder/dsh-im-wecom-profile
```

本地 checkout 把包名换成 `./packages/dsh-im-wecom-profile`（先 `pnpm build`）。装完重启该 profile 的进程——插件模块代码不参与热重载。

成员包里任何一个单独 `add` 都不生效：`dsh plugin add` 一个不带 `dsh.bundle` 的包只把它作为普通依赖装进 profile，打一句 `declares no dsh.bundle` 的警告，不激活任何行。

### 它插哪四行

| row id | 包 | 作用 |
| --- | --- | --- |
| `im` | `@lijcoder/dsh-im` | 接缝：`ctx.im` 通道注册表 |
| `im-wecom` | `@lijcoder/dsh-im-wecom` | 企微 aibot 长连接 |
| `notify` | `@lijcoder/dsh-notify` | 完成 / 授权通知（`channel` 钉成 `wecom`） |
| `im-commands` | `@lijcoder/dsh-im-commands` | `/list`、`/help` |

行序不影响激活顺序（见 [AGENTS.md](../../AGENTS.md) 的「行序不决定激活顺序」）；按「接缝 → 通道 → 功能」排只是读起来清楚。

### 装完能看到什么

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

在企微里发 `/list`：

```
## 🖥 DSH 会话（3）· 🏃 2 个运行中

**~/work/ai/dsh-plugins**

| 会话 | 状态 | sessionId |
| --- | --- | --- |
| 修复登录超时 | 🏃 运行中 | session-1a4cd73a-… |
| 随手问问 | 💤 空闲 | session-2ffacbca-… |

**~/work/ai/test/chat**

| 会话 | 状态 | sessionId |
| --- | --- | --- |
| Greeting | 🏃 运行中 | session-92bfcaee-… |
```

`/help` 列出所有命令；不是命令的普通聊天不回复；未知命令回一条带 `/help` 的提示。

## 配置

缺少配置时除 `im` 接缝行外的三行一起停用（一个开关管整条链路），所以装完没配好不会让 profile 起不来：

```sh
export WECOM_BOT_ID=...
export WECOM_BOT_SECRET=...
export IM_NOTIFY_TARGET=chatid或userid
```

这些名字也能写进 `<启动目录>/.env` 或 `$DSH_HOME/.env`，两者都会生效。变量名不能以保留前缀（`DSH_` / `XDG_` / `DYLD_` / `BASH_FUNC_`）开头，否则会让 dsh 报错退出。

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

两点注意：补丁整块替换 `config`，覆盖时要写全该行需要的键；bundle 层的 `disabled` 继续生效，所以不靠环境变量启用时三行都要显式写 `disabled: false`（`im` 接缝行不需要）。

## 了解实现

<details>
<summary>实现细节（维护者向）——点开</summary>

[`cordis.patch.yml`](cordis.patch.yml) 只做一件事：往 profile 里插四行，`im` 之外的三个由「`WECOM_BOT_ID`、`WECOM_BOT_SECRET`、`IM_NOTIFY_TARGET` 三个变量齐了」统一开关，缺配置时整行 `disabled`。

四个成员包是纯库，不带 `dsh.bundle`。理由与代价见 [AGENTS.md](../../AGENTS.md) 的「安装入口只能是组合包」；`tests/patch.test.ts` 把 patch 当结构断言，其中一条就是「成员不得带 `dsh.bundle`」——那是这套设计成立的前提，不该只靠人记得。

</details>

## 延伸阅读

- 仓库取向与包表：[README](../../README.md)
- 接缝契约：[`@lijcoder/dsh-im`](../dsh-im)
- 企微通道的渲染与配置：[`@lijcoder/dsh-im-wecom`](../dsh-im-wecom)
- 跨包端到端用例（四个包挂在同一个 Context 上对 Mock 企微服务端跑）：[`dsh-im-wecom/tests/e2e.test.ts`](../dsh-im-wecom/tests/e2e.test.ts)

## 已知限制与待办

成员包各自的行为细节（触发时机、渲染降级、命令语义）写在它们的 README 里；这里只列装完会碰到的边界：

- 同一个 botId 的长连接只能有一个：企微会把旧连接踢掉。别让第二个进程或第二个 profile 用同一个 `botId`。
- 授权通知只是提醒，不能在企微里批准，得回会话处理。
- 状态只用 emoji 表达、表格能画到什么程度，取决于这条通道的 markdown 子集（见[通道 README](../dsh-im-wecom)）。
- 插件加载前已结束的回合不会补发通知。
- `/list` 只覆盖当前进程内存里的会话：没加载进内存的历史会话、其它进程看不到。
